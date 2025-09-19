/**
 * Field Definitions API
 * Manage dynamic field definitions for reservation extras
 */

const express = require('express');
const router = express.Router();

/**
 * GET /field-defs
 * Get all field definitions
 */
router.get('/', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { category, active_only = 'true' } = req.query;

        let query = `
            SELECT 
                key, label, type, required, pattern, options, default_value,
                placeholder, help_text, category, sort_order, is_active,
                created_at, updated_at
            FROM field_defs
        `;

        const queryParams = [];
        const conditions = [];

        if (active_only === 'true') {
            conditions.push('is_active = TRUE');
        }

        if (category) {
            conditions.push(`category = $${queryParams.length + 1}`);
            queryParams.push(category);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }

        query += ' ORDER BY category, sort_order, label';

        const result = await pool.query(query, queryParams);

        // Group by category
        const grouped = {};
        result.rows.forEach(field => {
            const cat = field.category || 'general';
            if (!grouped[cat]) {
                grouped[cat] = [];
            }
            grouped[cat].push(field);
        });

        res.json({
            success: true,
            data: {
                fields: result.rows,
                grouped: grouped,
                categories: Object.keys(grouped).sort()
            }
        });

    } catch (error) {
        console.error('❌ Field definitions fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch field definitions',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * GET /field-defs/:key
 * Get single field definition
 */
router.get('/:key', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { key } = req.params;

        const query = `
            SELECT 
                key, label, type, required, pattern, options, default_value,
                placeholder, help_text, category, sort_order, is_active,
                created_at, updated_at
            FROM field_defs
            WHERE key = $1
        `;

        const result = await pool.query(query, [key]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field definition not found'
            });
        }

        res.json({
            success: true,
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Field definition fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch field definition',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * POST /field-defs
 * Create new field definition
 */
router.post('/', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const {
            key, label, type, required = false, pattern, options,
            default_value, placeholder, help_text, category = 'general',
            sort_order = 0, is_active = true
        } = req.body;

        // Validate required fields
        if (!key || !label || !type) {
            return res.status(400).json({
                success: false,
                message: 'key, label, and type are required'
            });
        }

        // Validate type
        const validTypes = [
            'string', 'number', 'date', 'time', 'datetime', 
            'boolean', 'select', 'multiselect', 'textarea', 'email', 'phone'
        ];

        if (!validTypes.includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid type. Must be one of: ' + validTypes.join(', ')
            });
        }

        // Validate key format (alphanumeric + underscore only)
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) {
            return res.status(400).json({
                success: false,
                message: 'Key must start with letter and contain only letters, numbers, and underscores'
            });
        }

        const insertQuery = `
            INSERT INTO field_defs (
                key, label, type, required, pattern, options, default_value,
                placeholder, help_text, category, sort_order, is_active
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
            ) RETURNING *
        `;

        const values = [
            key, label, type, required, pattern, 
            options ? JSON.stringify(options) : null,
            default_value, placeholder, help_text, category, 
            sort_order, is_active
        ];

        const result = await pool.query(insertQuery, values);

        res.status(201).json({
            success: true,
            message: 'Field definition created successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Field definition creation error:', error);
        
        if (error.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Field definition with this key already exists'
            });
        }

        res.status(500).json({
            success: false,
            message: 'Failed to create field definition',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * PATCH /field-defs/:key
 * Update field definition
 */
router.patch('/:key', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { key } = req.params;
        const updates = req.body;

        // Remove key from updates (can't change primary key)
        delete updates.key;
        delete updates.created_at;
        delete updates.updated_at;

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        // Validate type if provided
        if (updates.type) {
            const validTypes = [
                'string', 'number', 'date', 'time', 'datetime', 
                'boolean', 'select', 'multiselect', 'textarea', 'email', 'phone'
            ];

            if (!validTypes.includes(updates.type)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid type. Must be one of: ' + validTypes.join(', ')
                });
            }
        }

        // Build update query
        const setClause = [];
        const values = [key];
        let paramIndex = 2;

        Object.keys(updates).forEach(field => {
            if (field === 'options' && updates[field]) {
                setClause.push(`${field} = $${paramIndex}`);
                values.push(JSON.stringify(updates[field]));
            } else {
                setClause.push(`${field} = $${paramIndex}`);
                values.push(updates[field]);
            }
            paramIndex++;
        });

        setClause.push('updated_at = NOW()');

        const updateQuery = `
            UPDATE field_defs 
            SET ${setClause.join(', ')}
            WHERE key = $1
            RETURNING *
        `;

        const result = await pool.query(updateQuery, values);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field definition not found'
            });
        }

        res.json({
            success: true,
            message: 'Field definition updated successfully',
            data: result.rows[0]
        });

    } catch (error) {
        console.error('❌ Field definition update error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update field definition',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * DELETE /field-defs/:key
 * Delete field definition (soft delete - set is_active = false)
 */
router.delete('/:key', async (req, res) => {
    try {
        const { pool } = req.app.locals;
        const { key } = req.params;
        const { hard_delete = false } = req.body;

        let query, message;

        if (hard_delete) {
            // Hard delete - completely remove from database
            query = 'DELETE FROM field_defs WHERE key = $1 RETURNING key';
            message = 'Field definition deleted permanently';
        } else {
            // Soft delete - set is_active = false
            query = `
                UPDATE field_defs 
                SET is_active = FALSE, updated_at = NOW()
                WHERE key = $1 
                RETURNING *
            `;
            message = 'Field definition deactivated';
        }

        const result = await pool.query(query, [key]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Field definition not found'
            });
        }

        res.json({
            success: true,
            message,
            data: hard_delete ? { key } : result.rows[0]
        });

    } catch (error) {
        console.error('❌ Field definition deletion error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete field definition',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

/**
 * POST /field-defs/bulk-import
 * Import multiple field definitions
 */
router.post('/bulk-import', async (req, res) => {
    const client = await req.app.locals.pool.connect();
    
    try {
        await client.query('BEGIN');

        const { fields } = req.body;

        if (!Array.isArray(fields) || fields.length === 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: 'fields array is required'
            });
        }

        const results = [];
        const errors = [];

        for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            
            try {
                // Validate required fields
                if (!field.key || !field.label || !field.type) {
                    errors.push({ index: i, error: 'key, label, and type are required' });
                    continue;
                }

                const insertQuery = `
                    INSERT INTO field_defs (
                        key, label, type, required, pattern, options, default_value,
                        placeholder, help_text, category, sort_order, is_active
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
                    ) ON CONFLICT (key) DO UPDATE SET
                        label = EXCLUDED.label,
                        type = EXCLUDED.type,
                        required = EXCLUDED.required,
                        pattern = EXCLUDED.pattern,
                        options = EXCLUDED.options,
                        default_value = EXCLUDED.default_value,
                        placeholder = EXCLUDED.placeholder,
                        help_text = EXCLUDED.help_text,
                        category = EXCLUDED.category,
                        sort_order = EXCLUDED.sort_order,
                        is_active = EXCLUDED.is_active,
                        updated_at = NOW()
                    RETURNING *
                `;

                const values = [
                    field.key,
                    field.label,
                    field.type,
                    field.required || false,
                    field.pattern || null,
                    field.options ? JSON.stringify(field.options) : null,
                    field.default_value || null,
                    field.placeholder || null,
                    field.help_text || null,
                    field.category || 'general',
                    field.sort_order || 0,
                    field.is_active !== undefined ? field.is_active : true
                ];

                const result = await client.query(insertQuery, values);
                results.push(result.rows[0]);

            } catch (fieldError) {
                console.error(`❌ Error importing field ${i}:`, fieldError);
                errors.push({ 
                    index: i, 
                    key: field.key,
                    error: fieldError.message 
                });
            }
        }

        await client.query('COMMIT');

        res.json({
            success: true,
            message: `Imported ${results.length} field definitions`,
            data: {
                imported: results,
                errors: errors,
                summary: {
                    total: fields.length,
                    success: results.length,
                    failed: errors.length
                }
            }
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ Bulk import error:', error);
        res.status(500).json({
            success: false,
            message: 'Bulk import failed',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    } finally {
        client.release();
    }
});

/**
 * GET /field-defs/categories
 * Get all categories with field counts
 */
router.get('/categories', async (req, res) => {
    try {
        const { pool } = req.app.locals;

        const query = `
            SELECT 
                category,
                COUNT(*) as field_count,
                COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_count
            FROM field_defs
            GROUP BY category
            ORDER BY category
        `;

        const result = await pool.query(query);

        res.json({
            success: true,
            data: result.rows
        });

    } catch (error) {
        console.error('❌ Categories fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch categories',
            error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
        });
    }
});

module.exports = router;
