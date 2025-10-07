const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');
const { connectDB } = require('./database');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cors = require('cors');
// nodemailer 제거됨
// 간단하고 확실한 환경변수 처리
// 로컬에서는 railsql.env 파일 사용, 배포환경에서는 기본 .env 사용
const fs = require('fs');
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

// PostgreSQL 또는 JSON 데이터베이스 선택
const { pool, dbMode, testConnection, createTables, ensureAllColumns, migrateFromJSON } = require('./database');
const { normalizeReservationData } = require('./utils/normalize');
const { parseBooking } = require('./utils/aiParser');
let jsonDB;

try {
    if (dbMode === 'json') {
        console.log('📋 JSON 모드로 실행');
        jsonDB = require('./utils/jsonDB');
    }
} catch (error) {
    console.warn('⚠️ 데이터베이스 모듈 로드 실패:', error.message);
}

const app = express();
// Railway에서는 동적 포트 사용, 로컬에서는 3000 사용
const PORT = process.env.NODE_ENV === 'production' ? process.env.PORT : 3000;
console.log('🚀 최종 PORT 설정:', PORT, '(NODE_ENV:', process.env.NODE_ENV, ')');

// 이메일 기능 완전 제거됨

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/pa', express.static('pa'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 세션 설정
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'guam-savecard-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
};

// 프로덕션 환경에서 MemoryStore 경고 억제
if (process.env.NODE_ENV === 'production') {
    sessionConfig.name = 'sessionId';
    sessionConfig.proxy = true;
    // MemoryStore 경고 메시지 억제를 위한 설정
    const originalConsoleWarn = console.warn;
    console.warn = function(...args) {
        const message = args.join(' ');
        if (message.includes('MemoryStore') || message.includes('connect.session()')) {
            return; // MemoryStore 관련 경고 무시
        }
        originalConsoleWarn.apply(console, args);
    };
}

app.use(session(sessionConfig));

// 관리자 인증 미들웨어
function requireAuth(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        res.redirect('/admin/login');
    }
}

// 예약 테이블 스키마 마이그레이션
async function migrateReservationsSchema() {
  try {
    console.log('🔧 예약 테이블 스키마 마이그레이션 시작...');
    console.log('🔧 현재 시간:', new Date().toISOString());
    
    // 현재 테이블 구조 확인
    const tableInfo = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
    `);
    
    const existingColumns = tableInfo.rows.map(row => row.column_name);
    console.log('기존 컬럼들:', existingColumns);
    
    // 누락된 컬럼들 추가
    const columnsToAdd = [
      { name: 'platform_name', type: 'VARCHAR(50)', default: "'NOL'" },
      { name: 'channel', type: 'VARCHAR(50)', default: "'웹'" },
      { name: 'english_first_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'english_last_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'people_adult', type: 'INTEGER', default: '1' },
      { name: 'people_child', type: 'INTEGER', default: '0' },
      { name: 'people_infant', type: 'INTEGER', default: '0' },
      { name: 'total_amount', type: 'DECIMAL(12,2)', default: 'NULL' },
      { name: 'adult_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'child_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'payment_status', type: 'VARCHAR(20)', default: "'대기'" }
    ];
    
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        try {
          await pool.query(`
            ALTER TABLE reservations 
            ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
          `);
          console.log(`✅ ${column.name} 컬럼 추가 완료`);
        } catch (error) {
          console.log(`⚠️ ${column.name} 컬럼 추가 실패:`, error.message);
        }
      }
    }
    
    // 모든 컬럼의 NOT NULL 제약조건 제거 (부분 데이터 허용)
    const columnsToMakeNullable = ['korean_name', 'email', 'phone', 'product_name'];
    for (const columnName of columnsToMakeNullable) {
      if (existingColumns.includes(columnName)) {
        try {
          await pool.query(`ALTER TABLE reservations ALTER COLUMN ${columnName} DROP NOT NULL`);
          console.log(`✅ ${columnName} NOT NULL 제약조건 제거 완료`);
        } catch (error) {
          console.log(`⚠️ ${columnName} NOT NULL 제약조건 제거 건너뜀:`, error.message);
        }
      }
    }
    
    // 기존 데이터 마이그레이션
    if (existingColumns.includes('company')) {
      await pool.query(`
        UPDATE reservations 
        SET platform_name = COALESCE(company, 'NOL') 
        WHERE platform_name IS NULL OR platform_name = ''
      `);
      console.log('✅ company -> platform_name 데이터 이동 완료');
    }
    
    if (existingColumns.includes('amount')) {
      await pool.query(`
        UPDATE reservations 
        SET total_amount = amount 
        WHERE total_amount IS NULL AND amount IS NOT NULL
      `);
      console.log('✅ amount -> total_amount 데이터 이동 완료');
    }
    
    console.log('✅ 예약 테이블 스키마 마이그레이션 완료');
    
  } catch (error) {
    console.error('❌ 스키마 마이그레이션 실패:', error);
  }
}

// 서버 시작 시 데이터베이스 초기화
async function initializeDatabase() {
  try {
    if (dbMode === 'postgresql') {
      console.log('🚀 PostgreSQL 데이터베이스 초기화 중...');
      console.log('🚀 초기화 시작 시간:', new Date().toISOString());
      await createTables();
      
      // reservations 테이블 강제 생성 (누락된 경우 대비)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS reservations (
            id SERIAL PRIMARY KEY,
            reservation_number VARCHAR(100) UNIQUE NOT NULL,
            channel VARCHAR(50) DEFAULT '웹',
            platform_name VARCHAR(50) DEFAULT 'NOL',
            product_name VARCHAR(200),
            
            -- 예약자 정보
            korean_name VARCHAR(100),
            english_first_name VARCHAR(100),
            english_last_name VARCHAR(100),
            phone VARCHAR(50),
            email VARCHAR(200),
            kakao_id VARCHAR(100),
            
            -- 이용 정보
            usage_date DATE,
            usage_time TIME,
            guest_count INTEGER DEFAULT 1,
            people_adult INTEGER DEFAULT 1,
            people_child INTEGER DEFAULT 0,
            people_infant INTEGER DEFAULT 0,
            package_type VARCHAR(50),
            
            -- 결제 정보
            total_amount DECIMAL(10,2),
            adult_unit_price DECIMAL(10,2) DEFAULT 0,
            child_unit_price DECIMAL(10,2) DEFAULT 0,
            payment_status VARCHAR(50) DEFAULT '대기',
            
            -- 코드 발급 정보
            code_issued BOOLEAN DEFAULT FALSE,
            code_issued_at TIMESTAMP,
            
            -- 기타
            memo TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ reservations 테이블 강제 생성 완료');
        
        // 기존 테이블에 누락된 컬럼 추가
        await migrateReservationsSchema();
        
      } catch (tableError) {
        console.log('⚠️ reservations 테이블 생성 시도 중 오류:', tableError.message);
      }
      
      await migrateFromJSON();
    }
  } catch (error) {
    console.error('데이터베이스 초기화 오류:', error);
  }
}

// 데이터베이스 연결 확인 미들웨어
async function checkDatabase(req, res, next) {
    try {
        if (dbMode === 'postgresql') {
            await pool.query('SELECT 1');
        }
        // JSON 모드는 항상 사용 가능하므로 체크 생략
        next();
    } catch (err) {
        console.error('데이터베이스 연결 오류:', err);
        // PostgreSQL 실패 시 JSON 모드로 fallback
        if (dbMode === 'postgresql') {
            console.warn('⚠️ PostgreSQL 연결 실패, JSON 데이터베이스로 전환합니다.');
            dbMode = 'json';
            if (!jsonDB) {
                jsonDB = require('./utils/jsonDB');
            }
        }
        next();
    }
}

// 모든 라우트에 데이터베이스 체크 적용
app.use(checkDatabase);

// 관리자 라우트 연결 (로그인/로그아웃만)
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// app.locals에 pool 설정 (API 라우트에서 사용)
app.locals.pool = pool;

// 수배업체 API 라우트 연결
try {
    const vendorsRouter = require('./routes/vendors');
    app.use('/api/vendors', vendorsRouter);
    console.log('✅ 수배업체 API 라우트 연결 완료');
} catch (error) {
    console.error('⚠️ 수배업체 라우트 연결 실패:', error.message);
}

// 임시 테스트 API (구체적인 라우트를 먼저 배치)
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API 연결 성공!', 
        timestamp: new Date(),
        database: dbMode 
    });
});

// 예약관리 페이지 전용 API - 대기중 상태만 표시
app.get('/api/reservations', async (req, res) => {
    try {
        console.log('🔍 예약관리 API 호출 - 대기중 상태만 조회');
        
        // 대기중(pending) 상태만 조회 - 예약관리 페이지 전용
        const query = `
            SELECT * FROM reservations 
            WHERE payment_status = 'pending' OR payment_status IS NULL
            ORDER BY 
                CASE WHEN payment_status = 'pending' THEN 0 ELSE 1 END,
                created_at DESC 
            LIMIT 100
        `;
        
        const result = await pool.query(query);
        
        console.log(`📋 예약관리 조회 결과: ${result.rows.length}건 (대기중 상태만)`);
        
        res.json({
            success: true,
            count: result.rows.length,
            reservations: result.rows,
            filter: 'pending_only',
            message: '대기중 예약만 표시됩니다'
        });
    } catch (error) {
        console.error('예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 목록 조회 실패',
            error: error.message
        });
    }
});

// 간단한 통계 API
app.get('/api/stats', async (req, res) => {
    try {
        const totalQuery = 'SELECT COUNT(*) as total FROM reservations';
        const totalResult = await pool.query(totalQuery);
        
        res.json({
            success: true,
            stats: {
                total_reservations: totalResult.rows[0].total,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '통계 조회 실패',
            error: error.message
        });
    }
});

// 새로운 API 라우트들을 위한 데이터베이스 연결 설정
app.locals.pool = pool; // 중요: 새로운 라우트들이 사용할 수 있도록 pool 설정

// 새로운 예약 관리 API 라우트들 (임시 비활성화)
try {
    // const bookingsListRouter = require('./routes/bookings.list');
    // const bookingsPatchRouter = require('./routes/bookings.patch');
    // const bookingsCreateRouter = require('./routes/bookings.create');
    // const bookingsDeleteRouter = require('./routes/bookings.delete');
    // const bookingsBulkRouter = require('./routes/bookings.bulk');
    // const fieldDefsRouter = require('./routes/fieldDefs'); // 임시 비활성화
    // const auditsRouter = require('./routes/audits'); // 임시 비활성화
    // const bookingsDetailRouter = require('./routes/bookings.detail'); // 마지막에 배치

    // API 라우트 연결 (구체적인 것부터 먼저) - 임시 비활성화
    // app.use('/api', fieldDefsRouter); // 임시 비활성화
    // app.use('/api', auditsRouter); // 임시 비활성화
    // app.use('/api', bookingsListRouter);
    // app.use('/api', bookingsPatchRouter);
    // app.use('/api', bookingsCreateRouter);
    // app.use('/api', bookingsDeleteRouter);
    // app.use('/api', bookingsBulkRouter);
    // app.use('/api', bookingsDetailRouter); // /:id 라우트는 맨 마지막
    
    console.log('⚠️ 기존 API 라우트들 임시 비활성화 - 새로운 라우트 사용');
} catch (error) {
    console.error('❌ API 라우트 연결 오류:', error.message);
    console.log('⚠️ 일부 API 라우트를 사용할 수 없습니다. 기본 기능은 정상 작동합니다.');
}

// 서버 시작 시 PostgreSQL 스키마 보정: 테이블 생성 → 컬럼 보정
(async () => {
    if (dbMode !== 'postgresql') return;
    try {
        const ok = await testConnection();
        if (!ok) return;
        await createTables();
        if (typeof ensureAllColumns === 'function') {
            await ensureAllColumns();
        }
        console.log('🗄️ DB 초기화/보정 완료');
    } catch (e) {
        console.warn('DB 초기화/보정 중 경고:', e.message);
    }
})();

// 관리자: 수동 컬럼 보정 실행 엔드포인트 (로그인 필요)
app.post('/admin/db/ensure-columns', requireAuth, async (req, res) => {
    if (dbMode !== 'postgresql') {
        return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
    }
    try {
        await createTables();
        if (typeof ensureAllColumns === 'function') {
            await ensureAllColumns();
        }
        return res.json({ success: true, message: '모든 테이블 컬럼 보정 완료' });
    } catch (e) {
        console.error('ensure-columns 실행 오류:', e);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.json({ success: false, message: '컬럼 보정 중 오류가 발생했습니다.', ...(expose ? { detail: e.message } : {}) });
    }
});

// 데이터베이스 헬퍼 함수들 (PostgreSQL/JSON 호환)
const dbHelpers = {
    // 사용자 관련
    async getUsers() {
        if (dbMode === 'postgresql') {
            const result = await pool.query(`
                SELECT u.*, a.name as agency_name, 
                       COALESCE(usage_stats.usage_count, 0) as usage_count
                FROM users u 
                LEFT JOIN agencies a ON u.agency_id = a.id 
                LEFT JOIN (
                    SELECT token, COUNT(*) as usage_count 
                    FROM usages 
                    GROUP BY token
                ) usage_stats ON u.token = usage_stats.token
                ORDER BY u.created_at DESC
            `);
            return result.rows;
        } else {
            return await jsonDB.findAll('users');
        }
    },
    
    async getUserByToken(token) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findOne('users', { token });
        }
    },
    
    async createUser(userData) {
        if (dbMode === 'postgresql') {
            const { name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin } = userData;
            const result = await pool.query(
                'INSERT INTO users (name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *',
                [name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin]
            );
            // 호환성: 과거 스키마의 customer_name 컬럼이 존재한다면 동기화 저장
            try {
                const col = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='customer_name'");
                if (col && col.rowCount > 0) {
                    await pool.query('UPDATE users SET customer_name = $1, updated_at = NOW() WHERE id = $2', [name, result.rows[0].id]);
                }
            } catch (compatErr) {
                console.warn('customer_name 호환 저장 중 경고:', compatErr.message);
            }
            return result.rows[0];
        } else {
            return await jsonDB.insert('users', userData);
        }
    },
    
    // 여행사 관련
    async getAgencies() {
        if (dbMode === 'postgresql') {
            const result = await pool.query(`
                SELECT a.*, 
                       COALESCE(user_counts.card_count, 0) as card_count
                FROM agencies a 
                LEFT JOIN (
                    SELECT agency_id, COUNT(*) as card_count 
                    FROM users 
                    GROUP BY agency_id
                ) user_counts ON a.id = user_counts.agency_id
                ORDER BY a.sort_order, a.name
            `);
            return result.rows;
        } else {
            return await jsonDB.findAll('agencies');
        }
    },
    
    async getAgencyById(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM agencies WHERE id = $1', [id]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findById('agencies', id);
        }
    },
    
    async getAgencyByCode(code) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM agencies WHERE code = $1', [code]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findOne('agencies', { code });
        }
    },
    
    async createAgency(agencyData) {
        if (dbMode === 'postgresql') {
            const { name, code, discount_info, show_banners_on_landing = true } = agencyData;
            
            // 새로운 여행사의 sort_order를 가장 마지막으로 설정
            const maxOrderResult = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM agencies');
            const nextOrder = maxOrderResult.rows[0].next_order;
            
            const result = await pool.query(
                'INSERT INTO agencies (name, code, discount_info, show_banners_on_landing, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
                [name, code, discount_info, show_banners_on_landing, nextOrder]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('agencies', agencyData);
        }
    },
    
    async updateAgency(id, agencyData) {
        if (dbMode === 'postgresql') {
            const { name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url } = agencyData;
            console.log('updateAgency 호출:', { id, name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url });
            
            const result = await pool.query(
                'UPDATE agencies SET name = $1, code = $2, discount_info = $3, show_banners_on_landing = $4, contact_email = $5, contact_phone = $6, logo_url = $7, updated_at = NOW() WHERE id = $8 RETURNING *',
                [name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url, id]
            );
            
            console.log('SQL 업데이트 결과:', result.rows[0]);
            console.log('영향받은 행 수:', result.rowCount);
            
            return result.rows[0];
        } else {
            return await jsonDB.update('agencies', id, agencyData);
        }
    },

    async deleteAgency(id) {
        if (dbMode === 'postgresql') {
            // 연결된 사용자 확인
            const userCheck = await pool.query('SELECT COUNT(*) as count FROM users WHERE agency_id = $1', [id]);
            const userCount = parseInt(userCheck.rows[0].count);
            
            if (userCount > 0) {
                return { hasUsers: true, userCount, message: `이 여행사에 연결된 ${userCount}명의 고객이 있습니다.` };
            }
            
            // 사용자가 없으면 바로 삭제
            const result = await pool.query('DELETE FROM agencies WHERE id = $1 RETURNING *', [id]);
            return { success: true, deleted: result.rows[0] };
        } else {
            return await jsonDB.delete('agencies', id);
        }
    },

    async forceDeleteAgency(id) {
        if (dbMode === 'postgresql') {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // 연결된 사용자들의 사용 이력 삭제
                await client.query('DELETE FROM usages WHERE token IN (SELECT token FROM users WHERE agency_id = $1)', [id]);
                
                // 연결된 사용자들 삭제
                await client.query('DELETE FROM users WHERE agency_id = $1', [id]);
                
                // 여행사 삭제
                const result = await client.query('DELETE FROM agencies WHERE id = $1 RETURNING *', [id]);
                
                await client.query('COMMIT');
                return { success: true, deleted: result.rows[0] };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } else {
            return await jsonDB.delete('agencies', id);
        }
    },
    
    // 제휴업체 관련
    async getStores() {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM stores ORDER BY usage_count DESC, name ASC');
            return result.rows;
        } else {
            return await jsonDB.findAll('stores');
        }
    },
    
    async getStoreById(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM stores WHERE id = $1', [id]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findById('stores', id);
        }
    },
    
    async createStore(storeData) {
        if (dbMode === 'postgresql') {
            const {
                name,
                category = null,
                discount = null,
                discount_info = null,
                address = null,
                phone = null,
                website = null,
                description = null,
                image_url = null
            } = storeData;
            const result = await pool.query(
                `INSERT INTO stores (name, category, discount, discount_info, address, phone, website, description, image_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [name, category, discount, discount_info, address, phone, website, description, image_url]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('stores', storeData);
        }
    },

    async updateStore(id, storeData) {
        if (dbMode === 'postgresql') {
            const {
                name,
                category = null,
                discount = null,
                discount_info = null,
                address = null,
                phone = null,
                website = null,
                description = null,
                image_url = null,
                usage_count = 0
            } = storeData;
            const result = await pool.query(
                `UPDATE stores SET name = $1, category = $2, discount = $3, discount_info = $4, 
                 address = $5, phone = $6, website = $7, description = $8, image_url = $9, usage_count = $10, updated_at = NOW() 
                 WHERE id = $11 RETURNING *`,
                [name, category, discount, discount_info, address, phone, website, description, image_url, usage_count, id]
            );
            return result.rows[0];
        } else {
            return await jsonDB.update('stores', id, storeData);
        }
    },

    async deleteStore(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('UPDATE stores SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            return await jsonDB.update('stores', id, { is_active: false });
        }
    },
    
    // 배너 관련
    async getBanners() {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY display_order');
            return result.rows;
        } else {
            const banners = await jsonDB.findAll('banners');
            return banners.filter(banner => banner.is_active !== false);
        }
    },
    
    async createBanner(bannerData) {
        if (dbMode === 'postgresql') {
            const {
                advertiser_name,
                image_url,
                link_url = null,
                description = null,
                is_active = true,
                display_order = 0,
                display_locations = [1]
            } = bannerData;
            const result = await pool.query(
                `INSERT INTO banners (advertiser_name, image_url, link_url, description, is_active, display_order, display_locations)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [advertiser_name, image_url, link_url, description, is_active, display_order, display_locations]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('banners', bannerData);
        }
    },

    async updateBanner(id, bannerData) {
        if (dbMode === 'postgresql') {
            const {
                advertiser_name,
                image_url,
                link_url = null,
                description = null,
                is_active = true,
                display_order = 0,
                display_locations = [1]
            } = bannerData;
            const result = await pool.query(
                `UPDATE banners SET advertiser_name = $1, image_url = $2, link_url = $3, description = $4,
                 is_active = $5, display_order = $6, display_locations = $7, updated_at = NOW() 
                 WHERE id = $8 RETURNING *`,
                [advertiser_name, image_url, link_url, description, is_active, display_order, display_locations, id]
            );
            return result.rows[0];
        } else {
            return await jsonDB.update('banners', id, bannerData);
        }
    },

    async deleteBanner(id) {
        if (dbMode === 'postgresql') {
            // 실제 삭제로 변경 (소프트 삭제에서 하드 삭제로)
            const result = await pool.query('DELETE FROM banners WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            return await jsonDB.delete('banners', id);
        }
    },

    async incrementBannerClick(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('UPDATE banners SET click_count = click_count + 1, updated_at = NOW() WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            const banner = await jsonDB.findById('banners', id);
            if (banner) {
                banner.click_count = (banner.click_count || 0) + 1;
                return await jsonDB.update('banners', id, banner);
            }
            return null;
        }
    },
    
    // 사용 기록 관련
    async getUsages(token = null) {
        if (dbMode === 'postgresql') {
            if (token) {
                const result = await pool.query(`
                    SELECT u.*, 
                           users.name as customer_name,
                           agencies.name as agency_name
                    FROM usages u
                    LEFT JOIN users ON u.token = users.token
                    LEFT JOIN agencies ON users.agency_id = agencies.id
                    WHERE u.token = $1 
                    ORDER BY u.used_at DESC
                `, [token]);
                return result.rows;
            } else {
                const result = await pool.query(`
                    SELECT u.*, 
                           users.name as customer_name,
                           agencies.name as agency_name
                    FROM usages u
                    LEFT JOIN users ON u.token = users.token
                    LEFT JOIN agencies ON users.agency_id = agencies.id
                    ORDER BY u.used_at DESC
                `);
                return result.rows;
            }
        } else {
            if (token) {
                return await jsonDB.findAll('usages', { token });
            } else {
                return await jsonDB.findAll('usages');
            }
        }
    },
    
    async createUsage(usageData) {
        if (dbMode === 'postgresql') {
            const { token, store_name, used_at = new Date() } = usageData;
            const result = await pool.query(
                'INSERT INTO usages (token, store_name, used_at) VALUES ($1, $2, $3) RETURNING *',
                [token, store_name, used_at]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('usages', { ...usageData, used_at: usageData.used_at || new Date() });
        }
    }
};

// 날짜 포맷 함수
function formatDate(date) {
    const d = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = String(d.getDate()).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
}

// 발급 코드 전달 상태 업데이트 API
app.put('/admin/issue-codes/:id/delivery', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_delivered } = req.body;
        
        if (dbMode === 'postgresql') {
            const delivered_at = is_delivered ? new Date() : null;
            
            const result = await pool.query(
                'UPDATE issue_codes SET is_delivered = $1, delivered_at = $2 WHERE id = $3 RETURNING *',
                [is_delivered, delivered_at, id]
            );
            
            if (result.rows.length === 0) {
                return res.json({ success: false, message: '코드를 찾을 수 없습니다.' });
            }
            
            res.json({ 
                success: true, 
                message: is_delivered ? '전달 완료로 표시되었습니다.' : '미전달로 표시되었습니다.',
                code: result.rows[0]
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' });
        }
    } catch (error) {
        console.error('전달 상태 업데이트 오류:', error);
        res.json({ success: false, message: '전달 상태 업데이트 중 오류가 발생했습니다.' });
    }
});

// ==================== 메인 라우트 ====================

// 헬스체크 라우트 (디버깅용)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'PostgreSQL 서버가 정상 작동 중입니다.'
    });
});

// 데이터베이스 테스트 엔드포인트
app.get('/db-test', async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT NOW()');
            res.json({ 
                status: 'PostgreSQL Connected', 
                time: result.rows[0].now,
                mode: dbMode 
            });
        } else {
            res.json({ 
                status: 'JSON Mode', 
                mode: dbMode 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            status: 'Database Error', 
            error: error.message,
            mode: dbMode 
        });
    }
});

// 예약 테이블 생성 및 확인 엔드포인트
app.get('/create-reservations-table', async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ status: 'JSON Mode - 테이블 생성 불필요' });
        }

        // 예약 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reservations (
                id SERIAL PRIMARY KEY,
                company VARCHAR(50) DEFAULT 'NOL',
                reservation_number VARCHAR(50),
                confirmation_number VARCHAR(50),
                booking_channel VARCHAR(100),
                product_name VARCHAR(200),
                amount DECIMAL(10,2),
                package_type VARCHAR(100),
                usage_date DATE,
                usage_time TIME,
                korean_name VARCHAR(100),
                english_name VARCHAR(100),
                email VARCHAR(150),
                phone VARCHAR(20),
                kakao_id VARCHAR(100),
                guest_count INTEGER,
                memo TEXT,
                issue_code_id INTEGER REFERENCES issue_codes(id),
                code_issued BOOLEAN DEFAULT FALSE,
                code_issued_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'reservations'
        `);

        // 컬럼 정보 확인
        const columns = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'reservations'
            ORDER BY ordinal_position
        `);

        res.json({
            status: 'success',
            message: 'reservations 테이블 생성 완료',
            tableExists: tableCheck.rows.length > 0,
            columns: columns.rows
        });

    } catch (error) {
        console.error('테이블 생성 오류:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 사용자용 로그아웃 (프론트 my-card.ejs 등에서 사용)
app.post('/logout', (req, res) => {
    try {
        req.session.destroy(() => {
            res.redirect('/');
        });
    } catch (e) {
        res.redirect('/');
    }
});

// 제휴업체 생성 (관리자)
app.post('/admin/stores', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const name = (req.body.name || '').trim();
        const category = (req.body.category || '').trim();
        const description = (req.body.description || '').trim();
        const discount = (req.body.discount || '').trim();
        const address = (req.body.address || '').trim();
        const phone = (req.body.phone || '').trim();
        const website = (req.body.website || '').trim();
        const image_url = (req.body.image_url || '').trim();

        if (!name || !category || !description || !discount) {
            if (wantsJson) {
                return res.json({ success: false, message: '필수 항목(업체명/카테고리/설명/할인 정보)을 입력하세요.' });
            } else {
                return res.redirect('/admin/stores?error=missing_fields');
            }
        }

        const store = await dbHelpers.createStore({
            name,
            category,
            description,
            discount,
            address: address || null,
            phone: phone || null,
            website: website || null,
            image_url: image_url || null
        });

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 추가되었습니다.', store });
        } else {
            return res.redirect('/admin/stores?success=1');
        }
    } catch (error) {
        console.error('제휴업체 생성 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 추가 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 개별 조회 라우트 (수정 모달용) - PUT보다 먼저 정의
app.get('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const store = await dbHelpers.getStoreById(id);
        
        if (!store) {
            return res.json({
                success: false,
                message: '제휴업체를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            store: store
        });
        
    } catch (error) {
        console.error('제휴업체 조회 오류:', error);
        res.json({
            success: false,
            message: '제휴업체 조회 중 오류가 발생했습니다.'
        });
    }
});

// 제휴업체 수정 라우트
app.put('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        console.log('수정 요청 받은 데이터:', req.body);
        
        const {
            name,
            category,
            discount,
            discount_info,
            address,
            phone,
            website,
            description,
            image_url,
            usage_count
        } = req.body;

        if (!name || !category || !description || !discount) {
            if (wantsJson) {
                return res.json({ success: false, message: '필수 항목(업체명/카테고리/설명/할인 정보)을 입력하세요.' });
            } else {
                return res.redirect('/admin/stores?error=missing_fields');
            }
        }

        const updateData = {
            name: name.trim(),
            category: category.trim(),
            discount: discount.trim(),
            discount_info: discount_info ? discount_info.trim() : null,
            address: address ? address.trim() : null,
            phone: phone ? phone.trim() : null,
            website: website ? website.trim() : null,
            description: description.trim(),
            image_url: image_url ? image_url.trim() : null,
            usage_count: usage_count ? Number(usage_count) : 0
        };
        
        console.log('updateStore 호출 전 데이터:', updateData);
        const store = await dbHelpers.updateStore(id, updateData);
        console.log('updateStore 결과:', store);

        if (!store) {
            if (wantsJson) {
                return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
            } else {
                return res.redirect('/admin/stores?error=not_found');
            }
        }

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 수정되었습니다.', store });
        } else {
            return res.redirect('/admin/stores?success=updated');
        }
    } catch (error) {
        console.error('제휴업체 수정 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 수정 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 삭제 라우트 (소프트 삭제)
app.delete('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        const store = await dbHelpers.deleteStore(id);
        
        if (!store) {
            if (wantsJson) {
                return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
            } else {
                return res.redirect('/admin/stores?error=not_found');
            }
        }

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 비활성화되었습니다.' });
        } else {
            return res.redirect('/admin/stores?success=deleted');
        }
    } catch (error) {
        console.error('제휴업체 삭제 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 삭제 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 활성/비활성 토글
app.post('/admin/stores/:id/toggle', requireAuth, async (req, res) => {
    try {
        console.log('제휴업체 토글 요청:', req.params.id);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        
        if (!Number.isFinite(id)) {
            console.log('유효하지 않은 ID:', req.params.id);
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        let nextVal;
        if (dbMode === 'postgresql') {
            console.log('PostgreSQL에서 현재 상태 조회 중...');
            const current = await pool.query('SELECT is_active FROM stores WHERE id = $1', [id]);
            
            if (current.rowCount === 0) {
                console.log('업체를 찾을 수 없음:', id);
                return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            }
            
            const currentStatus = current.rows[0].is_active;
            nextVal = !Boolean(currentStatus);
            console.log(`업체 ${id} 상태 변경: ${currentStatus} -> ${nextVal}`);
            
            await pool.query('UPDATE stores SET is_active = $1, updated_at = NOW() WHERE id = $2', [nextVal, id]);
            console.log('상태 업데이트 완료');
        } else {
            const store = await jsonDB.findById('stores', id);
            if (!store) return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            nextVal = store.is_active === false ? true : false;
            await jsonDB.update('stores', id, { is_active: nextVal });
        }

        if (wantsJson) {
            console.log('JSON 응답 반환:', { success: true, is_active: nextVal });
            return res.json({ success: true, is_active: nextVal, message: `제휴업체가 ${nextVal ? '활성화' : '비활성화'}되었습니다.` });
        } else {
            return res.redirect('/admin/stores?toggle=1');
        }
    } catch (error) {
        console.error('제휴업체 토글 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// ==================== 관리자 페이지 라우트 ====================

// 관리자 메인 페이지 (대시보드로 리다이렉트)
app.get('/admin', requireAuth, (req, res) => {
    res.redirect('/admin/dashboard');
});

// 관리자 대시보드
app.get('/admin/dashboard', requireAuth, async (req, res) => {
    try {
        // 통계 데이터 수집
        const [users, agencies, stores, usages] = await Promise.all([
            dbHelpers.getUsers().catch(() => []),
            dbHelpers.getAgencies().catch(() => []),
            dbHelpers.getStores().catch(() => []),
            dbHelpers.getUsages().catch(() => [])
        ]);

        // 최근 사용 이력 (최근 10개)
        const recentUsages = usages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(0, 10);

        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: {
                totalUsers: users.length,
                totalAgencies: agencies.length,
                totalStores: stores.length,
                totalUsages: usages.length
            },
            recentUsages,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('관리자 대시보드 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: { totalUsers: 0, totalAgencies: 0, totalStores: 0, totalUsages: 0 },
            recentUsages: [],
            error: 'dashboard_error'
        });
    }
});

// 관리자 여행사 관리 페이지
app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: agencies,
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('여행사 관리 페이지 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: null,
            error: 'load_error'
        });
    }
});


// 관리자 고객 관리 페이지
app.get('/admin/customers', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const users = await dbHelpers.getUsers();
        const totalUsers = users.length;
        const paginatedUsers = users.slice(offset, offset + limit);
        
        const totalPages = Math.ceil(totalUsers / limit);

        res.render('admin/customers', {
            title: '고객 관리',
            users: paginatedUsers,
            pagination: {
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('고객 관리 페이지 오류:', error);
        res.render('admin/customers', {
            title: '고객 관리',
            users: [],
            pagination: { currentPage: 1, totalPages: 0, hasNext: false, hasPrev: false },
            error: 'load_error'
        });
    }
});

// 관리자 사용 이력 페이지
app.get('/admin/usage-history', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 50;
        const offset = (page - 1) * limit;

        const allUsages = await dbHelpers.getUsages();
        const totalUsages = allUsages.length;
        const paginatedUsages = allUsages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(offset, offset + limit);
        
        const totalPages = Math.ceil(totalUsages / limit);

        res.render('admin/usage-history', {
            title: '사용 이력',
            usages: paginatedUsages,
            pagination: {
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('사용 이력 페이지 오류:', error);
        res.render('admin/usage-history', {
            title: '사용 이력',
            usages: [],
            pagination: { currentPage: 1, totalPages: 0, hasNext: false, hasPrev: false },
            error: 'load_error'
        });
    }
});

// 관리자 수배관리 페이지
app.get('/admin/assignments', requireAuth, async (req, res) => {
    try {
        res.render('admin/assignments', {
            title: '수배관리',
            adminUsername: req.session.adminUsername || 'admin'
        });
    } catch (error) {
        console.error('수배관리 페이지 오류:', error);
        res.render('admin/assignments', {
            title: '수배관리',
            adminUsername: req.session.adminUsername || 'admin'
        });
    }
});

// 관리자 광고 배너 관리 페이지
app.get('/admin/banners', requireAuth, async (req, res) => {
    try {
        let banners = [];
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners ORDER BY display_order, created_at DESC');
            banners = result.rows;
        } else {
            banners = await jsonDB.findAll('banners');
        }

        res.render('admin/banners', {
            title: '광고 배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('광고 배너 관리 페이지 오류:', error);
        res.render('admin/banners', {
            title: '광고 배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners: [],
            success: null,
            error: 'load_error'
        });
    }
});

// 배너 생성 (관리자)
app.post('/admin/banners', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        let { advertiser_name, title, image_url, link_url, description, display_order } = req.body;
        let display_locations = req.body.display_locations;

        advertiser_name = String(advertiser_name || '').trim();
        title = String(title || '').trim();
        image_url = String(image_url || '').trim();
        link_url = (link_url && String(link_url).trim()) || null;
        description = (description && String(description).trim()) || null;
        const orderNum = Number(display_order);
        display_order = Number.isFinite(orderNum) ? orderNum : 0;

        // 체크박스 다중 값 처리
        if (!Array.isArray(display_locations)) {
            display_locations = typeof display_locations === 'undefined' ? [] : [display_locations];
        }
        const locationsInt = display_locations
            .map(v => Number(v))
            .filter(n => Number.isFinite(n) && n > 0);
        const finalLocations = locationsInt.length ? locationsInt : [1];

        if (!advertiser_name && !title) {
            if (wantsJson) return res.json({ success: false, message: '광고주명 또는 제목 중 하나는 필수입니다.' });
            return res.redirect('/admin/banners?error=missing_title');
        }
        if (!image_url) {
            if (wantsJson) return res.json({ success: false, message: '배너 이미지 URL은 필수입니다.' });
            return res.redirect('/admin/banners?error=missing_image');
        }

        // 배너 생성 (description 필드 포함)
        const banner = await dbHelpers.createBanner({
            advertiser_name: title || advertiser_name,
            image_url,
            link_url,
            description,
            is_active: true,
            display_order,
            display_locations: finalLocations
        });

        if (wantsJson) {
            return res.json({ success: true, message: '배너가 추가되었습니다.', banner });
        } else {
            return res.redirect('/admin/banners?success=1');
        }
    } catch (error) {
        console.error('배너 생성 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '배너 추가 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/banners?error=server');
        }
    }
});

// 메인 페이지
app.get('/', async (req, res) => {
    // 데이터 조회 (오류 발생 시 빈 배열로 대체하여 페이지는 항상 렌더)
    let agencies = [];
    let banners = [];
    try {
        agencies = await dbHelpers.getAgencies();
    } catch (err) {
        console.warn('여행사 데이터 조회 실패:', err.message);
    }
    try {
        banners = await dbHelpers.getBanners();
    } catch (err) {
        console.warn('배너 데이터 조회 실패:', err.message);
    }

    try {
        res.render('index', {
            title: '괌세이브카드',
            currentPage: 'home',
            agencies,
            banners,
            partnerAgency: null
        });
    } catch (renderErr) {
        console.error('메인 페이지 렌더링 오류:', renderErr);
        res.status(500).render('error', {
            title: '서버 오류',
            message: '페이지 렌더링 중 오류가 발생했습니다.',
            error: { status: 500, message: renderErr.message }
        });
    }
});

// 여행사 전용 랜딩 페이지
app.get('/partner/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // 여행사 코드로 여행사 정보 조회
        const partnerAgency = await dbHelpers.getAgencyByCode(code);
        if (!partnerAgency) {
            return res.render('error', {
                title: '여행사를 찾을 수 없습니다',
                message: '유효하지 않은 여행사 코드입니다.',
                error: { status: 404 }
            });
        }

        // 데이터 조회
        let agencies = [];
        let banners = [];
        try {
            agencies = await dbHelpers.getAgencies();
        } catch (err) {
            console.warn('여행사 데이터 조회 실패:', err.message);
        }
        try {
            banners = await dbHelpers.getBanners();
        } catch (err) {
            console.warn('배너 데이터 조회 실패:', err.message);
        }

        res.render('index', {
            title: `괌세이브카드 - ${partnerAgency.name}`,
            currentPage: 'home',
            agencies,
            banners,
            partnerAgency: partnerAgency
        });
        
    } catch (error) {
        console.error('파트너 랜딩 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500, message: error.message }
        });
    }
});

// 여행사별 랜딩 페이지
app.get('/partner/:agencyCode', async (req, res) => {
    try {
        const { agencyCode } = req.params;
        const agency = await dbHelpers.getAgencyByCode(agencyCode);
        
        if (!agency) {
            return res.render('error', {
                title: '페이지를 찾을 수 없습니다',
                message: '유효하지 않은 여행사 코드입니다.',
                error: { status: 404 }
            });
        }
        
        // 배너 표시 여부 확인
        let banners = [];
        if (agency.show_banners_on_landing) {
            banners = await dbHelpers.getBanners();
        }
        
        res.render('index', {
            title: `${agency.name} - 괌세이브카드`,
            currentPage: 'home',
            agency: agency,
            banners: banners,
            partnerMode: true,
            selectedAgency: agency
        });
    } catch (error) {
        console.error('파트너 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 배너 클릭 추적 API
app.post('/banner/click/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await dbHelpers.incrementBannerClick(id);
        res.json({ success: true });
    } catch (error) {
        console.error('배너 클릭 추적 오류:', error);
        res.json({ success: false });
    }
});

// 발급 완료 페이지
app.get('/register/success', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.redirect('/issue');
        }

        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.redirect('/issue');
        }

        const agency = user.agency_id ? await dbHelpers.getAgencyById(user.agency_id) : null;
        const banners = await dbHelpers.getBanners();

        // 만료 텍스트 구성 (있으면 표시)
        let expiration_text = null;
        if (user.expiration_start && user.expiration_end) {
            const start = new Date(user.expiration_start);
            const end = new Date(user.expiration_end);
            const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
            expiration_text = `Save Card Expiration Date ${fmt(start)}~${fmt(end)}`;
        }

        const userForView = {
            customer_name: user.name || user.customer_name || '고객',
            agency_name: agency ? agency.name : 'Unknown',
            expiration_text,
            token: token
        };

        const cardUrl = `/card?token=${encodeURIComponent(token)}`;
        const qrImageUrl = user.qr_code; // DataURL

        return res.render('register-success', {
            title: '괌세이브카드 발급 완료',
            user: userForView,
            cardUrl,
            qrImageUrl,
            banners
        });
    } catch (error) {
        console.error('발급 성공 페이지 오류:', error);
        return res.redirect('/issue');
    }
});

// 제휴업체 목록 페이지
app.get('/stores', async (req, res) => {
    try {
        let partnerAgency = null;
        if (req.query.agency) {
            partnerAgency = await dbHelpers.getAgencyByCode(req.query.agency);
        }
        
        const stores = await dbHelpers.getStores();
        const banners = await dbHelpers.getBanners();
        
        // 카테고리 생성 (stores에서 카테고리 추출)
        const categories = {};
        if (stores && stores.length > 0) {
            stores.forEach(store => {
                if (store.category) {
                    categories[store.category] = true;
                }
            });
        }
        
        res.render('stores', {
            title: '제휴업체',
            currentPage: 'stores',
            stores: stores,
            banners: banners,
            categories: categories,
            partnerAgency: partnerAgency
        });
    } catch (error) {
        console.error('제휴업체 목록 오류:', error);
        res.render('stores', {
            title: '제휴업체',
            currentPage: 'stores',
            stores: [],
            banners: [],
            categories: {},
            partnerAgency: null
        });
    }
});

app.get('/partner-apply', (req, res) => {
    try {
        res.render('partner-apply', {
            title: '제휴업체 신청'
        });
    } catch (error) {
        console.error('제휴 신청 페이지 오류:', error);
        res.status(500).render('error', { 
            title: '서버 오류',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 사용자 로그인 페이지
app.get('/login', async (req, res) => {
    try {
        let partnerAgency = null;
        if (req.query.agency) {
            partnerAgency = await dbHelpers.getAgencyByCode(req.query.agency);
        }
        
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: null,
            success: null,
            partnerAgency: partnerAgency
        });
    } catch (error) {
        console.error('로그인 페이지 오류:', error);
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: null,
            success: null,
            partnerAgency: null
        });
    }
});

// 사용자 로그인 처리
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '이메일과 비밀번호를 입력해주세요.',
                success: null
            });
        }
        
        if (!/^[0-9]{4}$/.test(password)) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호는 4자리 숫자여야 합니다.',
                success: null
            });
        }
        
        // 이메일로 사용자 찾기
        let user = null;
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            user = result.rows[0];
        } else {
            const users = jsonDB.getUsers();
            user = users.find(u => u.email === email);
        }
        
        if (!user) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '등록되지 않은 이메일입니다.',
                success: null
            });
        }
        
        if (!user.pin) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호가 설정되지 않았습니다. 관리자에게 문의해주세요.',
                success: null
            });
        }
        
        // 비밀번호 확인
        const isPasswordValid = await bcrypt.compare(password, user.pin);
        if (!isPasswordValid) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호가 일치하지 않습니다.',
                success: null
            });
        }
        
        // 로그인 성공 - 카드 페이지로 리다이렉트
        res.redirect(`/card?token=${encodeURIComponent(user.token)}&success=1`);
        
    } catch (error) {
        console.error('사용자 로그인 오류:', error);
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: '로그인 처리 중 오류가 발생했습니다.',
            success: null
        });
    }
});

// 카드 발급 페이지
app.get('/register', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        const { agency } = req.query;
        
        let selectedAgency = null;
        if (agency) {
            selectedAgency = await dbHelpers.getAgencyByCode(agency);
        }
        
        res.render('register', {
            title: '카드 발급',
            currentPage: 'register',
            agencies: agencies,
            error: null,
            success: null,
            selectedAgency: selectedAgency,
            partnerAgency: selectedAgency
        });
    } catch (error) {
        console.error('카드 발급 페이지 오류:', error);
        res.render('register', {
            title: '카드 발급',
            currentPage: 'register',
            agencies: [],
            error: null,
            success: null,
            selectedAgency: null,
            partnerAgency: null
        });
    }
});

// 사용자 로그인 페이지
app.get('/login', (req, res) => {
    res.render('login', {
        title: '로그인',
        error: null
    });
});

// 내 카드 페이지
app.get('/my-card', (req, res) => {
    res.render('my-card', {
        title: '내 카드',
        currentPage: 'my-card',
        user: null,
        usages: []
    });
});

// 카드 발급 페이지
app.get('/issue', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('issue', {
            title: '카드 발급',
            agencies: agencies
        });
    } catch (error) {
        console.error('카드 발급 페이지 오류:', error);
        res.render('issue', {
            title: '카드 발급',
            agencies: []
        });
    }
});

// 카드 발급 처리
app.post('/issue', async (req, res) => {
    try {
        const { name, email, issue_code } = req.body;
        let { agency_id, agency_code } = req.body;
        const pin = (req.body.pin || '').toString().trim();
        const phone = (req.body.phone || '').toString().trim() || null; // 선택 입력

        // 발급 코드 검증 (필수)
        if (!issue_code || !issue_code.trim()) {
            return res.json({ success: false, message: '발급 코드를 입력해주세요.' });
        }

        const codeValidation = await validateIssueCode(issue_code.trim().toLowerCase());
        if (!codeValidation.valid) {
            return res.json({ success: false, message: codeValidation.message });
        }

        // agency_id 우선, 없으면 agency_code로 조회
        let agency = null;
        if (agency_id) {
            const idNum = Number(agency_id);
            if (!Number.isFinite(idNum)) {
                return res.json({ success: false, message: '유효하지 않은 여행사 ID입니다.' });
            }
            agency = await dbHelpers.getAgencyById(idNum);
        } else if (agency_code) {
            agency_code = String(agency_code).trim();
            agency = await dbHelpers.getAgencyByCode(agency_code);
            if (agency) {
                agency_id = agency.id;
            }
        }

        // 필수값: name, agency, pin(4자리)
        if (!name || !agency_id || !agency) {
            return res.json({ success: false, message: '이름과 여행사를 선택해주세요.' });
        }
        if (!/^[0-9]{4}$/.test(pin)) {
            return res.json({ success: false, message: '비밀번호는 4자리 숫자여야 합니다.' });
        }
        
        // 토큰 생성
        const token = uuidv4();
        
        // 유효기간 설정 (발급일로부터 1년)
        const expirationStart = new Date();
        const expirationEnd = new Date();
        expirationEnd.setFullYear(expirationEnd.getFullYear() + 1);
        
        const expirationText = `Save Card Expiration Date ${formatDate(expirationStart)}~${formatDate(expirationEnd)}`;
        
        // QR 코드 생성 (Base64 인라인 방식)
        const qrUrl = `${req.protocol}://${req.get('host')}/card?token=${token}&staff=true`;
        const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        // PIN 해시 처리
        const saltRounds = Number(process.env.PIN_SALT_ROUNDS || 10);
        const hashedPin = await bcrypt.hash(pin, saltRounds);

        // (운영 안전장치) users 테이블 필수 컬럼 보정
        if (dbMode === 'postgresql') {
            try {
                await pool.query(`
                  ALTER TABLE users
                  ADD COLUMN IF NOT EXISTS name VARCHAR(255),
                  ADD COLUMN IF NOT EXISTS qr_code TEXT,
                  ADD COLUMN IF NOT EXISTS expiration_start TIMESTAMP,
                  ADD COLUMN IF NOT EXISTS expiration_end TIMESTAMP,
                  ADD COLUMN IF NOT EXISTS pin VARCHAR(100)
                `);
                // 과거 스키마 호환: customer_name만 있고 name이 비어있는 경우 동기화
                await pool.query(`
                  DO $$
                  BEGIN
                    IF EXISTS (
                      SELECT 1 FROM information_schema.columns
                      WHERE table_name='users' AND column_name='customer_name'
                    ) THEN
                      UPDATE users SET name = customer_name WHERE name IS NULL OR name = '';
                    END IF;
                  END$$;
                `);
                // 기존 pin 컬럼 길이가 100 미만이면 확장
                await pool.query(`
                  DO $$
                  BEGIN
                    IF EXISTS (
                      SELECT 1 FROM information_schema.columns
                      WHERE table_name='users' AND column_name='pin' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
                    ) THEN
                      ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(100);
                    END IF;
                  END$$;
                `);
            } catch (ensureErr) {
                console.warn('users 테이블 컬럼 보정 중 경고:', ensureErr.message);
            }
        }

        // 사용자 생성 (운영 DB에 pin 컬럼이 없는 경우 자동 보정 후 재시도)
        let user;
        try {
            user = await dbHelpers.createUser({
                name,
                phone,
                email,
                agency_id,
                token,
                qr_code: qrCodeDataURL,
                expiration_start: expirationStart,
                expiration_end: expirationEnd,
                pin: hashedPin
            });
        } catch (e) {
            // PostgreSQL: undefined_column = 42703
            const missingPinColumn = e && (e.code === '42703' || /column\s+"?pin"?\s+of\s+relation\s+"?users"?/i.test(e.message || ''));
            if (dbMode === 'postgresql' && missingPinColumn) {
                console.warn('users.pin 컬럼이 없어 자동으로 추가합니다.');
                try {
                    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pin VARCHAR(100)');
                    await pool.query(`
                      DO $$
                      BEGIN
                        IF EXISTS (
                          SELECT 1 FROM information_schema.columns
                          WHERE table_name='users' AND column_name='pin' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
                        ) THEN
                          ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(100);
                        END IF;
                      END$$;
                    `);
                    // 재시도
                    user = await dbHelpers.createUser({
                        name,
                        phone,
                        email,
                        agency_id,
                        token,
                        qr_code: qrCodeDataURL,
                        expiration_start: expirationStart,
                        expiration_end: expirationEnd,
                        pin: hashedPin
                    });
                } catch (e2) {
                    console.error('핀 컬럼 추가 또는 재시도 중 오류:', e2);
                    throw e2;
                }
            } else {
                throw e;
            }
        }
        
        // 발급 코드를 사용됨으로 표시
        if (dbMode === 'postgresql' && codeValidation.codeId) {
            try {
                await pool.query(
                    'UPDATE issue_codes SET is_used = true, used_by_user_id = $1, used_at = NOW() WHERE id = $2',
                    [user.id, codeValidation.codeId]
                );
            } catch (codeUpdateError) {
                console.error('발급 코드 업데이트 오류:', codeUpdateError);
                // 코드 업데이트 실패해도 카드 발급은 성공으로 처리
            }
        }
        
        // 제출 방식에 따른 응답 분기: AJAX이면 JSON, 일반 HTML 폼이면 발급 완료 페이지로 리다이렉트
        const isAjax = req.xhr || (req.get('X-Requested-With') === 'XMLHttpRequest');
        const acceptsHtml = (req.accepts(['html','json']) === 'html');
        if (!isAjax && acceptsHtml) {
            return res.redirect(`/register/success?token=${encodeURIComponent(token)}`);
        }
        return res.json({
            success: true,
            message: '카드가 성공적으로 발급되었습니다.',
            token: token,
            success_url: `/register/success?token=${encodeURIComponent(token)}`
        });
        
    } catch (error) {
        console.error('카드 발급 오류:', error);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        res.json({
            success: false,
            message: '카드 발급 중 오류가 발생했습니다.',
            ...(expose ? { detail: error.message, code: error.code } : {})
        });
    }
});

