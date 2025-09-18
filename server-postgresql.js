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
require('dotenv').config();

// PostgreSQL 또는 JSON 데이터베이스 선택
const { pool, dbMode, testConnection, createTables, ensureAllColumns, migrateFromJSON } = require('./database');
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

// 관리자 제휴업체
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const stores = await dbHelpers.getStores();
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('제휴업체 관리 페이지 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: [],
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

// 제휴 신청 페이지
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
            stores,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('제휴업체 관리 페이지 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            adminUsername: req.session.adminUsername || 'admin',
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
        
        // 2. reservation_schedules 테이블에 일정 정보 저장
        if (parsedData.usage_date || parsedData.usage_time || parsedData.package_type) {
            await client.query(`
                INSERT INTO reservation_schedules (
                    reservation_id, usage_date, usage_time, package_type, package_count
                ) VALUES ($1, $2, $3, $4, $5)
            `, [
                reservationId,
                parsedData.usage_date,
                parsedData.usage_time,
                parsedData.package_type,
                parsedData.package_count || 1
            ]);
        }
        
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

// 예약 상세 조회 (6개 테이블 JOIN)
async function getReservationById(reservationId) {
    try {
        const result = await pool.query(`
            SELECT 
                r.reservation_id,
                r.reservation_code,
                r.reservation_channel,
                r.platform_name,
                r.reservation_status,
                r.reservation_datetime,
                r.product_name,
                r.total_quantity,
                r.total_price,
                r.created_at,
                r.updated_at,
                
                s.usage_date,
                s.usage_time,
                s.package_type,
                s.package_count,
                
                c.name_kr,
                c.name_en_first,
                c.name_en_last,
                c.phone,
                c.email,
                c.kakao_id,
                c.people_adult,
                c.people_child,
                c.people_infant,
                c.memo,
                
                p.adult_unit_price,
                p.child_unit_price,
                p.infant_unit_price,
                p.platform_sale_amount,
                p.platform_settlement_amount,
                p.payment_status,
                p.payment_date,
                
                pol.policy_text
                
            FROM reservations r
            LEFT JOIN reservation_schedules s ON r.reservation_id = s.reservation_id
            LEFT JOIN reservation_customers c ON r.reservation_id = c.reservation_id
            LEFT JOIN reservation_payments p ON r.reservation_id = p.reservation_id
            LEFT JOIN cancellation_policies pol ON r.reservation_id = pol.reservation_id
            WHERE r.reservation_id = $1
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
        
        // 2. reservation_schedules 테이블 업데이트
        await client.query(`
            UPDATE reservation_schedules SET
                usage_date = $2,
                usage_time = $3
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.usage_date,
            updateData.usage_time
        ]);
        
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

// 예약 관리 페이지
app.get('/admin/reservations', requireAuth, async (req, res) => {
    try {
        console.log('📋 예약 관리 페이지 접근 시도');
        console.log('🔍 dbMode:', dbMode);
        
        if (dbMode === 'postgresql') {
            // 테이블 존재 확인
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'reservations'
            `);
            
            console.log('📊 reservations 테이블 존재 여부:', tableCheck.rows.length > 0);
            
            if (tableCheck.rows.length === 0) {
                console.log('⚠️ reservations 테이블이 존재하지 않음');
                return res.render('admin/reservations', {
                    title: '예약 관리',
                    adminUsername: req.session.adminUsername || 'admin',
                    stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0 },
                    reservations: []
                });
            }
            
            // 통계 쿼리 (안전한 방식)
            let stats = { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0 };
            try {
                const statsQuery = await pool.query(`
                    SELECT 
                        COUNT(*) as total_reservations,
                        COUNT(CASE WHEN code_issued = true THEN 1 END) as code_issued,
                        COUNT(CASE WHEN code_issued = false OR code_issued IS NULL THEN 1 END) as pending_codes,
                        COUNT(DISTINCT COALESCE(platform_name, 'NOL')) as companies
                    FROM reservations
                `);
                stats = statsQuery.rows[0];
                console.log('📊 통계 쿼리 성공:', stats);
            } catch (statsError) {
                console.error('⚠️ 통계 쿼리 오류:', statsError.message);
            }
            
            // 예약 목록 쿼리 (안전한 방식)
            let reservations = [];
            try {
                const reservationsQuery = await pool.query(`
                    SELECT 
                        id,
                        reservation_number,
                        COALESCE(channel, '웹') as channel,
                        COALESCE(platform_name, 'NOL') as platform_name,
                        product_name,
                        korean_name,
                        COALESCE(COALESCE(english_first_name, '') || ' ' || COALESCE(english_last_name, ''), '') as english_name,
                        phone,
                        email,
                        kakao_id,
                        usage_date,
                        usage_time,
                        COALESCE(guest_count, 1) as guest_count,
                        COALESCE(people_adult, 1) as people_adult,
                        COALESCE(people_child, 0) as people_child,
                        COALESCE(people_infant, 0) as people_infant,
                        package_type,
                        total_amount,
                        COALESCE(adult_unit_price, 0) as adult_unit_price,
                        COALESCE(child_unit_price, 0) as child_unit_price,
                        COALESCE(payment_status, '대기') as payment_status,
                        COALESCE(code_issued, false) as code_issued,
                        code_issued_at,
                        memo,
                        created_at
                    FROM reservations 
                    ORDER BY created_at DESC 
                    LIMIT 50
                `);
                reservations = reservationsQuery.rows;
                console.log('📋 예약 목록 쿼리 성공, 개수:', reservations.length);
            } catch (listError) {
                console.error('⚠️ 예약 목록 쿼리 오류:', listError.message);
            }
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                reservations: reservations
            });
        } else {
            console.log('📁 JSON 모드로 실행 중');
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0 },
                reservations: []
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
            
            const values = [
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
                
                res.json({
                    success: true,
                    message: '예약이 성공적으로 등록되었습니다.',
                    reservation_id: result.rows[0].id,
                    parsed_data: parsedData
                });
            } catch (dbError) {
                if (dbError.code === '23505' && dbError.constraint === 'reservations_reservation_number_key') {
                    // 예약번호 중복 시 새로운 번호로 재시도
                    console.log('⚠️ 예약번호 중복 감지, 새 번호로 재시도...');
                    parsedData.reservation_number = `RETRY_${Date.now()}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                    values[0] = parsedData.reservation_number;
                    
                    const retryResult = await pool.query(insertQuery, values);
                    res.json({
                        success: true,
                        message: '예약이 성공적으로 등록되었습니다. (예약번호 자동 변경)',
                        reservation_id: retryResult.rows[0].id,
                        parsed_data: parsedData
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
        
        // OpenAI 지능형 텍스트 파싱
        console.log('🤖 OpenAI 파싱 시작...');
        let parsedData;
        let parsingMethod = 'OpenAI';
        
        try {
            parsedData = await parseReservationToJSON(reservationText);
            console.log('✅ OpenAI 파싱 성공');
            parsingMethod = 'OpenAI';
        } catch (error) {
            console.error('❌ OpenAI 파싱 실패:', error.message);
            // OpenAI 실패 시 로컬 파싱으로 폴백
            console.log('🔄 로컬 파싱으로 폴백...');
            parsedData = parseReservationToJSONLocal(reservationText);
            parsingMethod = '로컬';
        }
        
        // 파싱 방법 추가
        parsedData.parsing_method = parsingMethod;
        
        // 부분 데이터 허용 - 확인된 정보만으로도 등록 가능
        console.log('📊 파싱된 데이터 확인:', {
            reservation_number: parsedData.reservation_number,
            korean_name: parsedData.korean_name,
            english_first_name: parsedData.english_first_name,
            product_name: parsedData.product_name,
            usage_date: parsedData.usage_date,
            total_amount: parsedData.total_amount
        });
        
        // 최소한의 데이터라도 있으면 등록 진행
        let hasMinimumData = false;
        const availableData = [];
        
        if (parsedData.reservation_number) {
            hasMinimumData = true;
            availableData.push('예약번호');
        }
        
        if (parsedData.korean_name || parsedData.english_first_name) {
            hasMinimumData = true;
            availableData.push('예약자명');
        }
        
        if (parsedData.product_name) {
            hasMinimumData = true;
            availableData.push('상품명');
        }
        
        if (parsedData.usage_date) {
            hasMinimumData = true;
            availableData.push('이용일');
        }
        
        if (parsedData.total_amount) {
            hasMinimumData = true;
            availableData.push('금액');
        }
        
        if (parsedData.phone || parsedData.email) {
            hasMinimumData = true;
            availableData.push('연락처');
        }
        
        // 아무 데이터도 없는 경우에만 실패
        if (!hasMinimumData) {
            return res.json({ 
                success: false, 
                message: '파싱 가능한 예약 정보를 찾을 수 없습니다. 예약번호, 예약자명, 상품명 중 하나 이상이 필요합니다.',
                parsed_data: parsedData
            });
        }
        
        // 부족한 정보는 기본값으로 보완 (파싱 품질에 따른 처리)
        if (!parsedData.reservation_number) {
            if (parsedData.parsing_confidence === 'high') {
                parsedData.reservation_number = 'HIGH_' + Date.now().toString().slice(-8);
            } else {
                parsedData.reservation_number = 'AUTO_' + Date.now().toString().slice(-8);
            }
            console.log('⚠️ 예약번호 자동 생성:', parsedData.reservation_number);
        }
        
        if (!parsedData.korean_name && !parsedData.english_first_name) {
            parsedData.korean_name = '예약자명 미확인';
            console.log('⚠️ 예약자명 기본값 설정');
        }
        
        if (!parsedData.product_name) {
            parsedData.product_name = '상품명 미확인';
            console.log('⚠️ 상품명 기본값 설정');
        }
        
        console.log(`✅ 부분 데이터로 예약 등록 진행 (확인된 정보: ${availableData.join(', ')})`);
        
        // 단일 테이블 구조에 맞게 데이터 매핑
        const reservationData = {
            reservation_number: parsedData.reservation_number,
            channel: parsedData.channel || '웹',
            platform_name: parsedData.platform_name || 'NOL',
            product_name: parsedData.product_name,
            korean_name: parsedData.korean_name,
            english_first_name: parsedData.english_first_name,
            english_last_name: parsedData.english_last_name,
            phone: parsedData.phone,
            email: parsedData.email,
            kakao_id: parsedData.kakao_id,
            usage_date: parsedData.usage_date,
            usage_time: parsedData.usage_time,
            guest_count: parsedData.guest_count || 1,
            people_adult: parsedData.people_adult || 1,
            people_child: parsedData.people_child || 0,
            people_infant: parsedData.people_infant || 0,
            package_type: parsedData.package_type,
            total_amount: parsedData.total_amount,
            adult_unit_price: parsedData.adult_unit_price,
            child_unit_price: parsedData.child_unit_price,
            payment_status: parsedData.payment_status || '대기',
            code_issued: false,
            memo: parsedData.memo
        };
        
        // 단일 테이블에 데이터 저장 (PostgreSQL)
        if (dbMode === 'postgresql') {
            try {
                const insertQuery = `
                    INSERT INTO reservations (
                        reservation_number, channel, platform_name, product_name,
                        korean_name, english_first_name, english_last_name,
                        phone, email, kakao_id, usage_date, usage_time,
                        guest_count, people_adult, people_child, people_infant,
                        package_type, total_amount, adult_unit_price, child_unit_price,
                        payment_status, code_issued, memo, created_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                        $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW()
                    ) RETURNING id
                `;
                
                const values = [
                    reservationData.reservation_number,
                    reservationData.channel,
                    reservationData.platform_name,
                    reservationData.product_name,
                    reservationData.korean_name,
                    reservationData.english_first_name,
                    reservationData.english_last_name,
                    reservationData.phone,
                    reservationData.email,
                    reservationData.kakao_id,
                    reservationData.usage_date,
                    reservationData.usage_time,
                    reservationData.guest_count,
                    reservationData.people_adult,
                    reservationData.people_child,
                    reservationData.people_infant,
                    reservationData.package_type,
                    reservationData.total_amount,
                    reservationData.adult_unit_price,
                    reservationData.child_unit_price,
                    reservationData.payment_status,
                    reservationData.code_issued,
                    reservationData.memo
                ];
                
                const result = await pool.query(insertQuery, values);
                const reservationId = result.rows[0].id;
                
                console.log(`✅ 예약 등록 성공 (ID: ${reservationId})`);
                
                res.json({
                    success: true,
                    message: `예약이 성공적으로 등록되었습니다. (확인된 정보: ${availableData.join(', ')})`,
                    reservation_id: reservationId,
                    parsed_data: reservationData,
                    parsing_method: parsingMethod,
                    available_data: availableData
                });
                
            } catch (dbError) {
                console.error('데이터베이스 저장 오류:', dbError);
                res.json({
                    success: false,
                    message: '데이터베이스 저장 중 오류가 발생했습니다: ' + dbError.message,
                    parsed_data: reservationData
                });
            }
        } else {
            res.json({
                success: false,
                message: 'PostgreSQL 모드가 아닙니다.',
                parsed_data: reservationData
            });
        }
        
    } catch (error) {
        console.error('예약 파싱 및 저장 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 처리 중 오류가 발생했습니다: ' + error.message 
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

// 예약 수정 API
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

// ==================== 서버 시작 ====================

// 데이터베이스 초기화 후 서버 시작
async function startServer() {
    try {
        await initializeDatabase();
        
        const server = app.listen(PORT, () => {
            console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
            console.log(`📊 관리자 페이지: http://localhost:${PORT}/admin`);
            console.log(`💳 카드 페이지: http://localhost:${PORT}/card`);
        });
        
        return server;
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
