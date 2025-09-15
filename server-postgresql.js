const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
// nodemailer 제거됨
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
const PORT = process.env.PORT || 3000;

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

// 데이터베이스 연결 테스트 라우트
app.get('/db-test', async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT NOW() as current_time');
            res.json({ 
                status: 'OK', 
                database: 'PostgreSQL Connected',
                mode: 'postgresql',
                current_time: result.rows[0].current_time
            });
        } else {
            res.json({ 
                status: 'OK', 
                database: 'JSON Database Active',
                mode: 'json',
                current_time: new Date().toISOString()
            });
        }
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR', 
            database: 'Connection Failed',
            mode: dbMode,
            error: error.message
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
            message: '여행사가 성공적으로 추가되었습니다.',
            agency: agency
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

// 서버 시작 및 데이터베이스 초기화
app.listen(PORT, async () => {
    console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📊 데이터베이스 모드: ${dbMode.toUpperCase()}`);
    
    if (dbMode === 'postgresql') {
        try {
            // 데이터베이스 연결 테스트
            await testConnection();
            
            // 데이터베이스 초기화 함수
            async function initializeDatabase() {
                if (dbMode === 'postgresql') {
                    try {
                        console.log('PostgreSQL 데이터베이스 초기화 중...');
                        
                        // 테이블 존재 확인 및 생성
                        await createTables();
                        
                        // 모든 컬럼 보정
                        await ensureAllColumns();
                    } catch (error) {
                        console.error('데이터베이스 초기화 오류:', error);
                    }
                }
            }
            await initializeDatabase();
            
            // JSON 데이터 마이그레이션 (최초 1회만)
            try {
                await migrateFromJSON();
                console.log('🔄 데이터 마이그레이션이 완료되었습니다.');
            } catch (error) {
                console.warn('⚠️ 데이터 마이그레이션 건너뜀:', error.message);
            }
            
            // logo_url 컬럼 존재 확인 및 추가 함수
            async function ensureLogoUrlColumn() {
                try {
                    // agencies 테이블에 logo_url 컬럼이 있는지 확인
                    const columnCheck = await pool.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'agencies' AND column_name = 'logo_url'
                    `);
                    
                    if (columnCheck.rows.length === 0) {
                        console.log('logo_url 컬럼이 없습니다. 추가하는 중...');
                        await pool.query('ALTER TABLE agencies ADD COLUMN logo_url VARCHAR(500)');
                        console.log('✅ logo_url 컬럼이 성공적으로 추가되었습니다.');
                    } else {
                        console.log('✅ logo_url 컬럼이 이미 존재합니다.');
                    }
                } catch (error) {
                    console.warn('⚠️ logo_url 컬럼 확인/추가 건너뜀:', error.message);
                }
            }
            
            
            // 제휴업체 자동 삭제 비활성화 (수동 관리 모드)
            console.log('📋 제휴업체 수동 관리 모드 - 기존 데이터 유지');
            
        } catch (error) {
            console.error('❌ PostgreSQL 초기화 중 오류:', error);
            console.warn('⚠️ JSON 데이터베이스로 fallback 합니다.');
            dbMode = 'json';
            if (!jsonDB) {
                jsonDB = require('./utils/jsonDB');
            }
        }
    } else {
        console.log('📁 JSON 파일 기반 데이터베이스를 사용합니다.');
        console.log('⚠️ 주의: Railway 배포 시 데이터가 초기화될 수 있습니다.');
    }
});

// ==================== 예약 데이터 파싱 함수 ====================

