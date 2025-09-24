const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();

/**
 * 수배업체 관리 API 라우터
 * 
 * 기능:
 * - 수배업체 목록 조회
 * - 수배업체 등록
 * - 수배업체 수정
 * - 수배업체 삭제
 * - 업체별 담당 상품 관리
 * - 수배업체 자동 매칭
 */

// 수배업체 목록 조회
router.get('/', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        
        const query = `
            SELECT 
                v.*,
                COUNT(vp.id) as product_count,
                COUNT(a.id) as assignment_count
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id AND vp.is_active = true
            LEFT JOIN assignments a ON v.id = a.vendor_id
            WHERE v.is_active = true
            GROUP BY v.id
            ORDER BY v.vendor_name
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            vendors: result.rows
        });
        
    } catch (error) {
        console.error('수배업체 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 목록을 불러오는데 실패했습니다.'
        });
    }
});

// 수배업체 상세 조회
router.get('/:id', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const vendorId = req.params.id;
        
        // 업체 기본 정보
        const vendorQuery = 'SELECT * FROM vendors WHERE id = $1 AND is_active = true';
        const vendorResult = await pool.query(vendorQuery, [vendorId]);
        
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }
        
        // 담당 상품 목록
        const productsQuery = `
            SELECT * FROM vendor_products 
            WHERE vendor_id = $1 AND is_active = true 
            ORDER BY priority, product_keyword
        `;
        const productsResult = await pool.query(productsQuery, [vendorId]);
        
        // 최근 수배 내역
        const assignmentsQuery = `
            SELECT a.*, r.product_name, r.reservation_number, r.korean_name
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            WHERE a.vendor_id = $1
            ORDER BY a.assigned_at DESC
            LIMIT 10
        `;
        const assignmentsResult = await pool.query(assignmentsQuery, [vendorId]);
        
        const vendor = vendorResult.rows[0];
        delete vendor.password_hash; // 패스워드 해시 제거
        
        res.json({
            success: true,
            vendor: vendor,
            products: productsResult.rows,
            recent_assignments: assignmentsResult.rows
        });
        
    } catch (error) {
        console.error('수배업체 상세 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 정보를 불러오는데 실패했습니다.'
        });
    }
});

// 수배업체 등록
router.post('/', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const {
            vendor_name,
            vendor_id,
            password,
            email,
            phone,
            contact_person,
            business_type,
            description,
            notification_email,
            products = []
        } = req.body;
        
        // 필수 필드 검증
        if (!vendor_name || !vendor_id || !password || !email) {
            return res.status(400).json({
                success: false,
                message: '업체명, 아이디, 패스워드, 이메일은 필수입니다.'
            });
        }
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 패스워드 해시화
            const saltRounds = 10;
            const password_hash = await bcrypt.hash(password, saltRounds);
            
            // 수배업체 등록
            const insertVendorQuery = `
                INSERT INTO vendors (
                    vendor_name, vendor_id, password_hash, email, phone, 
                    contact_person, business_type, description, notification_email
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id, vendor_name, vendor_id, email, created_at
            `;
            
            const vendorResult = await client.query(insertVendorQuery, [
                vendor_name, vendor_id, password_hash, email, phone,
                contact_person, business_type, description, notification_email
            ]);
            
            const newVendor = vendorResult.rows[0];
            
            // 담당 상품 등록
            if (products.length > 0) {
                const productValues = products.map((product, index) => 
                    `($1, $${index * 2 + 2}, $${index * 2 + 3})`
                ).join(', ');
                
                const productParams = [newVendor.id];
                products.forEach(product => {
                    productParams.push(product.keyword, product.priority || 1);
                });
                
                const insertProductsQuery = `
                    INSERT INTO vendor_products (vendor_id, product_keyword, priority)
                    VALUES ${productValues}
                `;
                
                await client.query(insertProductsQuery, productParams);
            }
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: '수배업체가 성공적으로 등록되었습니다.',
                vendor: newVendor
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            
            if (error.code === '23505') { // Unique constraint violation
                if (error.constraint.includes('vendor_name')) {
                    return res.status(400).json({
                        success: false,
                        message: '이미 등록된 업체명입니다.'
                    });
                } else if (error.constraint.includes('vendor_id')) {
                    return res.status(400).json({
                        success: false,
                        message: '이미 사용중인 아이디입니다.'
                    });
                }
            }
            
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('수배업체 등록 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 등록에 실패했습니다.'
        });
    }
});

// 수배업체 수정
router.put('/:id', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const vendorId = req.params.id;
        const {
            vendor_name,
            email,
            phone,
            contact_person,
            business_type,
            description,
            notification_email,
            is_active,
            password
        } = req.body;
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            let updateQuery = `
                UPDATE vendors SET 
                    vendor_name = $1,
                    email = $2,
                    phone = $3,
                    contact_person = $4,
                    business_type = $5,
                    description = $6,
                    notification_email = $7,
                    updated_at = NOW()
            `;
            
            let params = [
                vendor_name, email, phone, contact_person,
                business_type, description, notification_email
            ];
            
            // is_active가 명시적으로 전달된 경우에만 업데이트
            if (is_active !== undefined) {
                updateQuery = updateQuery.replace('updated_at = NOW()', 'is_active = $8, updated_at = NOW()');
                params.push(is_active);
            }
            
            // 패스워드 변경이 있는 경우
            if (password) {
                const password_hash = await bcrypt.hash(password, 10);
                updateQuery += ', password_hash = $' + (params.length + 1);
                params.push(password_hash);
            }
            
            updateQuery += ' WHERE id = $' + (params.length + 1) + ' RETURNING *';
            params.push(vendorId);
            
            const result = await client.query(updateQuery, params);
            
            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: '수배업체를 찾을 수 없습니다.'
                });
            }
            
            await client.query('COMMIT');
            
            const updatedVendor = result.rows[0];
            delete updatedVendor.password_hash;
            
            res.json({
                success: true,
                message: '수배업체 정보가 수정되었습니다.',
                vendor: updatedVendor
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('수배업체 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 수정에 실패했습니다.'
        });
    }
});

// 수배업체 삭제 (소프트 삭제)
router.delete('/:id', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const vendorId = req.params.id;
        
        const result = await pool.query(
            'UPDATE vendors SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING vendor_name',
            [vendorId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: `${result.rows[0].vendor_name} 업체가 삭제되었습니다.`
        });
        
    } catch (error) {
        console.error('수배업체 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 삭제에 실패했습니다.'
        });
    }
});

// 업체별 담당 상품 관리
router.post('/:id/products', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const vendorId = req.params.id;
        const { products } = req.body;
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 기존 상품 매핑 비활성화
            await client.query(
                'UPDATE vendor_products SET is_active = false WHERE vendor_id = $1',
                [vendorId]
            );
            
            // 새로운 상품 매핑 추가
            if (products && products.length > 0) {
                for (const product of products) {
                    await client.query(`
                        INSERT INTO vendor_products (vendor_id, product_keyword, priority, is_active)
                        VALUES ($1, $2, $3, true)
                        ON CONFLICT (vendor_id, product_keyword) 
                        DO UPDATE SET priority = $3, is_active = true
                    `, [vendorId, product.keyword, product.priority || 1]);
                }
            }
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: '담당 상품이 업데이트되었습니다.'
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('담당 상품 업데이트 실패:', error);
        res.status(500).json({
            success: false,
            message: '담당 상품 업데이트에 실패했습니다.'
        });
    }
});

// 상품명으로 수배업체 자동 매칭
router.post('/match', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const { product_name } = req.body;
        
        if (!product_name) {
            return res.status(400).json({
                success: false,
                message: '상품명이 필요합니다.'
            });
        }
        
        const query = `
            SELECT DISTINCT v.*, vp.product_keyword, vp.priority
            FROM vendors v
            JOIN vendor_products vp ON v.id = vp.vendor_id
            WHERE v.is_active = true 
            AND vp.is_active = true
            AND LOWER($1) LIKE LOWER('%' || vp.product_keyword || '%')
            ORDER BY vp.priority, v.vendor_name
        `;
        
        const result = await pool.query(query, [product_name]);
        
        res.json({
            success: true,
            matches: result.rows.map(row => ({
                vendor_id: row.id,
                vendor_name: row.vendor_name,
                matched_keyword: row.product_keyword,
                priority: row.priority,
                email: row.notification_email || row.email,
                contact_person: row.contact_person
            }))
        });
        
    } catch (error) {
        console.error('수배업체 매칭 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 매칭에 실패했습니다.'
        });
    }
});

module.exports = router;
