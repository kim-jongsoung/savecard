const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const { parseBooking } = require('./utils/aiParser');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// PostgreSQL 연결 설정
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// API 키 인증 미들웨어
const authenticateApiKey = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Bearer token required' 
        });
    }
    
    const token = authHeader.substring(7);
    const validApiKey = process.env.API_KEY || 'your-secret-api-key';
    
    if (token !== validApiKey) {
        return res.status(401).json({ 
            error: 'Unauthorized', 
            message: 'Invalid API key' 
        });
    }
    
    next();
};

// 데이터베이스 초기화
async function initializeDatabase() {
    try {
        console.log('🔄 데이터베이스 초기화 중...');
        
        // reservations 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reservations (
                id SERIAL PRIMARY KEY,
                reservation_number VARCHAR(100) UNIQUE NOT NULL,
                confirmation_number VARCHAR(100),
                channel VARCHAR(50) DEFAULT '웹',
                product_name TEXT,
                total_amount DECIMAL(10,2),
                package_type VARCHAR(100),
                usage_date DATE,
                usage_time TIME,
                quantity INTEGER DEFAULT 1,
                korean_name VARCHAR(100),
                english_first_name VARCHAR(100),
                english_last_name VARCHAR(100),
                email VARCHAR(255),
                phone VARCHAR(50),
                kakao_id VARCHAR(100),
                guest_count INTEGER DEFAULT 1,
                memo TEXT,
                reservation_datetime TIMESTAMP,
                issue_code_id INTEGER,
                code_issued BOOLEAN DEFAULT FALSE,
                code_issued_at TIMESTAMP,
                platform_name VARCHAR(50) DEFAULT 'OTHER',
                people_adult INTEGER DEFAULT 1,
                people_child INTEGER DEFAULT 0,
                people_infant INTEGER DEFAULT 0,
                adult_unit_price DECIMAL(10,2),
                child_unit_price DECIMAL(10,2),
                payment_status VARCHAR(50) DEFAULT '대기',
                status VARCHAR(50) DEFAULT 'active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // updated_at 자동 업데이트 트리거 생성
        await pool.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);
        
        await pool.query(`
            DROP TRIGGER IF EXISTS update_reservations_updated_at ON reservations;
            CREATE TRIGGER update_reservations_updated_at
                BEFORE UPDATE ON reservations
                FOR EACH ROW
                EXECUTE FUNCTION update_updated_at_column();
        `);
        
        console.log('✅ 데이터베이스 초기화 완료');
        
    } catch (error) {
        console.error('❌ 데이터베이스 초기화 오류:', error);
        throw error;
    }
}

// ==================== API 엔드포인트 ====================