function parseReservationText(text) {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const data = {};
    
    // 업체 구분 자동 감지
    const upperText = text.toUpperCase();
    if (upperText.includes('NOL') || upperText.includes('엔오엘')) {
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
        data.company = 'OTHER';
    }
    
    for (const line of lines) {
        // 예약번호
        if (line.includes('예약번호') || line.includes('Reservation')) {
            const match = line.match(/[A-Z0-9]{6,}/);
            if (match) data.reservation_number = match[0];
        }
        
        // 확인번호
        if (line.includes('확인번호') || line.includes('Confirmation')) {
            const match = line.match(/[A-Z0-9]{6,}/);
            if (match) data.confirmation_number = match[0];
        }
        
        // 예약 채널
        if (line.includes('예약채널') || line.includes('Channel')) {
            data.booking_channel = line.split(':')[1]?.trim() || line.split('Channel')[1]?.trim();
        }
        
        // 상품명
        if (line.includes('상품명') || line.includes('Product')) {
            data.product_name = line.split(':')[1]?.trim() || line.split('Product')[1]?.trim();
        }
        
        // 금액
        if (line.includes('금액') || line.includes('Amount') || line.includes('$')) {
            const match = line.match(/[\d,]+/);
            if (match) data.amount = parseFloat(match[0].replace(/,/g, ''));
        }
        
        // 패키지 타입
        if (line.includes('패키지') || line.includes('Package')) {
            data.package_type = line.split(':')[1]?.trim() || line.split('Package')[1]?.trim();
        }
        
        // 이용 예정일
        if (line.includes('이용예정일') || line.includes('Date')) {
            const dateMatch = line.match(/\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/);
            if (dateMatch) data.usage_date = dateMatch[0];
        }
        
        // 이용 시간
        if (line.includes('시간') || line.includes('Time')) {
            const timeMatch = line.match(/\d{1,2}:\d{2}/);
            if (timeMatch) data.usage_time = timeMatch[0];
        }
        
        // 예약자 한글명
        if (line.includes('예약자') && line.includes('한글')) {
            data.korean_name = line.split(':')[1]?.trim();
        }
        
        // 예약자 영문명
        if (line.includes('예약자') && line.includes('영문')) {
            data.english_name = line.split(':')[1]?.trim();
        }
        
        // 이메일
        if (line.includes('@')) {
            const emailMatch = line.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
            if (emailMatch) data.email = emailMatch[0];
        }
        
        // 전화번호
        if (line.includes('전화') || line.includes('Phone')) {
            const phoneMatch = line.match(/[\d\-\+\(\)\s]+/);
            if (phoneMatch) data.phone = phoneMatch[0].trim();
        }
        
        // 카카오톡 ID
        if (line.includes('카카오') || line.includes('KakaoTalk')) {
            data.kakao_id = line.split(':')[1]?.trim();
        }
        
        // 인원수
        if (line.includes('인원') || line.includes('Guest')) {
            const guestMatch = line.match(/\d+/);
            if (guestMatch) data.guest_count = parseInt(guestMatch[0]);
        }
        
        // 메모
        if (line.includes('메모') || line.includes('Note')) {
            data.memo = line.split(':')[1]?.trim();
        }
    }
    
    return data;
}

// ==================== 예약 관리 API ====================

// 예약 등록 (텍스트 파싱)
app.post('/admin/reservations/parse', requireAuth, async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || !reservationText.trim()) {
            return res.json({ success: false, message: '예약 데이터를 입력해주세요.' });
        }
        
        // 텍스트 파싱
        const parsedData = parseReservationText(reservationText);
        
        // 필수 필드 검증
        if (!parsedData.reservation_number || !parsedData.korean_name || !parsedData.email) {
            return res.json({ 
                success: false, 
                message: '필수 정보가 누락되었습니다. (예약번호, 이름, 이메일)',
                parsedData 
            });
        }
        
        if (dbMode === 'postgresql') {
            // 중복 예약번호 확인
            const existingReservation = await pool.query(
                'SELECT id FROM reservations WHERE reservation_number = $1',
                [parsedData.reservation_number]
            );
            
            if (existingReservation.rows.length > 0) {
                return res.json({ 
                    success: false, 
                    message: '이미 등록된 예약번호입니다.',
                    parsedData 
                });
            }
        }
        
        // 데이터베이스에 저장
        if (dbMode === 'postgresql') {
            const insertQuery = `
                INSERT INTO reservations (
                    company, reservation_number, confirmation_number, booking_channel, product_name, 
                    amount, package_type, usage_date, usage_time, korean_name, english_name, 
                    email, phone, kakao_id, guest_count, memo
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                RETURNING *
            `;
            
            const values = [
                parsedData.company || 'OTHER',
                parsedData.reservation_number || null,
                parsedData.confirmation_number || null,
                parsedData.booking_channel || null,
                parsedData.product_name || null,
                parsedData.amount || null,
                parsedData.package_type || null,
                parsedData.usage_date || null,
                parsedData.usage_time || null,
                parsedData.korean_name || null,
                parsedData.english_name || null,
                parsedData.email || null,
                parsedData.phone || null,
                parsedData.kakao_id || null,
                parsedData.guest_count || null,
                parsedData.memo || null
            ];
            
            const result = await pool.query(insertQuery, values);
            const savedReservation = result.rows[0];
            
            res.json({ 
                success: true, 
                message: '예약이 성공적으로 등록되었습니다.',
                reservation: savedReservation
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 연결이 필요합니다.' });
        }
        
    } catch (error) {
        console.error('예약 등록 오류:', error);
        return res.json({ 
            success: false, 
            message: '예약 등록 중 오류가 발생했습니다.' 
        });
    }
});

