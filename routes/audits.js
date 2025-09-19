/**
 * Audit Logs API
 * GET /bookings/:id/audits - Get audit history for a reservation
 */

const express = require('express');
const router = express.Router();

/**
 * GET /bookings/:id/audits
 * Get audit history for a specific reservation
 */
router.get('/bookings/:id/audits', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { id } = req.params;
        const { page = 1, page_size = 50, action } = req.query;

        // Validate pagination
        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(100, Math.max(1, parseInt(page_size)));
        const offset = (pageNum - 1) * pageSize;

        // Build query
        let whereClause = 'WHERE booking_id = $1';
        const queryParams = [id];
        let paramIndex = 2;

        if (action) {
            whereClause += ` AND action = $${paramIndex}`;
            queryParams.push(action);
            paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM reservation_audits ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);

        // Get audit records
        const auditQuery = `
            SELECT 
                audit_id, booking_id, actor, action, diff, previous_values, 
                current_values, reason, ip_address, user_agent, request_id, created_at
            FROM reservation_audits 
            ${whereClause}
            ORDER BY created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(pageSize, offset);
        const auditResult = await pool.query(auditQuery, queryParams);

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / pageSize);
        const hasNext = pageNum < totalPages;
        const hasPrev = pageNum > 1;

        res.json({
            success: true,
            data: auditResult.rows,
            pagination: {
                page: pageNum,
                page_size: pageSize,
                total_count: totalCount,
                total_pages: totalPages,
                has_next: hasNext,
                has_prev: hasPrev
            }
        });

    } catch (error) {
        console.error('❌ Audit history fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch audit history',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /audits/recent
 * Get recent audit activities across all reservations
 */
router.get('/recent', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { limit = 100, actor, action, hours = 24 } = req.query;

        // Build query
        let whereClause = `WHERE created_at >= NOW() - INTERVAL '${parseInt(hours)} hours'`;
        const queryParams = [];
        let paramIndex = 1;

        if (actor) {
            whereClause += ` AND actor = $${paramIndex}`;
            queryParams.push(actor);
            paramIndex++;
        }

        if (action) {
            whereClause += ` AND action = $${paramIndex}`;
            queryParams.push(action);
            paramIndex++;
        }

        const query = `
            SELECT 
                ra.audit_id, ra.booking_id, ra.actor, ra.action, ra.diff, 
                ra.reason, ra.created_at,
                r.reservation_number, r.korean_name, r.product_name
            FROM reservation_audits ra
            LEFT JOIN reservations r ON ra.booking_id = r.id
            ${whereClause}
            ORDER BY ra.created_at DESC
            LIMIT $${paramIndex}
        `;

        queryParams.push(Math.min(500, Math.max(1, parseInt(limit))));
        const result = await pool.query(query, queryParams);

        res.json({
            success: true,
            data: result.rows,
            metadata: {
                hours_range: parseInt(hours),
                total_records: result.rows.length
            }
        });

    } catch (error) {
        console.error('❌ Recent audits fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch recent audit activities',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /audits/stats
 * Get audit statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { days = 7 } = req.query;

        const statsQuery = `
            SELECT 
                COUNT(*) as total_audits,
                COUNT(DISTINCT booking_id) as unique_bookings,
                COUNT(DISTINCT actor) as unique_actors,
                COUNT(CASE WHEN action = 'create' THEN 1 END) as creates,
                COUNT(CASE WHEN action = 'update' THEN 1 END) as updates,
                COUNT(CASE WHEN action = 'cancel' THEN 1 END) as cancellations,
                COUNT(CASE WHEN action = 'delete' THEN 1 END) as deletions,
                COUNT(CASE WHEN action LIKE 'bulk_%' THEN 1 END) as bulk_operations,
                DATE_TRUNC('day', created_at) as audit_date
            FROM reservation_audits
            WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            GROUP BY DATE_TRUNC('day', created_at)
            ORDER BY audit_date DESC
        `;

        const result = await pool.query(statsQuery);

        // Get top actors
        const actorsQuery = `
            SELECT 
                actor,
                COUNT(*) as action_count,
                COUNT(DISTINCT booking_id) as bookings_affected,
                MAX(created_at) as last_activity
            FROM reservation_audits
            WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            GROUP BY actor
            ORDER BY action_count DESC
            LIMIT 10
        `;

        const actorsResult = await pool.query(actorsQuery);

        // Get action distribution
        const actionsQuery = `
            SELECT 
                action,
                COUNT(*) as count,
                COUNT(DISTINCT booking_id) as unique_bookings
            FROM reservation_audits
            WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
            GROUP BY action
            ORDER BY count DESC
        `;

        const actionsResult = await pool.query(actionsQuery);

        res.json({
            success: true,
            data: {
                daily_stats: result.rows,
                top_actors: actorsResult.rows,
                action_distribution: actionsResult.rows,
                period_days: parseInt(days)
            }
        });

    } catch (error) {
        console.error('❌ Audit stats fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch audit statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /audits/:audit_id
 * Get detailed audit record
 */
router.get('/:audit_id', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { audit_id } = req.params;

        const query = `
            SELECT 
                ra.audit_id, ra.booking_id, ra.actor, ra.action, ra.diff, 
                ra.previous_values, ra.current_values, ra.reason, 
                ra.ip_address, ra.user_agent, ra.request_id, ra.created_at,
                r.reservation_number, r.korean_name, r.product_name, r.payment_status
            FROM reservation_audits ra
            LEFT JOIN reservations r ON ra.booking_id = r.id
            WHERE ra.audit_id = $1
        `;

        const result = await pool.query(query, [audit_id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Audit record not found'
            });
        }

        const audit = result.rows[0];

        // Parse JSON fields safely
        try {
            if (audit.diff) audit.diff = JSON.parse(audit.diff);
            if (audit.previous_values) audit.previous_values = JSON.parse(audit.previous_values);
            if (audit.current_values) audit.current_values = JSON.parse(audit.current_values);
        } catch (parseError) {
            console.warn('⚠️ Failed to parse audit JSON fields:', parseError.message);
        }

        res.json({
            success: true,
            data: audit
        });

    } catch (error) {
        console.error('❌ Audit detail fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch audit details',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * POST /audits/search
 * Advanced audit search with multiple criteria
 */
router.post('/search', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const {
            booking_ids,
            actors,
            actions,
            date_from,
            date_to,
            search_term,
            page = 1,
            page_size = 50
        } = req.body;

        // Validate pagination
        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(100, Math.max(1, parseInt(page_size)));
        const offset = (pageNum - 1) * pageSize;

        // Build dynamic query
        const conditions = [];
        const queryParams = [];
        let paramIndex = 1;

        if (booking_ids && Array.isArray(booking_ids) && booking_ids.length > 0) {
            const placeholders = booking_ids.map(() => `$${paramIndex++}`).join(',');
            conditions.push(`ra.booking_id IN (${placeholders})`);
            queryParams.push(...booking_ids);
        }

        if (actors && Array.isArray(actors) && actors.length > 0) {
            const placeholders = actors.map(() => `$${paramIndex++}`).join(',');
            conditions.push(`ra.actor IN (${placeholders})`);
            queryParams.push(...actors);
        }

        if (actions && Array.isArray(actions) && actions.length > 0) {
            const placeholders = actions.map(() => `$${paramIndex++}`).join(',');
            conditions.push(`ra.action IN (${placeholders})`);
            queryParams.push(...actions);
        }

        if (date_from) {
            conditions.push(`ra.created_at >= $${paramIndex}`);
            queryParams.push(date_from);
            paramIndex++;
        }

        if (date_to) {
            conditions.push(`ra.created_at <= $${paramIndex}`);
            queryParams.push(date_to);
            paramIndex++;
        }

        if (search_term) {
            conditions.push(`(
                ra.reason ILIKE $${paramIndex} OR
                r.reservation_number ILIKE $${paramIndex} OR
                r.korean_name ILIKE $${paramIndex}
            )`);
            queryParams.push(`%${search_term}%`);
            paramIndex++;
        }

        const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

        // Get total count
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM reservation_audits ra
            LEFT JOIN reservations r ON ra.booking_id = r.id
            ${whereClause}
        `;

        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);

        // Get results
        const searchQuery = `
            SELECT 
                ra.audit_id, ra.booking_id, ra.actor, ra.action, ra.diff,
                ra.reason, ra.created_at,
                r.reservation_number, r.korean_name, r.product_name, r.payment_status
            FROM reservation_audits ra
            LEFT JOIN reservations r ON ra.booking_id = r.id
            ${whereClause}
            ORDER BY ra.created_at DESC
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;

        queryParams.push(pageSize, offset);
        const searchResult = await pool.query(searchQuery, queryParams);

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / pageSize);

        res.json({
            success: true,
            data: searchResult.rows,
            pagination: {
                page: pageNum,
                page_size: pageSize,
                total_count: totalCount,
                total_pages: totalPages,
                has_next: pageNum < totalPages,
                has_prev: pageNum > 1
            },
            search_criteria: {
                booking_ids, actors, actions, date_from, date_to, search_term
            }
        });

    } catch (error) {
        console.error('❌ Audit search error:', error);
        res.status(500).json({
            success: false,
            message: 'Audit search failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
