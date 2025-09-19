/**
 * Bookings List API
 * GET /bookings - List reservations with search, filter, pagination
 */

const express = require('express');
const router = express.Router();

/**
 * @typedef {Object} ListQuery
 * @property {string} [q] - Search keyword (reservation_number, name, email)
 * @property {string} [status] - Payment status filter
 * @property {string} [review] - Review status filter  
 * @property {string} [channel] - Channel filter
 * @property {string} [platform] - Platform filter
 * @property {string} [from] - Date range start (YYYY-MM-DD)
 * @property {string} [to] - Date range end (YYYY-MM-DD)
 * @property {number} [page=1] - Page number
 * @property {number} [page_size=20] - Items per page
 * @property {string} [sort=created_at] - Sort field
 * @property {string} [order=desc] - Sort order (asc/desc)
 */

/**
 * GET /bookings
 * List reservations with filtering and pagination
 */
router.get('/', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        
        // Parse query parameters
        const {
            q = '',
            status = '',
            review = '',
            channel = '',
            platform = '',
            from = '',
            to = '',
            page = 1,
            page_size = 20,
            sort = 'created_at',
            order = 'desc'
        } = req.query;

        // Validate pagination
        const pageNum = Math.max(1, parseInt(page));
        const pageSize = Math.min(100, Math.max(1, parseInt(page_size)));
        const offset = (pageNum - 1) * pageSize;

        // Validate sort parameters
        const allowedSortFields = [
            'id', 'reservation_number', 'korean_name', 'usage_date', 
            'total_amount', 'payment_status', 'review_status', 'created_at', 'updated_at'
        ];
        const sortField = allowedSortFields.includes(sort) ? sort : 'created_at';
        const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';

        // Build WHERE clause
        let whereClause = 'WHERE is_deleted = FALSE';
        const queryParams = [];
        let paramIndex = 1;

        // Search keyword
        if (q.trim()) {
            whereClause += ` AND (
                reservation_number ILIKE $${paramIndex} OR
                korean_name ILIKE $${paramIndex} OR
                english_first_name ILIKE $${paramIndex} OR
                english_last_name ILIKE $${paramIndex} OR
                email ILIKE $${paramIndex} OR
                product_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${q.trim()}%`);
            paramIndex++;
        }

        // Status filters
        if (status.trim()) {
            whereClause += ` AND payment_status = $${paramIndex}`;
            queryParams.push(status.trim());
            paramIndex++;
        }

        if (review.trim()) {
            whereClause += ` AND review_status = $${paramIndex}`;
            queryParams.push(review.trim());
            paramIndex++;
        }

        if (channel.trim()) {
            whereClause += ` AND channel = $${paramIndex}`;
            queryParams.push(channel.trim());
            paramIndex++;
        }

        if (platform.trim()) {
            whereClause += ` AND platform_name = $${paramIndex}`;
            queryParams.push(platform.trim());
            paramIndex++;
        }

        // Date range
        if (from.trim()) {
            whereClause += ` AND usage_date >= $${paramIndex}`;
            queryParams.push(from.trim());
            paramIndex++;
        }

        if (to.trim()) {
            whereClause += ` AND usage_date <= $${paramIndex}`;
            queryParams.push(to.trim());
            paramIndex++;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM reservations ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);

        // Get reservations
        const selectQuery = `
            SELECT 
                id, reservation_number, confirmation_number, channel, platform_name,
                product_name, package_type, total_amount, quantity, guest_count,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                usage_date, usage_time, reservation_datetime, payment_status, review_status,
                code_issued, code_issued_at, memo, extras, flags, origin_hash,
                created_at, updated_at, lock_version
            FROM reservations 
            ${whereClause}
            ORDER BY ${sortField} ${sortOrder}
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        
        queryParams.push(pageSize, offset);
        const result = await pool.query(selectQuery, queryParams);

        // Calculate pagination info
        const totalPages = Math.ceil(totalCount / pageSize);
        const hasNext = pageNum < totalPages;
        const hasPrev = pageNum > 1;

        // Response
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page: pageNum,
                page_size: pageSize,
                total_count: totalCount,
                total_pages: totalPages,
                has_next: hasNext,
                has_prev: hasPrev
            },
            filters: {
                q, status, review, channel, platform, from, to, sort, order
            }
        });

        // Send SSE event if enabled
        if (req.app.locals.sseClients) {
            req.app.locals.sseClients.forEach(client => {
                client.write(`data: ${JSON.stringify({
                    type: 'booking.list',
                    count: totalCount,
                    filters: { q, status, review, channel, platform, from, to }
                })}\n\n`);
            });
        }

    } catch (error) {
        console.error('❌ Bookings list error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch reservations',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /bookings/stats
 * Get reservation statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const { pool } = req.app.locals;

        const statsQuery = `
            SELECT 
                COUNT(*) as total_reservations,
                COUNT(CASE WHEN payment_status = 'confirmed' THEN 1 END) as confirmed_reservations,
                COUNT(CASE WHEN payment_status = 'pending' THEN 1 END) as pending_reservations,
                COUNT(CASE WHEN payment_status = 'cancelled' THEN 1 END) as cancelled_reservations,
                COUNT(CASE WHEN review_status = 'needs_review' THEN 1 END) as needs_review,
                COUNT(CASE WHEN code_issued = true THEN 1 END) as codes_issued,
                COUNT(DISTINCT platform_name) as platforms,
                COUNT(DISTINCT channel) as channels,
                COALESCE(SUM(total_amount), 0) as total_revenue,
                COALESCE(AVG(total_amount), 0) as avg_booking_value
            FROM reservations 
            WHERE is_deleted = FALSE
        `;

        const result = await pool.query(statsQuery);
        const stats = result.rows[0];

        // Convert numeric strings to numbers
        Object.keys(stats).forEach(key => {
            if (stats[key] !== null && !isNaN(stats[key])) {
                stats[key] = parseFloat(stats[key]);
            }
        });

        res.json({
            success: true,
            data: stats
        });

    } catch (error) {
        console.error('❌ Bookings stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /bookings/filters
 * Get available filter options
 */
router.get('/filters', async (req, res) => {
    try {
        const { pool } = req.app.locals;

        const filtersQuery = `
            SELECT 
                ARRAY_AGG(DISTINCT payment_status) FILTER (WHERE payment_status IS NOT NULL) as payment_statuses,
                ARRAY_AGG(DISTINCT review_status) FILTER (WHERE review_status IS NOT NULL) as review_statuses,
                ARRAY_AGG(DISTINCT channel) FILTER (WHERE channel IS NOT NULL) as channels,
                ARRAY_AGG(DISTINCT platform_name) FILTER (WHERE platform_name IS NOT NULL) as platforms
            FROM reservations 
            WHERE is_deleted = FALSE
        `;

        const result = await pool.query(filtersQuery);
        const filters = result.rows[0];

        res.json({
            success: true,
            data: {
                payment_statuses: filters.payment_statuses || [],
                review_statuses: filters.review_statuses || [],
                channels: filters.channels || [],
                platforms: filters.platforms || []
            }
        });

    } catch (error) {
        console.error('❌ Bookings filters error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch filter options',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
