/**
 * Bookings Update API
 * PATCH /bookings/:id - Update reservation with optimistic locking
 */

const express = require('express');
const router = express.Router();
const { validateReservation, checkDataQuality, formatErrors } = require('../services/validate');
const { normalizeReservation, normalizeExtras, deepMerge } = require('../services/normalize');

/**
 * PATCH /bookings/:id
 * Update reservation with core fields + extras, audit logging, optimistic locking
 */
router.patch('/:id', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const { id } = req.params;
        const updateData = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';
        const reason = req.body._reason || 'Manual update';
        const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;

        // Validate ID
        if (!id || isNaN(parseInt(id))) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Invalid reservation ID'
            });
        }

        // Get current reservation for optimistic locking
        const currentQuery = `
            SELECT * FROM reservations 
            WHERE id = $1 AND is_deleted = FALSE
            FOR UPDATE
        `;
        
        const currentResult = await client.query(currentQuery, [id]);

        if (currentResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const currentReservation = currentResult.rows[0];

        // Check optimistic locking
        const ifUnmodifiedSince = req.headers['if-unmodified-since'];
        const providedVersion = req.body._lock_version;

        if (ifUnmodifiedSince) {
            const lastModified = new Date(currentReservation.updated_at);
            const clientVersion = new Date(ifUnmodifiedSince);
            
            if (lastModified > clientVersion) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    message: 'Reservation has been modified by another user',
                    current_version: lastModified.toISOString(),
                    error_code: 'CONFLICT_TIMESTAMP'
                });
            }
        }

        if (providedVersion && providedVersion !== currentReservation.lock_version) {
            await client.query('ROLLBACK');
            return res.status(409).json({
                success: false,
                message: 'Reservation has been modified by another user',
                current_version: currentReservation.lock_version,
                provided_version: providedVersion,
                error_code: 'CONFLICT_VERSION'
            });
        }

        // Get field definitions for validation
        const fieldDefsQuery = `
            SELECT key, label, type, required, pattern, options, category
            FROM field_defs 
            WHERE is_active = TRUE
        `;
        
        const fieldDefsResult = await client.query(fieldDefsQuery);
        const fieldDefs = fieldDefsResult.rows;

        // Separate core fields and extras
        const { extras: newExtras, _reason, _lock_version, ...coreUpdates } = updateData;

        // Merge with current data
        const mergedCore = { ...currentReservation, ...coreUpdates };
        const mergedExtras = deepMerge(currentReservation.extras || {}, newExtras || {});

        // Normalize data
        const normalizedCore = normalizeReservation(mergedCore);
        const normalizedExtras = normalizeExtras(mergedExtras, fieldDefs);

        // Validate data
        const validation = validateReservation(
            { ...normalizedCore, extras: normalizedExtras }, 
            fieldDefs
        );

        if (!validation.valid) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: formatErrors(validation.errors)
            });
        }

        // Check data quality and update flags
        const flags = checkDataQuality({ ...normalizedCore, extras: normalizedExtras }, fieldDefs);

        // Set actor for audit trigger
        await client.query(`SET LOCAL app.current_actor = $1`, [actor]);

        // Update reservation
        const updateQuery = `
            UPDATE reservations SET
                reservation_number = $2,
                confirmation_number = $3,
                channel = $4,
                platform_name = $5,
                product_name = $6,
                package_type = $7,
                total_amount = $8,
                quantity = $9,
                guest_count = $10,
                korean_name = $11,
                english_first_name = $12,
                english_last_name = $13,
                email = $14,
                phone = $15,
                kakao_id = $16,
                people_adult = $17,
                people_child = $18,
                people_infant = $19,
                adult_unit_price = $20,
                child_unit_price = $21,
                usage_date = $22,
                usage_time = $23,
                reservation_datetime = $24,
                payment_status = $25,
                review_status = $26,
                memo = $27,
                extras = $28,
                flags = $29,
                updated_at = NOW(),
                lock_version = lock_version + 1
            WHERE id = $1
            RETURNING *
        `;

        const updateValues = [
            id,
            normalizedCore.reservation_number,
            normalizedCore.confirmation_number,
            normalizedCore.channel,
            normalizedCore.platform_name,
            normalizedCore.product_name,
            normalizedCore.package_type,
            normalizedCore.total_amount,
            normalizedCore.quantity,
            normalizedCore.guest_count,
            normalizedCore.korean_name,
            normalizedCore.english_first_name,
            normalizedCore.english_last_name,
            normalizedCore.email,
            normalizedCore.phone,
            normalizedCore.kakao_id,
            normalizedCore.people_adult,
            normalizedCore.people_child,
            normalizedCore.people_infant,
            normalizedCore.adult_unit_price,
            normalizedCore.child_unit_price,
            normalizedCore.usage_date,
            normalizedCore.usage_time,
            normalizedCore.reservation_datetime,
            normalizedCore.payment_status,
            normalizedCore.review_status,
            normalizedCore.memo,
            JSON.stringify(normalizedExtras),
            JSON.stringify(flags)
        ];

        const updateResult = await client.query(updateQuery, updateValues);
        const updatedReservation = updateResult.rows[0];

        // Create manual audit entry with detailed diff
        const auditQuery = `
            SELECT create_reservation_audit($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `;

        // Calculate diff between old and new
        const diff = {};
        Object.keys(updateData).forEach(key => {
            if (key.startsWith('_')) return; // Skip meta fields
            
            if (key === 'extras') {
                const oldExtras = currentReservation.extras || {};
                const newExtrasData = normalizedExtras;
                
                Object.keys(newExtrasData).forEach(extrasKey => {
                    if (oldExtras[extrasKey] !== newExtrasData[extrasKey]) {
                        diff[`extras.${extrasKey}`] = {
                            old: oldExtras[extrasKey],
                            new: newExtrasData[extrasKey]
                        };
                    }
                });
            } else if (currentReservation[key] !== normalizedCore[key]) {
                diff[key] = {
                    old: currentReservation[key],
                    new: normalizedCore[key]
                };
            }
        });

        await client.query(auditQuery, [
            id,
            actor,
            'update',
            JSON.stringify(diff),
            JSON.stringify(currentReservation),
            JSON.stringify(updatedReservation),
            reason,
            req.ip,
            req.headers['user-agent'],
            requestId
        ]);

        await client.query('COMMIT');

        // Response
        res.json({
            success: true,
            message: 'Reservation updated successfully',
            data: updatedReservation,
            validation: {
                flags,
                needs_review: flags.missing.length > 0 || flags.ambiguous.length > 0
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.update',
                    booking_id: id,
                    actor,
                    changes: Object.keys(diff)
                })}\n\n`);
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Booking update error:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Duplicate reservation number',
                error_code: 'DUPLICATE_RESERVATION_NUMBER'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to update reservation',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * PATCH /bookings/:id/status
 * Quick status update (payment_status or review_status)
 */
router.patch('/:id/status', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;
        const { payment_status, review_status, reason } = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';

        // Validate status values
        const validPaymentStatuses = ['pending', 'confirmed', 'cancelled', 'refunded', 'failed'];
        const validReviewStatuses = ['pending', 'needs_review', 'reviewed', 'confirmed', 'cancelled'];

        if (payment_status && !validPaymentStatuses.includes(payment_status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment status'
            });
        }

        if (review_status && !validReviewStatuses.includes(review_status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid review status'
            });
        }

        // Build update query
        const updates = [];
        const values = [id];
        let paramIndex = 2;

        if (payment_status) {
            updates.push(`payment_status = $${paramIndex}`);
            values.push(payment_status);
            paramIndex++;
        }

        if (review_status) {
            updates.push(`review_status = $${paramIndex}`);
            values.push(review_status);
            paramIndex++;
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No status updates provided'
            });
        }

        updates.push(`updated_at = NOW()`);
        updates.push(`lock_version = lock_version + 1`);

        const query = `
            UPDATE reservations 
            SET ${updates.join(', ')}
            WHERE id = $1 AND is_deleted = FALSE
            RETURNING id, payment_status, review_status, updated_at, lock_version
        `;

        const result = await pool.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        // Create audit log
        const auditQuery = `
            SELECT create_reservation_audit($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)
        `;

        const diff = {};
        if (payment_status) diff.payment_status = { new: payment_status };
        if (review_status) diff.review_status = { new: review_status };

        await pool.query(auditQuery, [
            id,
            actor,
            'update',
            JSON.stringify(diff),
            reason || 'Status update',
            req.ip,
            req.headers['user-agent'],
            `status_${Date.now()}`
        ]);

        res.json({
            success: true,
            message: 'Status updated successfully',
            data: result.rows[0]
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.status_update',
                    booking_id: id,
                    actor,
                    payment_status,
                    review_status
                })}\n\n`);
            });
        }

    } catch (error) {
        console.error('❌ Status update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update status',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
