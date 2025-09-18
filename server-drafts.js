const express = require('express');
const path = require('path');
const cors = require('cors');
const { pool, createDraftTables, testConnection } = require('./database-drafts');
const { parseBooking } = require('./utils/aiParser');
const { normalizeParsed } = require('./utils/normalize');
const { validateReservationData, mergeDraftData } = require('./utils/validator');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));
app.use('/pa', express.static('pa'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// API 키 인증 미들웨어
function requireApiKey(req, res, next) {
    const authHeader = req.headers.authorization;
    const apiKey = process.env.API_KEY || 'your-secret-api-key';
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization header required' });
    }
    
    const token = authHeader.substring(7);
    if (token !== apiKey) {
        return res.status(401).json({ error: 'Invalid API key' });
    }
    
    next();
}

// 데이터베이스 초기화
async function initializeDatabase() {
    console.log('🔧 데이터베이스 초기화 중...');
    
    const connected = await testConnection();
    if (!connected) {
        console.error('❌ 데이터베이스 연결 실패');
        process.exit(1);
    }
    
    await createDraftTables();
    console.log('✅ 데이터베이스 초기화 완료');
}

// ==================== API 엔드포인트 ====================

/**
 * POST /parse - 예약 텍스트 파싱
 */
app.post('/parse', requireApiKey, async (req, res) => {
    try {
        const { rawText } = req.body;
        
        if (!rawText || typeof rawText !== 'string') {
            return res.status(400).json({
                success: false,
                error: 'rawText is required and must be a string'
            });
        }
        
        console.log('🔍 예약 텍스트 파싱 시작...');
        
        // 1. OpenAI 파싱
        const parsed = await parseBooking(rawText);
        console.log('✅ OpenAI 파싱 완료');
        
        // 2. 정규화
        const normalized = normalizeParsed(parsed);
        console.log('✅ 데이터 정규화 완료');
        
        // 3. confidence와 extracted_notes 추출
        const confidence = parsed.confidence || 0.5;
        const extractedNotes = parsed.extracted_notes || '';
        
        // 4. 드래프트 저장
        const insertQuery = `
            INSERT INTO reservation_drafts (
                raw_text, parsed_json, normalized_json, confidence, status
            ) VALUES ($1, $2, $3, $4, $5)
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [
            rawText,
            JSON.stringify(parsed),
            JSON.stringify(normalized),
            confidence,
            'draft'
        ]);
        
        const draft = result.rows[0];
        
        console.log('✅ 드래프트 저장 완료:', draft.draft_id);
        
        res.json({
            success: true,
            draft_id: draft.draft_id,
            confidence: confidence,
            extracted_notes: extractedNotes,
            parsed_data: parsed,
            normalized_data: normalized,
            created_at: draft.created_at
        });
        
    } catch (error) {
        console.error('❌ 파싱 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * GET /drafts/:id - 드래프트 조회
 */
app.get('/drafts/:id', requireApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = 'SELECT * FROM reservation_drafts WHERE draft_id = $1';
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Draft not found'
            });
        }
        
        const draft = result.rows[0];
        
        res.json({
            success: true,
            draft: {
                draft_id: draft.draft_id,
                raw_text: draft.raw_text,
                parsed_json: draft.parsed_json,
                normalized_json: draft.normalized_json,
                manual_json: draft.manual_json,
                flags: draft.flags,
                confidence: draft.confidence,
                status: draft.status,
                created_at: draft.created_at,
                updated_at: draft.updated_at
            }
        });
        
    } catch (error) {
        console.error('❌ 드래프트 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /drafts/:id - 드래프트 수정 (manual_json 업데이트)
 */
app.put('/drafts/:id', requireApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const { manual_json } = req.body;
        
        if (!manual_json || typeof manual_json !== 'object') {
            return res.status(400).json({
                success: false,
                error: 'manual_json is required and must be an object'
            });
        }
        
        const updateQuery = `
            UPDATE reservation_drafts 
            SET manual_json = $1, status = $2, updated_at = NOW()
            WHERE draft_id = $3
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [
            JSON.stringify(manual_json),
            'ready',
            id
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Draft not found'
            });
        }
        
        const draft = result.rows[0];
        
        res.json({
            success: true,
            message: 'Draft updated successfully',
            draft: {
                draft_id: draft.draft_id,
                manual_json: draft.manual_json,
                status: draft.status,
                updated_at: draft.updated_at
            }
        });
        
    } catch (error) {
        console.error('❌ 드래프트 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /drafts/:id/commit - 드래프트를 최종 예약으로 커밋
 */
app.post('/drafts/:id/commit', requireApiKey, async (req, res) => {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        const { id } = req.params;
        
        // 1. 드래프트 조회
        const draftQuery = 'SELECT * FROM reservation_drafts WHERE draft_id = $1';
        const draftResult = await client.query(draftQuery, [id]);
        
        if (draftResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: 'Draft not found'
            });
        }
        
        const draft = draftResult.rows[0];
        
        // 2. 데이터 병합
        const parsed = draft.parsed_json || {};
        const normalized = draft.normalized_json || {};
        const manual = draft.manual_json || {};
        
        const finalData = mergeDraftData(parsed, normalized, manual);
        
        // 3. 스키마 검증
        const validation = validateReservationData(finalData);
        
        if (!validation.valid) {
            // 검증 실패 시 flags 업데이트
            await client.query(
                'UPDATE reservation_drafts SET flags = $1 WHERE draft_id = $2',
                [JSON.stringify(validation.flags), id]
            );
            
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                error: 'Validation failed',
                validation: validation
            });
        }
        
        // 4. reservations 테이블에 삽입
        const insertQuery = `
            INSERT INTO reservations (
                reservation_number, confirmation_number, channel, product_name,
                total_amount, package_type, usage_date, usage_time, quantity,
                korean_name, english_first_name, english_last_name,
                email, phone, kakao_id, guest_count, memo, reservation_datetime,
                issue_code_id, code_issued, code_issued_at, platform_name,
                people_adult, people_child, people_infant,
                adult_unit_price, child_unit_price, payment_status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                $21, $22, $23, $24, $25, $26, $27
            ) RETURNING *
        `;
        
        const values = [
            finalData.reservation_number,
            finalData.confirmation_number,
            finalData.channel,
            finalData.product_name,
            finalData.total_amount,
            finalData.package_type,
            finalData.usage_date,
            finalData.usage_time,
            finalData.quantity,
            finalData.korean_name,
            finalData.english_first_name,
            finalData.english_last_name,
            finalData.email,
            finalData.phone,
            finalData.kakao_id,
            finalData.guest_count,
            finalData.memo,
            finalData.reservation_datetime,
            finalData.issue_code_id,
            finalData.code_issued,
            finalData.code_issued_at,
            finalData.platform_name,
            finalData.people_adult,
            finalData.people_child,
            finalData.people_infant,
            finalData.adult_unit_price,
            finalData.child_unit_price,
            finalData.payment_status
        ];
        
        const reservationResult = await client.query(insertQuery, values);
        const reservation = reservationResult.rows[0];
        
        // 5. 드래프트 상태 업데이트
        await client.query(
            'UPDATE reservation_drafts SET status = $1, flags = $2 WHERE draft_id = $3',
            ['approved', JSON.stringify(validation.flags), id]
        );
        
        await client.query('COMMIT');
        
        console.log('✅ 예약 커밋 완료:', reservation.id);
        
        res.json({
            success: true,
            message: 'Reservation committed successfully',
            reservation_id: reservation.id,
            reservation_number: reservation.reservation_number,
            validation: validation
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 커밋 오류:', error);
        
        if (error.code === '23505') { // Unique constraint violation
            res.status(409).json({
                success: false,
                error: 'Duplicate reservation number',
                details: error.detail
            });
        } else {
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    } finally {
        client.release();
    }
});

/**
 * GET /bookings - 예약 목록 조회
 */
app.get('/bookings', requireApiKey, async (req, res) => {
    try {
        const { page = 1, limit = 20, status, search } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = '';
        let params = [];
        let paramCount = 0;
        
        if (status) {
            paramCount++;
            whereClause += ` WHERE payment_status = $${paramCount}`;
            params.push(status);
        }
        
        if (search) {
            paramCount++;
            const searchClause = ` ${whereClause ? 'AND' : 'WHERE'} (
                korean_name ILIKE $${paramCount} OR 
                english_first_name ILIKE $${paramCount} OR 
                english_last_name ILIKE $${paramCount} OR 
                reservation_number ILIKE $${paramCount} OR
                product_name ILIKE $${paramCount}
            )`;
            whereClause += searchClause;
            params.push(`%${search}%`);
        }
        
        const query = `
            SELECT * FROM reservations 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        
        // 총 개수 조회
        const countQuery = `SELECT COUNT(*) FROM reservations ${whereClause}`;
        const countResult = await pool.query(countQuery, params.slice(0, paramCount));
        const total = parseInt(countResult.rows[0].count);
        
        res.json({
            success: true,
            bookings: result.rows,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        console.error('❌ 예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /bookings/:id - 예약 상세 조회
 */
app.get('/bookings/:id', requireApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = 'SELECT * FROM reservations WHERE id = $1';
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        res.json({
            success: true,
            booking: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PATCH /bookings/:id - 예약 부분 수정
 */
app.patch('/bookings/:id', requireApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No updates provided'
            });
        }
        
        // 허용된 필드만 업데이트
        const allowedFields = [
            'confirmation_number', 'channel', 'product_name', 'total_amount',
            'package_type', 'usage_date', 'usage_time', 'quantity',
            'korean_name', 'english_first_name', 'english_last_name',
            'email', 'phone', 'kakao_id', 'guest_count', 'memo',
            'people_adult', 'people_child', 'people_infant',
            'adult_unit_price', 'child_unit_price', 'payment_status'
        ];
        
        const updateFields = [];
        const values = [];
        let paramCount = 0;
        
        Object.keys(updates).forEach(field => {
            if (allowedFields.includes(field)) {
                paramCount++;
                updateFields.push(`${field} = $${paramCount}`);
                values.push(updates[field]);
            }
        });
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid fields to update'
            });
        }
        
        paramCount++;
        values.push(id);
        
        const query = `
            UPDATE reservations 
            SET ${updateFields.join(', ')}, updated_at = NOW()
            WHERE id = $${paramCount}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Booking updated successfully',
            booking: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * DELETE /bookings/:id - 예약 취소 (상태 변경)
 */
app.delete('/bookings/:id', requireApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = `
            UPDATE reservations 
            SET payment_status = 'cancelled', updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        
        const result = await pool.query(query, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Booking not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Booking cancelled successfully',
            booking: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 취소 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 서버 시작
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(PORT, () => {
            console.log(`🚀 예약 파싱 검수형 서버 시작됨`);
            console.log(`📍 포트: ${PORT}`);
            console.log(`🔑 API 키 인증 활성화`);
            console.log(`📚 엔드포인트:`);
            console.log(`   POST /parse - 예약 텍스트 파싱`);
            console.log(`   GET /drafts/:id - 드래프트 조회`);
            console.log(`   PUT /drafts/:id - 드래프트 수정`);
            console.log(`   POST /drafts/:id/commit - 드래프트 커밋`);
            console.log(`   GET /bookings - 예약 목록`);
            console.log(`   GET /bookings/:id - 예약 상세`);
            console.log(`   PATCH /bookings/:id - 예약 수정`);
            console.log(`   DELETE /bookings/:id - 예약 취소`);
        });
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

startServer();
