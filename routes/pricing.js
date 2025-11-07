/**
 * 요금 RAG API 라우트
 * 
 * 기능:
 * - 업체명/상품명별 요금 관리
 * - 패키지 옵션별 판매가/수수료율/원가 관리
 * - 빠른 검색/수정
 * - 변경 이력 자동 기록
 */

const express = require('express');
const router = express.Router();

// 인증 미들웨어
const requireAuth = (req, res, next) => {
    if (req.session && req.session.adminId) {
        next();
    } else {
        res.status(401).json({ 
            success: false, 
            message: '인증이 필요합니다. 관리자 로그인을 해주세요.' 
        });
    }
};

module.exports = (pool) => {
    
    // ==================== 1. 요금 목록 조회 (검색/필터링) ====================
    router.get('/', requireAuth, async (req, res) => {
        try {
            const { 
                platform, 
                product, 
                vendor_id, 
                is_active = 'true',
                page = 1,
                limit = 50 
            } = req.query;
            
            console.log('📋 요금 목록 조회:', { platform, product, vendor_id, is_active });
            
            let query = `
                SELECT 
                    p.*,
                    v.vendor_name,
                    (SELECT COUNT(*) FROM pricing_history WHERE pricing_id = p.id) as history_count
                FROM product_pricing p
                LEFT JOIN vendors v ON p.vendor_id = v.id
                WHERE 1=1
            `;
            const params = [];
            let paramIndex = 1;
            
            // 업체명 검색 (부분 일치)
            if (platform) {
                query += ` AND p.platform_name ILIKE $${paramIndex}`;
                params.push(`%${platform}%`);
                paramIndex++;
            }
            
            // 상품명 검색 (부분 일치)
            if (product) {
                query += ` AND p.product_name ILIKE $${paramIndex}`;
                params.push(`%${product}%`);
                paramIndex++;
            }
            
            // 수배업체 필터
            if (vendor_id) {
                query += ` AND p.vendor_id = $${paramIndex}`;
                params.push(vendor_id);
                paramIndex++;
            }
            
            // 활성 상태 필터
            if (is_active === 'true') {
                query += ` AND p.is_active = true`;
            } else if (is_active === 'false') {
                query += ` AND p.is_active = false`;
            }
            
            query += ` ORDER BY p.updated_at DESC`;
            
            // 페이징
            const offset = (page - 1) * limit;
            query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);
            
            const result = await pool.query(query, params);
            
            // 전체 개수 조회
            let countQuery = `SELECT COUNT(*) FROM product_pricing p WHERE 1=1`;
            const countParams = [];
            let countParamIndex = 1;
            
            if (platform) {
                countQuery += ` AND p.platform_name ILIKE $${countParamIndex}`;
                countParams.push(`%${platform}%`);
                countParamIndex++;
            }
            if (product) {
                countQuery += ` AND p.product_name ILIKE $${countParamIndex}`;
                countParams.push(`%${product}%`);
                countParamIndex++;
            }
            if (vendor_id) {
                countQuery += ` AND p.vendor_id = $${countParamIndex}`;
                countParams.push(vendor_id);
                countParamIndex++;
            }
            if (is_active === 'true') {
                countQuery += ` AND p.is_active = true`;
            } else if (is_active === 'false') {
                countQuery += ` AND p.is_active = false`;
            }
            
            const countResult = await pool.query(countQuery, countParams);
            const total = parseInt(countResult.rows[0].count);
            
            res.json({
                success: true,
                data: result.rows,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
            
        } catch (error) {
            console.error('❌ 요금 목록 조회 오류:', error);
            console.error('❌ 오류 상세:', {
                message: error.message,
                code: error.code,
                detail: error.detail
            });
            res.status(500).json({
                success: false,
                message: '요금 목록 조회 중 오류가 발생했습니다: ' + error.message,
                error: error.code
            });
        }
    });
    
    // ==================== 2. 요금 상세 조회 ====================
    router.get('/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            
            const result = await pool.query(`
                SELECT 
                    p.*,
                    v.vendor_name,
                    v.email as vendor_email
                FROM product_pricing p
                LEFT JOIN vendors v ON p.vendor_id = v.id
                WHERE p.id = $1
            `, [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '요금 정보를 찾을 수 없습니다'
                });
            }
            
            // 변경 이력 조회
            const historyResult = await pool.query(`
                SELECT * FROM pricing_history
                WHERE pricing_id = $1
                ORDER BY created_at DESC
                LIMIT 10
            `, [id]);
            
            res.json({
                success: true,
                data: result.rows[0],
                history: historyResult.rows
            });
            
        } catch (error) {
            console.error('❌ 요금 상세 조회 오류:', error);
            res.status(500).json({
                success: false,
                message: '요금 상세 조회 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
    
    // ==================== 3. 요금 등록 ====================
    router.post('/', requireAuth, async (req, res) => {
        try {
            const {
                platform_name,
                vendor_id,
                product_name,
                commission_rate, // 상품 전체 공통 수수료율
                package_options, // [{ option_name, adult_price, adult_currency, ... }]
                notes
            } = req.body;
            
            console.log('➕ 요금 등록 요청:', { platform_name, product_name, options: package_options?.length });
            
            // 필수 필드 검증
            if (!platform_name || !product_name) {
                return res.status(400).json({
                    success: false,
                    message: '업체명과 상품명은 필수입니다'
                });
            }
            
            if (!package_options || package_options.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: '최소 1개의 패키지 옵션이 필요합니다'
                });
            }
            
            // 중복 체크
            const duplicateCheck = await pool.query(
                'SELECT id FROM product_pricing WHERE platform_name = $1 AND product_name = $2',
                [platform_name, product_name]
            );
            
            if (duplicateCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: '동일한 업체명과 상품명이 이미 존재합니다'
                });
            }
            
            // JSONB 컬럼에 객체 전달 (문자열이면 파싱)
            let packageOptionsObj = package_options;
            if (typeof package_options === 'string') {
                try {
                    packageOptionsObj = JSON.parse(package_options);
                } catch (e) {
                    packageOptionsObj = [];
                }
            } else if (!package_options) {
                packageOptionsObj = [];
            }
            
            // 요금 등록 - JSONB 컬럼에 객체 전달
            const result = await pool.query(`
                INSERT INTO product_pricing 
                (platform_name, vendor_id, product_name, commission_rate, package_options, notes)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING *
            `, [
                platform_name,
                vendor_id || null,
                product_name,
                commission_rate || 15,
                packageOptionsObj, // 객체 전달
                notes || null
            ]);
            
            console.log('✅ 요금 등록 완료:', result.rows[0].id);
            
            res.json({
                success: true,
                message: '요금이 등록되었습니다',
                data: result.rows[0]
            });
            
        } catch (error) {
            console.error('❌ 요금 등록 오류:', error);
            res.status(500).json({
                success: false,
                message: '요금 등록 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
    
    // ==================== 4. 요금 수정 (이력 저장) ====================
    router.put('/:id', requireAuth, async (req, res) => {
        const client = await pool.connect();
        
        try {
            const { id } = req.params;
            const {
                platform_name,
                vendor_id,
                product_name,
                commission_rate,
                package_options,
                notes,
                change_reason
            } = req.body;
            
            console.log('✏️  요금 수정 요청:', id);
            console.log('📦 package_options 타입:', typeof package_options);
            console.log('📦 package_options 값:', package_options);
            
            await client.query('BEGIN');
            
            // 기존 데이터 조회
            const oldDataResult = await client.query(
                'SELECT * FROM product_pricing WHERE id = $1',
                [id]
            );
            
            if (oldDataResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({
                    success: false,
                    message: '요금 정보를 찾을 수 없습니다'
                });
            }
            
            const oldData = oldDataResult.rows[0];
            
            console.log('🔍 oldData.package_options RAW:', oldData.package_options);
            console.log('🔍 oldData.package_options 타입:', typeof oldData.package_options);
            console.log('🔍 package_options RAW:', package_options);
            console.log('🔍 package_options 타입:', typeof package_options);
            
            // JSONB 컬럼에는 객체를 직접 전달 (pg 라이브러리가 자동 변환)
            // 문자열이면 파싱, 객체면 그대로 사용
            let packageOptionsObj = package_options;
            if (typeof package_options === 'string') {
                try {
                    packageOptionsObj = JSON.parse(package_options);
                } catch (e) {
                    console.error('❌ package_options 파싱 실패:', e);
                    packageOptionsObj = [];
                }
            } else if (!package_options) {
                packageOptionsObj = [];
            }
            
            // oldData는 JSONB에서 읽은 것이므로 이미 객체여야 함
            let oldPackageOptionsObj = oldData.package_options;
            if (typeof oldData.package_options === 'string') {
                console.warn('⚠️ oldData.package_options가 문자열입니다! 파싱 시도...');
                try {
                    oldPackageOptionsObj = JSON.parse(oldData.package_options);
                } catch (e) {
                    console.error('❌ oldData.package_options 파싱 실패:', e);
                    oldPackageOptionsObj = [];
                }
            } else if (!oldData.package_options) {
                oldPackageOptionsObj = [];
            }
            
            console.log('📦 old 변환 후:', JSON.stringify(oldPackageOptionsObj).substring(0, 100));
            console.log('📦 new 변환 후:', JSON.stringify(packageOptionsObj).substring(0, 100));
            
            // 요금 변경 이력 저장 (JSONB 컬럼에 객체 전달)
            // 실패해도 업데이트는 계속 진행
            try {
                await client.query(`
                    INSERT INTO pricing_history 
                    (pricing_id, old_package_options, new_package_options, changed_by, change_reason, version)
                    VALUES ($1, $2, $3, $4, $5, $6)
                `, [
                    id,
                    oldPackageOptionsObj,
                    packageOptionsObj,
                    req.session?.adminUsername || 'admin',
                    change_reason || '요금 수정',
                    oldData.version
                ]);
                console.log('✅ 이력 저장 완료');
            } catch (historyError) {
                console.error('⚠️ 이력 저장 실패 (계속 진행):', historyError.message);
                // 이력 저장 실패해도 업데이트는 계속 진행
            }
            
            // 요금 업데이트 (버전 증가) - JSONB 컬럼에 객체 전달
            const updateResult = await client.query(`
                UPDATE product_pricing
                SET 
                    platform_name = $1,
                    vendor_id = $2,
                    product_name = $3,
                    commission_rate = $4,
                    package_options = $5,
                    notes = $6,
                    version = version + 1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $7
                RETURNING *
            `, [
                platform_name,
                vendor_id || null,
                product_name,
                commission_rate || 15,
                packageOptionsObj, // 객체 전달
                notes || null,
                id
            ]);
            
            await client.query('COMMIT');
            
            console.log('✅ 요금 수정 완료:', id, '(버전:', updateResult.rows[0].version, ')');
            
            res.json({
                success: true,
                message: '요금이 수정되었습니다',
                data: updateResult.rows[0]
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ 요금 수정 오류:', error);
            res.status(500).json({
                success: false,
                message: '요금 수정 중 오류가 발생했습니다: ' + error.message
            });
        } finally {
            client.release();
        }
    });
    
    // ==================== 5. 요금 삭제 (비활성화) ====================
    router.delete('/:id', requireAuth, async (req, res) => {
        try {
            const { id } = req.params;
            
            const result = await pool.query(`
                UPDATE product_pricing
                SET is_active = false, updated_at = CURRENT_TIMESTAMP
                WHERE id = $1
                RETURNING *
            `, [id]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '요금 정보를 찾을 수 없습니다'
                });
            }
            
            console.log('✅ 요금 비활성화:', id);
            
            res.json({
                success: true,
                message: '요금이 비활성화되었습니다'
            });
            
        } catch (error) {
            console.error('❌ 요금 삭제 오류:', error);
            res.status(500).json({
                success: false,
                message: '요금 삭제 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
    
    // ==================== 6. 빠른 검색 (자동완성용) ====================
    router.get('/search/autocomplete', requireAuth, async (req, res) => {
        try {
            const { type, query } = req.query; // type: 'platform' or 'product'
            
            if (!query || query.length < 2) {
                return res.json({ success: true, data: [] });
            }
            
            let result;
            
            if (type === 'platform') {
                result = await pool.query(`
                    SELECT DISTINCT platform_name
                    FROM product_pricing
                    WHERE platform_name ILIKE $1 AND is_active = true
                    ORDER BY platform_name
                    LIMIT 10
                `, [`%${query}%`]);
                
                res.json({
                    success: true,
                    data: result.rows.map(r => r.platform_name)
                });
                
            } else if (type === 'product') {
                result = await pool.query(`
                    SELECT DISTINCT product_name, platform_name
                    FROM product_pricing
                    WHERE product_name ILIKE $1 AND is_active = true
                    ORDER BY product_name
                    LIMIT 10
                `, [`%${query}%`]);
                
                res.json({
                    success: true,
                    data: result.rows
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'type은 platform 또는 product여야 합니다'
                });
            }
            
        } catch (error) {
            console.error('❌ 자동완성 검색 오류:', error);
            res.status(500).json({
                success: false,
                message: '검색 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
    
    // ==================== 7. 상품명으로 요금 조회 (예약 시 사용) ====================
    router.post('/match', async (req, res) => {
        try {
            const { platform_name, product_name } = req.body;
            
            console.log('🔍 요금 매칭:', { platform_name, product_name });
            
            const result = await pool.query(`
                SELECT * FROM product_pricing
                WHERE platform_name = $1 
                AND product_name = $2 
                AND is_active = true
                LIMIT 1
            `, [platform_name, product_name]);
            
            if (result.rows.length === 0) {
                return res.json({
                    success: false,
                    message: '등록된 요금 정보가 없습니다',
                    data: null
                });
            }
            
            res.json({
                success: true,
                message: '요금 정보를 찾았습니다',
                data: result.rows[0]
            });
            
        } catch (error) {
            console.error('❌ 요금 매칭 오류:', error);
            res.status(500).json({
                success: false,
                message: '요금 매칭 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
    
    return router;
};