// 제휴 신청 접수 API
app.post('/api/partner-apply', async (req, res) => {
    try {
        // 폼 → DB 컬럼 매핑
        const business_name = (req.body.business_name || '').toString().trim();
        const contact_name = (req.body.contact_name || '').toString().trim();
        const phone = (req.body.phone || '').toString().trim();
        const email = (req.body.email || '').toString().trim() || null;
        const business_type = (req.body.business_type || '').toString().trim() || null;
        const location = (req.body.business_address || req.body.location || '').toString().trim() || null;
        const discount_offer = (req.body.proposed_discount || req.body.discount_offer || '').toString().trim() || null;
        // 설명/추가정보를 하나로 합쳐 저장 (둘 중 하나만 있을 수도 있음)
        const desc = (req.body.business_description || '').toString().trim();
        const notes = (req.body.additional_notes || req.body.additional_info || '').toString().trim();
        const additional_info = [desc, notes].filter(Boolean).join('\n\n');
        
        if (!business_name || !contact_name || !phone) {
            return res.status(400).json({ success: false, message: '필수 항목을 입력해주세요.' });
        }
        
        if (dbMode === 'postgresql') {
            // 중복 체크
            const existingApp = await pool.query(
                'SELECT id FROM partner_applications WHERE business_name = $1 AND contact_name = $2 AND phone = $3',
                [business_name, contact_name, phone]
            );
            
            if (existingApp.rows.length > 0) {
                return res.json({
                    success: false,
                    message: '이미 동일한 정보로 신청된 내역이 있습니다.'
                });
            }
            
            await pool.query(
                `INSERT INTO partner_applications (business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info || null]
            );
        } else {
            await jsonDB.create('partner_applications', {
                id: Date.now(),
                business_name, contact_name, phone, email,
                business_type, location, discount_offer,
                additional_info: additional_info || null,
                status: 'pending',
                created_at: new Date().toISOString()
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('제휴 신청 접수 오류:', error);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

// 내 카드 페이지
app.get('/my-card', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.render('error', {
                title: '잘못된 접근',
                message: '유효하지 않은 카드입니다.',
                error: { status: 400 }
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }
        
        const agency = await dbHelpers.getAgencyById(user.agency_id);
        const usages = await dbHelpers.getUsages(token);
        
        res.render('my-card', {
            title: '내 카드',
            currentPage: 'my-card',
            user: { ...user, agency_name: agency ? agency.name : 'Unknown' },
            usages: usages.slice(0, 5)
        });
        
    } catch (error) {
        console.error('내 카드 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 카드 보기 페이지 (경로 파라미터 방식) - /card로 리다이렉트
app.get('/view-card/:token', (req, res) => {
    const { token } = req.params;
    if (!token) {
        return res.redirect('/issue');
    }
    res.redirect(`/card?token=${token}`);
});

// 관리자 전용 - 고객 카드 정보 API (모달용)
app.get('/admin/card-info/:token', requireAuth, async (req, res) => {
    const { token } = req.params;

    try {
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({ success: false, message: '카드를 찾을 수 없습니다.' });
        }

        const agency = await dbHelpers.getAgencyById(user.agency_id);
        
        // 사용 이력 조회 (최근 10개)
        const usages = await dbHelpers.getUsages(token);
        const recentUsages = usages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(0, 10);

        res.json({
            success: true,
            user: {
                ...user,
                agency_name: agency ? agency.name : 'Unknown'
            },
            usages: recentUsages
        });
    } catch (error) {
        console.error('관리자 카드 정보 조회 오류:', error);
        res.json({ success: false, message: '카드 정보를 불러오는 중 오류가 발생했습니다.' });
    }
});

// 카드 사용 페이지 (QR 스캔)
app.get('/card', async (req, res) => {
    try {
        const { token, staff, success: successFlag } = req.query;
        
        if (!token) {
            return res.render('error', {
                title: '잘못된 접근',
                message: '유효하지 않은 카드입니다.',
                error: { status: 400 }
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }
        
        const agency = await dbHelpers.getAgencyById(user.agency_id);
        const banners = await dbHelpers.getBanners();
        const banner = banners.length > 0 ? banners[Math.floor(Math.random() * banners.length)] : null;
        const usages = await dbHelpers.getUsages(token);
        const stores = await dbHelpers.getStores();
        const isStaffMode = staff === 'true';
        
        const successMessage = (successFlag === '1' || successFlag === 'true')
            ? '카드 발급이 완료되었어요! 아래 QR을 매장 직원에게 보여주세요.'
            : null;

        res.render('card', {
            title: '괄세이브카드',
            currentPage: 'card',
            user: { 
                ...user, 
                agency_name: agency ? agency.name : 'Unknown',
                customer_name: user.customer_name || user.name || '고객',
                qr_code: user.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://savecard-production.up.railway.app/card?token=${token}&staff=true`)}`
            },
            banner: banner,
            usages: usages.slice(0, 5),
            stores: stores,
            isStaffMode: isStaffMode,
            success: successMessage,
            error: null
        });
        
    } catch (error) {
        console.error('카드 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 카드 비밀번호 검증
app.post('/verify-password', async (req, res) => {
    try {
        const token = (req.body.token || '').toString().trim();
        const password = (req.body.password || '').toString().trim();

        if (!token || !password) {
            return res.json({ success: false, message: '필수 정보가 누락되었습니다.' });
        }
        if (!/^[0-9]{4}$/.test(password)) {
            return res.json({ success: false, message: '비밀번호는 4자리 숫자여야 합니다.' });
        }

        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({ success: false, message: '유효하지 않은 카드입니다.' });
        }
        if (!user.pin) {
            return res.json({ success: false, message: '비밀번호가 설정되지 않았습니다. 관리자에게 문의해주세요.' });
        }

        const ok = await bcrypt.compare(password, user.pin);
        if (!ok) {
            return res.json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('비밀번호 검증 오류:', error);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.json({ success: false, message: '인증 중 오류가 발생했습니다.', ...(expose ? { detail: error.message } : {}) });
    }
});

// 카드 사용 처리
app.post('/card/use', async (req, res) => {
    try {
        const { token, store_code } = req.body;
        
        if (!token || !store_code) {
            return res.json({
                success: false,
                message: '필수 정보가 누락되었습니다.'
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }
        
        // 사용 기록 생성
        await dbHelpers.createUsage({
            token: token,
            store_name: store_code
        });
        
        res.json({
            success: true,
            message: '할인이 성공적으로 적용되었습니다.'
        });
        
    } catch (error) {
        console.error('카드 사용 처리 오류:', error);
        res.json({
            success: false,
            message: '카드 사용 처리 중 오류가 발생했습니다.'
        });
    }
});

// 관리자 대시보드
app.get('/admin/dashboard', requireAuth, async (req, res) => {
    try {
        const [users, agencies, stores, usages, banners] = await Promise.all([
            dbHelpers.getUsers(),
            dbHelpers.getAgencies(),
            dbHelpers.getStores(),
            dbHelpers.getUsages(),
            dbHelpers.getBanners()
        ]);
        
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: {
                total_agencies: agencies.length,
                total_users: users.length,
                total_usages: usages.length,
                total_stores: stores.length,
                active_banners: (banners || []).length
            },
            recentUsages: []
        });
    } catch (error) {
        console.error('관리자 대시보드 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: { 
                total_agencies: 0, 
                total_users: 0, 
                total_usages: 0, 
                total_stores: 0,
                active_banners: 0 
            },
            recentUsages: []
        });
    }
});


// 여행사 생성
app.post('/admin/agencies', requireAuth, async (req, res) => {
    try {
        // 프로덕션 진단 로그 (임시): 실제로 어떤 본문이 오는지 확인
        try {
            console.log('[POST /admin/agencies] content-type =', req.headers['content-type']);
            console.log('[POST /admin/agencies] raw body keys =', Object.keys(req.body || {}));
            console.log('[POST /admin/agencies] body preview =', {
                name: req.body?.name,
                code: req.body?.code,
                agency_code: req.body?.agency_code,
                show_banners_on_landing: req.body?.show_banners_on_landing
            });
        } catch (e) {
            console.warn('[POST /admin/agencies] log error:', e?.message);
        }

        const name = (req.body.name || '').trim();
        const code = (req.body.code || req.body.agency_code || '').trim();
        const discount_info = req.body.discount_info || '';
        const show_banners_on_landing = req.body.show_banners_on_landing;
        
        if (!name || !code) {
            return res.json({
                success: false,
                message: '여행사명과 코드는 필수입니다.'
            });
        }
        
        const agency = await dbHelpers.createAgency({
            name,
            code,
            discount_info,
            show_banners_on_landing: String(show_banners_on_landing) === 'true'
        });
        
        res.json({
            success: true,
            message: '파싱 완료',
            parsed_data: agency,
            parsing_method: 'createAgency'
        });
        
    } catch (error) {
        console.error('여행사 생성 오류:', error);
        // PostgreSQL unique 제약 위반 처리 (code 중복 등)
        if (error && (error.code === '23505' || /unique/i.test(String(error.message)))) {
            return res.json({ success: false, message: '이미 존재하는 코드입니다. 다른 코드를 사용하세요.' });
        }
        res.json({
            success: false,
            message: '여행사 추가 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 수정
app.put('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const name = (req.body.name || '').trim();
        const code = (req.body.code || req.body.agency_code || '').trim();
        const discount_info = req.body.discount_info || '';
        const show_banners_on_landing = req.body.show_banners_on_landing;
        const contact_email = (req.body.contact_email || '').trim();
        const contact_phone = (req.body.contact_phone || '').trim();
        const logo_url = (req.body.logo_url || '').trim();
        
        console.log('여행사 수정 요청:', {
            id,
            name,
            code,
            discount_info,
            show_banners_on_landing,
            contact_email,
            contact_phone,
            logo_url,
            body: req.body
        });
        
        const agency = await dbHelpers.updateAgency(id, {
            name,
            code,
            discount_info,
            show_banners_on_landing: String(show_banners_on_landing) === 'true',
            contact_email,
            contact_phone,
            logo_url
        });
        
        console.log('수정 결과:', agency);
        
        if (!agency) {
            return res.json({
                success: false,
                message: '여행사를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '여행사 정보가 성공적으로 수정되었습니다.',
            agency: agency
        });
        
    } catch (error) {
        console.error('여행사 수정 오류:', error);
        console.error('오류 상세:', error.message);
        console.error('오류 스택:', error.stack);
        res.json({
            success: false,
            message: `여행사 수정 중 오류가 발생했습니다: ${error.message}`
        });
    }
});

// 여행사 순위 조정
app.post('/admin/agencies/:id/move', requireAuth, async (req, res) => {
    try {
        const agencyId = Number(req.params.id);
        const { direction } = req.body; // 'up' 또는 'down'
        
        if (!Number.isFinite(agencyId) || !['up', 'down'].includes(direction)) {
            return res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
        }

        if (dbMode === 'postgresql') {
            // 현재 여행사의 sort_order 조회
            const currentResult = await pool.query('SELECT sort_order FROM agencies WHERE id = $1', [agencyId]);
            if (currentResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: '여행사를 찾을 수 없습니다.' });
            }
            
            const currentOrder = currentResult.rows[0].sort_order || 999;
            let targetOrder;
            
            if (direction === 'up') {
                // 위로 이동: 현재보다 작은 sort_order 중 가장 큰 값 찾기
                const targetResult = await pool.query(
                    'SELECT id, sort_order FROM agencies WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1',
                    [currentOrder]
                );
                if (targetResult.rows.length === 0) {
                    return res.json({ success: false, message: '이미 최상위입니다.' });
                }
                targetOrder = targetResult.rows[0].sort_order;
                const targetId = targetResult.rows[0].id;
                
                // 순서 교체
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [targetOrder, agencyId]);
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [currentOrder, targetId]);
                
            } else { // down
                // 아래로 이동: 현재보다 큰 sort_order 중 가장 작은 값 찾기
                const targetResult = await pool.query(
                    'SELECT id, sort_order FROM agencies WHERE sort_order > $1 ORDER BY sort_order ASC LIMIT 1',
                    [currentOrder]
                );
                if (targetResult.rows.length === 0) {
                    return res.json({ success: false, message: '이미 최하위입니다.' });
                }
                targetOrder = targetResult.rows[0].sort_order;
                const targetId = targetResult.rows[0].id;
                
                // 순서 교체
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [targetOrder, agencyId]);
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [currentOrder, targetId]);
            }
            
        } else {
            // JSON 모드 처리
            const agencies = await jsonDB.read('agencies') || [];
            const agencyIndex = agencies.findIndex(a => a.id === agencyId);
            
            if (agencyIndex === -1) {
                return res.status(404).json({ success: false, message: '여행사를 찾을 수 없습니다.' });
            }
            
            if (direction === 'up' && agencyIndex > 0) {
                // 위로 이동
                [agencies[agencyIndex], agencies[agencyIndex - 1]] = [agencies[agencyIndex - 1], agencies[agencyIndex]];
                await jsonDB.write('agencies', agencies);
            } else if (direction === 'down' && agencyIndex < agencies.length - 1) {
                // 아래로 이동
                [agencies[agencyIndex], agencies[agencyIndex + 1]] = [agencies[agencyIndex + 1], agencies[agencyIndex]];
                await jsonDB.write('agencies', agencies);
            } else {
                return res.json({ success: false, message: direction === 'up' ? '이미 최상위입니다.' : '이미 최하위입니다.' });
            }
        }
        
        res.json({ success: true, message: '순위가 변경되었습니다.' });
        
    } catch (error) {
        console.error('여행사 순위 조정 오류:', error);
        res.status(500).json({ success: false, message: '순위 조정 중 오류가 발생했습니다.' });
    }
});

// 사용자 관리 페이지
app.get('/admin/users', requireAuth, async (req, res) => {
    try {
        const users = await dbHelpers.getUsers();
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1; // 서버 페이징 미구현 상태의 기본값
        const search = req.query.search || '';
        const buildPageUrl = (p) => `/admin/users?page=${p}&search=${encodeURIComponent(search)}`;
        res.render('admin/users', {
            title: '사용자 관리',
            adminUsername: req.session.adminUsername || 'admin',
            search,
            totalUsers: Array.isArray(users) ? users.length : 0,
            currentPage,
            totalPages,
            buildPageUrl,
            users,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('사용자 관리 페이지 오류:', error);
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1;
        const search = req.query.search || '';
        const buildPageUrl = (p) => `/admin/users?page=${p}&search=${encodeURIComponent(search)}`;
        res.render('admin/users', {
            title: '사용자 관리',
            adminUsername: req.session.adminUsername || 'admin',
            search,
            totalUsers: 0,
            currentPage,
            totalPages,
            buildPageUrl,
            users: [],
            success: null,
            error: '사용자 목록을 불러오지 못했습니다.'
        });
    }
});

// 사용 이력 페이지
app.get('/admin/usages', requireAuth, async (req, res) => {
    try {
        const usages = await dbHelpers.getUsages();
        const storesData = await dbHelpers.getStores();
        const stores = Array.isArray(storesData)
            ? storesData.map(s => s.code || s.store_code || s.name).filter(Boolean)
            : [];
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1; // 서버 페이징 미구현 기본값
        const store_filter = req.query.store_filter || '';
        const date_from = req.query.date_from || '';
        const date_to = req.query.date_to || '';
        const sort_order = req.query.sort_order || 'desc';
        res.render('admin/usages', {
            title: '사용 이력',
            adminUsername: req.session.adminUsername || 'admin',
            usages,
            totalUsages: Array.isArray(usages) ? usages.length : 0,
            currentPage,
            totalPages,
            stores,
            store_filter,
            date_from,
            date_to,
            sort_order,
            formatDate,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('사용 이력 페이지 오류:', error);
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1;
        const store_filter = req.query.store_filter || '';
        const date_from = req.query.date_from || '';
        const date_to = req.query.date_to || '';
        const sort_order = req.query.sort_order || 'desc';
        res.render('admin/usages', {
            title: '사용 이력',
            adminUsername: req.session.adminUsername || 'admin',
            usages: [],
            totalUsages: 0,
            currentPage,
            totalPages,
            stores: [],
            store_filter,
            date_from,
            date_to,
            sort_order,
            formatDate,
            success: null,
            error: '사용 이력을 불러오지 못했습니다.'
        });
    }
});

// 제휴업체(스토어) 관리 페이지
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const stores = await dbHelpers.getStores();
        console.log('🔍 관리자 제휴업체 조회 결과:', stores.length, '개');
        console.log('📋 제휴업체 샘플 데이터:', stores.slice(0, 2));
        res.render('admin/stores', {
            title: '제휴업체 관리',
            adminUsername: req.session.adminUsername || 'admin',
            currentPage: 'stores',
            stores,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('제휴업체 관리 페이지 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            adminUsername: req.session.adminUsername || 'admin',
            currentPage: 'stores',
            stores: [],
            success: null,
            error: '제휴업체 목록을 불러오지 못했습니다.'
        });
    }
});


// 제휴 신청서 관리 페이지
app.get('/admin/partner-applications', requireAuth, async (req, res) => {
    try {
        let applications = [];
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM partner_applications ORDER BY created_at DESC');
            applications = result.rows;
        } else {
            applications = await jsonDB.findAll('partner_applications');
        }
        res.render('admin/partner-applications', {
            title: '제휴 신청서',
            adminUsername: req.session.adminUsername || 'admin',
            applications,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('제휴 신청서 페이지 오류:', error);
        res.render('admin/partner-applications', {
            title: '제휴 신청서',
            adminUsername: req.session.adminUsername || 'admin',
            applications: [],
            success: null,
            error: '신청서 목록을 불러오지 못했습니다.'
        });
    }
});

// 제휴 신청서 개별 삭제 라우트
app.delete('/admin/partner-applications/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query('DELETE FROM partner_applications WHERE id = $1 RETURNING *', [id]);
            if (result.rows.length === 0) {
                return res.json({
                    success: false,
                    message: '신청서를 찾을 수 없습니다.'
                });
            }
        } else {
            const deleted = await jsonDB.delete('partner_applications', id);
            if (!deleted) {
                return res.json({
                    success: false,
                    message: '신청서를 찾을 수 없습니다.'
                });
            }
        }
        
        res.json({
            success: true,
            message: '제휴 신청서가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('제휴 신청서 삭제 오류:', error);
        res.json({
            success: false,
            message: '제휴 신청서 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 제휴 신청서 전체 삭제 라우트
app.delete('/admin/partner-applications/clear-all', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            await pool.query('DELETE FROM partner_applications');
        } else {
            await jsonDB.deleteAll('partner_applications');
        }
        
        res.json({
            success: true,
            message: '모든 제휴 신청서가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('제휴 신청서 전체 삭제 오류:', error);
        res.json({
            success: false,
            message: '제휴 신청서 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 개별 조회 라우트 추가 (수정 모달용)
app.get('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const agency = await dbHelpers.getAgencyById(id);
        
        if (!agency) {
            return res.json({
                success: false,
                message: '여행사를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            agency: agency
        });
        
    } catch (error) {
        console.error('여행사 조회 오류:', error);
        res.json({
            success: false,
            message: '여행사 조회 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 삭제 라우트 추가
app.delete('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`여행사 삭제 요청: ID ${id}`);
        
        const result = await dbHelpers.deleteAgency(id);
        
        if (result.hasUsers) {
            return res.json({
                success: false,
                hasUsers: true,
                message: result.message
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                message: '여행사가 성공적으로 삭제되었습니다.'
            });
        } else {
            res.json({
                success: false,
                message: '여행사 삭제에 실패했습니다.'
            });
        }
        
    } catch (error) {
        console.error('여행사 삭제 오류:', error);
        res.json({
            success: false,
            message: '여행사 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 강제 삭제 라우트 추가
app.delete('/admin/agencies/:id/force', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`여행사 강제 삭제 요청: ID ${id}`);
        
        const result = await dbHelpers.forceDeleteAgency(id);
        
        if (result.success) {
            res.json({
                success: true,
                message: '여행사와 관련된 모든 데이터가 삭제되었습니다.'
            });
        } else {
            res.json({
                success: false,
                message: '여행사 강제 삭제에 실패했습니다.'
            });
        }
        
    } catch (error) {
        console.error('여행사 강제 삭제 오류:', error);
        res.json({
            success: false,
            message: '여행사 강제 삭제 중 오류가 발생했습니다.'
        });
    }
});




// 광고배너 개별 조회 라우트 추가 (수정 모달용)
app.get('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners WHERE id = $1', [id]);
            const banner = result.rows[0];
            
            if (!banner) {
                return res.json({
                    success: false,
                    message: '광고배너를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                banner: banner
            });
        } else {
            const banner = await jsonDB.findById('banners', id);
            if (!banner) {
                return res.json({
                    success: false,
                    message: '광고배너를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                banner: banner
            });
        }
        
    } catch (error) {
        console.error('광고배너 조회 오류:', error);
        res.json({
            success: false,
            message: '광고배너 조회 중 오류가 발생했습니다.'
        });
    }
});

// 광고배너 수정 라우트 추가
app.put('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const bannerData = req.body;
        
        const banner = await dbHelpers.updateBanner(id, bannerData);
        
        if (!banner) {
            return res.json({
                success: false,
                message: '광고배너를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '광고배너가 성공적으로 수정되었습니다.',
            banner: banner
        });
        
    } catch (error) {
        console.error('광고배너 수정 오류:', error);
        res.json({
            success: false,
            message: '광고배너 수정 중 오류가 발생했습니다.'
        });
    }
});

// 광고배너 삭제 라우트 추가
app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const banner = await dbHelpers.deleteBanner(id);
        
        if (!banner) {
            return res.json({
                success: false,
                message: '광고배너를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '광고배너가 성공적으로 삭제되었습니다.'
        });
        
    } catch (error) {
        console.error('광고배너 삭제 오류:', error);
        res.json({
            success: false,
            message: '광고배너 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 중복된 initializeDatabase 함수 제거됨 - 위의 올바른 마이그레이션 로직이 있는 함수 사용

// ==================== 예약 데이터 파싱 함수 ====================


// OpenAI API를 사용한 지능형 파싱 함수
async function parseReservationToJSON(text) {
    // OpenAI 파싱 사용
    const { parseBooking } = require('./utils/aiParser');
    
    try {
        console.log('🤖 OpenAI 파싱 시작...');
        const result = await parseBooking(text);
        console.log('✅ OpenAI 파싱 완료');
        return result;
    } catch (error) {
        console.error('❌ OpenAI 파싱 실패, 로컬 파싱으로 폴백:', error.message);
        return parseReservationToJSONLocal(text);
    }
}

// 기존 로컬 파싱 함수 (폴백용)
function parseReservationToJSONLocal(text) {
    console.log('🤖 AI 수준 파싱 시작...');
    
    // 더 지능적인 파싱을 위한 정규식 및 패턴 매칭
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = text.toLowerCase();
    
    // 기본 데이터 구조 (단일 테이블 구조에 맞게)
    const data = {
        reservation_number: null,
        channel: '웹',
        platform_name: 'NOL',
        product_name: null,
        korean_name: null,
        english_first_name: null,
        english_last_name: null,
        phone: null,
        email: null,
        kakao_id: null,
        usage_date: null,
        usage_time: null,
        guest_count: 1,
        people_adult: 1,
        people_child: 0,
        people_infant: 0,
        package_type: null,
        total_amount: null,
        adult_unit_price: null,
        child_unit_price: null,
        payment_status: '대기',
        code_issued: false,
        memo: null
    };
    
    // 플랫폼 자동 감지 (확장된 패턴)
    if (fullText.includes('nol') || fullText.includes('인터파크') || fullText.includes('interpark')) {
        data.platform_name = 'NOL';
    } else if (fullText.includes('klook') || fullText.includes('클룩')) {
        data.platform_name = 'KLOOK';
    } else if (fullText.includes('viator') || fullText.includes('비에이터')) {
        data.platform_name = 'VIATOR';
    } else if (fullText.includes('getyourguide') || fullText.includes('겟유어가이드')) {
        data.platform_name = 'GETYOURGUIDE';
    } else if (fullText.includes('expedia') || fullText.includes('익스피디아')) {
        data.platform_name = 'EXPEDIA';
    } else if (fullText.includes('agoda') || fullText.includes('아고다')) {
        data.platform_name = 'AGODA';
    } else if (fullText.includes('booking.com') || fullText.includes('부킹닷컴')) {
        data.platform_name = 'BOOKING';
    } else if (fullText.includes('트립어드바이저') || fullText.includes('tripadvisor')) {
        data.platform_name = 'TRIPADVISOR';
    }

    console.log(`🔍 감지된 플랫폼: ${data.platform_name}`);

    // NOL 인터파크 특화 패턴 매칭
    if (data.platform_name === 'NOL') {
        console.log('🎯 NOL 인터파크 특화 파싱 모드 활성화');

        // NOL 특화 예약번호 패턴 (강화)
        const nolReservationPatterns = [
            /예약번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /주문번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /확인번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /바우처번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /티켓번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /NOL[\s\-]?(\d{8,})/i,
            /([A-Z]{2}\d{8,})/,
            /IP[\-]?(\d{8,})/i,
            /(\d{10,})/
        ];

        for (const pattern of nolReservationPatterns) {
            const match = text.match(pattern);
            if (match && !data.reservation_number) {
                data.reservation_number = match[1];
                console.log(`✅ NOL 예약번호 발견: ${data.reservation_number}`);
                break;
            }
        }

        // NOL 특화 상품명 패턴 (강화)
        const nolProductPatterns = [
            /상품명[\s:：]*(.+?)(?:\n|$)/i,
            /투어명[\s:：]*(.+?)(?:\n|$)/i,
            /액티비티명[\s:：]*(.+?)(?:\n|$)/i,
            /체험명[\s:：]*(.+?)(?:\n|$)/i,
            /\[NOL\]\s*(.+?)(?:\n|$)/i,
            /\[인터파크\]\s*(.+?)(?:\n|$)/i,
            /괌\s*(.+?(?:투어|tour|체험|액티비티))/i,
            /사이판\s*(.+?(?:투어|tour|체험|액티비티))/i,
            /(.+?(?:투어|tour|티켓|ticket|입장권|체험|액티비티|패키지).+)/i
        ];

        for (const pattern of nolProductPatterns) {
            const match = text.match(pattern);
            if (match && !data.product_name) {
                data.product_name = match[1].trim();
                console.log(`✅ NOL 상품명 발견: ${data.product_name}`);
                break;
            }
        }

        // NOL 특화 시간 패턴 추가
        const nolTimePatterns = [
            /시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /출발시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /픽업시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /체크인시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /만날시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /(\d{1,2})[:\：](\d{2})\s*(?:AM|PM|am|pm)/i,
            /(\d{1,2})시\s*(\d{1,2})?분?/i
        ];

        for (const pattern of nolTimePatterns) {
            const match = text.match(pattern);
            if (match && !data.usage_time) {
                let hour = parseInt(match[1]);
                const minute = match[2] || '00';
                
                // AM/PM 처리
                if (match[0].toLowerCase().includes('pm') && hour !== 12) {
                    hour += 12;
                } else if (match[0].toLowerCase().includes('am') && hour === 12) {
                    hour = 0;
                }
                
                data.usage_time = `${hour.toString().padStart(2, '0')}:${minute.padStart(2, '0')}`;
                console.log(`✅ NOL 이용시간 발견: ${data.usage_time}`);
                break;
            }
        }

        // NOL 특화 카카오톡 ID 패턴
        const nolKakaoPatterns = [
            /카카오[\s:：]*([a-zA-Z0-9_-]+)/i,
            /카톡[\s:：]*([a-zA-Z0-9_-]+)/i,
            /kakao[\s:：]*([a-zA-Z0-9_-]+)/i,
            /카카오톡ID[\s:：]*([a-zA-Z0-9_-]+)/i
        ];

        for (const pattern of nolKakaoPatterns) {
            const match = text.match(pattern);
            if (match && !data.kakao_id) {
                data.kakao_id = match[1];
                console.log(`✅ NOL 카카오톡 ID 발견: ${data.kakao_id}`);
                break;
            }
        }

        // NOL 특화 날짜 패턴 (한국 형식)
        const nolDatePatterns = [
            /이용일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /방문일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /체크인[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /(\d{4})\-(\d{1,2})\-(\d{1,2})/,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/
        ];

        for (const pattern of nolDatePatterns) {
            const match = text.match(pattern);
            if (match && !data.usage_date) {
                let year, month, day;
                if (pattern.toString().includes('년')) {
                    [, year, month, day] = match;
                } else if (pattern.toString().includes('\\d{4}')) {
                    [, year, month, day] = match;
                } else {
                    [, month, day, year] = match;
                }

                if (year && month && day) {
                    data.usage_date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    console.log(`✅ NOL 이용일 발견: ${data.usage_date}`);
                }
                break;
            }
        }

        // NOL 특화 금액 패턴 (원화 → 달러 환산)
        const nolPricePatterns = [
            /총\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /결제\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /(\d{1,3}(?:,\d{3})*)\s*원/,
            /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
            /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*달러/
        ];

        for (const pattern of nolPricePatterns) {
            const match = text.match(pattern);
            if (match && !data.total_amount) {
                let price = parseFloat(match[1].replace(/,/g, ''));
                // 원화인 경우 달러로 환산 (1300원 = 1달러 기준)
                if (match[0].includes('원')) {
                    price = Math.round(price / 1300 * 100) / 100;
                    console.log(`💱 원화 → 달러 환산: ${match[1]}원 → $${price}`);
                }
                data.total_amount = price;
                break;
            }
        }

        // NOL 특화 인원수 패턴 (개선된 로직)
        const nolPeoplePatterns = [
            { pattern: /성인\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /어른\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /대인\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /소아\s*(\d+)\s*명/gi, type: 'child' },
            { pattern: /어린이\s*(\d+)\s*명/gi, type: 'child' },
            { pattern: /유아\s*(\d+)\s*명/gi, type: 'infant' },
            { pattern: /총\s*(\d+)\s*명/gi, type: 'total' }
        ];
        
        for (const { pattern, type } of nolPeoplePatterns) {
            const matches = [...text.matchAll(pattern)];
            for (const match of matches) {
                const count = parseInt(match[1]);
                if (type === 'adult') {
                    data.people_adult = count;
                    console.log(`👥 NOL 성인 인원수 발견: ${count}명`);
                } else if (type === 'child') {
                    data.people_child = count;
                    console.log(`👥 NOL 소아 인원수 발견: ${count}명`);
                } else if (type === 'infant') {
                    data.people_infant = count;
                    console.log(`👥 NOL 유아 인원수 발견: ${count}명`);
                } else if (type === 'total' && data.people_adult === 1 && data.people_child === 0) {
                    data.people_adult = count;
                    console.log(`👥 NOL 총 인원수 발견: ${count}명 (성인으로 설정)`);
                }
            }
        }
    }

    // 라인별 파싱 (일반 패턴)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const nextLine = i + 1 < lines.length ? lines[i + 1] : null;

        console.log(`📝 파싱 중: ${line}`);

        // 예약번호 (일반 패턴)
        if (!data.reservation_number) {
            const reservationPatterns = [
                /(?:예약번호|reservation|booking|order)[\s:：#]*([A-Z0-9\-]{6,})/i,
                /([A-Z]{2,}\d{6,})/,
                /(\d{10,})/,
                /([A-Z0-9]{8,})/
            ];

            for (const pattern of reservationPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.reservation_number = match[1];
                    break;
                }
            }
        }

        // 상품명 (일반 패턴)
        if (!data.product_name && (lowerLine.includes('상품') || lowerLine.includes('투어') || 
            lowerLine.includes('tour') || lowerLine.includes('activity') || lowerLine.includes('티켓'))) {
            const productPatterns = [
                /(?:상품명|투어명|상품|tour|activity)[\s:：]*(.+)/i,
                /(.+(?:투어|tour|티켓|ticket|입장권).+)/i
            ];

            for (const pattern of productPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.product_name = match[1].trim();
                    break;
                }
            }
        }

        // 한글 이름 (개선된 패턴)
        if (!data.korean_name) {
            // 명시적 한글명 패턴 - 콜론 뒤의 이름 추출
            if (lowerLine.includes('한글') || lowerLine.includes('이름') || lowerLine.includes('성명')) {
                const namePatterns = [
                    /(?:한글명|이름|성명)[\s:：]+([가-힣]{2,})/,
                    /한글[\s:：]+([가-힣]{2,})/
                ];
                
                for (const pattern of namePatterns) {
                    const match = line.match(pattern);
                    if (match && match[1] !== '한글명' && match[1] !== '이름' && match[1] !== '성명') {
                        data.korean_name = match[1];
                        console.log(`✅ 한글 이름 발견: ${data.korean_name}`);
                        break;
                    }
                }
            }
            // 단독 한글 이름 패턴 (라인에 한글 이름만 있는 경우)
            else {
                const koreanNameMatch = line.match(/^([가-힣]{2,4})$/);
                if (koreanNameMatch) {
                    data.korean_name = koreanNameMatch[1];
                    console.log(`✅ 단독 한글 이름 발견: ${data.korean_name}`);
                }
            }
        }

        // 영문 이름
        if ((!data.english_first_name || !data.english_last_name) && 
            (lowerLine.includes('영문') || lowerLine.includes('english'))) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1) {
                const englishName = parts[1].trim();
                const nameParts = englishName.split(/\s+/);
                if (nameParts.length >= 2) {
                    data.english_first_name = nameParts[0];
                    data.english_last_name = nameParts.slice(1).join(' ');
                }
            }
        }

        // 이메일
        if (!data.email) {
            const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
                data.email = emailMatch[1];
            }
        }

        // 전화번호 (개선된 패턴)
        if (!data.phone) {
            // 명시적 전화번호 패턴
            if (lowerLine.includes('전화') || lowerLine.includes('phone') || lowerLine.includes('mobile')) {
                const phonePatterns = [
                    /(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})/,
                    /(010[-\s]?\d{4}[-\s]?\d{4})/,
                    /(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        break;
                    }
                }
            }
            // 단독 전화번호 패턴 (라인에 전화번호만 있는 경우)
            else {
                const phonePatterns = [
                    /^(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})$/,
                    /^(010[-\s]?\d{4}[-\s]?\d{4})$/,
                    /^(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})$/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        console.log(`✅ 단독 전화번호 발견: ${data.phone}`);
                        break;
                    }
                }
            }
        }

        // 카카오톡 아이디 (개선된 패턴)
        if (!data.kakao_id && lowerLine.includes('카카오톡 아이디')) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1 && parts[1].trim().length > 0) {
                data.kakao_id = parts[1].trim();
            } else if (nextLine && nextLine.trim().length > 0 && !nextLine.includes(':')) {
                data.kakao_id = nextLine.trim();
            }
        }
    }
    
    // 데이터 후처리 및 검증
    console.log('🔍 파싱된 데이터 검증 중...');
    
    // 필수 데이터 검증 및 기본값 설정
    if (!data.reservation_number) {
        console.log('⚠️ 예약번호가 없습니다. 임시 번호를 생성합니다.');
        data.reservation_number = 'TEMP_' + Date.now();
    }
    
    if (!data.korean_name) {
        console.log('⚠️ 한글 이름이 없습니다.');
    }
    
    if (!data.english_first_name || !data.english_last_name) {
        console.log('⚠️ 영문 이름이 불완전합니다.');
    }
    
    if (!data.product_name) {
        console.log('⚠️ 상품명이 없습니다.');
        data.product_name = '상품명 미확인';
    }
    
    if (!data.usage_date) {
        console.log('⚠️ 이용일이 없습니다.');
    }
    
    if (!data.total_amount) {
        console.log('⚠️ 총 금액이 없습니다.');
    }
    
    // 전화번호 정리
    if (data.phone) {
        data.phone = data.phone.replace(/[^\d\+\-]/g, '');
    }
    
    // 총 인원수 계산
    data.guest_count = data.people_adult + data.people_child + data.people_infant;
    
    // 단가 계산 (총 금액을 성인 수로 나눔)
    if (data.total_amount && data.people_adult > 0) {
        data.adult_unit_price = Math.round(data.total_amount / data.people_adult);
    }
    
    // 파싱 품질 점수 계산
    let qualityScore = 0;
    const scoreWeights = {
        reservation_number: 25,
        korean_name: 20,
        product_name: 15,
        usage_date: 15,
        phone: 10,
        email: 10,
        total_amount: 5
    };
    
    for (const [field, weight] of Object.entries(scoreWeights)) {
        if (data[field]) qualityScore += weight;
    }
    
    data.parsing_quality = qualityScore;
    data.parsing_confidence = qualityScore >= 70 ? 'high' : qualityScore >= 40 ? 'medium' : 'low';
    
    console.log('🎯 파싱 완료:', {
        reservation_number: data.reservation_number,
        platform_name: data.platform_name,
        product_name: data.product_name,
        korean_name: data.korean_name,
        english_name: `${data.english_first_name || ''} ${data.english_last_name || ''}`.trim(),
        guest_count: data.guest_count,
        usage_date: data.usage_date,
        usage_time: data.usage_time,
        total_amount: data.total_amount,
        parsing_quality: `${qualityScore}% (${data.parsing_confidence})`,
        kakao_id: data.kakao_id
    });
    
    return data;
}

// ==================== 6개 테이블 CRUD 함수 ====================

// 6개 테이블에 예약 데이터 저장
async function saveReservationToSixTables(parsedData) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. reservations 테이블에 기본 정보 저장
        const reservationResult = await client.query(`
            INSERT INTO reservations (
                reservation_code, reservation_channel, platform_name, 
                reservation_status, product_name, total_quantity, total_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING reservation_id
        `, [
            parsedData.reservation_code,
            parsedData.reservation_channel || '웹',
            parsedData.platform_name || 'OTHER',
            '접수',
            parsedData.product_name,
            parsedData.total_quantity || 1,
            parsedData.total_price
        ]);
        
        const reservationId = reservationResult.rows[0].reservation_id;
        
        // 일정 정보는 이미 reservations 테이블에 저장됨 (usage_date, usage_time, package_type)
        
        // 3. reservation_customers 테이블에 고객 정보 저장
        await client.query(`
            INSERT INTO reservation_customers (
                reservation_id, name_kr, name_en_first, name_en_last, 
                phone, email, kakao_id, people_adult, people_child, people_infant, memo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            reservationId,
            parsedData.name_kr,
            parsedData.name_en_first,
            parsedData.name_en_last,
            parsedData.phone,
            parsedData.email,
            parsedData.kakao_id,
            parsedData.people_adult || 0,
            parsedData.people_child || 0,
            parsedData.people_infant || 0,
            parsedData.memo
        ]);
        
        // 4. reservation_payments 테이블에 결제 정보 저장
        await client.query(`
            INSERT INTO reservation_payments (
                reservation_id, adult_unit_price, child_unit_price, infant_unit_price,
                adult_count, child_count, infant_count, platform_sale_amount, 
                platform_settlement_amount, payment_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            reservationId,
            parsedData.adult_unit_price || 0,
            parsedData.child_unit_price || 0,
            parsedData.infant_unit_price || 0,
            parsedData.people_adult || 0,
            parsedData.people_child || 0,
            parsedData.people_infant || 0,
            parsedData.platform_sale_amount || parsedData.total_price,
            parsedData.platform_settlement_amount || parsedData.total_price,
            '대기'
        ]);
        
        // 5. cancellation_policies 테이블에 취소 정책 저장
        if (parsedData.policy_text) {
            await client.query(`
                INSERT INTO cancellation_policies (reservation_id, policy_text)
                VALUES ($1, $2)
            `, [reservationId, parsedData.policy_text]);
        }
        
        // 6. reservation_logs 테이블에 생성 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'CREATE',
            'AI_PARSING',
            null,
            JSON.stringify(parsedData)
        ]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            reservation_id: reservationId,
            message: '예약이 성공적으로 저장되었습니다.'
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('6개 테이블 저장 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 예약 상세 조회 (단일 reservations 테이블)
async function getReservationById(reservationId) {
    try {
        const result = await pool.query(`
            SELECT * FROM reservations WHERE id = $1
        `, [reservationId]);
        
        return result.rows[0] || null;
    } catch (error) {
        console.error('예약 조회 오류:', error);
        throw error;
    }
}

// 예약 수정 (6개 테이블 업데이트)
async function updateReservationInSixTables(reservationId, updateData) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 기존 데이터 조회 (로그용)
        const oldData = await getReservationById(reservationId);
        
        // 1. reservations 테이블 업데이트
        await client.query(`
            UPDATE reservations SET
                reservation_code = $2,
                platform_name = $3,
                product_name = $4,
                total_price = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.reservation_code,
            updateData.platform_name,
            updateData.product_name,
            updateData.total_price
        ]);
        
        // 일정 정보는 이미 reservations 테이블에서 업데이트됨
        
        // 3. reservation_customers 테이블 업데이트
        await client.query(`
            UPDATE reservation_customers SET
                name_kr = $2,
                name_en_first = $3,
                name_en_last = $4,
                phone = $5,
                email = $6,
                people_adult = $7,
                people_child = $8,
                people_infant = $9,
                memo = $10
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.name_kr,
            updateData.name_en_first,
            updateData.name_en_last,
            updateData.phone,
            updateData.email,
            updateData.people_adult || 0,
            updateData.people_child || 0,
            updateData.people_infant || 0,
            updateData.memo
        ]);
        
        // 4. reservation_payments 테이블 업데이트
        await client.query(`
            UPDATE reservation_payments SET
                platform_sale_amount = $2,
                platform_settlement_amount = $3
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.total_price,
            updateData.total_price
        ]);
        
        // 5. reservation_logs 테이블에 수정 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'UPDATE',
            'ADMIN',
            JSON.stringify(oldData),
            JSON.stringify(updateData)
        ]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            message: '예약이 성공적으로 수정되었습니다.'
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('예약 수정 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 예약 삭제 (6개 테이블에서 삭제)
async function deleteReservationFromSixTables(reservationId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 기존 데이터 조회 (로그용)
        const oldData = await getReservationById(reservationId);
        
        // reservation_logs에 삭제 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'DELETE',
            'ADMIN',
            JSON.stringify(oldData),
            null
        ]);
        
        // CASCADE 옵션으로 인해 reservations 테이블만 삭제하면 연관 테이블도 자동 삭제됨
        const result = await client.query(`
            DELETE FROM reservations WHERE reservation_id = $1
        `, [reservationId]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            message: '예약이 성공적으로 삭제되었습니다.',
            deleted_count: result.rowCount
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('예약 삭제 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 기존 파싱 함수 (백업용)
function parseReservationTextAdvanced(text) {
    const parsedData = parseReservationText(text);
    
    // 영문명을 first_name과 last_name으로 분리
    const englishNameParts = (parsedData.english_name || '').split(' ');
    const englishFirstName = englishNameParts[0] || '';
    const englishLastName = englishNameParts.slice(1).join(' ') || '';
    
    // JSON 스키마 형태로 변환 (새로운 6개 테이블 구조)
    const jsonSchema = {
        action: "INSERT", // INSERT, UPDATE, DELETE
        
        // 1. reservations (예약 기본)
        reservation: {
            reservation_code: parsedData.reservation_number || null,
            reservation_channel: parsedData.booking_channel || "웹",
            platform_name: parsedData.company || "기타",
            reservation_status: "접수",
            reservation_datetime: parsedData.reservation_datetime || null,
            product_name: parsedData.product_name || null,
            total_quantity: parsedData.guest_count || 1,
            total_price: parsedData.amount || null
        },
        
        // 2. reservation_schedules (이용 일정)
        schedule: {
            usage_date: parsedData.usage_date || null,
            usage_time: parsedData.usage_time || null,
            package_type: parsedData.package_type || "기본",
            package_count: parsedData.guest_count || 1
        },
        
        // 3. reservation_customers (예약자 및 고객 정보)
        customer: {
            name_kr: parsedData.korean_name || null,
            name_en_first: englishFirstName || null,
            name_en_last: englishLastName || null,
            phone: parsedData.phone || null,
            email: parsedData.email || null,
            kakao_id: parsedData.kakao_id || null,
            people_adult: parsedData.adult_count || parsedData.guest_count || 1,
            people_child: parsedData.child_count || 0,
            people_infant: parsedData.infant_count || 0,
            memo: parsedData.memo || null
        },
        
        // 4. reservation_payments (결제 내역)
        payment: {
            adult_unit_price: parsedData.adult_unit_price || null,
            child_unit_price: parsedData.child_unit_price || null,
            infant_unit_price: parsedData.infant_unit_price || null,
            adult_count: parsedData.adult_count || parsedData.guest_count || 1,
            child_count: parsedData.child_count || 0,
            infant_count: parsedData.infant_count || 0,
            platform_sale_amount: parsedData.amount || null,
            platform_settlement_amount: parsedData.settlement_amount || parsedData.amount || null,
            payment_status: "대기",
            payment_date: null
        },
        
        // 5. cancellation_policies (취소/환불 규정)
        cancellation_policy: {
            policy_text: parsedData.cancellation_policy || null
        },
        
        // 6. reservation_logs (예약 변경 이력)
        log: {
            action: "등록",
            changed_by: "관리자",
            old_data: null,
            new_data: parsedData
        },
        
        // 메타 정보
        metadata: {
            created_at: new Date().toISOString(),
            parsed_fields: Object.keys(parsedData).filter(key => parsedData[key] !== null && parsedData[key] !== undefined),
            total_parsed_fields: Object.keys(parsedData).filter(key => parsedData[key] !== null && parsedData[key] !== undefined).length
        }
    };
    
    return jsonSchema;
}

// AI 수준의 지능형 예약 데이터 파싱 함수 (기존 함수 유지)

function parseReservationText(text) {
    const data = {};
    
    // 텍스트 정규화 및 전처리
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = lines.join(' ');
    
    console.log('파싱 시작 - 입력 텍스트:', text.substring(0, 200) + '...');
    
    // 업체 구분 자동 감지 (더 정확한 패턴)
    const upperText = text.toUpperCase();
    if (upperText.includes('NOL') || upperText.includes('엔오엘') || upperText.includes('N.O.L')) {
        data.company = 'NOL';
    } else if (upperText.includes('KLOOK') || upperText.includes('클룩')) {
        data.company = 'KLOOK';
    } else if (upperText.includes('VIATOR') || upperText.includes('비아토르')) {
        data.company = 'VIATOR';
    } else if (upperText.includes('GETYOURGUIDE') || upperText.includes('겟유어가이드')) {
        data.company = 'GETYOURGUIDE';
    } else if (upperText.includes('EXPEDIA') || upperText.includes('익스피디아')) {
        data.company = 'EXPEDIA';
    } else {
        data.company = 'NOL'; // 기본값
    }
    
    // AI 수준의 지능형 파싱
    
    // 1. 예약번호 - 다양한 패턴 지원
    const reservationPatterns = [
        /(?:예약번호|reservation|booking|ref|reference)[\s:：]*([A-Z0-9]{4,20})/i,
        /([A-Z]{2,4}\d{4,10})/g,
        /(\d{8,12})/g,
        /([A-Z0-9]{6,15})/g
    ];
    
    for (const pattern of reservationPatterns) {
        const matches = fullText.match(pattern);
        if (matches) {
            if (pattern.source.includes('예약번호|reservation')) {
                data.reservation_number = matches[1];
                break;
            } else {
                // 가장 긴 매치를 선택
                const candidates = [...fullText.matchAll(pattern)];
                if (candidates.length > 0) {
                    data.reservation_number = candidates.sort((a, b) => b[0].length - a[0].length)[0][0];
                    break;
                }
            }
        }
    }
    
    // 2. 확인번호
    const confirmationPatterns = [
        /(?:확인번호|confirmation|confirm)[\s:：]*([A-Z0-9]{4,20})/i,
        /(?:conf|cnf)[\s:：]*([A-Z0-9]{4,20})/i
    ];
    
    for (const pattern of confirmationPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.confirmation_number = match[1];
            break;
        }
    }
    
    // 3. 이메일 - 더 정확한 패턴
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const emailMatches = [...fullText.matchAll(emailPattern)];
    if (emailMatches.length > 0) {
        data.email = emailMatches[0][1];
    }
    
    // 4. 한글명 - 다양한 패턴 지원
    const koreanNamePatterns = [
        /(?:예약자|이름|성명|name)[\s:：]*([가-힣]{2,10})/i,
        /(?:한글|korean)[\s:：]*([가-힣]{2,10})/i,
        /([가-힣]{2,4})\s*님/,
        /고객명[\s:：]*([가-힣]{2,10})/i
    ];
    
    for (const pattern of koreanNamePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.korean_name = match[1];
            break;
        }
    }
    
    // 5. 영문명
    const englishNamePatterns = [
        /(?:영문|english)[\s:：]*([A-Za-z\s]{2,30})/i,
        /(?:first|last|full)\s*name[\s:：]*([A-Za-z\s]{2,30})/i,
        /([A-Z][a-z]+\s+[A-Z][a-z]+)/g
    ];
    
    for (const pattern of englishNamePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.english_name = match[1].trim();
            break;
        }
    }
    
    // 6. 전화번호 - 국제번호 포함
    const phonePatterns = [
        /(?:전화|phone|tel|mobile)[\s:：]*([+]?[\d\s\-\(\)]{8,20})/i,
        /([+]?82[\s\-]?1[0-9][\s\-]?\d{3,4}[\s\-]?\d{4})/,
        /([+]?1[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{4})/,
        /(01[0-9][\s\-]?\d{3,4}[\s\-]?\d{4})/
    ];
    
    for (const pattern of phonePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.phone = match[1].replace(/\s+/g, '').replace(/\-+/g, '-');
            break;
        }
    }
    
    // 7. 상품명 - 더 유연한 패턴
    const productPatterns = [
        /(?:상품명|product|tour|activity)[\s:：]*([^\n\r]{5,100})/i,
        /(?:투어|tour|액티비티|activity)[\s:：]*([^\n\r]{5,100})/i
    ];
    
    for (const pattern of productPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.product_name = match[1].trim();
            break;
        }
    }
    
    // 8. 날짜 - 다양한 형식 지원
    const datePatterns = [
        /(?:날짜|date|이용일)[\s:：]*(\d{4}[-\/년]\d{1,2}[-\/월]\d{1,2}일?)/i,
        /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/g,
        /(\d{1,2}\/\d{1,2}\/\d{4})/g,
        /(\d{4}\.\d{1,2}\.\d{1,2})/g
    ];
    
    for (const pattern of datePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            let dateStr = match[1];
            // 한글 날짜 형식 정규화
            dateStr = dateStr.replace(/년/g, '-').replace(/월/g, '-').replace(/일/g, '');
            data.usage_date = dateStr;
            break;
        }
    }
    
    // 9. 시간
    const timePatterns = [
        /(?:시간|time)[\s:：]*(\d{1,2}:\d{2})/i,
        /(\d{1,2}:\d{2}(?:\s*[AP]M)?)/gi
    ];
    
    for (const pattern of timePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.usage_time = match[1];
            break;
        }
    }
    
    // 10. 금액 - 다양한 통화 지원
    const amountPatterns = [
        /(?:금액|amount|price|cost|total)[\s:：]*[$₩]?([\d,]+\.?\d*)/i,
        /[$₩]([\d,]+\.?\d*)/g,
        /([\d,]+)\s*원/g,
        /([\d,]+)\s*달러/g
    ];
    
    for (const pattern of amountPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            const amount = match[1].replace(/,/g, '');
            data.amount = parseFloat(amount);
            break;
        }
    }
    
    // 11. 인원수
    const guestPatterns = [
        /(?:인원|guest|pax|person)[\s:：]*(\d+)/i,
        /(\d+)\s*명/g,
        /(\d+)\s*인/g
    ];
    
    for (const pattern of guestPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.guest_count = parseInt(match[1]);
            break;
        }
    }
    
    // 12. 카카오톡 ID
    const kakaoPatterns = [
        /(?:카카오|kakao|카톡)[\s:：]*([a-zA-Z0-9_-]{2,20})/i,
        /(?:id|아이디)[\s:：]*([a-zA-Z0-9_-]{2,20})/i
    ];
    
    for (const pattern of kakaoPatterns) {
        const match = fullText.match(pattern);
        if (match && !match[1].includes('@')) { // 이메일이 아닌 경우만
            data.kakao_id = match[1];
            break;
        }
    }
    
    // 13. 예약 채널
    const channelPatterns = [
        /(?:채널|channel|platform)[\s:：]*([^\n\r]{2,50})/i,
        /(?:through|via)[\s:：]*([^\n\r]{2,50})/i
    ];
    
    for (const pattern of channelPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.booking_channel = match[1].trim();
            break;
        }
    }
    
    // 14. 패키지 타입
    const packagePatterns = [
        /(?:패키지|package|type)[\s:：]*([^\n\r]{2,50})/i,
        /(?:옵션|option)[\s:：]*([^\n\r]{2,50})/i
    ];
    
    for (const pattern of packagePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.package_type = match[1].trim();
            break;
        }
    }
    
    // 15. 메모/특이사항
    const memoPatterns = [
        /(?:메모|note|remark|특이사항)[\s:：]*([^\n\r]{2,200})/i,
        /(?:요청사항|request)[\s:：]*([^\n\r]{2,200})/i
    ];
    
    for (const pattern of memoPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.memo = match[1].trim();
            break;
        }
    }
    
    // 데이터 후처리 및 검증
    if (data.korean_name) {
        data.korean_name = data.korean_name.replace(/님$/, '').trim();
    }
    
    if (data.english_name) {
        data.english_name = data.english_name.replace(/\s+/g, ' ').trim();
    }
    
    if (data.phone) {
        data.phone = data.phone.replace(/[^\d\+\-]/g, '');
    }
    
    console.log('파싱 결과:', data);
    
    return data;
}