// 1. 예약 텍스트 파싱 및 저장 (POST /import-booking)
app.post('/import-booking', authenticateApiKey, async (req, res) => {
    try {
        const { rawText } = req.body;
        
        if (!rawText || typeof rawText !== 'string') {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'rawText is required and must be a string'
            });
        }
        
        console.log('📝 예약 텍스트 파싱 시작');
        console.log('📄 텍스트 길이:', rawText.length);
        
        // OpenAI API로 파싱
        const parsedData = await parseBooking(rawText);
        
        // 데이터베이스에 저장
        const insertQuery = `
            INSERT INTO reservations (
                reservation_number, confirmation_number, channel, product_name, 
                total_amount, package_type, usage_date, usage_time, quantity,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                guest_count, memo, reservation_datetime, platform_name,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                payment_status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
            ) RETURNING *
        `;
        
        const values = [
            parsedData.reservation_number,
            parsedData.confirmation_number,
            parsedData.channel,
            parsedData.product_name,
            parsedData.total_amount,
            parsedData.package_type,
            parsedData.usage_date,
            parsedData.usage_time,
            parsedData.quantity,
            parsedData.korean_name,
            parsedData.english_first_name,
            parsedData.english_last_name,
            parsedData.email,
            parsedData.phone,
            parsedData.kakao_id,
            parsedData.guest_count,
            parsedData.memo,
            parsedData.reservation_datetime,
            parsedData.platform_name,
            parsedData.people_adult,
            parsedData.people_child,
            parsedData.people_infant,
            parsedData.adult_unit_price,
            parsedData.child_unit_price,
            parsedData.payment_status
        ];
        
        const result = await pool.query(insertQuery, values);
        const savedBooking = result.rows[0];
        
        console.log('✅ 예약 저장 완료:', savedBooking.id);
        
        res.status(201).json({
            success: true,
            message: '예약이 성공적으로 저장되었습니다',
            booking: savedBooking,
            parsed_data: parsedData
        });
        
    } catch (error) {
        console.error('❌ 예약 파싱/저장 오류:', error);
        
        if (error.code === '23505') { // 중복 예약번호
            return res.status(409).json({
                error: 'Conflict',
                message: '이미 존재하는 예약번호입니다'
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 2. 전체 예약 목록 조회 (GET /bookings)
app.get('/bookings', authenticateApiKey, async (req, res) => {
    try {
        const { page = 1, limit = 50, status = 'active', platform, search } = req.query;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE status = $1';
        let queryParams = [status];
        let paramIndex = 2;
        
        // 플랫폼 필터
        if (platform) {
            whereClause += ` AND platform_name = $${paramIndex}`;
            queryParams.push(platform);
            paramIndex++;
        }
        
        // 검색 필터 (예약번호, 이름, 상품명)
        if (search) {
            whereClause += ` AND (
                reservation_number ILIKE $${paramIndex} OR 
                korean_name ILIKE $${paramIndex} OR 
                product_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }
        
        // 총 개수 조회
        const countQuery = `SELECT COUNT(*) FROM reservations ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].count);
        
        // 예약 목록 조회
        const bookingsQuery = `
            SELECT * FROM reservations 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        queryParams.push(limit, offset);
        
        const bookingsResult = await pool.query(bookingsQuery, queryParams);
        const bookings = bookingsResult.rows;
        
        console.log(`📋 예약 목록 조회: ${bookings.length}건 (총 ${totalCount}건)`);
        
        res.json({
            success: true,
            data: bookings,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: totalCount,
                pages: Math.ceil(totalCount / limit)
            }
        });
        
    } catch (error) {
        console.error('❌ 예약 목록 조회 오류:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 3. 특정 예약 상세 조회 (GET /bookings/:id)
app.get('/bookings/:id', authenticateApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        
        const query = 'SELECT * FROM reservations WHERE id = $1 AND status != $2';
        const result = await pool.query(query, [id, 'deleted']);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '예약을 찾을 수 없습니다'
            });
        }
        
        const booking = result.rows[0];
        console.log(`📄 예약 상세 조회: ID ${id}`);
        
        res.json({
            success: true,
            data: booking
        });
        
    } catch (error) {
        console.error('❌ 예약 상세 조회 오류:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 4. 수기 예약 생성 (POST /bookings)
app.post('/bookings', authenticateApiKey, async (req, res) => {
    try {
        const bookingData = req.body;
        
        // 필수 필드 검증
        if (!bookingData.reservation_number) {
            return res.status(400).json({
                error: 'Bad Request',
                message: 'reservation_number is required'
            });
        }
        
        console.log('📝 수기 예약 생성 시작');
        
        const insertQuery = `
            INSERT INTO reservations (
                reservation_number, confirmation_number, channel, product_name, 
                total_amount, package_type, usage_date, usage_time, quantity,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                guest_count, memo, reservation_datetime, platform_name,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                payment_status
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
            ) RETURNING *
        `;
        
        const values = [
            bookingData.reservation_number,
            bookingData.confirmation_number || null,
            bookingData.channel || '웹',
            bookingData.product_name || null,
            bookingData.total_amount || null,
            bookingData.package_type || null,
            bookingData.usage_date || null,
            bookingData.usage_time || null,
            bookingData.quantity || 1,
            bookingData.korean_name || null,
            bookingData.english_first_name || null,
            bookingData.english_last_name || null,
            bookingData.email || null,
            bookingData.phone || null,
            bookingData.kakao_id || null,
            bookingData.guest_count || 1,
            bookingData.memo || null,
            bookingData.reservation_datetime || null,
            bookingData.platform_name || 'OTHER',
            bookingData.people_adult || 1,
            bookingData.people_child || 0,
            bookingData.people_infant || 0,
            bookingData.adult_unit_price || null,
            bookingData.child_unit_price || null,
            bookingData.payment_status || '대기'
        ];
        
        const result = await pool.query(insertQuery, values);
        const savedBooking = result.rows[0];
        
        console.log('✅ 수기 예약 생성 완료:', savedBooking.id);
        
        res.status(201).json({
            success: true,
            message: '예약이 성공적으로 생성되었습니다',
            data: savedBooking
        });
        
    } catch (error) {
        console.error('❌ 수기 예약 생성 오류:', error);
        
        if (error.code === '23505') { // 중복 예약번호
            return res.status(409).json({
                error: 'Conflict',
                message: '이미 존재하는 예약번호입니다'
            });
        }
        
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 5. 예약 수정 (PUT /bookings/:id)
app.put('/bookings/:id', authenticateApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;
        
        // 예약 존재 확인
        const existingQuery = 'SELECT * FROM reservations WHERE id = $1 AND status != $2';
        const existingResult = await pool.query(existingQuery, [id, 'deleted']);
        
        if (existingResult.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '예약을 찾을 수 없습니다'
            });
        }
        
        console.log(`📝 예약 수정 시작: ID ${id}`);
        
        // 업데이트 쿼리 동적 생성
        const updateFields = [];
        const updateValues = [];
        let paramIndex = 1;
        
        const allowedFields = [
            'confirmation_number', 'channel', 'product_name', 'total_amount', 'package_type',
            'usage_date', 'usage_time', 'quantity', 'korean_name', 'english_first_name',
            'english_last_name', 'email', 'phone', 'kakao_id', 'guest_count', 'memo',
            'reservation_datetime', 'platform_name', 'people_adult', 'people_child',
            'people_infant', 'adult_unit_price', 'child_unit_price', 'payment_status'
        ];
        
        for (const field of allowedFields) {
            if (updateData.hasOwnProperty(field)) {
                updateFields.push(`${field} = $${paramIndex}`);
                updateValues.push(updateData[field]);
                paramIndex++;
            }
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                error: 'Bad Request',
                message: '업데이트할 필드가 없습니다'
            });
        }
        
        const updateQuery = `
            UPDATE reservations 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex} AND status != 'deleted'
            RETURNING *
        `;
        updateValues.push(id);
        
        const result = await pool.query(updateQuery, updateValues);
        const updatedBooking = result.rows[0];
        
        console.log(`✅ 예약 수정 완료: ID ${id}`);
        
        res.json({
            success: true,
            message: '예약이 성공적으로 수정되었습니다',
            data: updatedBooking
        });
        
    } catch (error) {
        console.error('❌ 예약 수정 오류:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 6. 예약 취소 (DELETE /bookings/:id)
app.delete('/bookings/:id', authenticateApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        
        console.log(`🗑️ 예약 취소 시작: ID ${id}`);
        
        // 예약 상태를 'cancelled'로 변경 (실제 삭제하지 않음)
        const updateQuery = `
            UPDATE reservations 
            SET status = 'cancelled', payment_status = '취소'
            WHERE id = $1 AND status != 'deleted'
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                error: 'Not Found',
                message: '예약을 찾을 수 없습니다'
            });
        }
        
        const cancelledBooking = result.rows[0];
        console.log(`✅ 예약 취소 완료: ID ${id}`);
        
        res.json({
            success: true,
            message: '예약이 성공적으로 취소되었습니다',
            data: cancelledBooking
        });
        
    } catch (error) {
        console.error('❌ 예약 취소 오류:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 7. 통계 조회 (GET /stats)
app.get('/stats', authenticateApiKey, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total_bookings,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_bookings,
                COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_bookings,
                COUNT(CASE WHEN code_issued = true THEN 1 END) as code_issued,
                COUNT(DISTINCT platform_name) as platforms,
                SUM(CASE WHEN status = 'active' THEN total_amount ELSE 0 END) as total_revenue
            FROM reservations
        `;
        
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];
        
        console.log('📊 통계 조회 완료');
        
        res.json({
            success: true,
            data: {
                total_bookings: parseInt(stats.total_bookings),
                active_bookings: parseInt(stats.active_bookings),
                cancelled_bookings: parseInt(stats.cancelled_bookings),
                code_issued: parseInt(stats.code_issued),
                platforms: parseInt(stats.platforms),
                total_revenue: parseFloat(stats.total_revenue) || 0
            }
        });
        
    } catch (error) {
        console.error('❌ 통계 조회 오류:', error);
        res.status(500).json({
            error: 'Internal Server Error',
            message: error.message
        });
    }
});

// 헬스체크 엔드포인트
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'OpenAI Booking Parser API'
    });
});

// 404 핸들러
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: 'API endpoint not found'
    });
});

// 전역 에러 핸들러
app.use((error, req, res, next) => {
    console.error('🚨 전역 에러:', error);
    res.status(500).json({
        error: 'Internal Server Error',
        message: 'Something went wrong'
    });
});

// 서버 시작
async function startServer() {
    try {
        await initializeDatabase();
        
        app.listen(port, () => {
            console.log('🚀 OpenAI Booking Parser API 서버 시작');
            console.log(`📡 포트: ${port}`);
            console.log(`🔑 인증: Bearer Token 필요`);
            console.log(`🤖 OpenAI API: ${process.env.OPENAI_API_KEY ? '연결됨' : '미설정'}`);
            console.log(`🗄️ 데이터베이스: ${process.env.DATABASE_URL ? '연결됨' : '미설정'}`);
        });
        
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// 프로세스 종료 시 정리
process.on('SIGINT', async () => {
    console.log('🛑 서버 종료 중...');
    await pool.end();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 서버 종료 중...');
    await pool.end();
    process.exit(0);
});

startServer();
