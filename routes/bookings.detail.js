/**
 * Bookings Detail API
 * GET /bookings/:id - Get single reservation details
 */

const express = require('express');
const router = express.Router();

/**
 * GET /bookings/:id
 * Get reservation details including core fields, extras, flags, and raw_text
 */
router.get('/:id', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;

        // Validate ID
        if (!id || isNaN(parseInt(id))) {
            return res.status(400).json({
                success: false,
                message: 'Invalid reservation ID'
            });
        }

        // Get reservation details
        const query = `
            SELECT 
                id, reservation_number, confirmation_number, channel, platform_name,
                product_name, package_type, total_amount, quantity, guest_count,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                usage_date, usage_time, reservation_datetime, payment_status, review_status,
                code_issued, code_issued_at, memo, extras, flags, origin_hash,
                created_at, updated_at, lock_version
            FROM reservations 
            WHERE id = $1 AND is_deleted = FALSE
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const reservation = result.rows[0];

        // Get field definitions for extras validation
        const fieldDefsQuery = `
            SELECT key, label, type, required, pattern, options, category, help_text
            FROM field_defs 
            WHERE is_active = TRUE 
            ORDER BY category, sort_order
        `;
        
        const fieldDefsResult = await pool.query(fieldDefsQuery);
        const fieldDefs = fieldDefsResult.rows;

        // Get audit history
        const auditQuery = `
            SELECT 
                audit_id, actor, action, diff, reason, ip_address, created_at
            FROM reservation_audits 
            WHERE booking_id = $1 
            ORDER BY created_at DESC 
            LIMIT 20
        `;
        
        const auditResult = await pool.query(auditQuery, [id]);
        const auditHistory = auditResult.rows;

        // Response with complete data
        res.json({
            success: true,
            data: {
                reservation,
                field_definitions: fieldDefs,
                audit_history: auditHistory,
                metadata: {
                    has_extras: reservation.extras && Object.keys(reservation.extras).length > 0,
                    has_flags: reservation.flags && Object.keys(reservation.flags).length > 0,
                    needs_review: reservation.review_status === 'needs_review',
                    is_editable: ['pending', 'needs_review', 'reviewed'].includes(reservation.review_status)
                }
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.view',
                    booking_id: id,
                    actor: req.user?.id || 'anonymous'
                })}\n\n`);
            });
        }

    } catch (error) {
        console.error('❌ Booking detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reservation details',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /bookings/:id/raw
 * Get raw text data for reservation (if available)
 */
router.get('/:id/raw', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;

        // Check if reservation exists and get raw text from drafts
        const query = `
            SELECT rd.raw_text, rd.parsed_json, rd.confidence, rd.extracted_notes
            FROM reservations r
            LEFT JOIN reservation_drafts rd ON rd.committed_reservation_id = r.id
            WHERE r.id = $1 AND r.is_deleted = FALSE
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const rawData = result.rows[0];

        res.json({
            success: true,
            data: {
                raw_text: rawData.raw_text,
                parsed_json: rawData.parsed_json,
                confidence: rawData.confidence,
                extracted_notes: rawData.extracted_notes,
                has_raw_data: !!rawData.raw_text
            }
        });

    } catch (error) {
        console.error('❌ Booking raw data error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch raw data',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /bookings/:id/similar
 * Find similar reservations based on name, email, or phone
 */
router.get('/:id/similar', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;

        // Get current reservation details
        const currentQuery = `
            SELECT korean_name, email, phone 
            FROM reservations 
            WHERE id = $1 AND is_deleted = FALSE
        `;

        const currentResult = await pool.query(currentQuery, [id]);

        if (currentResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reservation not found'
            });
        }

        const current = currentResult.rows[0];

        // Find similar reservations
        let similarQuery = `
            SELECT 
                id, reservation_number, korean_name, email, phone,
                product_name, usage_date, total_amount, payment_status,
                created_at
            FROM reservations 
            WHERE id != $1 AND is_deleted = FALSE
        `;

        const queryParams = [id];
        const conditions = [];

        if (current.korean_name) {
            conditions.push(`korean_name = $${queryParams.length + 1}`);
            queryParams.push(current.korean_name);
        }

        if (current.email) {
            conditions.push(`email = $${queryParams.length + 1}`);
            queryParams.push(current.email);
        }

        if (current.phone) {
            conditions.push(`phone = $${queryParams.length + 1}`);
            queryParams.push(current.phone);
        }

        if (conditions.length > 0) {
            similarQuery += ` AND (${conditions.join(' OR ')})`;
        } else {
            // No matching criteria, return empty result
            return res.json({
                success: true,
                data: []
            });
        }

        similarQuery += ` ORDER BY created_at DESC LIMIT 10`;

        const similarResult = await pool.query(similarQuery, queryParams);

        res.json({
            success: true,
            data: similarResult.rows
        });

    } catch (error) {
        console.error('❌ Similar bookings error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to find similar reservations',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