// ==================== 예약 관리 API ====================

// 임시 디버깅 엔드포인트 - 발급코드 데이터 직접 확인
app.get('/admin/debug-codes', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM issue_codes ORDER BY created_at DESC LIMIT 20');
            res.json({
                success: true,
                count: result.rows.length,
                codes: result.rows
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드가 아님' });
        }
    } catch (error) {
        res.json({ success: false, error: error.message, stack: error.stack });
    }
});

// 발급 코드 관리 페이지
app.get('/admin/issue-codes', requireAuth, async (req, res) => {
    try {
        console.log('🎫 발급 코드 관리 페이지 접근 시도');
        
        if (dbMode === 'postgresql') {
            // issue_codes 테이블 존재 확인
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'issue_codes'
            `);
            
            if (tableCheck.rows.length === 0) {
                console.log('⚠️ issue_codes 테이블이 존재하지 않음');
                return res.render('admin/issue-codes', {
                    title: '발급 코드 관리',
                    adminUsername: req.session.adminUsername || 'admin',
                    stats: { total_codes: 0, delivered: 0, pending: 0 },
                    codes: []
                });
            }
            
            // 통계 쿼리
            let stats = { total_codes: 0, delivered: 0, pending: 0 };
            try {
                const statsQuery = await pool.query(`
                    SELECT 
                        COUNT(*) as total_codes,
                        COUNT(CASE WHEN is_delivered = true THEN 1 END) as delivered,
                        COUNT(CASE WHEN is_delivered = false OR is_delivered IS NULL THEN 1 END) as pending
                    FROM issue_codes
                `);
                stats = statsQuery.rows[0];
                console.log('📊 발급 코드 통계:', stats);
            } catch (statsError) {
                console.error('⚠️ 발급 코드 통계 쿼리 오류:', statsError.message);
            }
            
            // 발급 코드 목록 쿼리
            let codes = [];
            try {
                const codesQuery = await pool.query(`
                    SELECT 
                        id,
                        code,
                        COALESCE(is_delivered, false) as is_delivered,
                        delivered_at,
                        COALESCE(is_used, false) as is_used,
                        used_at,
                        notes,
                        created_at
                    FROM issue_codes 
                    ORDER BY created_at DESC 
                    LIMIT 100
                `);
                codes = codesQuery.rows;
                console.log('🎫 발급 코드 목록 쿼리 성공, 개수:', codes.length);
                console.log('🔍 첫 번째 코드 데이터:', codes[0]);
            } catch (listError) {
                console.error('⚠️ 발급 코드 목록 쿼리 오류:', listError.message);
            }
            
            console.log('📊 템플릿으로 전달되는 데이터:');
            console.log('- stats:', stats);
            console.log('- codes 개수:', codes.length);
            console.log('- adminUsername:', req.session.adminUsername || 'admin');
            
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                codes: codes
            });
        } else {
            console.log('📁 JSON 모드로 실행 중');
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_codes: 0, delivered: 0, pending: 0 },
                codes: []
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 관리 페이지 로드 오류:', error);
        res.status(500).json({ 
            error: true,
            message: '발급 코드 관리 페이지를 불러올 수 없습니다: ' + error.message,
            stack: error.stack
        });
    }
});

// 발급 코드 생성 API
app.post('/admin/issue-codes/generate', requireAuth, async (req, res) => {
    try {
        const { count = 1, notes = '' } = req.body;
        
        if (count < 1 || count > 100) {
            return res.status(400).json({
                success: false,
                message: '코드 개수는 1개에서 100개 사이여야 합니다.'
            });
        }
        
        if (dbMode === 'postgresql') {
            // issue_codes 테이블 존재 확인 및 생성
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'issue_codes'
            `);
            
            if (tableCheck.rows.length === 0) {
                // issue_codes 테이블 생성
                await pool.query(`
                    CREATE TABLE issue_codes (
                        id SERIAL PRIMARY KEY,
                        code VARCHAR(20) UNIQUE NOT NULL,
                        user_name VARCHAR(100),
                        user_phone VARCHAR(20),
                        user_email VARCHAR(100),
                        qr_code_url TEXT,
                        is_used BOOLEAN DEFAULT FALSE,
                        used_at TIMESTAMP,
                        is_delivered BOOLEAN DEFAULT FALSE,
                        delivered_at TIMESTAMP,
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ issue_codes 테이블 생성 완료');
            }
            
            const generatedCodes = [];
            
            for (let i = 0; i < count; i++) {
                // 고유한 코드 생성 (a1234b 형태)
                let code;
                let isUnique = false;
                let attempts = 0;
                
                while (!isUnique && attempts < 10) {
                    const letters = 'abcdefghijklmnopqrstuvwxyz';
                    const numbers = '0123456789';
                    
                    const firstLetter = letters[Math.floor(Math.random() * letters.length)];
                    const lastLetter = letters[Math.floor(Math.random() * letters.length)];
                    const middleNumbers = Array.from({length: 4}, () => 
                        numbers[Math.floor(Math.random() * numbers.length)]
                    ).join('');
                    
                    code = firstLetter + middleNumbers + lastLetter;
                    
                    // 중복 확인
                    const duplicateCheck = await pool.query(
                        'SELECT id FROM issue_codes WHERE code = $1',
                        [code]
                    );
                    
                    if (duplicateCheck.rows.length === 0) {
                        isUnique = true;
                    }
                    attempts++;
                }
                
                if (!isUnique) {
                    return res.status(500).json({
                        success: false,
                        message: '고유한 코드 생성에 실패했습니다. 다시 시도해주세요.'
                    });
                }
                
                // 코드 저장
                const result = await pool.query(
                    'INSERT INTO issue_codes (code, notes) VALUES ($1, $2) RETURNING *',
                    [code, notes]
                );
                
                generatedCodes.push(result.rows[0].code);
            }
            
            console.log(`✅ ${count}개의 발급 코드 생성 완료:`, generatedCodes);
            
            res.json({
                success: true,
                message: `${count}개의 코드가 생성되었습니다.`,
                codes: generatedCodes
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 발급 코드 수정 API
app.put('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query(
                'UPDATE issue_codes SET notes = $1 WHERE id = $2 RETURNING *',
                [notes, id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '코드를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                message: '코드가 수정되었습니다.',
                code: result.rows[0]
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 발급 코드 삭제 API
app.delete('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query(
                'DELETE FROM issue_codes WHERE id = $1 RETURNING *',
                [id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '코드를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                message: '코드가 삭제되었습니다.'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 삭제 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 인박스 페이지 (파싱·검수·등록 통합)
app.get('/admin/inbox', requireAuth, async (req, res) => {
    try {
        console.log('📥 인박스 페이지 접근');
        
        // 여행사 목록 조회
        const agencies = await dbHelpers.getAgencies().catch(() => []);
        
        res.render('admin/inbox', {
            title: '인박스',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: agencies
        });
        
    } catch (error) {
        console.error('❌ 인박스 페이지 오류:', error);
        res.status(500).render('admin/inbox', {
            title: '인박스',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
            error: '페이지 로드 중 오류가 발생했습니다.'
        });
    }
});

// 예약 관리 페이지 (검수형 백엔드 통합)
app.get('/admin/reservations', requireAuth, async (req, res) => {
    try {
        console.log('📋 예약 관리 페이지 접근 시도');
        console.log('🔍 dbMode:', dbMode);
        
        // 페이징 파라미터
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        
        if (dbMode === 'postgresql') {
            // 테이블 존재 확인 (reservations와 reservation_drafts 모두)
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('reservations', 'reservation_drafts')
            `);
            
            const existingTables = tableCheck.rows.map(row => row.table_name);
            console.log('📊 존재하는 테이블:', existingTables);
            
            if (existingTables.length === 0) {
                console.log('⚠️ 예약 관련 테이블이 존재하지 않음');
                return res.render('admin/reservations', {
                    title: '예약 관리',
                    adminUsername: req.session.adminUsername || 'admin',
                    stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 },
                    reservations: [],
                    drafts: [],
                    pagination: { page: 1, totalPages: 1, hasNext: false, hasPrev: false }
                });
            }
            
            // 통계 쿼리 (reservations + drafts)
            let stats = { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 };
            try {
                // 예약 통계
                if (existingTables.includes('reservations')) {
                    const reservationStats = await pool.query(`
                        SELECT 
                            COUNT(*) as total_reservations,
                            COUNT(CASE WHEN code_issued = true THEN 1 END) as code_issued,
                            COUNT(CASE WHEN code_issued = false OR code_issued IS NULL THEN 1 END) as pending_codes,
                            COUNT(DISTINCT COALESCE(platform_name, 'NOL')) as companies
                        FROM reservations
                        WHERE payment_status != 'cancelled'
                    `);
                    stats = { ...stats, ...reservationStats.rows[0] };
                }
                
                // 드래프트 통계
                if (existingTables.includes('reservation_drafts')) {
                    const draftStats = await pool.query(`
                        SELECT 
                            COUNT(CASE WHEN status = 'pending' THEN 1 END) as drafts_pending,
                            COUNT(CASE WHEN status = 'ready' THEN 1 END) as drafts_ready
                        FROM reservation_drafts
                        WHERE status IN ('pending', 'ready')
                    `);
                    stats = { ...stats, ...draftStats.rows[0] };
                }
                
                console.log('📊 통계 쿼리 성공:', stats);
            } catch (statsError) {
                console.error('⚠️ 통계 쿼리 오류:', statsError.message);
            }
            
            // 예약 목록 쿼리 (검색 및 필터링 포함)
            let reservations = [];
            let totalCount = 0;
            try {
                if (existingTables.includes('reservations')) {
                    let whereClause = "WHERE 1=1";
                    let queryParams = [];
                    let paramIndex = 1;
                    
                    // 검색 조건
                    if (search) {
                        whereClause += ` AND (
                            reservation_number ILIKE $${paramIndex} OR 
                            korean_name ILIKE $${paramIndex} OR 
                            product_name ILIKE $${paramIndex} OR
                            email ILIKE $${paramIndex}
                        )`;
                        queryParams.push(`%${search}%`);
                        paramIndex++;
                    }
                    
                    // 상태 필터
                    if (status === 'issued') {
                        whereClause += ` AND code_issued = true`;
                    } else if (status === 'pending') {
                        whereClause += ` AND (code_issued = false OR code_issued IS NULL)`;
                    }
                    
                    // 총 개수 조회
                    const countQuery = `SELECT COUNT(*) as total FROM reservations ${whereClause}`;
                    const countResult = await pool.query(countQuery, queryParams);
                    totalCount = parseInt(countResult.rows[0].total);
                    
                    // 예약 목록 조회 (실제 테이블 구조에 맞춤)
                    const reservationsQuery = await pool.query(`
                        SELECT 
                            id,
                            reservation_number,
                            platform_name,
                            product_name,
                            korean_name,
                            usage_date,
                            total_amount as total_price,
                            code_issued,
                            email,
                            created_at,
                            updated_at
                        FROM reservations 
                        ${whereClause}
                        ORDER BY created_at DESC 
                        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
                    `, [...queryParams, limit, offset]);
                    
                    reservations = reservationsQuery.rows;
                    console.log('📋 예약 목록 쿼리 성공, 개수:', reservations.length);
                }
            } catch (listError) {
                console.error('⚠️ 예약 목록 쿼리 오류:', listError.message);
            }
            
            // 드래프트 목록 조회 (탭별 처리)
            let drafts = [];
            let draft_pagination = null;
            const activeTab = req.query.tab || 'reservations';
            
            if (activeTab === 'drafts') {
                // 드래프트 탭이 활성화된 경우 전체 드래프트 목록 조회
                const draft_page = parseInt(req.query.page) || 1;
                const draft_search = req.query.draft_search || '';
                const draft_status = req.query.draft_status || '';
                
                try {
                    if (existingTables.includes('reservation_drafts')) {
                        let draftWhereClause = 'WHERE 1=1';
                        let draftQueryParams = [];
                        let draftParamIndex = 1;
                        
                        // 드래프트 상태 필터
                        if (draft_status) {
                            draftWhereClause += ` AND status = $${draftParamIndex}`;
                            draftQueryParams.push(draft_status);
                            draftParamIndex++;
                        }
                        
                        // 드래프트 검색 조건
                        if (draft_search) {
                            draftWhereClause += ` AND (
                                raw_text ILIKE $${draftParamIndex} OR 
                                extracted_notes ILIKE $${draftParamIndex} OR
                                (normalized_json->>'reservation_number') ILIKE $${draftParamIndex} OR
                                (normalized_json->>'korean_name') ILIKE $${draftParamIndex}
                            )`;
                            draftQueryParams.push(`%${draft_search}%`);
                            draftParamIndex++;
                        }
                        
                        // 드래프트 총 개수 조회
                        const draftCountQuery = `SELECT COUNT(*) as total FROM reservation_drafts ${draftWhereClause}`;
                        const draftCountResult = await pool.query(draftCountQuery, draftQueryParams);
                        const draftTotalCount = parseInt(draftCountResult.rows[0].total);
                        
                        // 드래프트 목록 조회
                        const draftsQuery = await pool.query(`
                            SELECT 
                                draft_id as id,
                                raw_text,
                                parsed_json,
                                normalized_json,
                                manual_json,
                                confidence,
                                extracted_notes,
                                status,
                                created_at,
                                updated_at,
                                reviewed_by,
                                reviewed_at,
                                committed_reservation_id
                            FROM reservation_drafts 
                            ${draftWhereClause}
                            ORDER BY created_at DESC 
                            LIMIT $${draftParamIndex} OFFSET $${draftParamIndex + 1}
                        `, [...draftQueryParams, limit, (draft_page - 1) * limit]);
                        
                        drafts = draftsQuery.rows.map(draft => {
                            try {
                                // JSON 필드 파싱
                                if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                                    draft.parsed_json = JSON.parse(draft.parsed_json);
                                }
                                if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                                    draft.normalized_json = JSON.parse(draft.normalized_json);
                                }
                                if (draft.manual_json && typeof draft.manual_json === 'string') {
                                    draft.manual_json = JSON.parse(draft.manual_json);
                                }
                                
                                // 최종 데이터 (manual_json > normalized_json > parsed_json 순서)
                                const finalData = draft.manual_json || draft.normalized_json || draft.parsed_json || {};
                                
                                // UI에서 사용할 수 있도록 필드명 매핑
                                draft.reservation_code = finalData.reservation_number || finalData.reservation_code;
                                draft.platform_name = finalData.platform;
                                draft.product_name = finalData.product_name;
                                draft.total_price = finalData.total_price;
                                draft.name_kr = finalData.korean_name;
                                draft.name_en_first = finalData.english_first_name;
                                draft.name_en_last = finalData.english_last_name;
                                draft.email = finalData.email;
                                draft.phone = finalData.phone;
                                
                            } catch (parseError) {
                                console.warn('드래프트 JSON 파싱 오류:', parseError);
                            }
                            return draft;
                        });
                        
                        // 드래프트 페이징 정보
                        const draftTotalPages = Math.ceil(draftTotalCount / limit);
                        draft_pagination = {
                            page: draft_page,
                            totalPages: draftTotalPages,
                            hasNext: draft_page < draftTotalPages,
                            hasPrev: draft_page > 1,
                            totalCount: draftTotalCount
                        };
                        
                        console.log('📋 드래프트 목록 쿼리 성공, 개수:', drafts.length);
                    }
                } catch (draftError) {
                    console.error('⚠️ 드래프트 목록 쿼리 오류:', draftError.message);
                }
            } else {
                // 예약 탭이 활성화된 경우 최근 드래프트 몇 개만 표시
                try {
                    if (existingTables.includes('reservation_drafts')) {
                        const recentDraftsQuery = await pool.query(`
                            SELECT 
                                draft_id as id,
                                status,
                                confidence,
                                created_at,
                                CASE 
                                    WHEN manual_json IS NOT NULL THEN manual_json
                                    WHEN normalized_json IS NOT NULL THEN normalized_json
                                    ELSE parsed_json
                                END as display_data
                            FROM reservation_drafts 
                            WHERE status IN ('pending', 'ready')
                            ORDER BY created_at DESC 
                            LIMIT 5
                        `);
                        drafts = recentDraftsQuery.rows.map(draft => {
                            try {
                                draft.display_data = typeof draft.display_data === 'string' ? 
                                    JSON.parse(draft.display_data) : draft.display_data;
                            } catch (e) {
                                draft.display_data = {};
                            }
                            return draft;
                        });
                    }
                } catch (draftError) {
                    console.error('⚠️ 최근 드래프트 쿼리 오류:', draftError.message);
                }
            }
            
            // 페이징 정보
            const totalPages = Math.ceil(totalCount / limit);
            const pagination = {
                page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                totalCount
            };
            
            // 여행사 목록 조회
            const agencies = await dbHelpers.getAgencies().catch(() => []);
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                reservations: reservations,
                drafts: drafts,
                pagination: pagination,
                draft_pagination: draft_pagination,
                search: search,
                status: status,
                draft_search: req.query.draft_search || '',
                draft_status: req.query.draft_status || '',
                activeTab: activeTab,
                agencies: agencies
            });
        } else {
            console.log('📁 JSON 모드로 실행 중');
            // 여행사 목록 조회
            const agencies = await dbHelpers.getAgencies().catch(() => []);
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 },
                reservations: [],
                drafts: [],
                pagination: { page: 1, totalPages: 1, hasNext: false, hasPrev: false },
                agencies: agencies
            });
        }
    } catch (error) {
        console.error('❌ 예약 관리 페이지 로드 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        res.status(500).json({ 
            error: true,
            message: '예약 관리 페이지를 불러올 수 없습니다: ' + error.message,
            stack: error.stack
        });
    }
});