// 예약 관리 페이지
app.get('/admin/reservations', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            // 통계 조회
            const statsQuery = await pool.query(`
                SELECT 
                    COUNT(*) as total_reservations,
                    COUNT(CASE WHEN code_issued = true THEN 1 END) as code_issued,
                    COUNT(CASE WHEN code_issued = false THEN 1 END) as pending_codes,
                    COUNT(DISTINCT company) as companies
                FROM reservations
            `);
            
            // 예약 목록 조회
            const reservationsQuery = await pool.query(`
                SELECT * FROM reservations 
                ORDER BY created_at DESC 
                LIMIT 50
            `);
            
            const stats = statsQuery.rows[0];
            const reservations = reservationsQuery.rows;
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                reservations: reservations
            });
        } else {
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0 },
                reservations: []
            });
        }
    } catch (error) {
        console.error('예약 관리 페이지 로드 오류:', error);
        res.status(500).render('error', { 
            title: '오류', 
            message: '예약 관리 페이지를 불러올 수 없습니다.' 
        });
    }
});

// 예약에서 발급 코드 자동 생성
app.post('/admin/reservations/:id/generate-code', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        if (dbMode === 'postgresql') {
            // 예약 정보 조회
            const reservationQuery = await pool.query(
                'SELECT * FROM reservations WHERE id = $1',
                [reservationId]
            );
            
            if (reservationQuery.rows.length === 0) {
                return res.json({ success: false, message: '예약을 찾을 수 없습니다.' });
            }
            
            const reservation = reservationQuery.rows[0];
            
            if (reservation.code_issued) {
                return res.json({ success: false, message: '이미 발급 코드가 생성되었습니다.' });
            }
            
            // 발급 코드 생성 (6자리 랜덤 코드)
            function generateCode() {
                const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
                let result = '';
                for (let i = 0; i < 6; i++) {
                    result += chars.charAt(Math.floor(Math.random() * chars.length));
                }
                return result;
            }
            
            let newCode;
            let isUnique = false;
            
            // 중복되지 않는 코드 생성
            while (!isUnique) {
                newCode = generateCode();
                const existingCode = await pool.query(
                    'SELECT id FROM issue_codes WHERE code = $1',
                    [newCode]
                );
                if (existingCode.rows.length === 0) {
                    isUnique = true;
                }
            }
            
            // issue_codes 테이블에 코드 추가
            const insertCodeQuery = await pool.query(
                'INSERT INTO issue_codes (code) VALUES ($1) RETURNING *',
                [newCode]
            );
            
            const issueCode = insertCodeQuery.rows[0];
            
            // 예약 테이블 업데이트
            await pool.query(
                'UPDATE reservations SET issue_code_id = $1, code_issued = true, code_issued_at = CURRENT_TIMESTAMP WHERE id = $2',
                [issueCode.id, reservationId]
            );
            
            res.json({ 
                success: true, 
                message: '발급 코드가 성공적으로 생성되었습니다.',
                code: newCode
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 연결이 필요합니다.' });
        }
    } catch (error) {
        console.error('발급 코드 생성 오류:', error);
        res.json({ success: false, message: '발급 코드 생성 중 오류가 발생했습니다.' });
    }
});

