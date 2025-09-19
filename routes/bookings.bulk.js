/**
 * Bookings Bulk Operations API
 * POST /bookings/bulk - Perform bulk operations on multiple reservations
 */

const express = require('express');
const router = express.Router();

/**
 * POST /bookings/bulk
 * Perform bulk operations: cancel, status update, export
 */
router.post('/', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const { action, ids, filters, reason, new_status, export_fields } = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';
        const requestId = req.headers['x-request-id'] || `bulk_${Date.now()}`;

        // Validate action
        const validActions = ['cancel', 'status', 'export', 'delete'];
        if (!validActions.includes(action)) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Invalid action. Must be one of: ' + validActions.join(', ')
            });
        }

        let targetIds = [];

        // Get target reservation IDs
        if (ids && Array.isArray(ids) && ids.length > 0) {
            // Use provided IDs
            targetIds = ids.filter(id => !isNaN(parseInt(id))).map(id => parseInt(id));
        } else if (filters) {
            // Build query from filters
            let whereClause = 'WHERE is_deleted = FALSE';
            const queryParams = [];
            let paramIndex = 1;

            if (filters.status) {
                whereClause += ` AND payment_status = $${paramIndex}`;
                queryParams.push(filters.status);
                paramIndex++;
            }

            if (filters.review) {
                whereClause += ` AND review_status = $${paramIndex}`;
                queryParams.push(filters.review);
                paramIndex++;
            }

            if (filters.channel) {
                whereClause += ` AND channel = $${paramIndex}`;
                queryParams.push(filters.channel);
                paramIndex++;
            }

            if (filters.platform) {
                whereClause += ` AND platform_name = $${paramIndex}`;
                queryParams.push(filters.platform);
                paramIndex++;
            }

            if (filters.from) {
                whereClause += ` AND usage_date >= $${paramIndex}`;
                queryParams.push(filters.from);
                paramIndex++;
            }

            if (filters.to) {
                whereClause += ` AND usage_date <= $${paramIndex}`;
                queryParams.push(filters.to);
                paramIndex++;
            }

            if (filters.q) {
                whereClause += ` AND (
                    reservation_number ILIKE $${paramIndex} OR
                    korean_name ILIKE $${paramIndex} OR
                    email ILIKE $${paramIndex}
                )`;
                queryParams.push(`%${filters.q}%`);
                paramIndex++;
            }

            const idsQuery = `SELECT id FROM reservations ${whereClause} LIMIT 1000`;
            const idsResult = await client.query(idsQuery, queryParams);
            targetIds = idsResult.rows.map(row => row.id);
        }

        if (targetIds.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'No reservations found to process'
            });
        }

        // Limit bulk operations for safety
        if (targetIds.length > 1000) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Too many reservations selected. Maximum 1000 allowed.'
            });
        }

        let results = [];

        // Set actor for audit trigger
        await client.query(`SET LOCAL app.current_actor = $1`, [actor]);

        switch (action) {
            case 'cancel':
                results = await performBulkCancel(client, targetIds, reason, actor, requestId, req);
                break;
            
            case 'status':
                if (!new_status) {
                    await client.query('ROLLBACK');
                    return res.status(400).json({
                        success: false,
                        message: 'new_status is required for status update'
                    });
                }
                results = await performBulkStatusUpdate(client, targetIds, new_status, reason, actor, requestId, req);
                break;
            
            case 'export':
                await client.query('ROLLBACK'); // No transaction needed for export
                return await performBulkExport(req.app.locals.pool, targetIds, export_fields, res);
            
            case 'delete':
                results = await performBulkDelete(client, targetIds, reason, actor, requestId, req);
                break;
        }

        await client.query('COMMIT');

        // Response
        res.json({
            success: true,
            message: `Bulk ${action} completed`,
            data: {
                processed_count: results.length,
                target_count: targetIds.length,
                results: results.slice(0, 10), // Show first 10 results
                has_more: results.length > 10
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.bulk_operation',
                    action,
                    actor,
                    processed_count: results.length,
                    target_count: targetIds.length
                })}\n\n`);
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Bulk operation error:', error);
        
        res.status(500).json({
            success: false,
            message: 'Bulk operation failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * Perform bulk cancellation
 */
async function performBulkCancel(client, targetIds, reason, actor, requestId, req) {
    const results = [];

    for (const id of targetIds) {
        try {
            // Get current reservation
            const currentQuery = `
                SELECT id, reservation_number, payment_status, korean_name
                FROM reservations 
                WHERE id = $1 AND is_deleted = FALSE AND payment_status != 'cancelled'
            `;
            
            const currentResult = await client.query(currentQuery, [id]);
            
            if (currentResult.rows.length === 0) {
                results.push({ id, status: 'skipped', reason: 'Already cancelled or not found' });
                continue;
            }

            const reservation = currentResult.rows[0];

            // Update to cancelled
            const updateQuery = `
                UPDATE reservations 
                SET payment_status = 'cancelled',
                    review_status = 'cancelled',
                    updated_at = NOW(),
                    lock_version = lock_version + 1
                WHERE id = $1
            `;

            await client.query(updateQuery, [id]);

            // Create audit entry
            const auditQuery = `
                SELECT create_reservation_audit($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)
            `;

            await client.query(auditQuery, [
                id,
                actor,
                'bulk_cancel',
                JSON.stringify({ payment_status: { old: reservation.payment_status, new: 'cancelled' } }),
                reason || 'Bulk cancellation',
                req.ip,
                req.headers['user-agent'],
                `${requestId}_${id}`
            ]);

            results.push({ 
                id, 
                status: 'success', 
                reservation_number: reservation.reservation_number,
                korean_name: reservation.korean_name
            });

        } catch (error) {
            console.error(`❌ Failed to cancel reservation ${id}:`, error.message);
            results.push({ id, status: 'error', reason: error.message });
        }
    }

    return results;
}

/**
 * Perform bulk status update
 */
async function performBulkStatusUpdate(client, targetIds, newStatus, reason, actor, requestId, req) {
    const results = [];
    const validStatuses = ['pending', 'confirmed', 'cancelled', 'refunded', 'failed'];

    if (!validStatuses.includes(newStatus)) {
        throw new Error('Invalid status');
    }

    for (const id of targetIds) {
        try {
            // Get current reservation
            const currentQuery = `
                SELECT id, reservation_number, payment_status, korean_name
                FROM reservations 
                WHERE id = $1 AND is_deleted = FALSE
            `;
            
            const currentResult = await client.query(currentQuery, [id]);
            
            if (currentResult.rows.length === 0) {
                results.push({ id, status: 'skipped', reason: 'Not found' });
                continue;
            }

            const reservation = currentResult.rows[0];

            if (reservation.payment_status === newStatus) {
                results.push({ id, status: 'skipped', reason: 'Already in target status' });
                continue;
            }

            // Update status
            const updateQuery = `
                UPDATE reservations 
                SET payment_status = $2,
                    updated_at = NOW(),
                    lock_version = lock_version + 1
                WHERE id = $1
            `;

            await client.query(updateQuery, [id, newStatus]);

            // Create audit entry
            const auditQuery = `
                SELECT create_reservation_audit($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)
            `;

            await client.query(auditQuery, [
                id,
                actor,
                'bulk_update',
                JSON.stringify({ payment_status: { old: reservation.payment_status, new: newStatus } }),
                reason || 'Bulk status update',
                req.ip,
                req.headers['user-agent'],
                `${requestId}_${id}`
            ]);

            results.push({ 
                id, 
                status: 'success', 
                reservation_number: reservation.reservation_number,
                korean_name: reservation.korean_name,
                old_status: reservation.payment_status,
                new_status: newStatus
            });

        } catch (error) {
            console.error(`❌ Failed to update reservation ${id}:`, error.message);
            results.push({ id, status: 'error', reason: error.message });
        }
    }

    return results;
}

/**
 * Perform bulk delete (hard delete)
 */
async function performBulkDelete(client, targetIds, reason, actor, requestId, req) {
    const results = [];

    for (const id of targetIds) {
        try {
            // Get current reservation
            const currentQuery = `
                SELECT id, reservation_number, korean_name
                FROM reservations 
                WHERE id = $1 AND is_deleted = FALSE
            `;
            
            const currentResult = await client.query(currentQuery, [id]);
            
            if (currentResult.rows.length === 0) {
                results.push({ id, status: 'skipped', reason: 'Already deleted or not found' });
                continue;
            }

            const reservation = currentResult.rows[0];

            // Hard delete
            const updateQuery = `
                UPDATE reservations 
                SET is_deleted = TRUE,
                    updated_at = NOW(),
                    lock_version = lock_version + 1
                WHERE id = $1
            `;

            await client.query(updateQuery, [id]);

            // Create audit entry
            const auditQuery = `
                SELECT create_reservation_audit($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)
            `;

            await client.query(auditQuery, [
                id,
                actor,
                'bulk_delete',
                JSON.stringify({ is_deleted: { old: false, new: true } }),
                reason || 'Bulk deletion',
                req.ip,
                req.headers['user-agent'],
                `${requestId}_${id}`
            ]);

            results.push({ 
                id, 
                status: 'success', 
                reservation_number: reservation.reservation_number,
                korean_name: reservation.korean_name
            });

        } catch (error) {
            console.error(`❌ Failed to delete reservation ${id}:`, error.message);
            results.push({ id, status: 'error', reason: error.message });
        }
    }

    return results;
}

/**
 * Perform bulk export
 */
async function performBulkExport(pool, targetIds, exportFields, res) {
    try {
        // Default export fields
        const defaultFields = [
            'id', 'reservation_number', 'korean_name', 'email', 'phone',
            'product_name', 'usage_date', 'total_amount', 'payment_status',
            'created_at'
        ];

        const fields = exportFields && Array.isArray(exportFields) && exportFields.length > 0 
            ? exportFields 
            : defaultFields;

        // Validate fields
        const allowedFields = [
            'id', 'reservation_number', 'confirmation_number', 'channel', 'platform_name',
            'product_name', 'package_type', 'total_amount', 'quantity', 'guest_count',
            'korean_name', 'english_first_name', 'english_last_name', 'email', 'phone', 'kakao_id',
            'people_adult', 'people_child', 'people_infant', 'adult_unit_price', 'child_unit_price',
            'usage_date', 'usage_time', 'reservation_datetime', 'payment_status', 'review_status',
            'code_issued', 'memo', 'created_at', 'updated_at'
        ];

        const validFields = fields.filter(field => allowedFields.includes(field));
        
        if (validFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid export fields specified'
            });
        }

        // Get reservations
        const placeholders = targetIds.map((_, index) => `$${index + 1}`).join(',');
        const query = `
            SELECT ${validFields.join(', ')}
            FROM reservations 
            WHERE id IN (${placeholders}) AND is_deleted = FALSE
            ORDER BY created_at DESC
        `;

        const result = await pool.query(query, targetIds);

        // Generate CSV
        const csv = generateCSV(result.rows, validFields);

        // Send CSV response
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="reservations_export_${Date.now()}.csv"`);
        res.send(csv);

    } catch (error) {
        console.error('❌ Bulk export error:', error);
        res.status(500).json({
            success: false,
            message: 'Export failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
}

/**
 * Generate CSV from data
 */
function generateCSV(data, fields) {
    if (data.length === 0) {
        return fields.join(',') + '\n';
    }

    // Header row
    const header = fields.join(',');
    
    // Data rows
    const rows = data.map(row => {
        return fields.map(field => {
            let value = row[field];
            
            // Handle null/undefined
            if (value === null || value === undefined) {
                value = '';
            }
            
            // Handle dates
            if (value instanceof Date) {
                value = value.toISOString();
            }
            
            // Handle objects (like extras)
            if (typeof value === 'object') {
                value = JSON.stringify(value);
            }
            
            // Escape CSV special characters
            value = String(value);
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            
            return value;
        }).join(',');
    });

    return header + '\n' + rows.join('\n');
}

module.exports = router;