// 새로운 JSON 스키마 기반 예약 데이터 변환 API
app.post('/admin/reservations/convert-json', requireAuth, async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || !reservationText.trim()) {
            return res.json({ 
                success: false, 
                message: '예약 데이터를 입력해주세요.' 
            });
        }
        
        // JSON 스키마로 변환
        const jsonData = await parseReservationToJSON(reservationText);
        
        // JSON만 반환 (요청사항에 따라)
        res.json(jsonData);
        
    } catch (error) {
        console.error('JSON 변환 오류:', error);
        res.status(500).json({
            success: false,
            message: 'JSON 변환 중 오류가 발생했습니다.'
        });
    }
});

// 공개 예약 등록 API (텍스트 파싱)
app.post('/api/register-reservation', async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || reservationText.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: '예약 텍스트가 필요합니다.'
            });
        }
        
        console.log('🎯 공개 API 예약 파싱 요청 받음');
        console.log('입력 텍스트 길이:', reservationText.length);
        console.log('현재 시간:', new Date().toISOString());
        
        // AI 수준 파싱 실행
        const parsedData = parseReservationToJSON(reservationText);
        console.log('📊 파싱 완료:', parsedData);
        console.log('🔍 한글 이름 확인:', parsedData.korean_name);
        console.log('🔍 영문 이름 확인:', parsedData.english_first_name, parsedData.english_last_name);
        
        // 데이터베이스에 저장
        if (dbMode === 'postgresql') {
            const insertQuery = `
                INSERT INTO reservations (
                    reservation_number, channel, platform_name, product_name,
                    korean_name, english_first_name, english_last_name,
                    phone, email, kakao_id,
                    usage_date, usage_time, guest_count,
                    people_adult, people_child, people_infant,
                    package_type, total_amount, adult_unit_price, child_unit_price,
                    payment_status, code_issued, memo
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23
                ) RETURNING *
            `;
            
            let values = [
                parsedData.reservation_number,
                parsedData.channel || '웹',
                parsedData.platform_name || 'NOL',
                parsedData.product_name,
                parsedData.korean_name,
                parsedData.english_first_name,
                parsedData.english_last_name,
                parsedData.phone,
                parsedData.email,
                parsedData.kakao_id,
                parsedData.usage_date,
                parsedData.usage_time,
                parsedData.guest_count || 1,
                parsedData.people_adult || 1,
                parsedData.people_child || 0,
                parsedData.people_infant || 0,
                parsedData.package_type,
                parsedData.total_amount,
                parsedData.adult_unit_price,
                parsedData.child_unit_price,
                parsedData.payment_status || '대기',
                parsedData.code_issued || false,
                parsedData.memo
            ];
            
            try {
                const result = await pool.query(insertQuery, values);
                const reservationId = result.rows[0].id;
                
                // 자동 수배서 생성 시도
                console.log('🔄 자동 수배서 생성 시도:', {
                    reservationId,
                    productName: parsedData.product_name
                });
                
                const autoAssignment = await createAutoAssignment(reservationId, parsedData.product_name);
                
                res.json({
                    success: true,
                    message: '예약이 성공적으로 등록되었습니다.',
                    reservation_id: reservationId,
                    parsed_data: parsedData,
                    auto_assignment: autoAssignment ? {
                        created: true,
                        vendor: autoAssignment.vendor_name,
                        assignment_id: autoAssignment.assignment_id
                    } : {
                        created: false,
                        reason: '매칭되는 수배업체가 없습니다'
                    }
                });
            } catch (dbError) {
                if (dbError.code === '23505' && dbError.constraint === 'reservations_reservation_number_key') {
                    // 예약번호 중복 시 새로운 번호로 재시도
                    console.log('⚠️ 예약번호 중복 감지, 새 번호로 재시도...');
                    parsedData.reservation_number = `RETRY_${Date.now()}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                    values[0] = parsedData.reservation_number;
                    
                    const retryResult = await pool.query(insertQuery, values);
                    const reservationId = retryResult.rows[0].id;
                    
                    // 자동 수배서 생성 시도 (재시도 케이스)
                    console.log('🔄 자동 수배서 생성 시도 (재시도):', {
                        reservationId,
                        productName: parsedData.product_name
                    });
                    
                    const autoAssignment = await createAutoAssignment(reservationId, parsedData.product_name);
                    
                    res.json({
                        success: true,
                        message: '예약이 성공적으로 등록되었습니다. (예약번호 자동 변경)',
                        reservation_id: reservationId,
                        parsed_data: parsedData,
                        auto_assignment: autoAssignment ? {
                            created: true,
                            vendor: autoAssignment.vendor_name,
                            assignment_id: autoAssignment.assignment_id
                        } : {
                            created: false,
                            reason: '매칭되는 수배업체가 없습니다'
                        }
                    });
                } else {
                    throw dbError;
                }
            }
        }
        
    } catch (error) {
        console.error('❌ 공개 API 예약 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 등록 중 오류가 발생했습니다: ' + error.message,
            error: error.stack
        });
    }
});

// 예약 등록 (텍스트 파싱) - 관리자용
app.post('/admin/reservations/parse', requireAuth, async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || !reservationText.trim()) {
            return res.json({ success: false, message: '예약 데이터를 입력해주세요.' });
        }
        
        console.log('📝 파싱 요청 받음 (여행사 선택 없음)');
        
        // OpenAI 지능형 텍스트 파싱 (검수형 워크플로우)
        console.log('🤖 OpenAI 파싱 시작...');
        let parsedData;
        let parsingMethod = 'OpenAI';
        let confidence = 0.8;
        let extractedNotes = '';
        
        try {
            const aiResult = await parseBooking(reservationText);
            parsedData = aiResult;
            confidence = aiResult.confidence || 0.8;
            extractedNotes = aiResult.extracted_notes || '';
            console.log('✅ OpenAI 파싱 성공');
        } catch (error) {
            console.error('❌ OpenAI 파싱 실패:', error.message);
            // OpenAI 실패 시 로컬 파싱으로 폴백
            console.log('🔄 로컬 파싱으로 폴백...');
            parsedData = parseReservationToJSONLocal(reservationText);
            parsingMethod = '로컬';
            confidence = 0.5;
            extractedNotes = '로컬 파싱으로 처리됨 - 수동 검수 필요';
        }
        
        // 정규화 처리
        const normalizedData = normalizeReservationData(parsedData);
        
        console.log('✅ 파싱 완료 (여행사 정보는 파싱 결과에서 추출)');
        
        // 파싱 결과만 반환 (저장은 별도 단계)
        res.json({
            success: true,
            message: '파싱이 완료되었습니다.',
            parsed_data: normalizedData,
            parsing_method: parsingMethod,
            confidence: confidence,
            extracted_notes: extractedNotes,
            workflow: 'parsing_only'
        });
        
    } catch (error) {
        console.error('예약 파싱 및 저장 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 처리 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약 직접 저장 API
app.post('/admin/reservations/save', requireAuth, async (req, res) => {
    try {
        const { parsedData } = req.body;
        
        if (!parsedData) {
            return res.json({ success: false, message: '예약 데이터가 없습니다.' });
        }
        
        // 정규화 처리
        const normalizedData = normalizeReservationData(parsedData);
        
        // 예약번호 중복 체크 및 자동 생성
        if (normalizedData.reservation_number) {
            const checkQuery = 'SELECT id FROM reservations WHERE reservation_number = $1';
            const existingReservation = await pool.query(checkQuery, [normalizedData.reservation_number]);
            
            if (existingReservation.rows.length > 0) {
                // 중복된 예약번호가 있으면 새로운 번호 생성
                const timestamp = Date.now();
                const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                normalizedData.reservation_number = `${normalizedData.reservation_number}_${random}`;
                console.log('🔄 중복 예약번호 감지, 새 번호 생성:', normalizedData.reservation_number);
            }
        }
        
        // 예약 테이블에 직접 저장
        if (dbMode === 'postgresql') {
            try {
                const insertQuery = `
                    INSERT INTO reservations (
                        reservation_number, confirmation_number, channel, platform_name,
                        product_name, package_type, total_amount, quantity, guest_count,
                        korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                        people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                        usage_date, usage_time, reservation_datetime, payment_status,
                        memo, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
                    ) RETURNING id
                `;
                
                const values = [
                    normalizedData.reservation_number || null,
                    normalizedData.confirmation_number || null,
                    normalizedData.channel || '웹',
                    normalizedData.platform_name || 'NOL',
                    normalizedData.product_name || null,
                    normalizedData.package_type || null,
                    normalizedData.total_amount || null,
                    normalizedData.quantity || null,
                    normalizedData.guest_count || null,
                    normalizedData.korean_name || null,
                    normalizedData.english_first_name || null,
                    normalizedData.english_last_name || null,
                    normalizedData.email || null,
                    normalizedData.phone || null,
                    normalizedData.kakao_id || null,
                    normalizedData.people_adult || null,
                    normalizedData.people_child || null,
                    normalizedData.people_infant || null,
                    normalizedData.adult_unit_price || null,
                    normalizedData.child_unit_price || null,
                    normalizedData.usage_date || null,
                    normalizedData.usage_time || null,
                    normalizedData.reservation_datetime || null,
                    normalizedData.payment_status || 'pending', // 기본값을 대기중으로 변경
                    normalizedData.memo || null
                ];
                
                const result = await pool.query(insertQuery, values);
                const reservationId = result.rows[0].id;
                
                console.log(`✅ 예약 저장 성공 (ID: ${reservationId})`);
                
                // 자동 수배서 생성 시도 (관리자 저장)
                console.log('🔄 자동 수배서 생성 시도 (관리자):', {
                    reservationId,
                    productName: normalizedData.product_name
                });
                
                const autoAssignment = await createAutoAssignment(reservationId, normalizedData.product_name);
                
                res.json({
                    success: true,
                    message: '예약이 성공적으로 저장되었습니다.',
                    reservation_id: reservationId,
                    auto_assignment: autoAssignment ? {
                        created: true,
                        vendor: autoAssignment.vendor_name,
                        assignment_id: autoAssignment.assignment_id
                    } : {
                        created: false,
                        reason: '매칭되는 수배업체가 없습니다'
                    },
                    workflow: 'reservation_saved'
                });
                
            } catch (dbError) {
                console.error('예약 저장 오류:', dbError);
                res.json({
                    success: false,
                    message: '예약 저장 중 오류가 발생했습니다: ' + dbError.message
                });
            }
        } else {
            res.json({
                success: false,
                message: 'PostgreSQL 모드가 아닙니다.'
            });
        }
        
    } catch (error) {
        console.error('예약 저장 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 처리 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약 생성 API (인박스에서 사용)
app.post('/api/reservations', requireAuth, async (req, res) => {
    try {
        const reservationData = req.body;
        
        if (dbMode === 'postgresql') {
            // 예약번호 중복 체크 및 자동 생성
            if (reservationData.reservation_number) {
                const checkQuery = 'SELECT id FROM reservations WHERE reservation_number = $1';
                const existingReservation = await pool.query(checkQuery, [reservationData.reservation_number]);
                
                if (existingReservation.rows.length > 0) {
                    // 중복된 예약번호가 있으면 새로운 번호 생성
                    const timestamp = Date.now();
                    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                    reservationData.reservation_number = `${reservationData.reservation_number}_${random}`;
                    console.log('🔄 중복 예약번호 감지, 새 번호 생성:', reservationData.reservation_number);
                }
            } else {
                // 예약번호가 없으면 자동 생성
                const timestamp = Date.now();
                const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                reservationData.reservation_number = `AUTO_${timestamp}_${random}`;
            }

            const insertQuery = `
                INSERT INTO reservations (
                    reservation_number, confirmation_number, channel, platform_name,
                    product_name, package_type, total_amount, quantity, guest_count,
                    korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                    people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                    usage_date, usage_time, reservation_datetime, payment_status,
                    memo, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
                ) RETURNING id, reservation_number
            `;
            
            const values = [
                reservationData.reservation_number,
                reservationData.confirmation_number || null,
                reservationData.channel || 'inbox',
                reservationData.platform_name || null,
                reservationData.product_name || null,
                reservationData.package_type || null,
                reservationData.total_amount || null,
                reservationData.quantity || null,
                reservationData.guest_count || null,
                reservationData.korean_name || null,
                reservationData.english_first_name || null,
                reservationData.english_last_name || null,
                reservationData.email || null,
                reservationData.phone || null,
                reservationData.kakao_id || null,
                reservationData.people_adult || null,
                reservationData.people_child || null,
                reservationData.people_infant || null,
                reservationData.adult_unit_price || null,
                reservationData.child_unit_price || null,
                reservationData.usage_date || null,
                reservationData.usage_time || null,
                reservationData.reservation_datetime || null,
                reservationData.payment_status || 'pending', // 인박스에서 설정한 상태 유지, 기본값은 대기중
                reservationData.memo || null
            ];

            const result = await pool.query(insertQuery, values);
            const newReservation = result.rows[0];
            
            // 자동 수배 생성 체크 (바로 확정 상품인 경우)
            let autoAssignmentResult = null;
            if (reservationData.product_name && isAutoConfirmProduct(reservationData.product_name)) {
                console.log('🎯 바로 확정 상품 감지:', reservationData.product_name);
                
                // 예약 상태를 확정으로 업데이트
                await pool.query(
                    'UPDATE reservations SET payment_status = $1 WHERE id = $2',
                    ['confirmed', newReservation.id]
                );
                
                // 자동 수배서 생성
                autoAssignmentResult = await createAutoAssignment(newReservation.id, reservationData.product_name);
            }
            
            const response = {
                success: true,
                message: '예약이 성공적으로 저장되었습니다.',
                reservation: {
                    id: newReservation.id,
                    reservation_number: newReservation.reservation_number
                }
            };
            
            // 자동 수배 결과 추가
            if (autoAssignmentResult) {
                response.auto_assignment = {
                    created: true,
                    vendor: autoAssignmentResult.vendor.vendor_name,
                    assignment_link: autoAssignmentResult.assignment_link,
                    message: `자동으로 ${autoAssignmentResult.vendor.vendor_name}에 수배서가 생성되었습니다.`
                };
                console.log('✅ 자동 수배 완료:', autoAssignmentResult.vendor.vendor_name);
            }
            
            res.json(response);
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }
        
    } catch (error) {
        console.error('예약 저장 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '예약 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 직접 예약 데이터 입력 API
app.post('/api/reservations/direct', requireAuth, async (req, res) => {
    try {
        const reservationData = req.body;
        
        // 필수 필드 검증
        const requiredFields = ['reservation_code', 'product_name', 'name_kr'];
        const missingFields = requiredFields.filter(field => !reservationData[field]);
        
        if (missingFields.length > 0) {
            return res.json({
                success: false,
                message: `필수 필드가 누락되었습니다: ${missingFields.join(', ')}`
            });
        }
        
        // 6개 테이블에 데이터 저장
        const result = await saveReservationToSixTables(reservationData);
        
        res.json({
            success: true,
            message: result.message,
            reservation_id: result.reservation_id
        });
        
    } catch (error) {
        console.error('직접 예약 입력 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 드래프트 목록 조회 API
app.get('/api/drafts', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || '';
        const search = req.query.search || '';

        let whereClause = 'WHERE 1=1';
        let queryParams = [];
        let paramIndex = 1;

        // 상태 필터
        if (status) {
            whereClause += ` AND status = $${paramIndex}`;
            queryParams.push(status);
            paramIndex++;
        }

        // 검색 조건
        if (search) {
            whereClause += ` AND (
                raw_text ILIKE $${paramIndex} OR 
                extracted_notes ILIKE $${paramIndex} OR
                (normalized_json->>'reservation_number') ILIKE $${paramIndex} OR
                (normalized_json->>'korean_name') ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        // 총 개수 조회
        const countQuery = `SELECT COUNT(*) as total FROM reservation_drafts ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);

        // 드래프트 목록 조회
        const draftsQuery = await pool.query(`
            SELECT 
                draft_id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status,
                created_at,
                updated_at,
                reviewed_by,
                reviewed_at,
                committed_reservation_id
            FROM reservation_drafts 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...queryParams, limit, offset]);

        const drafts = draftsQuery.rows.map(draft => {
            // JSON 필드 파싱
            try {
                if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                    draft.parsed_json = JSON.parse(draft.parsed_json);
                }
                if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                    draft.normalized_json = JSON.parse(draft.normalized_json);
                }
                if (draft.manual_json && typeof draft.manual_json === 'string') {
                    draft.manual_json = JSON.parse(draft.manual_json);
                }
            } catch (parseError) {
                console.warn('JSON 파싱 오류:', parseError);
            }
            return draft;
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
            success: true,
            drafts: drafts,
            pagination: {
                page: page,
                totalPages: totalPages,
                totalCount: totalCount,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('드래프트 목록 조회 오류:', error);
        res.json({
            success: false,
            message: '드래프트 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 드래프트 상세 조회 API
app.get('/api/drafts/:id', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const draftId = req.params.id;
        
        const query = `
            SELECT 
                draft_id as id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status,
                created_at,
                updated_at,
                reviewed_by,
                reviewed_at,
                committed_reservation_id
            FROM reservation_drafts 
            WHERE draft_id = $1
        `;
        
        const result = await pool.query(query, [draftId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '드래프트를 찾을 수 없습니다.'
            });
        }
        
        const draft = result.rows[0];
        
        // JSON 필드 파싱 및 정규화된 데이터 추출
        try {
            if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                draft.parsed_json = JSON.parse(draft.parsed_json);
            }
            if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                draft.normalized_json = JSON.parse(draft.normalized_json);
            }
            if (draft.manual_json && typeof draft.manual_json === 'string') {
                draft.manual_json = JSON.parse(draft.manual_json);
            }
            
            // 최종 데이터 (manual_json > normalized_json > parsed_json 순서)
            const finalData = draft.manual_json || draft.normalized_json || draft.parsed_json || {};
            
            // UI에서 사용할 수 있도록 필드명 매핑
            draft.reservation_code = finalData.reservation_number || finalData.reservation_code;
            draft.platform_name = finalData.platform;
            draft.product_name = finalData.product_name;
            draft.total_price = finalData.total_price;
            draft.name_kr = finalData.korean_name;
            draft.name_en_first = finalData.english_first_name;
            draft.name_en_last = finalData.english_last_name;
            draft.email = finalData.email;
            draft.phone = finalData.phone;
            draft.usage_date = finalData.usage_date;
            draft.usage_time = finalData.usage_time;
            draft.people_adult = finalData.adult_count;
            draft.people_child = finalData.child_count;
            draft.people_infant = finalData.infant_count;
            
        } catch (parseError) {
            console.warn('JSON 파싱 오류:', parseError);
        }
        
        res.json({
            success: true,
            draft: draft
        });
        
    } catch (error) {
        console.error('드래프트 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 드래프트 승인 API (최종 예약으로 등록)
app.post('/api/drafts/:id/approve', requireAuth, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        await client.query('BEGIN');
        
        const draftId = req.params.id;
        
        // 드래프트 조회
        const draftQuery = `
            SELECT 
                draft_id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status
            FROM reservation_drafts 
            WHERE draft_id = $1 AND status = 'pending'
        `;
        const draftResult = await client.query(draftQuery, [draftId]);
        
        if (draftResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: '승인 가능한 드래프트를 찾을 수 없습니다.'
            });
        }
        
        const draft = draftResult.rows[0];
        
        // JSON 데이터 파싱
        let finalData = {};
        try {
            const parsedJson = typeof draft.parsed_json === 'string' ? JSON.parse(draft.parsed_json) : draft.parsed_json;
            const normalizedJson = typeof draft.normalized_json === 'string' ? JSON.parse(draft.normalized_json) : draft.normalized_json;
            const manualJson = typeof draft.manual_json === 'string' ? JSON.parse(draft.manual_json) : draft.manual_json;
            
            finalData = manualJson || normalizedJson || parsedJson || {};
        } catch (parseError) {
            console.warn('JSON 파싱 오류:', parseError);
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: '드래프트 데이터 파싱 중 오류가 발생했습니다.'
            });
        }
        
        // 예약번호 중복 확인
        const reservationCode = finalData.reservation_number || finalData.reservation_code;
        if (reservationCode) {
            const duplicateQuery = 'SELECT id FROM reservations WHERE reservation_code = $1';
            const duplicateResult = await client.query(duplicateQuery, [reservationCode]);
            
            if (duplicateResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: '이미 존재하는 예약번호입니다. 드래프트를 수정해주세요.'
                });
            }
        }
        
        // 최종 예약으로 등록
        const insertQuery = `
            INSERT INTO reservations (
                reservation_code, platform_name, product_name, total_price,
                name_kr, name_en_first, name_en_last, email, phone,
                usage_date, usage_time, people_adult, people_child, people_infant,
                memo, payment_status, card_status, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
                COALESCE($16, 'pending'), 'pending', NOW(), NOW()
            ) RETURNING id
        `;
        
        const insertResult = await client.query(insertQuery, [
            reservationCode,
            finalData.platform,
            finalData.product_name,
            finalData.total_price,
            finalData.korean_name,
            finalData.english_first_name,
            finalData.english_last_name,
            finalData.email,
            finalData.phone,
            finalData.usage_date,
            finalData.usage_time,
            finalData.adult_count,
            finalData.child_count,
            finalData.infant_count,
            finalData.memo,
            finalData.payment_status
        ]);
        
        // 드래프트 상태를 'reviewed'로 업데이트
        const updateQuery = `
            UPDATE reservation_drafts 
            SET status = 'reviewed', 
                reviewed_at = NOW(),
                reviewed_by = 'admin',
                committed_reservation_id = $1
            WHERE draft_id = $2
        `;
        await client.query(updateQuery, [insertResult.rows[0].id, draftId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '드래프트가 승인되어 예약으로 등록되었습니다.',
            reservation_id: insertResult.rows[0].id
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('드래프트 승인 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 승인 중 오류가 발생했습니다.'
        });
    } finally {
        client.release();
    }
});