// 예약의 발급 코드 조회
app.get('/admin/reservations/:id/code', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        if (dbMode === 'postgresql') {
            const query = await pool.query(`
                SELECT r.*, ic.code 
                FROM reservations r
                LEFT JOIN issue_codes ic ON r.issue_code_id = ic.id
                WHERE r.id = $1
            `, [reservationId]);
            
            if (query.rows.length === 0) {
                return res.json({ success: false, message: '예약을 찾을 수 없습니다.' });
            }
            
            const reservation = query.rows[0];
            
            if (!reservation.code_issued || !reservation.code) {
                return res.json({ success: false, message: '발급된 코드가 없습니다.' });
            }
            
            res.json({ 
                success: true, 
                code: reservation.code
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 연결이 필요합니다.' });
        }
    } catch (error) {
        console.error('발급 코드 조회 오류:', error);
        res.json({ success: false, message: '발급 코드 조회 중 오류가 발생했습니다.' });
    }
});

// 예약에 발급 코드 연결
app.post('/admin/reservations/:id/assign-code', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const { issueCodeId } = req.body;
        
        if (dbMode === 'postgresql') {
            // 발급 코드가 사용 가능한지 확인
            const codeCheck = await pool.query(
                'SELECT id, is_used FROM issue_codes WHERE id = $1',
                [issueCodeId]
            );
            
            if (codeCheck.rows.length === 0 || codeCheck.rows[0].is_used) {
                return res.json({ 
                    success: false, 
                    message: '사용할 수 없는 발급 코드입니다.' 
                });
            }
            
            // 예약에 코드 연결
            await pool.query(`
                UPDATE reservations 
                SET issue_code_id = $1, code_issued = true, code_issued_at = CURRENT_TIMESTAMP
                WHERE id = $2
            `, [issueCodeId, reservationId]);
            
            return res.json({ 
                success: true, 
                message: '발급 코드가 성공적으로 연결되었습니다.' 
            });
        } else {
            return res.json({ 
                success: false, 
                message: 'PostgreSQL 모드에서만 사용 가능합니다.' 
            });
        }
        
    } catch (error) {
        console.error('코드 연결 오류:', error);
        return res.json({ 
            success: false, 
            message: '코드 연결 중 오류가 발생했습니다.' 
        });
    }
});

// ==================== 발급 코드 관련 API ====================

// 랜덤 코드 생성 함수 (a1234b 형태)
function generateIssueCode() {
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    
    // 첫 글자: 소문자
    let result = letters.charAt(Math.floor(Math.random() * letters.length));
    
    // 중간 4자리: 숫자
    for (let i = 0; i < 4; i++) {
        result += numbers.charAt(Math.floor(Math.random() * numbers.length));
    }
    
    // 마지막 글자: 소문자
    result += letters.charAt(Math.floor(Math.random() * letters.length));
    
    return result;
}

// 발급 코드 관리 페이지
app.get('/admin/issue-codes', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            // 통계 조회
            const statsQuery = await pool.query(`
                SELECT 
                    COUNT(*) as total_codes,
                    COUNT(CASE WHEN is_used = false THEN 1 END) as unused_codes,
                    COUNT(CASE WHEN is_used = true THEN 1 END) as used_codes,
                    COUNT(CASE WHEN is_delivered = false THEN 1 END) as undelivered_codes,
                    COUNT(CASE WHEN is_delivered = true THEN 1 END) as delivered_codes,
                    CASE 
                        WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN is_used = true THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 1)
                        ELSE 0 
                    END as usage_rate,
                    CASE 
                        WHEN COUNT(*) > 0 THEN ROUND((COUNT(CASE WHEN is_delivered = true THEN 1 END)::numeric / COUNT(*)::numeric) * 100, 1)
                        ELSE 0 
                    END as delivery_rate
                FROM issue_codes
            `);
            
            // 코드 목록 조회 (사용자 정보 포함)
            const codesQuery = await pool.query(`
                SELECT 
                    ic.*,
                    u.name as user_name
                FROM issue_codes ic
                LEFT JOIN users u ON ic.used_by_user_id = u.id
                ORDER BY ic.created_at DESC
                LIMIT 100
            `);
            
            const stats = statsQuery.rows[0];
            const codes = codesQuery.rows;
            
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                codes: codes
            });
        } else {
            // JSON 모드 (기본 데이터)
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_codes: 0, unused_codes: 0, used_codes: 0, undelivered_codes: 0, delivered_codes: 0, usage_rate: 0, delivery_rate: 0 },
                codes: []
            });
        }
    } catch (error) {
        console.error('발급 코드 페이지 로드 오류:', error);
        res.status(500).render('error', { 
            title: '오류', 
            message: '발급 코드 페이지를 불러올 수 없습니다.' 
        });
    }
});

