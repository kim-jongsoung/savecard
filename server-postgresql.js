const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
require('dotenv').config();

// PostgreSQL 또는 JSON 데이터베이스 선택
let dbMode = 'postgresql';
let pool, testConnection, createTables, migrateFromJSON, ensureAllColumns;
let jsonDB;

try {
    const dbModule = require('./database');
    pool = dbModule.pool;
    testConnection = dbModule.testConnection;
    createTables = dbModule.createTables;
    migrateFromJSON = dbModule.migrateFromJSON;
    ensureAllColumns = dbModule.ensureAllColumns;
} catch (error) {
    console.warn('⚠️ PostgreSQL 모듈 로드 실패, JSON 데이터베이스로 fallback:', error.message);
    dbMode = 'json';
    jsonDB = require('./utils/jsonDB');
}

const app = express();
const PORT = process.env.PORT || 3000;

// 메일 발송 설정 (환경변수 기반)
let mailTransporter = null;
try {
    const {
        SMTP_HOST,
        SMTP_PORT,
        SMTP_USER,
        SMTP_PASS,
        SMTP_SECURE,
        MAIL_FROM
    } = process.env;

    if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) {
        mailTransporter = nodemailer.createTransport({
            host: SMTP_HOST,
            port: Number(SMTP_PORT),
            secure: String(SMTP_SECURE || '').toLowerCase() === 'true',
            auth: { user: SMTP_USER, pass: SMTP_PASS }
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
            expiration_text
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

// (편의) GET으로도 실행 가능하게 지원
app.get('/admin/db/ensure-columns', requireAuth, async (req, res) => {
    if (dbMode !== 'postgresql') {
        return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
    }
    try {
        await createTables();
        if (typeof ensureAllColumns === 'function') {
            await ensureAllColumns();
        }
        return res.json({ success: true, message: '모든 테이블 컬럼 보정 완료 (GET)' });
    } catch (e) {
        console.error('ensure-columns(GET) 실행 오류:', e);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.json({ success: false, message: '컬럼 보정 중 오류가 발생했습니다.', ...(expose ? { detail: e.message } : {}) });
    }
});
        console.log('✉️ 이메일 발송 설정이 구성되었습니다.');
    } else {
        console.warn('⚠️ SMTP 환경변수가 설정되지 않았습니다. 이메일 대신 검증 링크를 콘솔에 출력합니다.');
    }
} catch (e) {
    console.warn('⚠️ 이메일 발송 설정 중 경고:', e.message);
}

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'guam-savecard-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

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
            const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
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
            const result = await pool.query('SELECT * FROM agencies ORDER BY display_order, name');
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
            const result = await pool.query(
                'INSERT INTO agencies (name, code, discount_info, show_banners_on_landing, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
                [name, code, discount_info, show_banners_on_landing]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('agencies', agencyData);
        }
    },
    
    async updateAgency(id, agencyData) {
        if (dbMode === 'postgresql') {
            const { name, code, discount_info, show_banners_on_landing } = agencyData;
            const result = await pool.query(
                'UPDATE agencies SET name = $1, code = $2, discount_info = $3, show_banners_on_landing = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
                [name, code, discount_info, show_banners_on_landing, id]
            );
            return result.rows[0];
        } else {
            return await jsonDB.update('agencies', id, agencyData);
        }
    },
    
    // 제휴업체 관련
    async getStores() {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM stores WHERE is_active = true ORDER BY name');
            return result.rows;
        } else {
            const stores = await jsonDB.findAll('stores');
            return stores.filter(store => store.is_active !== false);
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
                is_active = true,
                display_order = 0,
                display_locations = [1]
            } = bannerData;
            const result = await pool.query(
                `INSERT INTO banners (advertiser_name, image_url, link_url, is_active, display_order, display_locations)
                 VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
                [advertiser_name, image_url, link_url, is_active, display_order, display_locations]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('banners', bannerData);
        }
    },
    
    // 사용 기록 관련
    async getUsages(token = null) {
        if (dbMode === 'postgresql') {
            if (token) {
                const result = await pool.query('SELECT * FROM usages WHERE token = $1 ORDER BY used_at DESC', [token]);
                return result.rows;
            } else {
                const result = await pool.query('SELECT * FROM usages ORDER BY used_at DESC');
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

// 제휴업체 활성/비활성 토글
app.post('/admin/stores/:id/toggle', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        if (dbMode === 'postgresql') {
            const current = await pool.query('SELECT is_active FROM stores WHERE id = $1', [id]);
            if (current.rowCount === 0) return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            const nextVal = !Boolean(current.rows[0].is_active);
            await pool.query('UPDATE stores SET is_active = $1, updated_at = NOW() WHERE id = $2', [nextVal, id]);
        } else {
            const store = await jsonDB.findById('stores', id);
            if (!store) return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            await jsonDB.update('stores', id, { is_active: store.is_active === false ? true : false });
        }

        if (wantsJson) {
            return res.json({ success: true });
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

        // DB 스키마에 제목/설명 컬럼이 없으므로 광고주명에 제목을 우선 반영
        const banner = await dbHelpers.createBanner({
            advertiser_name: title || advertiser_name,
            image_url,
            link_url,
            is_active: true,
            display_order,
            display_locations: finalLocations
        });

        // JSON 모드의 경우 description 등 추가 필드도 저장
        if (dbMode === 'json' && description) {
            await jsonDB.update('banners', banner.id, { description });
        }

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

// 진단용 라우트 (임시)
app.get('/__diag', async (req, res) => {
    try {
        const [agencies, banners] = await Promise.all([
            dbHelpers.getAgencies().catch(e => { console.warn('diag agencies fail', e.message); return []; }),
            dbHelpers.getBanners().catch(e => { console.warn('diag banners fail', e.message); return []; })
        ]);
        res.json({
            ok: true,
            mode: dbMode,
            agencies_count: agencies.length,
            banners_count: banners.length
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message, mode: dbMode });
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
        
        res.render('partner', {
            title: `${agency.name} - 괌세이브카드`,
            agency: agency,
            banners: banners
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

// 제휴업체 목록 페이지
app.get('/stores', async (req, res) => {
    try {
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
            stores: stores,
            banners: banners,
            categories: categories
        });
    } catch (error) {
        console.error('제휴업체 목록 오류:', error);
        res.render('stores', {
            title: '제휴업체',
            stores: [],
            banners: [],
            categories: {}
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

// 카드 발급 페이지
app.get('/register', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('register', {
            title: '카드 발급',
            agencies: agencies,
            error: null,
            success: null,
            selectedAgency: null
        });
    } catch (error) {
        console.error('카드 발급 페이지 오류:', error);
        res.render('register', {
            title: '카드 발급',
            agencies: [],
            error: null,
            success: null,
            selectedAgency: null
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
        const { name, email } = req.body;
        let { agency_id, agency_code } = req.body;
        const pin = (req.body.pin || '').toString().trim();
        const phone = (req.body.phone || '').toString().trim() || null; // 선택 입력

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
            title: '괌세이브카드',
            user: { ...user, agency_name: agency ? agency.name : 'Unknown' },
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
            message: '처리 중 오류가 발생했습니다.'
        });
    }
});

// ==================== 관리자 라우트 ====================

// 관리자 로그인 페이지
app.get('/admin/login', (req, res) => {
    res.render('admin/login', { 
        title: '관리자 로그인',
        error: null,
        success: null
    });
});

// 관리자 로그인 처리
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 기본 관리자 계정 (환경변수 또는 하드코딩)
        const adminUsername = process.env.ADMIN_USERNAME || 'luxfind01';
        const adminPassword = process.env.ADMIN_PASSWORD || 'vasco01@';
        
        if (username === adminUsername && password === adminPassword) {
            req.session.adminId = 'admin';
            req.session.adminUsername = username;
            res.json({ success: true });
        } else {
            res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }
    } catch (error) {
        console.error('관리자 로그인 오류:', error);
        res.json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
    }
});
app.post('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// 일부 관리자 뷰에서 GET 링크로 로그아웃을 호출하므로 GET도 허용
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// 관리자 대시보드
app.get('/admin', requireAuth, async (req, res) => {
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

// 여행사 관리 페이지
app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: agencies,
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('여행사 관리 페이지 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: null,
            error: null
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
        
        const agency = await dbHelpers.updateAgency(id, {
            name,
            code,
            discount_info,
            show_banners_on_landing: String(show_banners_on_landing) === 'true'
        });
        
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
        res.json({
            success: false,
            message: '여행사 수정 중 오류가 발생했습니다.'
        });
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

// 배너 관리 페이지
app.get('/admin/banners', requireAuth, async (req, res) => {
    try {
        const banners = await dbHelpers.getBanners();
        res.render('admin/banners', {
            title: '배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('배너 관리 페이지 오류:', error);
        res.render('admin/banners', {
            title: '배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners: [],
            success: null,
            error: '배너 목록을 불러오지 못했습니다.'
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

// 서버 시작 및 데이터베이스 초기화
app.listen(PORT, async () => {
    console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`📊 데이터베이스 모드: ${dbMode.toUpperCase()}`);
    
    if (dbMode === 'postgresql') {
        try {
            // 데이터베이스 연결 테스트
            await testConnection();
            
            // 테이블 생성
            await createTables();
            console.log('📊 PostgreSQL 테이블이 준비되었습니다.');
            
            // JSON 데이터 마이그레이션 (최초 1회만)
            await migrateFromJSON();
            console.log('🔄 데이터 마이그레이션이 완료되었습니다.');
            
        } catch (error) {
            console.error('❌ PostgreSQL 초기화 중 오류:', error);
            console.warn('⚠️ JSON 데이터베이스로 fallback 합니다.');
            dbMode = 'json';
            if (!jsonDB) {
                jsonDB = require('./utils/jsonDB');
            }
        }
    }
    
    if (dbMode === 'json') {
        console.log('📁 JSON 파일 기반 데이터베이스를 사용합니다.');
        console.log('⚠️ 주의: Railway 배포 시 데이터가 초기화될 수 있습니다.');
    }
});