// 드래프트 반려 API
app.post('/api/drafts/:id/reject', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const draftId = req.params.id;
        const { reason } = req.body;
        
        if (!reason || reason.trim() === '') {
            return res.status(400).json({
                success: false,
                message: '반려 사유를 입력해주세요.'
            });
        }
        
        // 드래프트 상태를 'rejected'로 업데이트
        const updateQuery = `
            UPDATE reservation_drafts 
            SET status = 'rejected', 
                extracted_notes = COALESCE(extracted_notes, '') || E'\n[반려 사유] ' || $1,
                reviewed_at = NOW(),
                reviewed_by = 'admin'
            WHERE draft_id = $2 AND status = 'pending'
            RETURNING draft_id
        `;
        
        const result = await pool.query(updateQuery, [reason, draftId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '반려 가능한 드래프트를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '드래프트가 반려되었습니다.'
        });
        
    } catch (error) {
        console.error('드래프트 반려 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 반려 중 오류가 발생했습니다.'
        });
    }
});

// 예약 삭제 API
app.delete('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'DELETE FROM reservations WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '예약이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('❌ 예약 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 예약 코드 생성 API
app.post('/api/reservations/:id/generate-code', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [id]
        );
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // 이미 코드가 발급된 경우
        if (reservation.code_issued) {
            return res.status(400).json({
                success: false,
                message: '이미 코드가 발급된 예약입니다.'
            });
        }
        
        // 세이브카드 코드 생성 (간단한 형태로 구현)
        const saveCardCode = `SC${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        
        // 예약 상태 업데이트
        const updateResult = await pool.query(
            'UPDATE reservations SET code_issued = true, code_issued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
            [id]
        );
        
        res.json({
            success: true,
            message: '세이브카드 코드가 생성되었습니다.',
            data: {
                saveCardCode: saveCardCode
            }
        });
    } catch (error) {
        console.error('❌ 코드 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 생성 중 오류가 발생했습니다.'
        });
    }
});

// 예약 상세 조회 API
app.get('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const reservation = await getReservationById(reservationId);
        
        if (!reservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            data: reservation
        });
        
    } catch (error) {
        console.error('예약 조회 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약 수정 API (구버전 - 6개 테이블 사용, 사용 안함)
/*
app.put('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const updateData = req.body;
        
        // 예약 존재 확인
        const existingReservation = await getReservationById(reservationId);
        if (!existingReservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 6개 테이블 업데이트
        const result = await updateReservationInSixTables(reservationId, updateData);
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('예약 수정 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 수정 중 오류가 발생했습니다: ' + error.message 
        });
    }
});
*/

// 예약 삭제 API
app.delete('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        // 예약 존재 확인
        const existingReservation = await getReservationById(reservationId);
        if (!existingReservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 6개 테이블에서 삭제
        const result = await deleteReservationFromSixTables(reservationId);
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('예약 삭제 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 삭제 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 코드 생성 API
app.post('/api/reservations/:id/generate-code', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        // 예약 존재 확인
        const reservation = await getReservationById(reservationId);
        if (!reservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 결제 상태를 '완료'로 업데이트
        await pool.query(`
            UPDATE reservation_payments 
            SET payment_status = '완료', payment_date = CURRENT_TIMESTAMP
            WHERE reservation_id = $1
        `, [reservationId]);
        
        res.json({
            success: true,
            message: '코드가 성공적으로 발급되었습니다.'
        });
        
    } catch (error) {
        console.error('코드 생성 오류:', error);
        res.json({ 
            success: false, 
            message: '코드 생성 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// ==================== ERP API 라우트 ====================

// API 상태 확인 엔드포인트 (공개)
app.get('/api/status', async (req, res) => {
    try {
        // 데이터베이스 연결 테스트
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
        // 테이블 존재 확인
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('reservations', 'field_defs', 'reservation_audits', 'assignments', 'settlements')
            ORDER BY table_name
        `);
        
        // 마이그레이션 상태 확인
        const migrationStatus = await pool.query(`
            SELECT version, description, executed_at 
            FROM migration_log 
            ORDER BY executed_at DESC 
            LIMIT 5
        `).catch(() => ({ rows: [] }));
        
        res.json({
            success: true,
            timestamp: dbTest.rows[0].current_time,
            tables: tables.rows.map(r => r.table_name),
            migrations: migrationStatus.rows,
            message: 'API 서버가 정상 작동 중입니다.'
        });
        
    } catch (error) {
        console.error('API 상태 확인 오류:', error);
        res.status(500).json({
            success: false,
            message: 'API 서버 오류: ' + error.message
        });
    }
});

