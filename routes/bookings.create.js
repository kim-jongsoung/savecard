/**
 * Bookings Create API
 * POST /bookings - Create new reservation manually
 */

const express = require('express');
const router = express.Router();
const { validateReservation, checkDataQuality, formatErrors } = require('../services/validate');
const { normalizeReservation, normalizeExtras, generateOriginHash } = require('../services/normalize');

/**
 * POST /bookings
 * Create new reservation with core fields + extras
 */
router.post('/', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const reservationData = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';
        const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;

        // Get field definitions for validation
        const fieldDefsQuery = `
            SELECT key, label, type, required, pattern, options, category
            FROM field_defs 
            WHERE is_active = TRUE
        `;
        
        const fieldDefsResult = await client.query(fieldDefsQuery);
        const fieldDefs = fieldDefsResult.rows;

        // Separate core fields and extras
        const { extras, ...coreData } = reservationData;

        // Normalize data
        const normalizedCore = normalizeReservation(coreData);
        const normalizedExtras = normalizeExtras(extras || {}, fieldDefs);

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

        // Check data quality and generate flags
        const flags = checkDataQuality({ ...normalizedCore, extras: normalizedExtras }, fieldDefs);

        // Generate origin hash if raw text provided
        const originHash = reservationData._raw_text ? 
            generateOriginHash(reservationData._raw_text) : null;

        // Check for duplicate reservation
        if (normalizedCore.reservation_number) {
            const duplicateQuery = `
                SELECT id FROM reservations 
                WHERE reservation_number = $1 AND channel = $2 AND is_deleted = FALSE
            `;
            
            const duplicateResult = await client.query(duplicateQuery, [
                normalizedCore.reservation_number,
                normalizedCore.channel
            ]);

            if (duplicateResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    success: false,
                    message: 'Duplicate reservation number for this channel',
                    existing_id: duplicateResult.rows[0].id,
                    error_code: 'DUPLICATE_RESERVATION'
                });
            }
        }

        // Set actor for audit trigger
        await client.query(`SET LOCAL app.current_actor = $1`, [actor]);

        // Insert reservation
        const insertQuery = `
            INSERT INTO reservations (
                reservation_number, confirmation_number, channel, platform_name, product_name,
                package_type, total_amount, quantity, guest_count,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                usage_date, usage_time, reservation_datetime, payment_status, review_status,
                code_issued, memo, extras, flags, origin_hash
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27, $28, $29, $30
            ) RETURNING *
        `;

        const insertValues = [
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
            normalizedCore.code_issued || false,
            normalizedCore.memo,
            JSON.stringify(normalizedExtras),
            JSON.stringify(flags),
            originHash
        ];

        const insertResult = await client.query(insertQuery, insertValues);
        const newReservation = insertResult.rows[0];

        // Create audit entry (creation is automatically logged by trigger, but add manual entry with more details)
        const auditQuery = `
            SELECT create_reservation_audit($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
        `;

        await client.query(auditQuery, [
            newReservation.id,
            actor,
            'create',
            JSON.stringify({ source: 'manual_creation', has_raw_text: !!reservationData._raw_text }),
            JSON.stringify(newReservation),
            'Manual reservation creation',
            req.ip,
            req.headers['user-agent'],
            requestId
        ]);

        await client.query('COMMIT');

        // Response
        res.status(201).json({
            success: true,
            message: 'Reservation created successfully',
            data: newReservation,
            validation: {
                flags,
                needs_review: flags.missing.length > 0 || flags.ambiguous.length > 0
            }
        });

        // Send SSE event
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.create',
                    booking_id: newReservation.id,
                    actor,
                    reservation_number: newReservation.reservation_number
                })}\n\n`);
            });
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Booking creation error:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Duplicate reservation number or constraint violation',
                error_code: 'CONSTRAINT_VIOLATION'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create reservation',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * POST /bookings/import
 * Import reservation from parsed text (integration with existing parsing system)
 */
router.post('/import', async (req, res) => {
    try {
        const { parsed_data, raw_text, parsing_method = 'manual', confidence = 0.8 } = req.body;
        const actor = req.user?.id || req.headers['x-actor'] || 'system';

        if (!parsed_data) {
            return res.status(400).json({
                success: false,
                message: 'Parsed data is required'
            });
        }

        // Add metadata to parsed data
        const reservationData = {
            ...parsed_data,
            _raw_text: raw_text,
            review_status: confidence >= 0.9 ? 'reviewed' : 'needs_review'
        };

        // Forward to create endpoint
        req.body = reservationData;
        req.headers['x-actor'] = actor;
        req.headers['x-parsing-method'] = parsing_method;
        req.headers['x-confidence'] = confidence.toString();

        // Call the main create handler
        return router.handle(
            { ...req, method: 'POST', url: '/' },
            res,
            () => {}
        );

    } catch (error) {
        console.error('❌ Booking import error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to import reservation',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * POST /bookings/validate
 * Validate reservation data without saving
 */
router.post('/validate', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const reservationData = req.body;

        // Get field definitions
        const fieldDefsQuery = `
            SELECT key, label, type, required, pattern, options, category
            FROM field_defs 
            WHERE is_active = TRUE
        `;
        
        const fieldDefsResult = await pool.query(fieldDefsQuery);
        const fieldDefs = fieldDefsResult.rows;

        // Separate core and extras
        const { extras, ...coreData } = reservationData;

        // Normalize data
        const normalizedCore = normalizeReservation(coreData);
        const normalizedExtras = normalizeExtras(extras || {}, fieldDefs);

        // Validate data
        const validation = validateReservation(
            { ...normalizedCore, extras: normalizedExtras }, 
            fieldDefs
        );

        // Check data quality
        const flags = checkDataQuality({ ...normalizedCore, extras: normalizedExtras }, fieldDefs);

        // Check for duplicates
        let duplicateCheck = null;
        if (normalizedCore.reservation_number) {
            const duplicateQuery = `
                SELECT id, korean_name, usage_date 
                FROM reservations 
                WHERE reservation_number = $1 AND channel = $2 AND is_deleted = FALSE
            `;
            
            const duplicateResult = await pool.query(duplicateQuery, [
                normalizedCore.reservation_number,
                normalizedCore.channel
            ]);

            if (duplicateResult.rows.length > 0) {
                duplicateCheck = duplicateResult.rows[0];
            }
        }

        res.json({
            success: true,
            validation: {
                valid: validation.valid,
                errors: validation.valid ? [] : formatErrors(validation.errors),
                flags,
                needs_review: flags.missing.length > 0 || flags.ambiguous.length > 0,
                duplicate_check: duplicateCheck,
                normalized_data: {
                    core: normalizedCore,
                    extras: normalizedExtras
                }
            }
        });

    } catch (error) {
        console.error('❌ Validation error:', error);
        res.status(500).json({
            success: false,
            message: 'Validation failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