// 발급 코드 생성 API
app.post('/admin/issue-codes/generate', requireAuth, async (req, res) => {
    try {
        const { count = 1, notes = '' } = req.body;
        const codeCount = Math.min(Math.max(parseInt(count), 1), 100); // 1-100개 제한
        
        if (dbMode === 'postgresql') {
            const generatedCodes = [];
            
            for (let i = 0; i < codeCount; i++) {
                let code;
                let isUnique = false;
                let attempts = 0;
                
                // 중복되지 않는 코드 생성 (최대 10회 시도)
                while (!isUnique && attempts < 10) {
                    code = generateIssueCode();
                    const existingCode = await pool.query('SELECT id FROM issue_codes WHERE code = $1', [code]);
                    if (existingCode.rows.length === 0) {
                        isUnique = true;
                    }
                    attempts++;
                }
                
                if (isUnique) {
                    await pool.query(
                        'INSERT INTO issue_codes (code, notes) VALUES ($1, $2)',
                        [code, notes]
                    );
                    generatedCodes.push(code);
                } else {
                    console.warn('코드 생성 실패: 중복 방지 시도 초과');
                }
            }
            
            res.json({ 
                success: true, 
                message: `${generatedCodes.length}개의 코드가 생성되었습니다.`,
                codes: generatedCodes
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' });
        }
    } catch (error) {
        console.error('발급 코드 생성 오류:', error);
        res.json({ success: false, message: '코드 생성 중 오류가 발생했습니다.' });
    }
});

// 발급 코드 수정 API
app.put('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        
        if (dbMode === 'postgresql') {
            await pool.query(
                'UPDATE issue_codes SET notes = $1 WHERE id = $2 AND is_used = false',
                [notes, id]
            );
            
            res.json({ success: true, message: '코드가 수정되었습니다.' });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' });
        }
    } catch (error) {
        console.error('발급 코드 수정 오류:', error);
        res.json({ success: false, message: '코드 수정 중 오류가 발생했습니다.' });
    }
});

// 발급 코드 삭제 API
app.delete('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            await pool.query('DELETE FROM issue_codes WHERE id = $1 AND is_used = false', [id]);
            res.json({ success: true, message: '코드가 삭제되었습니다.' });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' });
        }
    } catch (error) {
        console.error('발급 코드 삭제 오류:', error);
        res.json({ success: false, message: '코드 삭제 중 오류가 발생했습니다.' });
    }
});

// 발급 코드 검증 함수
async function validateIssueCode(code) {
    if (dbMode === 'postgresql') {
        try {
            const result = await pool.query(
                'SELECT id, is_used FROM issue_codes WHERE code = $1',
                [code.toLowerCase()]
            );
            
            if (result.rows.length === 0) {
                return { valid: false, message: '존재하지 않는 발급 코드입니다.' };
            }
            
            if (result.rows[0].is_used) {
                return { valid: false, message: '이미 사용된 발급 코드입니다.' };
            }
            
            return { valid: true, codeId: result.rows[0].id };
        } catch (error) {
            console.error('발급 코드 검증 오류:', error);
            return { valid: false, message: '코드 검증 중 오류가 발생했습니다.' };
        }
    }
    
    return { valid: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' };
}