// 예약 목록 API (새로운 /bookings용)
app.get('/api/bookings', requireAuth, async (req, res) => {
    try {
        console.log('📋 /api/bookings 요청 받음:', req.query);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        
        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'reservations'
        `);
        
        if (tableCheck.rows.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'reservations 테이블이 존재하지 않습니다.'
            });
        }
        
        // extras 컬럼 존재 확인
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'reservations' AND column_name = 'extras'
        `);
        
        const hasExtras = columnCheck.rows.length > 0;
        console.log('📊 extras 컬럼 존재:', hasExtras);
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        if (search) {
            paramCount++;
            whereClause += ` AND (customer_name ILIKE $${paramCount} OR customer_email ILIKE $${paramCount} OR customer_phone ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        if (status) {
            paramCount++;
            whereClause += ` AND status = $${paramCount}`;
            params.push(status);
        }
        
        const extrasSelect = hasExtras ? "COALESCE(r.extras, '{}') as extras," : "'{}' as extras,";
        
        const query = `
            SELECT r.*, 
                   ${extrasSelect}
                   COUNT(*) OVER() as total_count
            FROM reservations r 
            ${whereClause}
            ORDER BY r.created_at DESC 
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        params.push(limit, offset);
        
        console.log('🔍 실행할 쿼리:', query);
        console.log('📝 파라미터:', params);
        
        const result = await pool.query(query, params);
        const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
        
        console.log('✅ 조회 결과:', result.rows.length, '개');
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
        
    } catch (error) {
        console.error('❌ 예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 목록을 불러오는 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 상세 조회 API
app.get('/api/bookings/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 예약 기본 정보
        const reservationQuery = `
            SELECT r.*, 
                   COALESCE(r.extras, '{}') as extras
            FROM reservations r 
            WHERE r.id = $1
        `;
        
        const reservationResult = await pool.query(reservationQuery, [id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // 감사 로그 조회
        const auditQuery = `
            SELECT * FROM reservation_audits 
            WHERE reservation_id = $1 
            ORDER BY changed_at DESC 
            LIMIT 50
        `;
        
        const auditResult = await pool.query(auditQuery, [id]).catch(() => ({ rows: [] }));
        
        // 수배 정보 조회
        const assignmentQuery = `
            SELECT * FROM assignments 
            WHERE reservation_id = $1 
            ORDER BY created_at DESC
        `;
        
        const assignmentResult = await pool.query(assignmentQuery, [id]).catch(() => ({ rows: [] }));
        
        res.json({
            success: true,
            data: {
                reservation,
                audits: auditResult.rows,
                assignments: assignmentResult.rows
            }
        });
        
    } catch (error) {
        console.error('예약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 예약 수정 API (코어 + extras 동시 수정)
app.patch('/api/bookings/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { coreData, extrasData } = req.body;
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 기존 데이터 조회 (감사 로그용)
            const oldDataResult = await client.query(
                'SELECT *, COALESCE(extras, \'{}\') as extras FROM reservations WHERE id = $1',
                [id]
            );
            
            if (oldDataResult.rows.length === 0) {
                throw new Error('예약을 찾을 수 없습니다.');
            }
            
            const oldData = oldDataResult.rows[0];
            
            // 코어 데이터 업데이트
            if (coreData) {
                const setClauses = [];
                const values = [];
                let paramCount = 0;
                
                Object.entries(coreData).forEach(([key, value]) => {
                    if (key !== 'id' && key !== 'created_at') {
                        paramCount++;
                        setClauses.push(`${key} = $${paramCount}`);
                        values.push(value);
                    }
                });
                
                if (setClauses.length > 0) {
                    paramCount++;
                    setClauses.push(`updated_at = NOW()`);
                    values.push(id);
                    
                    const updateQuery = `
                        UPDATE reservations 
                        SET ${setClauses.join(', ')} 
                        WHERE id = $${paramCount}
                    `;
                    
                    await client.query(updateQuery, values);
                }
            }
            
            // extras 데이터 업데이트 (deep merge)
            if (extrasData) {
                const updateExtrasQuery = `
                    UPDATE reservations 
                    SET extras = COALESCE(extras, '{}') || $1::jsonb,
                        updated_at = NOW()
                    WHERE id = $2
                `;
                
                await client.query(updateExtrasQuery, [JSON.stringify(extrasData), id]);
            }
            
            // 업데이트된 데이터 조회
            const newDataResult = await client.query(
                'SELECT *, COALESCE(extras, \'{}\') as extras FROM reservations WHERE id = $1',
                [id]
            );
            
            const newData = newDataResult.rows[0];
            
            // 감사 로그 기록
            const auditQuery = `
                INSERT INTO reservation_audits (
                    reservation_id, action, changed_by, old_values, new_values, 
                    ip_address, user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            
            await client.query(auditQuery, [
                id,
                'update',
                req.session.adminUsername || 'admin',
                JSON.stringify(oldData),
                JSON.stringify(newData),
                req.ip,
                req.get('User-Agent')
            ]).catch(err => console.log('감사 로그 기록 실패:', err));
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: '예약이 수정되었습니다.',
                data: newData
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('예약 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// field_defs 조회 API
app.get('/api/field-defs', requireAuth, async (req, res) => {
    try {
        console.log('📋 /api/field-defs 요청 받음');
        
        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'field_defs'
        `);
        
        if (tableCheck.rows.length === 0) {
            console.log('❌ field_defs 테이블이 존재하지 않음');
            return res.json({
                success: false,
                message: 'field_defs 테이블이 존재하지 않습니다.',
                data: []
            });
        }
        
        // 컬럼 구조 확인
        const columnCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'field_defs'
            ORDER BY ordinal_position
        `);
        
        console.log('📊 field_defs 테이블 컬럼:', columnCheck.rows);
        
        // 데이터 조회 (컬럼명 확인 후)
        const hasIsActive = columnCheck.rows.some(col => col.column_name === 'is_active');
        const hasFieldGroup = columnCheck.rows.some(col => col.column_name === 'field_group');
        const hasSortOrder = columnCheck.rows.some(col => col.column_name === 'sort_order');
        const hasFieldName = columnCheck.rows.some(col => col.column_name === 'field_name');
        
        let query = 'SELECT * FROM field_defs';
        let whereClause = '';
        let orderClause = ' ORDER BY id';
        
        if (hasIsActive) {
            whereClause = ' WHERE is_active = true';
        }
        
        if (hasFieldGroup && hasSortOrder && hasFieldName) {
            orderClause = ' ORDER BY field_group, sort_order, field_name';
        } else if (hasFieldName) {
            orderClause = ' ORDER BY field_name';
        }
        
        const finalQuery = query + whereClause + orderClause;
        console.log('🔍 실행할 쿼리:', finalQuery);
        
        const result = await pool.query(finalQuery);
        
        console.log('✅ field_defs 조회 결과:', result.rows.length, '개');
        
        res.json({
            success: true,
            data: result.rows,
            meta: {
                count: result.rows.length,
                columns: columnCheck.rows.map(col => col.column_name)
            }
        });
        
    } catch (error) {
        console.error('❌ field_defs 조회 오류:', error);
        res.json({
            success: false,
            message: 'field_defs를 불러올 수 없습니다: ' + error.message,
            data: [],
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 수배서 생성 API
app.post('/api/assignments', requireAuth, async (req, res) => {
    try {
        const { reservation_id, vendor_id, notes } = req.body;
        console.log('🔧 수배서 생성 요청:', { reservation_id, vendor_id, notes });

        // 예약 정보 조회 (vendor_id 컬럼이 없으므로 reservations 테이블만 조회)
        const reservationQuery = `
            SELECT r.*
            FROM reservations r
            WHERE r.id = $1
        `;
        const reservationResult = await pool.query(reservationQuery, [reservation_id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '예약을 찾을 수 없습니다.' });
        }

        const reservation = reservationResult.rows[0];

        // 수배업체 정보 조회 (vendor_id가 제공된 경우)
        let vendor_info = null;
        if (vendor_id) {
            const vendorQuery = `SELECT * FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [vendor_id]);
            if (vendorResult.rows.length > 0) {
                vendor_info = vendorResult.rows[0];
            }
        }

        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');

        // 수배서 생성
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *
        `;

        const vendor_contact = vendor_info ? {
            email: vendor_info.email,
            phone: vendor_info.phone,
            contact_person: vendor_info.contact_person
        } : {};

        const assignmentResult = await pool.query(insertQuery, [
            reservation_id,
            vendor_id || null,
            vendor_info ? vendor_info.vendor_name : '미지정',
            JSON.stringify(vendor_contact),
            assignment_token,
            'sent',
            notes || `수배서 생성 (${reservation.product_name})`,
            req.session.adminUsername || 'admin'
        ]);

        // 예약 상태를 수배중으로 변경
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'in_progress', updated_at = NOW()
            WHERE id = $1
        `, [reservation_id]);

        const assignment = assignmentResult.rows[0];
        const assignment_link = `/assignment/${assignment_token}`;

        console.log('✅ 수배서 생성 완료:', assignment_link);

        res.json({
            success: true,
            message: '수배서가 생성되었습니다.',
            data: {
                assignment: assignment,
                assignment_link: assignment_link,
                assignment_token: assignment_token
            }
        });

    } catch (error) {
        console.error('❌ 수배서 생성 오류:', error);
        res.status(500).json({ success: false, message: '수배서 생성 중 오류가 발생했습니다: ' + error.message });
    }
});


// 수배서 페이지 라우트
app.get('/assignment/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 수배서 페이지 요청:', token);
        console.log('🔍 요청 시간:', new Date().toISOString());
        console.log('🔍 DB 연결 상태:', pool ? 'OK' : 'NULL');

        // 토큰 유효성 검사
        if (!token || token.length < 10) {
            console.error('❌ 유효하지 않은 토큰:', token);
            return res.status(400).send(`
                <html>
                    <head><title>잘못된 수배서 링크</title></head>
                    <body>
                        <h1>잘못된 수배서 링크</h1>
                        <p>수배서 토큰이 유효하지 않습니다.</p>
                        <p>토큰: ${token}</p>
                        <button onclick="window.close()">닫기</button>
                    </body>
                </html>
            `);
        }

        // 수배서 정보 조회 (기본 컬럼만 사용)
        console.log('🔍 DB 쿼리 시작');
        const query = `
            SELECT 
                a.id as assignment_id,
                a.assignment_token,
                a.reservation_id,
                a.vendor_id,
                a.status as assignment_status,
                a.assigned_at,
                a.sent_at,
                a.viewed_at,
                a.notes,
                r.id as reservation_id,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;

        console.log('🔍 실행할 쿼리:', query);
        console.log('🔍 토큰 파라미터:', token);

        const result = await pool.query(query, [token]);
        console.log('🔍 쿼리 결과 개수:', result.rows.length);

        if (result.rows.length === 0) {
            console.log('❌ 수배서를 찾을 수 없음:', token);
            
            // 토큰이 존재하는지 별도 확인
            const tokenCheck = await pool.query('SELECT assignment_token FROM assignments WHERE assignment_token = $1', [token]);
            console.log('🔍 토큰 존재 확인:', tokenCheck.rows.length > 0 ? '존재함' : '존재하지 않음');
            
            return res.status(404).send(`
                <html>
                    <head><title>수배서를 찾을 수 없습니다</title></head>
                    <body>
                        <h1>수배서를 찾을 수 없습니다</h1>
                        <p>요청하신 수배서를 찾을 수 없습니다.</p>
                        <p><strong>토큰:</strong> ${token}</p>
                        <p><strong>토큰 길이:</strong> ${token.length}</p>
                        <p><strong>토큰 존재 여부:</strong> ${tokenCheck.rows.length > 0 ? '존재함' : '존재하지 않음'}</p>
                        <hr>
                        <p><small>이 정보를 개발자에게 전달해주세요.</small></p>
                        <button onclick="window.close()">닫기</button>
                    </body>
                </html>
            `);
        }

        const assignment = result.rows[0];
        console.log('✅ 수배서 조회 성공:', assignment.reservation_number);
        console.log('🔍 assignment 데이터 키들:', Object.keys(assignment));

        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
            }
        }

        // 수배업체 정보가 없으면 기본값 설정
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = assignment.platform_name || '미지정';
        }

        // 필수 필드들 null 체크 및 기본값 설정
        const safeAssignment = {
            ...assignment,
            reservation_number: assignment.reservation_number || 'N/A',
            customer_name: assignment.customer_name || '미지정',
            product_name: assignment.product_name || '미지정',
            platform_name: assignment.platform_name || '미지정',
            assignment_vendor: assignment.assignment_vendor || '미지정',
            adult_count: assignment.adult_count || 0,
            child_count: assignment.child_count || 0,
            people_infant: assignment.people_infant || 0,
            phone_number: assignment.phone_number || '-',
            email: assignment.email || '-',
            package_type: assignment.package_type || '-',
            special_requests: assignment.special_requests || '-',
            usage_time: assignment.usage_time || '-'
        };

        console.log('🔍 안전한 assignment 객체 생성 완료');
        console.log('🔍 주요 필드 확인:');
        console.log('  - reservation_number:', safeAssignment.reservation_number);
        console.log('  - customer_name:', safeAssignment.customer_name);
        console.log('  - product_name:', safeAssignment.product_name);

        // 조회 시간 기록 (안전하게)
        try {
            await pool.query(`
                UPDATE assignments 
                SET viewed_at = NOW()
                WHERE assignment_token = $1
            `, [token]);
            console.log('✅ 조회 시간 기록 완료');
        } catch (updateError) {
            console.error('⚠️ 조회 시간 기록 실패:', updateError.message);
            // 조회 시간 기록 실패는 치명적이지 않으므로 계속 진행
        }

        console.log('🔍 템플릿 렌더링 시작');

        // 템플릿 렌더링
        res.render('assignment', {
            assignment: safeAssignment,
            title: `수배서 - ${safeAssignment.reservation_number}`,
            isPreview: false,
            formatDate: (date) => {
                try {
                    if (!date) return '-';
                    const dateObj = new Date(date);
                    if (isNaN(dateObj.getTime())) return '-';
                    return dateObj.toLocaleDateString('ko-KR');
                } catch (e) {
                    console.error('날짜 포맷 오류:', e);
                    return '-';
                }
            },
            formatDateTime: (datetime) => {
                try {
                    if (!datetime) return '-';
                    const dateObj = new Date(datetime);
                    if (isNaN(dateObj.getTime())) return '-';
                    return dateObj.toLocaleString('ko-KR');
                } catch (e) {
                    console.error('날짜시간 포맷 오류:', e);
                    return '-';
                }
            },
            formatCurrency: (amount) => {
                try {
                    if (!amount || isNaN(amount)) return '-';
                    return new Intl.NumberFormat('ko-KR').format(amount) + '원';
                } catch (e) {
                    console.error('통화 포맷 오류:', e);
                    return '-';
                }
            }
        });
        
        console.log('✅ 템플릿 렌더링 완료');

    } catch (error) {
        console.error('❌❌❌ 수배서 페이지 치명적 오류 ❌❌❌');
        console.error('❌ 오류 메시지:', error.message);
        console.error('❌ 오류 이름:', error.name);
        console.error('❌ 오류 코드:', error.code);
        console.error('❌ 요청 토큰:', req.params.token);
        console.error('❌ 요청 URL:', req.url);
        console.error('❌ 요청 시간:', new Date().toISOString());
        console.error('❌ 오류 스택 트레이스:');
        console.error(error.stack);
        console.error('❌❌❌ 오류 정보 끝 ❌❌❌');
        
        // DB 연결 상태 확인
        let dbStatus = 'Unknown';
        try {
            await pool.query('SELECT 1');
            dbStatus = 'Connected';
        } catch (dbError) {
            dbStatus = `Error: ${dbError.message}`;
            console.error('❌ DB 연결 오류:', dbError.message);
        }
        
        // 상세한 HTML 오류 페이지 반환
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>수배서 페이지 오류</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .error-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    .error-title { color: #d32f2f; margin-bottom: 20px; }
                    .error-details { background: #f8f8f8; padding: 15px; border-radius: 4px; margin: 10px 0; }
                    .error-code { font-family: monospace; background: #333; color: #fff; padding: 10px; border-radius: 4px; }
                    .buttons { margin-top: 20px; }
                    .btn { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
                    .btn-primary { background: #1976d2; color: white; }
                    .btn-secondary { background: #757575; color: white; }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1 class="error-title">🚨 수배서 페이지 오류</h1>
                    
                    <div class="error-details">
                        <h3>오류 정보</h3>
                        <p><strong>오류 메시지:</strong> ${error.message || '알 수 없는 오류'}</p>
                        <p><strong>오류 타입:</strong> ${error.name || 'Unknown'}</p>
                        <p><strong>오류 코드:</strong> ${error.code || 'N/A'}</p>
                        <p><strong>요청 토큰:</strong> ${req.params.token || 'N/A'}</p>
                        <p><strong>토큰 길이:</strong> ${req.params.token ? req.params.token.length : 'N/A'}</p>
                        <p><strong>DB 연결 상태:</strong> ${dbStatus}</p>
                        <p><strong>발생 시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
                    </div>
                    
                    <div class="error-details">
                        <h3>디버깅 정보</h3>
                        <div class="error-code">
                            <strong>Stack Trace:</strong><br>
                            ${error.stack ? error.stack.replace(/\n/g, '<br>') : 'No stack trace available'}
                        </div>
                    </div>
                    
                    <div class="error-details">
                        <h3>해결 방법</h3>
                        <ul>
                            <li>수배서 링크가 올바른지 확인해주세요</li>
                            <li>잠시 후 다시 시도해주세요</li>
                            <li>문제가 계속되면 관리자에게 문의해주세요</li>
                        </ul>
                    </div>
                    
                    <div class="buttons">
                        <button class="btn btn-primary" onclick="window.location.reload()">🔄 새로고침</button>
                        <button class="btn btn-secondary" onclick="window.close()">❌ 닫기</button>
                        <button class="btn btn-secondary" onclick="history.back()">⬅️ 뒤로가기</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// 간단한 수배서 테스트 라우트 (인증 불필요)
app.get('/test-assignment/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🧪 간단한 수배서 테스트:', token);
        
        // 1. 토큰 존재 확인
        const tokenCheck = await pool.query('SELECT * FROM assignments WHERE assignment_token = $1', [token]);
        
        if (tokenCheck.rows.length === 0) {
            return res.send(`
                <h1>토큰 테스트 결과</h1>
                <p><strong>토큰:</strong> ${token}</p>
                <p><strong>결과:</strong> ❌ 토큰이 존재하지 않습니다</p>
                <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            `);
        }
        
        const assignment = tokenCheck.rows[0];
        
        // 2. 예약 정보 조회
        const reservationCheck = await pool.query('SELECT * FROM reservations WHERE id = $1', [assignment.reservation_id]);
        
        if (reservationCheck.rows.length === 0) {
            return res.send(`
                <h1>토큰 테스트 결과</h1>
                <p><strong>토큰:</strong> ${token}</p>
                <p><strong>결과:</strong> ⚠️ 토큰은 존재하지만 연결된 예약이 없습니다</p>
                <p><strong>Assignment ID:</strong> ${assignment.id}</p>
                <p><strong>Reservation ID:</strong> ${assignment.reservation_id}</p>
                <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            `);
        }
        
        const reservation = reservationCheck.rows[0];
        
        // 3. 성공 결과
        res.send(`
            <h1>토큰 테스트 결과</h1>
            <p><strong>토큰:</strong> ${token}</p>
            <p><strong>결과:</strong> ✅ 정상</p>
            <p><strong>예약번호:</strong> ${reservation.reservation_number}</p>
            <p><strong>고객명:</strong> ${reservation.korean_name}</p>
            <p><strong>상품명:</strong> ${reservation.product_name}</p>
            <p><strong>수배 상태:</strong> ${assignment.status}</p>
            <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            <hr>
            <p><a href="/assignment/${token}">실제 수배서 페이지로 이동</a></p>
        `);
        
    } catch (error) {
        console.error('테스트 라우트 오류:', error);
        res.send(`
            <h1>토큰 테스트 오류</h1>
            <p><strong>토큰:</strong> ${req.params.token}</p>
            <p><strong>오류:</strong> ${error.message}</p>
            <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
        `);
    }
});

// 테이블 구조 확인 라우트
app.get('/debug/table-structure', requireAuth, async (req, res) => {
    try {
        const tables = ['assignments', 'reservations', 'vendors'];
        const structure = {};
        
        for (const table of tables) {
            try {
                const result = await pool.query(`
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_name = $1 
                    ORDER BY ordinal_position
                `, [table]);
                structure[table] = result.rows;
            } catch (e) {
                structure[table] = { error: e.message };
            }
        }
        
        res.json({
            timestamp: new Date().toISOString(),
            database_structure: structure
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// 특정 토큰 디버깅 라우트
app.get('/debug/assignment/:token', requireAuth, async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 디버깅 라우트 시작:', token);
        
        const debugInfo = {
            token: token,
            tokenLength: token.length,
            timestamp: new Date().toISOString(),
            checks: []
        };
        
        // 1. 토큰 존재 확인
        try {
            const tokenCheck = await pool.query('SELECT * FROM assignments WHERE assignment_token = $1', [token]);
            debugInfo.checks.push({
                step: 'token_exists',
                success: tokenCheck.rows.length > 0,
                result: tokenCheck.rows.length > 0 ? tokenCheck.rows[0] : null,
                count: tokenCheck.rows.length
            });
        } catch (e) {
            debugInfo.checks.push({
                step: 'token_exists',
                success: false,
                error: e.message
            });
        }
        
        // 2. 조인 쿼리 테스트
        try {
            const joinQuery = `
                SELECT a.*, r.reservation_number, r.korean_name, r.product_name
                FROM assignments a
                JOIN reservations r ON a.reservation_id = r.id
                WHERE a.assignment_token = $1
            `;
            const joinResult = await pool.query(joinQuery, [token]);
            debugInfo.checks.push({
                step: 'join_query',
                success: joinResult.rows.length > 0,
                result: joinResult.rows.length > 0 ? joinResult.rows[0] : null,
                count: joinResult.rows.length
            });
        } catch (e) {
            debugInfo.checks.push({
                step: 'join_query',
                success: false,
                error: e.message
            });
        }
        
        // 3. 예약 정보 확인
        const tokenExists = debugInfo.checks.find(c => c.step === 'token_exists');
        if (tokenExists && tokenExists.success && tokenExists.result) {
            try {
                const reservationQuery = 'SELECT * FROM reservations WHERE id = $1';
                const reservationResult = await pool.query(reservationQuery, [tokenExists.result.reservation_id]);
                debugInfo.checks.push({
                    step: 'reservation_exists',
                    success: reservationResult.rows.length > 0,
                    result: reservationResult.rows.length > 0 ? reservationResult.rows[0] : null,
                    count: reservationResult.rows.length
                });
            } catch (e) {
                debugInfo.checks.push({
                    step: 'reservation_exists',
                    success: false,
                    error: e.message
                });
            }
        }
        
        res.json(debugInfo);
        
    } catch (error) {
        console.error('디버깅 라우트 오류:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// 수배서 시스템 테스트 라우트
app.get('/test/assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔍 테스트 라우트 시작');
        
        // 단계별로 테스트
        let result = { step: 1, message: 'DB 연결 테스트' };
        
        // 1단계: 기본 쿼리 테스트
        await pool.query('SELECT 1');
        result.step = 2;
        result.message = 'assignments 테이블 확인';
        
        // 2단계: 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'assignments'
        `);
        result.step = 3;
        result.assignments_table_exists = tableCheck.rows.length > 0;
        result.message = 'reservations 테이블 확인';
        
        // 3단계: 예약 테이블 확인
        const reservationCheck = await pool.query(`SELECT COUNT(*) as count FROM reservations`);
        result.step = 4;
        result.reservations_count = reservationCheck.rows[0].count;
        result.message = 'assignments 개수 확인';
        
        // 4단계: assignments 개수 확인
        if (tableCheck.rows.length > 0) {
            const assignmentCheck = await pool.query(`SELECT COUNT(*) as count FROM assignments`);
            result.assignments_count = assignmentCheck.rows[0].count;
            result.step = 5;
            result.message = '완료';
        } else {
            result.assignments_count = 0;
            result.step = 5;
            result.message = 'assignments 테이블 없음';
        }

        console.log('✅ 테스트 완료:', result);
        res.json(result);
        
    } catch (error) {
        console.error('❌ 테스트 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack,
            step: 'error'
        });
    }
});

// 간단한 디버그 라우트
app.get('/debug/simple', (req, res) => {
    res.json({ 
        message: '서버 정상 작동',
        timestamp: new Date().toISOString(),
        pool_status: pool ? 'pool 존재' : 'pool 없음'
    });
});

// 실제 수배서 토큰 조회
app.get('/debug/tokens', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.id,
                a.assignment_token,
                a.status,
                a.created_at,
                r.id as reservation_id,
                r.reservation_number,
                r.korean_name,
                r.product_name
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            ORDER BY a.created_at DESC
            LIMIT 10
        `);
        
        res.json({
            message: '수배서 토큰 목록',
            count: result.rows.length,
            assignments: result.rows
        });
        
    } catch (error) {
        console.error('토큰 조회 오류:', error);
        res.status(500).json({ error: error.message });
    }
});

// 토큰만 간단히 조회
app.get('/debug/simple-tokens', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT assignment_token, id, status 
            FROM assignments 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        const tokens = result.rows.map(row => ({
            token: row.assignment_token,
            id: row.id,
            status: row.status,
            url: `/assignment/${row.assignment_token}`
        }));
        
        res.json({
            message: '수배서 토큰 목록 (최근 5개)',
            tokens: tokens
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// 수배서 테스트 라우트 (간단한 HTML 반환)
app.get('/assignment-test/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🧪 수배서 테스트 요청:', token);
        
        const result = await pool.query(`
            SELECT 
                a.id, a.assignment_token, a.status,
                r.reservation_number, r.korean_name, r.product_name
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `, [token]);
        
        if (result.rows.length === 0) {
            return res.send(`<h1>수배서 없음</h1><p>토큰: ${token}</p>`);
        }
        
        const data = result.rows[0];
        res.send(`
            <html>
                <head><title>수배서 테스트</title></head>
                <body>
                    <h1>수배서 테스트 성공</h1>
                    <p><strong>토큰:</strong> ${token}</p>
                    <p><strong>예약번호:</strong> ${data.reservation_number}</p>
                    <p><strong>예약자:</strong> ${data.korean_name}</p>
                    <p><strong>상품:</strong> ${data.product_name}</p>
                    <p><strong>상태:</strong> ${data.status}</p>
                    <hr>
                    <a href="/assignment/${token}">실제 수배서 페이지로 이동</a>
                </body>
            </html>
        `);
        
    } catch (error) {
        console.error('🧪 테스트 오류:', error);
        res.status(500).send(`<h1>테스트 오류</h1><p>${error.message}</p>`);
    }
});

// 안전한 수배서 페이지 (템플릿 오류 디버깅용)
app.get('/assignment-safe/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🛡️ 안전한 수배서 페이지 요청:', token);
        
        const query = `
            SELECT 
                a.*,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name as vendor_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount as total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;

        const result = await pool.query(query, [token]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>수배서를 찾을 수 없습니다</h1>');
        }

        const assignment = result.rows[0];
        
        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
            }
        }

        // 수배업체 정보가 없으면 기본값 설정
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = assignment.vendor_name || '미지정';
        }

        console.log('🛡️ 안전한 템플릿으로 렌더링');
        res.render('assignment-safe', {
            assignment: assignment,
            title: `수배서 (안전모드) - ${assignment.reservation_number}`
        });
        
    } catch (error) {
        console.error('🛡️ 안전한 수배서 오류:', error);
        res.status(500).render('error', {
            title: '수배서 오류',
            message: '수배서를 불러오는 중 오류가 발생했습니다.',
            backUrl: '/'
        });
    }
});

// 수배 로그 조회 API
app.get('/api/assignments/logs/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔍 수배 로그 조회:', reservationId);
        
        const result = await pool.query(`
            SELECT 
                'assignment_created' as action,
                '수배서 생성' as details,
                'success' as type,
                created_at
            FROM assignments 
            WHERE reservation_id = $1
            UNION ALL
            SELECT 
                'assignment_sent' as action,
                '수배서 전송' as details,
                'success' as type,
                sent_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND sent_at IS NOT NULL
            UNION ALL
            SELECT 
                'assignment_viewed' as action,
                '수배서 열람' as details,
                'info' as type,
                viewed_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND viewed_at IS NOT NULL
            UNION ALL
            SELECT 
                'assignment_confirmed' as action,
                '수배 확정' as details,
                'success' as type,
                response_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND response_at IS NOT NULL
            ORDER BY created_at DESC
        `, [reservationId]);
        
        res.json({
            success: true,
            logs: result.rows
        });
        
    } catch (error) {
        console.error('❌ 수배 로그 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '로그 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 저장 API
app.post('/api/assignments/:reservationId/save', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('💾 수배서 저장 요청:', reservationId);
        
        // 기존 수배서가 있는지 확인
        let assignment = await pool.query(`
            SELECT * FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        if (assignment.rows.length === 0) {
            // 수배서가 없으면 자동 생성
            const autoAssignment = await createAutoAssignment(reservationId, null);
            if (!autoAssignment) {
                return res.status(400).json({
                    success: false,
                    message: '수배서 생성에 실패했습니다'
                });
            }
        }
        
        res.json({
            success: true,
            message: '수배서가 저장되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 수배서 저장 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 전송 API
app.post('/api/assignments/:reservationId/send', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('📤 수배서 전송 요청:', reservationId);
        
        // 수배서 조회
        const assignment = await pool.query(`
            SELECT * FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다'
            });
        }
        
        // 전송 시간 업데이트
        await pool.query(`
            UPDATE assignments 
            SET sent_at = NOW(), status = 'sent'
            WHERE reservation_id = $1
        `, [reservationId]);
        
        res.json({
            success: true,
            message: '수배서가 전송되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 수배서 전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 재전송 API
app.post('/api/assignments/:reservationId/resend', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔄 수배서 재전송 요청:', reservationId);
        
        // 재전송 시간 업데이트
        await pool.query(`
            UPDATE assignments 
            SET sent_at = NOW()
            WHERE reservation_id = $1
        `, [reservationId]);
        
        res.json({
            success: true,
            message: '수배서가 재전송되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 수배서 재전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 재전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 링크 생성 API (토큰이 없으면 생성)
app.post('/api/assignments/:reservationId/generate-link', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔗 수배서 링크 생성 요청:', reservationId);
        
        // 기존 수배서 토큰 조회
        let assignment = await pool.query(`
            SELECT assignment_token FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        let token;
        
        if (assignment.rows.length === 0) {
            // 수배서가 없으면 새로 생성
            token = crypto.randomBytes(32).toString('hex');
            
            // 예약 정보 조회
            const reservation = await pool.query(`
                SELECT * FROM reservations WHERE id = $1
            `, [reservationId]);
            
            if (reservation.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '예약 정보를 찾을 수 없습니다'
                });
            }
            
            const reservationData = reservation.rows[0];
            
            // 새 수배서 생성
            await pool.query(`
                INSERT INTO assignments (
                    reservation_id, assignment_token, assignment_status, 
                    created_at, updated_at
                ) VALUES ($1, $2, 'created', NOW(), NOW())
            `, [reservationId, token]);
            
            console.log('✅ 새 수배서 생성:', token);
            
        } else if (!assignment.rows[0].assignment_token) {
            // 토큰이 없으면 새로 생성
            token = crypto.randomBytes(32).toString('hex');
            
            await pool.query(`
                UPDATE assignments 
                SET assignment_token = $1, updated_at = NOW()
                WHERE reservation_id = $2
            `, [token, reservationId]);
            
            console.log('✅ 수배서 토큰 생성:', token);
            
        } else {
            // 기존 토큰 사용
            token = assignment.rows[0].assignment_token;
            console.log('✅ 기존 토큰 사용:', token);
        }
        
        const assignmentUrl = `https://www.guamsavecard.com/assignment/${token}`;
        
        // 로그 기록
        await pool.query(`
            INSERT INTO assignment_logs (reservation_id, action, details, created_at)
            VALUES ($1, 'link_generated', $2, NOW())
        `, [reservationId, JSON.stringify({ url: assignmentUrl })]);
        
        console.log('📎 수배서 링크 생성 완료:', assignmentUrl);
        
        res.json({
            success: true,
            message: '수배서 링크가 생성되었습니다',
            link: assignmentUrl,
            token: token
        });
        
    } catch (error) {
        console.error('❌ 수배서 링크 생성 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '링크 생성 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 링크 전송 API (기존 유지)
app.post('/api/assignments/:reservationId/send-link', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔗 수배서 링크 전송 요청:', reservationId);
        
        // 수배서 토큰 조회
        const assignment = await pool.query(`
            SELECT assignment_token FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다'
            });
        }
        
        const token = assignment.rows[0].assignment_token;
        const assignmentUrl = `https://www.guamsavecard.com/assignment/${token}`;
        
        console.log('📎 수배서 링크:', assignmentUrl);
        
        res.json({
            success: true,
            message: '수배서 링크가 전송되었습니다',
            url: assignmentUrl
        });
        
    } catch (error) {
        console.error('❌ 수배서 링크 전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '링크 전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 파일 다운로드 API
app.get('/api/assignments/:reservationId/download', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('📥 수배서 다운로드 요청:', reservationId);
        
        // 임시로 텍스트 파일 생성 (실제로는 PDF 생성 라이브러리 사용)
        const content = `수배서 - 예약 ID: ${reservationId}\n생성일: ${new Date().toLocaleString('ko-KR')}`;
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="assignment_${reservationId}.txt"`);
        res.send(content);
        
    } catch (error) {
        console.error('❌ 수배서 다운로드 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '다운로드 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 미리보기 (관리자용)
app.get('/assignment/preview/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔍 수배서 미리보기 요청:', reservationId);

        // 해당 예약의 수배서 조회
        const query = `
            SELECT 
                a.*,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name as vendor_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount as total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE r.id = $1
            ORDER BY a.created_at DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [reservationId]);

        if (result.rows.length === 0) {
            // 수배서가 없는 경우, 예약 정보만으로 임시 수배서 생성
            const reservationQuery = `SELECT * FROM reservations WHERE id = $1`;
            const reservationResult = await pool.query(reservationQuery, [reservationId]);
            
            if (reservationResult.rows.length === 0) {
                return res.status(404).render('error', { 
                    message: '예약을 찾을 수 없습니다.',
                    error: { status: 404 }
                });
            }
            
            const reservation = reservationResult.rows[0];
            
            // 임시 수배서 데이터 생성
            const tempAssignment = {
                id: 'TEMP',
                assignment_token: 'preview',
                reservation_id: reservation.id,
                vendor_id: null,
                vendor_name: '미지정',
                status: 'draft',
                created_at: new Date(),
                sent_at: null,
                viewed_at: null,
                response_at: null,
                confirmation_number: null,
                rejection_reason: null,
                notes: '임시 수배서 (아직 생성되지 않음)',
                
                // 예약 정보 매핑
                reservation_number: reservation.reservation_number,
                customer_name: reservation.korean_name,
                english_first_name: reservation.english_first_name,
                english_last_name: reservation.english_last_name,
                vendor_name: reservation.platform_name,
                product_name: reservation.product_name,
                departure_date: reservation.usage_date,
                usage_date: reservation.usage_date,
                usage_time: reservation.usage_time,
                adult_count: reservation.people_adult,
                child_count: reservation.people_child,
                people_infant: reservation.people_infant,
                total_amount: reservation.total_amount,
                phone_number: reservation.phone,
                email: reservation.email,
                package_type: reservation.package_type,
                special_requests: reservation.memo,
                assignment_vendor: '미지정',
                vendor_email: null,
                vendor_phone: null
            };
            
            return res.render('assignment', {
                assignment: tempAssignment,
                title: `수배서 미리보기 - ${tempAssignment.reservation_number} (임시)`,
                isPreview: true,
                formatDate: (date) => {
                    if (!date) return '-';
                    return new Date(date).toLocaleDateString('ko-KR');
                },
                formatCurrency: (amount) => {
                    if (!amount) return '-';
                    return new Intl.NumberFormat('ko-KR').format(amount) + '원';
                }
            });
        }

        const assignment = result.rows[0];

        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
            }
        }

        // 수배업체 정보가 없으면 기본값 설정
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = assignment.vendor_name || '미지정';
        }

        res.render('assignment', {
            assignment: assignment,
            title: `수배서 미리보기 - ${assignment.reservation_number}`,
            isPreview: true,
            formatDate: (date) => {
                if (!date) return '-';
                return new Date(date).toLocaleDateString('ko-KR');
            },
            formatCurrency: (amount) => {
                if (!amount) return '-';
                return new Intl.NumberFormat('ko-KR').format(amount) + '원';
            }
        });

    } catch (error) {
        console.error('❌ 수배서 미리보기 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        console.error('❌ 요청 파라미터:', req.params);
        
        // 간단한 HTML 오류 페이지 반환 (error.ejs가 없을 수도 있음)
        res.status(500).send(`
            <html>
                <head><title>수배서 오류</title></head>
                <body>
                    <h1>수배서 미리보기 오류</h1>
                    <p>오류 메시지: ${error.message}</p>
                    <p>예약 ID: ${req.params.reservationId}</p>
                    <button onclick="window.close()">닫기</button>
                </body>
            </html>
        `);
    }
});

// 수배서 확정 처리 API
app.post('/assignment/:token/confirm', async (req, res) => {
    try {
        const { token } = req.params;
        const { confirmation_number, notes } = req.body;
        
        console.log('✅ 수배서 확정 요청:', { token, confirmation_number });

        if (!confirmation_number) {
            return res.status(400).json({ success: false, message: '확정번호를 입력해주세요.' });
        }

        // 수배서 정보 조회
        const assignmentQuery = `
            SELECT a.*, r.reservation_number 
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;
        const assignmentResult = await pool.query(assignmentQuery, [token]);

        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '수배서를 찾을 수 없습니다.' });
        }

        const assignment = assignmentResult.rows[0];

        // 수배서 확정 처리
        await pool.query(`
            UPDATE assignments 
            SET 
                status = 'confirmed',
                confirmation_number = $1,
                response_at = NOW(),
                notes = COALESCE(notes, '') || $2
            WHERE assignment_token = $3
        `, [confirmation_number, notes ? '\n확정 메모: ' + notes : '', token]);

        // 예약 상태를 확정으로 변경
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'confirmed', updated_at = NOW()
            WHERE id = $1
        `, [assignment.reservation_id]);

        console.log('✅ 수배서 확정 완료:', assignment.reservation_number, confirmation_number);

        res.json({
            success: true,
            message: '수배서가 확정되었습니다.',
            data: {
                confirmation_number: confirmation_number,
                reservation_number: assignment.reservation_number
            }
        });

    } catch (error) {
        console.error('❌ 수배서 확정 오류:', error);
        res.status(500).json({ success: false, message: '수배서 확정 중 오류가 발생했습니다: ' + error.message });
    }
});

// 수배서 거절 처리 API
app.post('/assignment/:token/reject', async (req, res) => {
    try {
        const { token } = req.params;
        const { rejection_reason } = req.body;
        
        console.log('❌ 수배서 거절 요청:', { token, rejection_reason });

        if (!rejection_reason) {
            return res.status(400).json({ success: false, message: '거절 사유를 입력해주세요.' });
        }

        // 수배서 정보 조회
        const assignmentQuery = `
            SELECT a.*, r.reservation_number 
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;
        const assignmentResult = await pool.query(assignmentQuery, [token]);

        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '수배서를 찾을 수 없습니다.' });
        }

        const assignment = assignmentResult.rows[0];

        // 수배서 거절 처리
        await pool.query(`
            UPDATE assignments 
            SET 
                status = 'rejected',
                rejection_reason = $1,
                response_at = NOW()
            WHERE assignment_token = $2
        `, [rejection_reason, token]);

        // 예약 상태를 대기중으로 되돌림 (다른 업체에 재수배 가능)
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'pending', updated_at = NOW()
            WHERE id = $1
        `, [assignment.reservation_id]);

        console.log('❌ 수배서 거절 완료:', assignment.reservation_number);

        res.json({
            success: true,
            message: '수배서가 거절되었습니다.',
            data: {
                rejection_reason: rejection_reason,
                reservation_number: assignment.reservation_number
            }
        });

    } catch (error) {
        console.error('❌ 수배서 거절 오류:', error);
        res.status(500).json({ success: false, message: '수배서 거절 중 오류가 발생했습니다: ' + error.message });
    }
});

// 구버전 수배 관리 API (사용 안함 - 새로운 API로 대체됨)
/*
app.get('/api/assignments', requireAuth, async (req, res) => {
    try {
        const status = req.query.status || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (status) {
            whereClause += ' AND a.status = $1';
            params.push(status);
        }
        
        const query = `
            SELECT a.*, r.customer_name, r.tour_date, r.platform_name,
                   COUNT(*) OVER() as total_count
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
        
        res.json({
            success: true,
            data: {
                assignments: result.rows,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalCount / limit),
                    total: totalCount,
                    limit
                }
            }
        });
        
    } catch (error) {
        console.error('수배 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
});
*/

// 자동 수배 생성 함수
async function createAutoAssignment(reservationId, productName) {
    try {
        // 상품명으로 수배업체 자동 매칭
        const matchQuery = `
            SELECT v.*, vp.product_keyword, vp.priority
            FROM vendors v
            JOIN vendor_products vp ON v.id = vp.vendor_id
            WHERE v.is_active = true AND vp.is_active = true
            AND LOWER($1) LIKE '%' || LOWER(vp.product_keyword) || '%'
            ORDER BY vp.priority ASC, v.created_at ASC
            LIMIT 1
        `;
        
        const matchResult = await pool.query(matchQuery, [productName]);
        
        if (matchResult.rows.length === 0) {
            console.log('자동 매칭되는 수배업체가 없습니다:', productName);
            return null;
        }
        
        const vendor = matchResult.rows[0];
        
        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');
        
        // 자동 수배서 생성 (바로 확정 상태)
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *
        `;
        
        const vendor_contact = {
            email: vendor.email,
            phone: vendor.phone,
            contact_person: vendor.contact_person
        };
        
        const insertParams = [
            reservationId,
            vendor.id,
            vendor.vendor_name,
            JSON.stringify(vendor_contact),
            assignment_token,
            'sent', // 바로 전송 상태로 설정
            `자동 생성된 수배서 (${productName})`,
            'system'
        ];
        
        const result = await pool.query(insertQuery, insertParams);
        
        console.log('✅ 자동 수배서 생성 완료:', {
            reservationId,
            vendor: vendor.vendor_name,
            keyword: vendor.product_keyword
        });
        
        return {
            assignment: result.rows[0],
            vendor: vendor,
            assignment_link: `/assignment/${assignment_token}`
        };
        
    } catch (error) {
        console.error('자동 수배서 생성 오류:', error);
        return null;
    }
}

// 바로 확정 상품 체크 함수
function isAutoConfirmProduct(productName) {
    if (!productName) return false;
    
    const autoConfirmKeywords = [
        '롱혼스테이크', '롱혼', 'longhorn',
        '레스토랑', '식당', '맛집', '카페',
        '렌터카', '렌트카', 'rental',
        '쇼핑', 'shopping', '면세점'
    ];
    
    const lowerProductName = productName.toLowerCase();
    return autoConfirmKeywords.some(keyword => 
        lowerProductName.includes(keyword.toLowerCase())
    );
}

// 임시: assignments 테이블 필드 추가 (Railway 실행용)
app.get('/admin/setup-assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔧 assignments 테이블에 필요한 필드들을 추가합니다...');

        // 1. assignment_token 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'assignment_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN assignment_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_token ON assignments(assignment_token);
                END IF;
            END $$;
        `);

        // 2. viewed_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'viewed_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN viewed_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 3. response_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'response_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN response_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 4. confirmation_number 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'confirmation_number'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN confirmation_number VARCHAR(100);
                END IF;
            END $$;
        `);

        // 5. voucher_token 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'voucher_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN voucher_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_voucher_token ON assignments(voucher_token);
                END IF;
            END $$;
        `);

        // 6. sent_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'sent_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN sent_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 7. rejection_reason 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'rejection_reason'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN rejection_reason TEXT;
                END IF;
            END $$;
        `);

        // 현재 테이블 구조 확인
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'assignments'
            ORDER BY ordinal_position
        `);

        res.json({
            success: true,
            message: 'assignments 테이블 필드 추가 완료!',
            columns: result.rows
        });

    } catch (error) {
        console.error('❌ assignments 테이블 필드 추가 중 오류:', error);
        res.status(500).json({
            success: false,
            message: 'assignments 테이블 필드 추가 실패: ' + error.message
        });
    }
});

// 수배관리 목록 조회 API (수배중 + 확정 상태의 예약들)
app.get('/api/assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔍 수배관리 API 호출 시작');
        
        // 먼저 테이블 존재 여부 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('reservations', 'assignments')
        `);
        console.log('📋 존재하는 테이블:', tableCheck.rows.map(r => r.table_name));
        
        const { page = 1, status = '', search = '' } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        // 수배관리 페이지: 수배중 + 확정 상태만 표시 (대기중 제외)
        let whereClause = `WHERE r.payment_status IN ('in_progress', 'confirmed')`;
        const queryParams = [];
        let paramIndex = 0;
        
        console.log('🔍 수배관리 필터: 수배중(in_progress) + 확정(confirmed) 상태만 표시');
        
        console.log('🔍 수배관리 API 호출 - 필터:', { page, status, search });
        
        // 예약 상태 필터
        if (status) {
            if (status === 'in_progress') {
                whereClause += ` AND r.payment_status = 'in_progress'`;
            } else if (status === 'confirmed') {
                whereClause += ` AND r.payment_status = 'confirmed'`;
            } else if (status === 'voucher_sent') {
                whereClause += ` AND r.payment_status = 'voucher_sent'`;
            }
        }
        
        // 검색 필터 (예약번호, 상품명, 고객명)
        if (search) {
            paramIndex++;
            whereClause += ` AND (
                r.reservation_number ILIKE $${paramIndex} OR 
                r.product_name ILIKE $${paramIndex} OR 
                r.korean_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
        }
        
        // 총 개수 조회 (assignments 테이블 없어도 안전)
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM reservations r
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);
        
        // assignments 테이블 존재 여부에 따라 쿼리 분기
        const hasAssignmentsTable = tableCheck.rows.some(r => r.table_name === 'assignments');
        
        let assignmentsQuery;
        if (hasAssignmentsTable) {
            // assignments 테이블이 있는 경우
            assignmentsQuery = `
                SELECT 
                    r.*,
                    a.id as assignment_id,
                    a.vendor_name,
                    a.vendor_contact,
                    a.assignment_token,
                    a.status as assignment_status,
                    a.notes as assignment_notes,
                    a.assigned_at,
                    a.sent_at,
                    a.viewed_at,
                    a.response_at,
                    a.confirmation_number,
                    a.voucher_token,
                    a.rejection_reason,
                    COUNT(*) OVER() as total_count
                FROM reservations r
                LEFT JOIN assignments a ON r.id = a.reservation_id
                ${whereClause}
                ORDER BY r.updated_at DESC, r.created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `;
        } else {
            // assignments 테이블이 없는 경우 (예약만 조회)
            assignmentsQuery = `
                SELECT 
                    r.*,
                    NULL as assignment_id,
                    NULL as vendor_name,
                    NULL as vendor_contact,
                    NULL as assignment_token,
                    NULL as assignment_status,
                    NULL as assignment_notes,
                    NULL as assigned_at,
                    NULL as sent_at,
                    NULL as viewed_at,
                    NULL as response_at,
                    NULL as confirmation_number,
                    NULL as voucher_token,
                    NULL as rejection_reason,
                    COUNT(*) OVER() as total_count
                FROM reservations r
                ${whereClause}
                ORDER BY r.updated_at DESC, r.created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `;
        }
        
        queryParams.push(limit, offset);
        const result = await pool.query(assignmentsQuery, queryParams);
        
        console.log(`📊 수배관리 쿼리 결과: ${result.rows.length}개 (총 ${totalCount}개)`);
        if (result.rows.length > 0) {
            console.log('📋 첫 번째 항목:', {
                id: result.rows[0].id,
                reservation_number: result.rows[0].reservation_number,
                payment_status: result.rows[0].payment_status,
                vendor_name: result.rows[0].vendor_name
            });
        }
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.json({
            success: true,
            data: {
                assignments: result.rows,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit
                }
            }
        });
        
    } catch (error) {
        console.error('❌ 수배관리 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배관리 목록을 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 예약 상세 조회 API (수배관리 모달용)
app.get('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        console.log('🔍 예약 상세 조회 API 호출:', reservationId);
        
        // reservations 테이블에서 기본 정보만 조회
        const query = `
            SELECT 
                r.*,
                v.vendor_name,
                a.assignment_token,
                a.confirmation_number as assignment_confirmation_number,
                a.voucher_token
            FROM reservations r
            LEFT JOIN vendors v ON r.vendor_id = v.id
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE r.id = $1
        `;
        
        const result = await pool.query(query, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        console.log('📋 예약 상세 조회 성공:', {
            id: reservation.id,
            reservation_number: reservation.reservation_number,
            payment_status: reservation.payment_status,
            vendor_name: reservation.vendor_name
        });
        
        res.json({
            success: true,
            reservation: reservation
        });
        
    } catch (error) {
        console.error('❌ 예약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 정보 수정 API (수배관리 모달용 - 확장된 필드 지원)
app.put('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const formData = req.body;
        
        console.log('🔧 예약 정보 수정 API 호출:', reservationId, formData);
        
        // 동적 쿼리 생성
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        
        // 예약 정보
        if (formData.platform_name !== undefined) {
            updateFields.push(`platform_name = $${paramIndex++}`);
            values.push(formData.platform_name);
        }
        if (formData.payment_status !== undefined) {
            updateFields.push(`payment_status = $${paramIndex++}`);
            values.push(formData.payment_status);
        }
        
        // 상품 정보
        if (formData.product_name !== undefined) {
            updateFields.push(`product_name = $${paramIndex++}`);
            values.push(formData.product_name);
        }
        if (formData.package_type !== undefined) {
            updateFields.push(`package_type = $${paramIndex++}`);
            values.push(formData.package_type);
        }
        
        // 일정 정보
        if (formData.usage_date !== undefined) {
            updateFields.push(`usage_date = $${paramIndex++}`);
            values.push(formData.usage_date);
        }
        if (formData.usage_time !== undefined) {
            updateFields.push(`usage_time = $${paramIndex++}`);
            values.push(formData.usage_time);
        }
        
        // 예약자 정보
        if (formData.korean_name !== undefined) {
            updateFields.push(`korean_name = $${paramIndex++}`);
            values.push(formData.korean_name);
        }
        
        // 영문명 처리 (english_name을 first_name과 last_name으로 분리)
        if (formData.english_name !== undefined) {
            const nameParts = formData.english_name.split(' ');
            const firstName = nameParts.slice(1).join(' ') || '';
            const lastName = nameParts[0] || '';
            
            updateFields.push(`english_first_name = $${paramIndex++}`);
            values.push(firstName);
            updateFields.push(`english_last_name = $${paramIndex++}`);
            values.push(lastName);
        }
        
        if (formData.phone !== undefined) {
            updateFields.push(`phone = $${paramIndex++}`);
            values.push(formData.phone);
        }
        if (formData.email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            values.push(formData.email);
        }
        if (formData.kakao_id !== undefined) {
            updateFields.push(`kakao_id = $${paramIndex++}`);
            values.push(formData.kakao_id);
        }
        
        // 인원 및 금액 정보
        if (formData.people_adult !== undefined) {
            updateFields.push(`people_adult = $${paramIndex++}`);
            values.push(formData.people_adult);
        }
        if (formData.people_child !== undefined) {
            updateFields.push(`people_child = $${paramIndex++}`);
            values.push(formData.people_child);
        }
        if (formData.people_infant !== undefined) {
            updateFields.push(`people_infant = $${paramIndex++}`);
            values.push(formData.people_infant);
        }
        if (formData.adult_price !== undefined) {
            updateFields.push(`adult_unit_price = $${paramIndex++}`);
            values.push(formData.adult_price);
        }
        if (formData.child_price !== undefined) {
            updateFields.push(`child_unit_price = $${paramIndex++}`);
            values.push(formData.child_price);
        }
        // infant_unit_price 컬럼이 없으므로 제외
        // if (formData.infant_price !== undefined) {
        //     updateFields.push(`infant_unit_price = $${paramIndex++}`);
        //     values.push(formData.infant_price);
        // }
        
        // 특별 요청사항
        if (formData.memo !== undefined) {
            updateFields.push(`memo = $${paramIndex++}`);
            values.push(formData.memo);
        }
        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: '수정할 필드가 없습니다.'
            });
        }
        
        // updated_at 추가
        updateFields.push(`updated_at = NOW()`);
        values.push(reservationId);
        
        const query = `
            UPDATE reservations 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 예약 정보 수정 완료:', result.rows[0].reservation_number);
        
        res.json({
            success: true,
            message: '예약 정보가 수정되었습니다.',
            reservation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 정보 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 정보 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 메모 저장 API
app.post('/api/reservations/:id/memo', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const { memo } = req.body;
        
        console.log('📝 예약 메모 저장 API 호출:', reservationId);
        
        const query = `
            UPDATE reservations 
            SET memo = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `;
        
        const result = await pool.query(query, [memo, reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 예약 메모 저장 완료');
        
        res.json({
            success: true,
            message: '메모가 저장되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 예약 메모 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '메모 저장 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 수배서 생성 API
app.post('/api/assignments', requireAuth, async (req, res) => {
    try {
        console.log('수배서 생성 요청:', req.body);
        const { reservation_id, vendor_id, notes } = req.body;

        if (!reservation_id || !vendor_id) {
            console.log('필수 필드 누락:', { reservation_id, vendor_id });
            return res.status(400).json({
                success: false,
                message: '예약 ID와 수배업체 ID는 필수입니다.'
            });
        }
        
        // 예약 정보 확인
        const reservationQuery = 'SELECT * FROM reservations WHERE id = $1';
        const reservationResult = await pool.query(reservationQuery, [reservation_id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 수배업체 정보 확인
        const vendorQuery = 'SELECT * FROM vendors WHERE id = $1 AND is_active = true';
        const vendorResult = await pool.query(vendorQuery, [vendor_id]);
        
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다.'
            });
        }
        
        const vendor = vendorResult.rows[0];
        
        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');
        
        // 수배서 생성
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *
        `;
        
        const vendor_contact = {
            email: vendor.email,
            phone: vendor.phone,
            contact_person: vendor.contact_person
        };
        
        const insertParams = [
            reservation_id,
            vendor_id,
            vendor.vendor_name,
            JSON.stringify(vendor_contact),
            assignment_token,
            'requested',
            notes || '',
            req.session.adminUsername || 'admin'
        ];
        
        const result = await pool.query(insertQuery, insertParams);
        const assignment = result.rows[0];

        // 예약 상태를 "수배중(현지수배)"으로 업데이트 (수배관리로 이동)
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['in_progress', reservation_id]
        );

        // 수배서 자동 전송 (상태를 'sent'로 업데이트)
        await pool.query(
            'UPDATE assignments SET status = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2',
            ['sent', assignment.id]
        );

        // TODO: 실제 이메일/메신저 전송 로직 추가
        console.log(`📧 수배서 자동 전송: ${vendor.vendor_name} (${vendor.email})`);
        console.log(`🔗 수배서 링크: ${req.protocol}://${req.get('host')}/assignment/${assignment_token}`);

        res.json({
            success: true,
            message: '수배서가 생성되고 수배처에 전송되었습니다.',
            data: assignment,
            assignment_link: `/assignment/${assignment_token}`,
            auto_sent: true
        });
        
    } catch (error) {
        console.error('❌ 수배서 생성 오류:', error);
        console.error('❌ 스택 트레이스:', error.stack);
        res.status(500).json({
            success: false,
            message: '수배서 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약을 수배중으로 전환하는 API (예약관리 → 수배관리)
app.post('/api/reservations/:id/assign', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { vendor_name, notes } = req.body;
        
        console.log(`🔄 예약 수배 전환: ${id} → 수배중 상태로 변경`);
        
        // 예약 상태를 in_progress(수배중)로 변경
        const updateQuery = `
            UPDATE reservations 
            SET payment_status = 'in_progress',
                updated_at = NOW()
            WHERE id = $1 AND payment_status = 'pending'
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '대기중 상태의 예약을 찾을 수 없습니다.'
            });
        }
        
        console.log(`✅ 예약 수배 전환 완료: ${id} (pending → in_progress)`);
        
        res.json({
            success: true,
            message: '예약이 수배중 상태로 전환되었습니다.',
            reservation: result.rows[0],
            workflow: {
                from: 'pending',
                to: 'in_progress',
                page_transfer: '예약관리 → 수배관리'
            }
        });
        
    } catch (error) {
        console.error('예약 수배 전환 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 수배 전환 실패',
            error: error.message
        });
    }
});

// 예약 확정 API (컨펌번호 입력)
app.post('/api/reservations/:id/confirm', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { confirmation_number } = req.body;

        if (!confirmation_number) {
            return res.status(400).json({
                success: false,
                message: '확정번호를 입력해주세요.'
            });
        }

        console.log(`🎯 예약 확정 처리: ID ${id}, 확정번호: ${confirmation_number}`);

        // 예약 상태를 '확정(수배완료)'로 변경
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['confirmed', id]
        );

        // assignments 테이블에 확정번호 저장
        await pool.query(
            `UPDATE assignments 
             SET confirmation_number = $1, status = 'confirmed', response_at = NOW(), updated_at = NOW() 
             WHERE reservation_id = $2`,
            [confirmation_number, id]
        );

        console.log(`✅ 예약 확정 완료: ${confirmation_number}`);

        res.json({
            success: true,
            message: '예약이 확정되었습니다.',
            confirmation_number: confirmation_number
        });

    } catch (error) {
        console.error('❌ 예약 확정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 확정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 생성/전송 API (새로운 시스템)
app.post('/api/reservations/:id/voucher', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { auto_generate, savecard_code } = req.body;

        console.log(`🎫 바우처 생성 시작: 예약 ID ${id}`, { auto_generate, savecard_code });

        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [id]
        );

        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const reservation = reservationResult.rows[0];

        // 이미 바우처가 생성되었는지 확인
        const existingVoucher = await pool.query(
            'SELECT voucher_token FROM assignments WHERE reservation_id = $1 AND voucher_token IS NOT NULL',
            [id]
        );

        let voucher_token;
        let generated_savecard_code = savecard_code;

        if (existingVoucher.rows.length > 0) {
            voucher_token = existingVoucher.rows[0].voucher_token;
            console.log(`📋 기존 바우처 토큰 사용: ${voucher_token}`);
        } else {
            // 새 바우처 토큰 생성
            voucher_token = 'VCH' + Date.now() + Math.random().toString(36).substr(2, 9);
            
            // 세이브카드 코드가 없으면 자동 생성
            if (!generated_savecard_code) {
                const letters = 'abcdefghijklmnopqrstuvwxyz';
                const numbers = '0123456789';
                generated_savecard_code = 
                    letters.charAt(Math.floor(Math.random() * letters.length)) +
                    Array.from({length: 4}, () => numbers.charAt(Math.floor(Math.random() * numbers.length))).join('') +
                    letters.charAt(Math.floor(Math.random() * letters.length));
            }

            // assignments 테이블 업데이트 또는 생성
            const assignmentExists = await pool.query(
                'SELECT id FROM assignments WHERE reservation_id = $1',
                [id]
            );

            if (assignmentExists.rows.length > 0) {
                // 기존 assignment 업데이트
                await pool.query(
                    `UPDATE assignments 
                     SET voucher_token = $1, savecard_code = $2, sent_at = NOW(), updated_at = NOW() 
                     WHERE reservation_id = $3`,
                    [voucher_token, generated_savecard_code, id]
                );
            } else {
                // 새 assignment 생성
                await pool.query(
                    `INSERT INTO assignments (reservation_id, voucher_token, savecard_code, sent_at, created_at, updated_at)
                     VALUES ($1, $2, $3, NOW(), NOW(), NOW())`,
                    [id, voucher_token, generated_savecard_code]
                );
            }

            console.log(`✅ 새 바우처 생성: ${voucher_token}, 세이브카드: ${generated_savecard_code}`);
        }

        // 예약 상태를 '바우처전송완료'로 변경 (자동 생성이 아닌 경우)
        if (!auto_generate) {
            await pool.query(
                'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
                ['voucher_sent', id]
            );
        }

        console.log(`🎫 바우처 링크: ${req.protocol}://${req.get('host')}/voucher/${voucher_token}`);

        res.json({
            success: true,
            message: auto_generate ? '바우처가 자동 생성되었습니다.' : '바우처가 전송되었습니다.',
            voucher_token: voucher_token,
            savecard_code: generated_savecard_code,
            voucher_link: `/voucher/${voucher_token}`,
            voucher: {
                voucher_token: voucher_token,
                savecard_code: generated_savecard_code,
                created_at: new Date(),
                status: 'created'
            }
        });

    } catch (error) {
        console.error('❌ 바우처 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 재전송 API
app.post('/api/reservations/:id/voucher/resend', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔄 바우처 재전송: 예약 ID ${id}`);

        // 예약 정보 및 바우처 토큰 조회
        const result = await pool.query(`
            SELECT r.*, a.voucher_token 
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE r.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const reservation = result.rows[0];

        if (!reservation.voucher_token) {
            return res.status(400).json({
                success: false,
                message: '바우처가 아직 생성되지 않았습니다.'
            });
        }

        // TODO: 실제 바우처 재전송 로직 추가
        console.log(`📧 바우처 재전송 완료: ${reservation.korean_name}`);

        res.json({
            success: true,
            message: '바우처가 재전송되었습니다.',
            voucher_token: reservation.voucher_token
        });

    } catch (error) {
        console.error('❌ 바우처 재전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 재전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산 이관 API
app.post('/api/reservations/:id/settlement', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`💰 정산 이관: 예약 ID ${id}`);

        // 예약 상태를 '정산완료'로 변경 (수배관리에서 제외)
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['settlement_completed', id]
        );

        console.log(`✅ 정산 이관 완료: 예약 ID ${id}`);

        res.json({
            success: true,
            message: '정산관리로 이관되었습니다.'
        });

    } catch (error) {
        console.error('❌ 정산 이관 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 이관 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 수배서 재전송 API
app.post('/api/assignments/:id/resend', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔄 수배서 재전송: Assignment ID ${id}`);

        // 수배서 정보 조회
        const result = await pool.query(
            'SELECT * FROM assignments WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }

        const assignment = result.rows[0];

        // 재전송 시간 업데이트
        await pool.query(
            'UPDATE assignments SET sent_at = NOW(), updated_at = NOW() WHERE id = $1',
            [id]
        );

        // TODO: 실제 수배서 재전송 로직 추가
        console.log(`📧 수배서 재전송 완료: ${assignment.vendor_name}`);

        res.json({
            success: true,
            message: '수배서가 재전송되었습니다.',
            assignment_link: `/assignment/${assignment.assignment_token}`
        });

    } catch (error) {
        console.error('❌ 수배서 재전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배서 재전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산관리 목록 조회 API
app.get('/api/settlements', requireAuth, async (req, res) => {
    try {
        const { page = 1, status = '', search = '' } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        let whereClause = `WHERE r.payment_status IN ('settlement_completed', 'payment_completed')`;
        const queryParams = [];
        let paramIndex = 0;
        
        if (status) {
            paramIndex++;
            whereClause += ` AND r.payment_status = $${paramIndex}`;
            queryParams.push(status);
        }
        
        if (search) {
            paramIndex++;
            whereClause += ` AND (
                r.reservation_number ILIKE $${paramIndex} OR 
                r.product_name ILIKE $${paramIndex} OR 
                r.korean_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
        }
        
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM reservations r
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);
        
        const settlementsQuery = `
            SELECT 
                r.*,
                a.id as assignment_id,
                a.vendor_name,
                a.confirmation_number,
                a.voucher_token
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            ${whereClause}
            ORDER BY r.updated_at DESC, r.created_at DESC
            LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
        `;
        
        queryParams.push(limit, offset);
        const result = await pool.query(settlementsQuery, queryParams);
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.json({
            success: true,
            data: {
                settlements: result.rows,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit
                }
            }
        });
        
    } catch (error) {
        console.error('❌ 정산관리 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산관리 목록을 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 정산 통계 API
app.get('/api/settlements/statistics', requireAuth, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN payment_status = 'settlement_completed' THEN 1 END) as pending,
                COUNT(CASE WHEN payment_status = 'payment_completed' THEN 1 END) as completed,
                COALESCE(SUM(total_amount), 0) as total_amount
            FROM reservations 
            WHERE payment_status IN ('settlement_completed', 'payment_completed')
        `;
        
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];
        
        res.json({
            success: true,
            data: {
                total: parseInt(stats.total),
                pending: parseInt(stats.pending),
                completed: parseInt(stats.completed),
                totalAmount: parseFloat(stats.total_amount)
            }
        });
        
    } catch (error) {
        console.error('❌ 정산 통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 통계를 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 정산 완료 API
app.post('/api/settlements/:id/complete', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['payment_completed', id]
        );
        
        console.log(`✅ 정산 완료: 예약 ID ${id}`);
        
        res.json({
            success: true,
            message: '정산이 완료되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 정산 완료 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 완료 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산관리 페이지 라우트
app.get('/admin/settlement', requireAuth, (req, res) => {
    res.render('admin/settlement');
});


// 수배서 열람 상태 업데이트 API
app.post('/api/assignment/:token/view', async (req, res) => {
    try {
        const { token } = req.params;
        
        const updateQuery = `
            UPDATE assignments 
            SET viewed_at = COALESCE(viewed_at, NOW()),
                status = CASE 
                    WHEN status = 'sent' THEN 'viewed'
                    ELSE status 
                END,
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [token]);
        
        res.json({
            success: true,
            message: '열람 상태가 업데이트되었습니다.'
        });
        
    } catch (error) {
        console.error('열람 상태 업데이트 오류:', error);
        res.status(500).json({
            success: false,
            message: '열람 상태 업데이트 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 확정 API
app.post('/api/assignment/:token/confirm', async (req, res) => {
    try {
        const { token } = req.params;
        const { confirmation_number, cost_price, cost_currency } = req.body;
        
        // 바우처 토큰 생성 (확정번호가 있는 경우)
        let voucher_token = null;
        if (confirmation_number) {
            voucher_token = crypto.randomBytes(16).toString('hex');
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = 'confirmed',
                confirmation_number = $2,
                cost_price = $3,
                cost_currency = $4,
                voucher_token = $5,
                response_at = NOW(),
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [
            token, 
            confirmation_number || null,
            cost_price || null,
            cost_currency || 'USD',
            voucher_token
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        const assignment = result.rows[0];
        
        // 예약 상태도 확정으로 업데이트
        await pool.query(
            'UPDATE reservations SET payment_status = $1 WHERE id = $2',
            ['confirmed', assignment.reservation_id]
        );
        
        res.json({
            success: true,
            message: '수배가 확정되었습니다.',
            voucher_link: voucher_token ? `/voucher/${voucher_token}` : null
        });
        
    } catch (error) {
        console.error('수배 확정 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 확정 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 거절 API
app.post('/api/assignment/:token/reject', async (req, res) => {
    try {
        const { token } = req.params;
        const { rejection_reason } = req.body;
        
        if (!rejection_reason || !rejection_reason.trim()) {
            return res.status(400).json({
                success: false,
                message: '거절 사유는 필수입니다.'
            });
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = 'rejected',
                rejection_reason = $2,
                response_at = NOW(),
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [token, rejection_reason]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '수배가 거절되었습니다.'
        });
        
    } catch (error) {
        console.error('수배 거절 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 거절 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 전송 API
app.post('/api/assignments/:id/send', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 수배서 정보 조회
        const assignmentQuery = 'SELECT * FROM assignments WHERE id = $1';
        const result = await pool.query(assignmentQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        const assignment = result.rows[0];
        
        // 이미 전송된 수배서인지 확인
        if (assignment.status !== 'requested') {
            return res.status(400).json({
                success: false,
                message: '이미 전송된 수배서입니다.'
            });
        }
        
        // 수배서 상태를 전송됨으로 업데이트
        const updateQuery = `
            UPDATE assignments 
            SET status = 'sent', 
                sent_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        
        const updateResult = await pool.query(updateQuery, [id]);
        
        // 실제로는 여기서 이메일이나 SMS 전송 로직이 들어갈 수 있습니다
        // 현재는 상태만 업데이트하고 링크를 제공합니다
        
        const assignmentLink = `${req.protocol}://${req.get('host')}/assignment/${assignment.assignment_token}`;
        
        res.json({
            success: true,
            message: '수배서가 전송되었습니다.',
            assignment_link: assignmentLink,
            data: updateResult.rows[0]
        });
        
    } catch (error) {
        console.error('수배서 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배서 전송 중 오류가 발생했습니다.'
        });
    }
});

// 바우처 페이지 라우트
app.get('/voucher/:token', async (req, res) => {
    try {
        const { token } = req.params;
        
        console.log(`🎫 바우처 페이지 요청: ${token}`);
        
        // 바우처 정보 조회 (새로운 시스템에 맞게 수정)
        const voucherQuery = `
            SELECT 
                r.*,
                a.voucher_token,
                a.confirmation_number,
                a.vendor_name,
                a.vendor_contact,
                a.cost_price,
                a.cost_currency,
                a.response_at,
                a.created_at as voucher_created_at,
                a.sent_at as voucher_sent_at,
                a.viewed_at as voucher_viewed_at,
                a.savecard_code
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE a.voucher_token = $1
        `;
        
        console.log(`🔍 바우처 쿼리 실행: ${token}`);
        const result = await pool.query(voucherQuery, [token]);
        console.log(`📊 쿼리 결과: ${result.rows.length}개 행 반환`);
        
        if (result.rows.length === 0) {
            console.log(`❌ 바우처 토큰 ${token}을 찾을 수 없음`);
            
            // 디버깅: 최근 바우처 토큰들 조회
            try {
                const debugQuery = `
                    SELECT voucher_token, reservation_id, created_at 
                    FROM assignments 
                    WHERE voucher_token IS NOT NULL 
                    ORDER BY created_at DESC 
                    LIMIT 5
                `;
                const debugResult = await pool.query(debugQuery);
                console.log('🔍 최근 바우처 토큰들:', debugResult.rows);
            } catch (debugError) {
                console.error('디버그 쿼리 오류:', debugError);
            }
            
            return res.status(404).render('error', {
                title: '바우처를 찾을 수 없습니다',
                message: `바우처 토큰 "${token}"을 찾을 수 없습니다. 링크를 다시 확인해주세요.`
            });
        }
        
        const data = result.rows[0];
        
        // 바우처 조회 기록 남기기
        try {
            await pool.query(
                'UPDATE assignments SET viewed_at = NOW() WHERE voucher_token = $1 AND viewed_at IS NULL',
                [token]
            );
        } catch (viewError) {
            console.error('바우처 조회 기록 오류:', viewError);
        }
        
        // 바우처 객체 구성
        const voucher = {
            voucher_token: data.voucher_token,
            savecard_code: data.savecard_code || null,
            created_at: data.voucher_created_at,
            sent_at: data.voucher_sent_at,
            viewed_at: data.voucher_viewed_at,
            status: data.voucher_sent_at ? (data.voucher_viewed_at ? 'viewed' : 'sent') : 'created'
        };
        
        // 예약 객체 구성 (새로운 필드명에 맞게 수정)
        const reservation = {
            id: data.id,
            reservation_number: data.reservation_number,
            korean_name: data.korean_name,
            english_name: data.english_name,
            phone: data.phone,
            email: data.email,
            product_name: data.product_name,
            package_type: data.package_type,
            usage_date: data.usage_date,
            usage_time: data.usage_time,
            people_adult: data.people_adult,
            people_child: data.people_child,
            people_infant: data.people_infant,
            memo: data.memo,
            platform_name: data.platform_name,
            vendor_name: data.vendor_name,
            total_price: data.total_price
        };
        
        res.render('voucher', {
            title: `바우처 - ${reservation.korean_name}`,
            voucher,
            reservation
        });
        
    } catch (error) {
        console.error('바우처 페이지 오류:', error);
        res.status(500).render('error', {
            title: '서버 오류',
            message: '바우처를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 수배 상태 업데이트 API
app.patch('/api/assignments/:id/status', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const validStatuses = ['requested', 'assigned', 'in_progress', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 상태입니다.'
            });
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = $1, 
                updated_at = NOW(),
                ${status === 'completed' ? 'completed_at = NOW(),' : ''}
                ${status === 'assigned' ? 'assigned_at = NOW(), assigned_by = $3,' : ''}
            WHERE id = $2
            RETURNING *
        `;
        
        const params = [status, id];
        if (status === 'assigned') {
            params.push(req.session.adminUsername || 'admin');
        }
        
        const result = await pool.query(updateQuery, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '수배 상태가 업데이트되었습니다.',
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('수배 상태 업데이트 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 상태 업데이트 중 오류가 발생했습니다.'
        });
    }
});

// ==================== 서버 시작 ====================

async function startServer() {
    try {
        // 서버 먼저 시작
        const httpServer = app.listen(PORT, () => {
            console.log('✅ 서버 초기화 및 시작 완료');
            console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
            console.log(`관리자 페이지: http://localhost:${PORT}/admin`);
            console.log(`카드 페이지: http://localhost:${PORT}/card`);
        });
        
        // 서버 시작 후 데이터베이스 초기화 (비동기)
        setTimeout(async () => {
            try {
                await initializeDatabase();
                console.log('✅ 데이터베이스 초기화 완료');
            } catch (error) {
                console.error('⚠️ 데이터베이스 초기화 실패 (서버는 계속 실행):', error.message);
            }
        }, 2000);
        
        // ==================== 정산관리 API ====================

        // 정산관리 페이지 라우트
        app.get('/admin/settlements', requireAuth, (req, res) => {
            try {
                console.log('정산관리 페이지 렌더링 시작');
                res.render('admin/settlements', { 
                    title: '정산관리',
                    currentPage: 'settlements',
                    adminUsername: req.session.adminUsername || 'Admin'
                });
                console.log('정산관리 페이지 렌더링 완료');
            } catch (error) {
                console.error('정산관리 페이지 렌더링 오류:', error);
                res.status(500).send(`
                    <h1>정산관리 페이지 오류</h1>
                    <p>페이지를 불러오는 중 오류가 발생했습니다.</p>
                    <p>오류: ${error.message}</p>
                    <a href="/admin">관리자 대시보드로 돌아가기</a>
                `);
            }
        });

        // 정산 통계 API
        app.get('/api/settlements/stats', requireAuth, async (req, res) => {
            try {
                console.log('🔍 정산 통계 API 호출 시작');
                
                // settlement_status 컬럼 존재 여부 확인
                const columnCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                `);
                
                const hasSettlementStatus = columnCheck.rows.length > 0;
                console.log('📋 settlement_status 컬럼 존재:', hasSettlementStatus);
                
                let statsQuery;
                if (hasSettlementStatus) {
                    statsQuery = `
                        SELECT 
                            COALESCE(SUM(CASE WHEN settlement_status = 'settled' THEN sale_amount ELSE 0 END), 0) as total_revenue,
                            COALESCE(SUM(CASE WHEN settlement_status = 'settled' THEN cost_amount ELSE 0 END), 0) as total_cost,
                            COALESCE(SUM(CASE WHEN settlement_status = 'settled' THEN profit_amount ELSE 0 END), 0) as total_profit,
                            COUNT(*) as total_count,
                            COUNT(CASE WHEN settlement_status = 'settled' THEN 1 END) as settled_count
                        FROM reservations 
                        WHERE payment_status = 'voucher_sent' 
                        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
                    `;
                } else {
                    // settlement_status 컬럼이 없을 때 기본 통계
                    statsQuery = `
                        SELECT 
                            COALESCE(SUM(total_amount), 0) as total_revenue,
                            0 as total_cost,
                            COALESCE(SUM(total_amount), 0) as total_profit,
                            COUNT(*) as total_count,
                            0 as settled_count
                        FROM reservations 
                        WHERE payment_status = 'voucher_sent' 
                        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', CURRENT_DATE)
                    `;
                }
                
                const result = await pool.query(statsQuery);
                const stats = result.rows[0];
                
                const profitRate = stats.total_revenue > 0 ? (stats.total_profit / stats.total_revenue * 100) : 0;
                
                res.json({
                    success: true,
                    data: {
                        totalRevenue: parseFloat(stats.total_revenue) || 0,
                        totalCost: parseFloat(stats.total_cost) || 0,
                        totalProfit: parseFloat(stats.total_profit) || 0,
                        profitRate: profitRate,
                        totalCount: parseInt(stats.total_count) || 0,
                        settledCount: parseInt(stats.settled_count) || 0
                    }
                });
                
            } catch (error) {
                console.error('정산 통계 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 통계를 불러올 수 없습니다.'
                });
            }
        });

        // 정산 목록 조회 API
        app.get('/api/settlements', requireAuth, async (req, res) => {
            try {
                console.log('🔍 정산관리 API 호출 시작');
                
                // 먼저 settlement_status 컬럼 존재 여부 확인
                const columnCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                `);
                
                const hasSettlementStatus = columnCheck.rows.length > 0;
                console.log('📋 settlement_status 컬럼 존재:', hasSettlementStatus);
                
                const { page = 1, status = '', month = '', search = '' } = req.query;
                const limit = 20;
                const offset = (page - 1) * limit;
                
                let whereClause = `WHERE r.payment_status = 'voucher_sent'`;
                const queryParams = [];
                let paramIndex = 0;
                
                // 정산 상태 필터 (컬럼이 존재할 때만)
                if (status && hasSettlementStatus) {
                    paramIndex++;
                    if (status === 'pending') {
                        whereClause += ` AND (r.settlement_status IS NULL OR r.settlement_status = 'pending')`;
                    } else {
                        whereClause += ` AND r.settlement_status = $${paramIndex}`;
                        queryParams.push(status);
                    }
                }
                
                // 월별 필터
                if (month) {
                    paramIndex++;
                    whereClause += ` AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', $${paramIndex}::date)`;
                    queryParams.push(month + '-01');
                }
                
                // 검색 필터
                if (search) {
                    paramIndex++;
                    whereClause += ` AND (
                        r.reservation_number ILIKE $${paramIndex} OR 
                        r.product_name ILIKE $${paramIndex} OR 
                        r.korean_name ILIKE $${paramIndex}
                    )`;
                    queryParams.push(`%${search}%`);
                }
                
                // 총 개수 조회
                const countQuery = `
                    SELECT COUNT(*) as total
                    FROM reservations r
                    ${whereClause}
                `;
                
                const countResult = await pool.query(countQuery, queryParams);
                const totalCount = parseInt(countResult.rows[0].total);
                
                // 정산 목록 조회 (인박스와 동일한 실제 컬럼명 사용)
                let listQuery;
                if (hasSettlementStatus) {
                    listQuery = `
                        SELECT 
                            r.*,
                            r.korean_name,
                            r.usage_date as departure_date,
                            COALESCE(r.sale_amount, r.total_amount) as sale_amount,
                            COALESCE(r.cost_amount, 0) as cost_amount,
                            COALESCE(r.profit_amount, COALESCE(r.sale_amount, r.total_amount) - COALESCE(r.cost_amount, 0)) as profit_amount,
                            COALESCE(r.settlement_status, 'pending') as settlement_status
                        FROM reservations r
                        ${whereClause}
                        ORDER BY 
                            CASE WHEN COALESCE(r.settlement_status, 'pending') = 'pending' THEN 0 ELSE 1 END,
                            r.created_at DESC
                        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
                    `;
                } else {
                    // settlement_status 컬럼이 없을 때 기본 쿼리
                    listQuery = `
                        SELECT 
                            r.*,
                            r.korean_name,
                            r.usage_date as departure_date,
                            r.total_amount as sale_amount,
                            0 as cost_amount,
                            r.total_amount as profit_amount,
                            'pending' as settlement_status,
                            NULL as settlement_notes,
                            NULL as settled_at,
                            NULL as settled_by
                        FROM reservations r
                        ${whereClause}
                        ORDER BY r.created_at DESC
                        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
                    `;
                }
                
                queryParams.push(limit, offset);
                const listResult = await pool.query(listQuery, queryParams);
                
                res.json({
                    success: true,
                    data: {
                        settlements: listResult.rows,
                        pagination: {
                            currentPage: parseInt(page),
                            totalPages: Math.ceil(totalCount / limit),
                            total: totalCount,
                            limit: limit
                        }
                    }
                });
                
            } catch (error) {
                console.error('정산 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 목록을 불러올 수 없습니다.'
                });
            }
        });

        // 정산 처리 API
        app.post('/api/settlements/:id/process', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                const { sale_amount, cost_amount, settlement_notes } = req.body;
                
                if (!sale_amount || !cost_amount) {
                    return res.status(400).json({
                        success: false,
                        message: '매출 금액과 매입 금액을 입력해주세요.'
                    });
                }
                
                const profit_amount = sale_amount - cost_amount;
                
                const updateQuery = `
                    UPDATE reservations 
                    SET 
                        sale_amount = $1,
                        cost_amount = $2,
                        profit_amount = $3,
                        settlement_status = 'settled',
                        settlement_notes = $4,
                        settled_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $5 AND payment_status = 'voucher_sent'
                    RETURNING *
                `;
                
                const result = await pool.query(updateQuery, [
                    sale_amount, cost_amount, profit_amount, settlement_notes, id
                ]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '정산 가능한 예약을 찾을 수 없습니다.'
                    });
                }
                
                res.json({
                    success: true,
                    message: '정산이 완료되었습니다.',
                    data: result.rows[0]
                });
                
            } catch (error) {
                console.error('정산 처리 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 처리 중 오류가 발생했습니다.'
                });
            }
        });

        // 정산 내보내기 API
        app.get('/api/settlements/export', requireAuth, async (req, res) => {
            try {
                const { status = '', month = '', search = '' } = req.query;
                
                let whereClause = `WHERE r.payment_status = 'voucher_sent'`;
                const queryParams = [];
                let paramIndex = 0;
                
                // 필터 적용 (위와 동일한 로직)
                if (status) {
                    paramIndex++;
                    if (status === 'pending') {
                        whereClause += ` AND (r.settlement_status IS NULL OR r.settlement_status = 'pending')`;
                    } else {
                        whereClause += ` AND r.settlement_status = $${paramIndex}`;
                        queryParams.push(status);
                    }
                }
                
                if (month) {
                    paramIndex++;
                    whereClause += ` AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', $${paramIndex}::date)`;
                    queryParams.push(month + '-01');
                }
                
                if (search) {
                    paramIndex++;
                    whereClause += ` AND (
                        r.reservation_number ILIKE $${paramIndex} OR 
                        r.product_name ILIKE $${paramIndex} OR 
                        r.korean_name ILIKE $${paramIndex}
                    )`;
                    queryParams.push(`%${search}%`);
                }
                
                const exportQuery = `
                    SELECT 
                        r.reservation_number as "예약번호",
                        r.product_name as "상품명",
                        r.korean_name as "고객명",
                        r.departure_date as "이용일",
                        r.platform_name as "플랫폼",
                        COALESCE(r.sale_amount, r.total_amount) as "매출금액",
                        COALESCE(r.cost_amount, 0) as "매입금액",
                        COALESCE(r.profit_amount, COALESCE(r.sale_amount, r.total_amount) - COALESCE(r.cost_amount, 0)) as "마진",
                        COALESCE(r.settlement_status, 'pending') as "정산상태",
                        r.settlement_notes as "정산메모",
                        r.created_at as "생성일시",
                        r.settled_at as "정산일시"
                    FROM reservations r
                    ${whereClause}
                    ORDER BY r.created_at DESC
                `;
                
                const result = await pool.query(exportQuery, queryParams);
                
                // CSV 헤더 생성
                const headers = Object.keys(result.rows[0] || {});
                let csv = headers.join(',') + '\n';
                
                // CSV 데이터 생성
                result.rows.forEach(row => {
                    const values = headers.map(header => {
                        const value = row[header];
                        if (value === null || value === undefined) return '';
                        if (typeof value === 'string' && value.includes(',')) {
                            return `"${value.replace(/"/g, '""')}"`;
                        }
                        return value;
                    });
                    csv += values.join(',') + '\n';
                });
                
                res.setHeader('Content-Type', 'text/csv; charset=utf-8');
                res.setHeader('Content-Disposition', `attachment; filename="settlements_${new Date().toISOString().slice(0, 10)}.csv"`);
                res.send('\uFEFF' + csv); // UTF-8 BOM 추가
                
            } catch (error) {
                console.error('정산 내보내기 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 내보내기 중 오류가 발생했습니다.'
                });
            }
        });
        
        // ERP 확장 마이그레이션 함수
        async function runERPMigration() {
            try {
                console.log('🔍 ERP 마이그레이션 상태 확인...');
                
                // migration_log 테이블 생성 (없으면)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS migration_log (
                        id SERIAL PRIMARY KEY,
                        version VARCHAR(10) UNIQUE NOT NULL,
                        description TEXT,
                        executed_at TIMESTAMP DEFAULT NOW()
                    )
                `);
                
                // 마이그레이션 003 실행 여부 확인 (버전 업데이트)
                const migrationCheck = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['003']
                ).catch(() => ({ rows: [] }));
                
                if (migrationCheck.rows.length > 0) {
                    console.log('✅ ERP 마이그레이션 003은 이미 완료되었습니다.');
                    
                    // 테이블 존재 확인
                    const tableCheck = await pool.query(`
                        SELECT table_name 
                        FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name IN ('field_defs', 'reservation_audits', 'assignments', 'settlements')
                    `);
                    
                    if (tableCheck.rows.length < 4) {
                        console.log('⚠️ 일부 테이블이 누락됨. 마이그레이션 재실행...');
                        // 마이그레이션 로그 삭제하고 재실행
                        await pool.query('DELETE FROM migration_log WHERE version = $1', ['003']);
                    } else {
                        console.log('📊 모든 ERP 테이블 확인됨:', tableCheck.rows.map(r => r.table_name));
                        
                        // 마이그레이션 004 (정산 필드) 확인 및 실행
                        await runSettlementMigration();
                        return;
                    }
                }
                
                console.log('🚀 ERP 마이그레이션 003 실행 중... (reservation_id 호환성 개선)');
                
                await pool.query('BEGIN');
                
                // 1. extras JSONB 컬럼 추가
                await pool.query(`
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'extras'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN extras JSONB DEFAULT '{}';
                            CREATE INDEX IF NOT EXISTS idx_reservations_extras_gin ON reservations USING GIN (extras);
                        END IF;
                    END $$;
                `);
                
                // 2. field_defs 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS field_defs (
                        id SERIAL PRIMARY KEY,
                        field_key VARCHAR(100) NOT NULL UNIQUE,
                        field_name VARCHAR(200) NOT NULL,
                        field_type VARCHAR(50) NOT NULL DEFAULT 'text',
                        field_group VARCHAR(100) DEFAULT 'general',
                        validation_rules JSONB DEFAULT '{}',
                        ui_config JSONB DEFAULT '{}',
                        is_required BOOLEAN DEFAULT false,
                        is_active BOOLEAN DEFAULT true,
                        sort_order INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // 3. reservation_audits 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS reservation_audits (
                        id SERIAL PRIMARY KEY,
                        reservation_id INTEGER NOT NULL,
                        action VARCHAR(50) NOT NULL,
                        changed_by VARCHAR(100) NOT NULL,
                        changed_at TIMESTAMP DEFAULT NOW(),
                        old_values JSONB,
                        new_values JSONB,
                        diff JSONB,
                        ip_address INET,
                        user_agent TEXT,
                        notes TEXT
                    );
                `);
                
                // 인덱스는 별도로 생성 (reservation_audits 테이블과 컬럼 존재 확인 후)
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- reservation_audits 테이블과 reservation_id 컬럼 존재 확인
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservation_audits' AND column_name = 'reservation_id'
                        ) THEN
                            -- reservation_id 컬럼이 존재하면 인덱스 생성
                            CREATE INDEX IF NOT EXISTS idx_reservation_audits_reservation_id ON reservation_audits(reservation_id);
                        END IF;
                        
                        -- changed_at 컬럼 존재 확인 후 인덱스 생성
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservation_audits' AND column_name = 'changed_at'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_reservation_audits_changed_at ON reservation_audits(changed_at);
                        END IF;
                    END $$;
                `);
                
                // 4. assignments 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS assignments (
                        id SERIAL PRIMARY KEY,
                        reservation_id INTEGER NOT NULL,
                        vendor_id INTEGER,
                        vendor_name VARCHAR(200),
                        vendor_contact JSONB,
                        assignment_type VARCHAR(100) DEFAULT 'general',
                        status VARCHAR(50) DEFAULT 'requested',
                        cost_price DECIMAL(10,2),
                        cost_currency VARCHAR(3) DEFAULT 'USD',
                        voucher_number VARCHAR(100),
                        voucher_url TEXT,
                        voucher_issued_at TIMESTAMP,
                        notes TEXT,
                        assigned_by VARCHAR(100),
                        assigned_at TIMESTAMP,
                        completed_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // assignments 테이블에 vendor_id 컬럼 추가 (기존 테이블에 없는 경우)
                await pool.query(`
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'vendor_id'
                        ) THEN
                            ALTER TABLE assignments ADD COLUMN vendor_id INTEGER;
                        END IF;
                    END $$;
                `);
                
                // assignments 인덱스 별도 생성
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- assignments 테이블과 reservation_id 컬럼 존재 확인
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'reservation_id'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_assignments_reservation_id ON assignments(reservation_id);
                        END IF;
                        
                        -- status 컬럼 존재 확인 후 인덱스 생성
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'status'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
                        END IF;
                    END $$;
                `);
                
                // 5. vendors 테이블 생성 (수배업체 관리)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS vendors (
                        id SERIAL PRIMARY KEY,
                        vendor_name VARCHAR(100) NOT NULL UNIQUE,
                        vendor_id VARCHAR(50) NOT NULL UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        email VARCHAR(100) NOT NULL,
                        phone VARCHAR(20),
                        contact_person VARCHAR(50),
                        business_type VARCHAR(50),
                        description TEXT,
                        notification_email VARCHAR(100),
                        is_active BOOLEAN DEFAULT true,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // 6. vendor_products 테이블 생성 (업체별 담당 상품 매핑)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS vendor_products (
                        id SERIAL PRIMARY KEY,
                        vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                        product_keyword VARCHAR(100) NOT NULL,
                        priority INTEGER DEFAULT 1,
                        is_active BOOLEAN DEFAULT true,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(vendor_id, product_keyword)
                    );
                `);
                
                // 7. settlements 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS settlements (
                        id SERIAL PRIMARY KEY,
                        settlement_period VARCHAR(20) NOT NULL,
                        reservation_id INTEGER,
                        total_sales DECIMAL(12,2) DEFAULT 0.00,
                        total_purchases DECIMAL(12,2) DEFAULT 0.00,
                        gross_margin DECIMAL(12,2) DEFAULT 0.00,
                        margin_rate DECIMAL(5,2) DEFAULT 0.00,
                        currency VARCHAR(3) DEFAULT 'USD',
                        status VARCHAR(50) DEFAULT 'draft',
                        settlement_date DATE,
                        payment_date DATE,
                        notes TEXT,
                        created_by VARCHAR(100),
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                    CREATE INDEX IF NOT EXISTS idx_settlements_settlement_period ON settlements(settlement_period);
                `);
                
                // 6. 기본 field_defs 데이터 삽입 (테이블 존재 확인 후)
                const fieldDefsCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'field_defs' AND column_name = 'field_key'
                `);
                
                if (fieldDefsCheck.rows.length > 0) {
                    await pool.query(`
                        INSERT INTO field_defs (field_key, field_name, field_type, field_group, validation_rules, ui_config, is_required, sort_order)
                        VALUES 
                            ('special_requests', '특별 요청사항', 'textarea', 'booking', '{"maxLength": 1000}', '{"placeholder": "특별한 요청사항이 있으시면 입력해주세요", "rows": 3}', false, 10),
                            ('dietary_restrictions', '식이 제한사항', 'text', 'traveler', '{"maxLength": 200}', '{"placeholder": "알레르기, 채식주의 등"}', false, 20),
                            ('emergency_contact', '비상 연락처', 'text', 'traveler', '{"pattern": "^[0-9+\\\\-\\\\s()]+$"}', '{"placeholder": "+82-10-1234-5678"}', false, 30),
                            ('tour_guide_language', '가이드 언어', 'select', 'service', '{}', '{"options": ["한국어", "영어", "일본어", "중국어"]}', false, 40),
                            ('pickup_location_detail', '픽업 위치 상세', 'text', 'service', '{"maxLength": 300}', '{"placeholder": "호텔 로비, 특정 위치 등"}', false, 50),
                            ('internal_notes', '내부 메모', 'textarea', 'internal', '{"maxLength": 2000}', '{"placeholder": "내부 직원용 메모", "rows": 4}', false, 100)
                        ON CONFLICT (field_key) DO NOTHING;
                    `);
                    console.log('✅ field_defs 기본 데이터 삽입 완료');
                } else {
                    console.log('⚠️ field_defs 테이블의 field_key 컬럼이 존재하지 않음 - 데이터 삽입 건너뜀');
                }
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['003', 'ERP 확장 v2: reservation_id 호환성 개선, 안전한 인덱스 생성']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ ERP 마이그레이션 003 완료! (reservation_id 호환성 개선)');
                
                // 생성된 테이블 확인
                const tables = await pool.query(`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name IN ('field_defs', 'reservation_audits', 'assignments', 'settlements')
                    ORDER BY table_name
                `);
                
                console.log('📊 ERP 테이블들:');
                tables.rows.forEach(row => {
                    console.log(`   ✓ ${row.table_name}`);
                });
                
                // 마이그레이션 003 완료 후 정산 마이그레이션 004 실행
                await runSettlementMigration();
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ ERP 마이그레이션 실패:', error);
                // 마이그레이션 실패해도 서버는 계속 실행
            }
        }

        // 정산 필드 마이그레이션 함수 (마이그레이션 004)
        async function runSettlementMigration() {
            try {
                console.log('🔍 정산 필드 마이그레이션 004 상태 확인...');
                
                // 마이그레이션 004 실행 여부 확인
                const migration004Check = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['004']
                ).catch(() => ({ rows: [] }));
                
                // 환경변수로 마이그레이션 강제 실행 가능
                const forceMigration = process.env.FORCE_MIGRATION === 'true';
                
                if (migration004Check.rows.length > 0 && !forceMigration) {
                    console.log('✅ 정산 필드 마이그레이션 004는 이미 완료되었습니다.');
                    return;
                }
                
                if (forceMigration) {
                    console.log('🔄 FORCE_MIGRATION=true 감지 - 마이그레이션 004 강제 재실행');
                    // 기존 마이그레이션 로그 삭제
                    await pool.query('DELETE FROM migration_log WHERE version = $1', ['004']);
                }
                
                console.log('🚀 정산 필드 마이그레이션 004 실행 중...');
                
                await pool.query('BEGIN');
                
                // 정산 관련 컬럼들 추가
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- 매출 금액 (고객이 지불한 금액)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'sale_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN sale_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 매입 금액 (수배업체에 지불할 금액)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'cost_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN cost_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 마진 (매출 - 매입)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'profit_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN profit_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 정산 상태 (pending, settled, overdue)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settlement_status VARCHAR(20) DEFAULT 'pending';
                        END IF;
                        
                        -- 정산 메모
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settlement_notes'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settlement_notes TEXT;
                        END IF;
                        
                        -- 정산 완료 일시
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settled_at'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settled_at TIMESTAMP;
                        END IF;
                        
                        -- 정산 담당자
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settled_by'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settled_by VARCHAR(100);
                        END IF;
                    END $$;
                `);
                
                // 인덱스 추가 (성능 최적화)
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_reservations_settlement_status ON reservations(settlement_status);
                    CREATE INDEX IF NOT EXISTS idx_reservations_settled_at ON reservations(settled_at);
                    CREATE INDEX IF NOT EXISTS idx_reservations_payment_settlement ON reservations(payment_status, settlement_status);
                `);
                
                // 기존 바우처 전송 완료 예약들의 정산 상태 초기화
                const updateQuery = `
                    UPDATE reservations 
                    SET settlement_status = 'pending',
                        sale_amount = COALESCE(total_amount, 0)
                    WHERE payment_status = 'voucher_sent' 
                    AND settlement_status IS NULL
                `;
                
                const result = await pool.query(updateQuery);
                console.log(`✅ 기존 예약 ${result.rowCount}건의 정산 상태 초기화 완료`);
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['004', '정산관리 필드 추가: sale_amount, cost_amount, profit_amount, settlement_status 등']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 정산 필드 마이그레이션 004 완료!');
                
                // 현재 정산 대상 예약 수 확인
                const countQuery = `
                    SELECT 
                        COUNT(*) as total_voucher_sent,
                        COUNT(CASE WHEN settlement_status = 'pending' THEN 1 END) as pending_settlement,
                        COUNT(CASE WHEN settlement_status = 'settled' THEN 1 END) as settled
                    FROM reservations 
                    WHERE payment_status = 'voucher_sent'
                `;
                
                const countResult = await pool.query(countQuery);
                const stats = countResult.rows[0];
                
                console.log('📊 정산 현황:');
                console.log(`   - 바우처 전송 완료: ${stats.total_voucher_sent}건`);
                console.log(`   - 정산 대기: ${stats.pending_settlement}건`);
                console.log(`   - 정산 완료: ${stats.settled}건`);
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 정산 필드 마이그레이션 실패:', error);
                throw error;
            }
        }

        // 예약 ID로 수배서 정보 조회 API
        app.get('/api/assignments/by-reservation/:reservationId', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                console.log('📋 수배서 정보 조회 요청:', reservationId);
                
                const result = await pool.query(`
                    SELECT a.*, v.vendor_name, v.email as vendor_email
                    FROM assignments a
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE a.reservation_id = $1
                    ORDER BY a.assigned_at DESC
                    LIMIT 1
                `, [reservationId]);
                
                if (result.rows.length > 0) {
                    res.json({
                        success: true,
                        assignment: result.rows[0],
                        assignment_token: result.rows[0].assignment_token
                    });
                } else {
                    res.json({
                        success: false,
                        message: '수배서를 찾을 수 없습니다',
                        assignment: null
                    });
                }
                
            } catch (error) {
                console.error('❌ 수배서 정보 조회 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '수배서 정보 조회 중 오류가 발생했습니다: ' + error.message
                });
            }
        });

        // 수배서 워드파일 다운로드 API
        app.get('/api/assignments/:reservationId/download/word', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                console.log('📄 워드파일 다운로드 요청:', reservationId);
                
                // 예약 정보 조회
                const reservation = await pool.query(`
                    SELECT * FROM reservations WHERE id = $1
                `, [reservationId]);
                
                if (reservation.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservationData = reservation.rows[0];
                
                // 워드 문서 생성 (간단한 HTML 형태로)
                const wordContent = generateWordContent(reservationData);
                
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                res.setHeader('Content-Disposition', `attachment; filename="수배서_${reservationId}.docx"`);
                
                // 실제로는 docx 라이브러리를 사용해야 하지만, 여기서는 HTML을 반환
                res.send(wordContent);
                
            } catch (error) {
                console.error('❌ 워드파일 다운로드 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '워드파일 생성 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 수배서 PDF 다운로드 API
        app.get('/api/assignments/:reservationId/download/pdf', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                console.log('📄 PDF 다운로드 요청:', reservationId);
                
                // 예약 정보 조회
                const reservation = await pool.query(`
                    SELECT * FROM reservations WHERE id = $1
                `, [reservationId]);
                
                if (reservation.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservationData = reservation.rows[0];
                
                // PDF 생성 (puppeteer 등을 사용해야 하지만 여기서는 간단히)
                const pdfContent = generatePdfContent(reservationData);
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="수배서_${reservationId}.pdf"`);
                
                res.send(pdfContent);
                
            } catch (error) {
                console.error('❌ PDF 다운로드 오류:', error);
                res.status(500).json({
                    success: false,
                    message: 'PDF 생성 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 수배업체 메일 전송 API
        app.post('/api/assignments/:reservationId/send-email', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                const { assignment_url, message } = req.body;
                
                console.log('📧 수배업체 메일 전송 요청:', reservationId);
                
                // 예약 정보 및 수배업체 정보 조회
                const result = await pool.query(`
                    SELECT r.*, v.email as vendor_email, v.vendor_name
                    FROM reservations r
                    LEFT JOIN assignments a ON r.id = a.reservation_id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE r.id = $1
                `, [reservationId]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservation = result.rows[0];
                
                // 메일 전송 (nodemailer 설정이 있다면)
                if (process.env.SMTP_HOST) {
                    const nodemailer = require('nodemailer');
                    
                    const transporter = nodemailer.createTransporter({
                        host: process.env.SMTP_HOST,
                        port: process.env.SMTP_PORT || 587,
                        secure: false,
                        auth: {
                            user: process.env.SMTP_USER,
                            pass: process.env.SMTP_PASS
                        }
                    });
                    
                    const mailOptions = {
                        from: process.env.SMTP_FROM || 'noreply@guamsavecard.com',
                        to: reservation.vendor_email || 'vendor@example.com',
                        subject: `[괌세이브카드] 수배서 - ${reservation.reservation_number}`,
                        html: `
                            <h2>수배서 확인 요청</h2>
                            <p>안녕하세요, ${reservation.vendor_name || '수배업체'} 담당자님</p>
                            <p>새로운 수배서가 도착했습니다.</p>
                            
                            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
                                <h3>예약 정보</h3>
                                <p><strong>예약번호:</strong> ${reservation.reservation_number}</p>
                                <p><strong>예약자명:</strong> ${reservation.korean_name}</p>
                                <p><strong>상품명:</strong> ${reservation.product_name}</p>
                                <p><strong>사용일자:</strong> ${reservation.usage_date}</p>
                                <p><strong>인원:</strong> 성인 ${reservation.people_adult || 0}명, 아동 ${reservation.people_child || 0}명</p>
                            </div>
                            
                            <p><a href="${assignment_url}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">수배서 확인하기</a></p>
                            
                            <p>${message}</p>
                            
                            <hr>
                            <p><small>괌세이브카드 수배관리시스템</small></p>
                        `
                    };
                    
                    await transporter.sendMail(mailOptions);
                }
                
                // 전송 로그 기록
                await pool.query(`
                    INSERT INTO assignment_logs (reservation_id, action_type, details, created_at)
                    VALUES ($1, $2, $3, NOW())
                `, [reservationId, 'email_sent', '수배업체 메일 전송']);
                
                res.json({
                    success: true,
                    message: '수배업체로 메일이 전송되었습니다'
                });
                
            } catch (error) {
                console.error('❌ 메일 전송 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '메일 전송 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 워드 문서 내용 생성 함수
        function generateWordContent(reservation) {
            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>수배서</title>
                    <style>
                        body { font-family: 'Malgun Gothic', sans-serif; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .info-table { width: 100%; border-collapse: collapse; }
                        .info-table th, .info-table td { 
                            border: 1px solid #ddd; 
                            padding: 8px; 
                            text-align: left; 
                        }
                        .info-table th { background-color: #f5f5f5; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>수 배 서</h1>
                        <p>괌세이브카드</p>
                    </div>
                    
                    <table class="info-table">
                        <tr><th>예약번호</th><td>${reservation.reservation_number || '-'}</td></tr>
                        <tr><th>예약자명</th><td>${reservation.korean_name || '-'}</td></tr>
                        <tr><th>고객연락처</th><td>${reservation.phone || '-'}</td></tr>
                        <tr><th>업체명</th><td>${reservation.platform_name || '-'}</td></tr>
                        <tr><th>상품명</th><td>${reservation.product_name || '-'}</td></tr>
                        <tr><th>패키지(옵션명)</th><td>${reservation.package_type || '-'}</td></tr>
                        <tr><th>사용일자</th><td>${reservation.usage_date || '-'}</td></tr>
                        <tr><th>인원</th><td>성인 ${reservation.people_adult || 0}명, 아동 ${reservation.people_child || 0}명</td></tr>
                        <tr><th>메모</th><td>${reservation.memo || '-'}</td></tr>
                    </table>
                    
                    <div style="margin-top: 30px;">
                        <p>위 내용으로 수배를 요청드립니다.</p>
                        <p>확인 후 회신 부탁드립니다.</p>
                    </div>
                </body>
                </html>
            `;
        }
        
        // PDF 내용 생성 함수 (실제로는 puppeteer 등 필요)
        function generatePdfContent(reservation) {
            // 실제 구현에서는 puppeteer나 다른 PDF 생성 라이브러리 사용
            return Buffer.from('PDF 생성 기능은 추후 구현 예정입니다.');
        }

        // ERP 마이그레이션도 비동기로 실행
        setTimeout(async () => {
            try {
                await runERPMigration();
                console.log('✅ ERP 마이그레이션 완료');
            } catch (error) {
                console.error('⚠️ ERP 마이그레이션 실패 (서버는 계속 실행):', error.message);
            }
        }, 5000);
        
        return httpServer;
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// 서버 시작 및 에러 핸들링
startServer().then(serverInstance => {
    console.log('✅ 서버 초기화 및 시작 완료');
    
    serverInstance.on('error', (error) => {
        console.error('❌ 서버 오류:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`포트 ${PORT}가 이미 사용 중입니다.`);
        }
        process.exit(1);
    });
    
    // 프로세스 종료 시 정리
    process.on('SIGTERM', () => {
        console.log('🔄 SIGTERM 신호 수신, 서버 종료 중...');
        serverInstance.close(() => {
            console.log('✅ 서버가 정상적으로 종료되었습니다.');
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('🔄 SIGINT 신호 수신, 서버 종료 중...');
        serverInstance.close(() => {
            console.log('✅ 서버가 정상적으로 종료되었습니다.');
            process.exit(0);
        });
    });
    
}).catch(error => {
    console.error('❌ 서버 초기화 실패:', error);
    process.exit(1);
});
