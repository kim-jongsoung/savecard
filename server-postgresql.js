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
let pool, testConnection, createTables, migrateFromJSON;
let jsonDB;

try {
    const dbModule = require('./database');
    pool = dbModule.pool;
    testConnection = dbModule.testConnection;
    createTables = dbModule.createTables;
    migrateFromJSON = dbModule.migrateFromJSON;
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
            const { name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end } = userData;
            const result = await pool.query(
                'INSERT INTO users (name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *',
                [name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end]
            );
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
        const { name, phone, email, agency_id } = req.body;
        
        if (!name || !phone || !agency_id) {
            return res.json({
                success: false,
                message: '필수 정보를 모두 입력해주세요.'
            });
        }
        
        const agency = await dbHelpers.getAgencyById(agency_id);
        if (!agency) {
            return res.json({
                success: false,
                message: '유효하지 않은 여행사입니다.'
            });
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
        
        // 사용자 생성
        const user = await dbHelpers.createUser({
            name,
            phone,
            email,
            agency_id,
            token,
            qr_code: qrCodeDataURL,
            expiration_start: expirationStart,
            expiration_end: expirationEnd
        });
        
        res.json({
            success: true,
            message: '카드가 성공적으로 발급되었습니다.',
            token: token
        });
        
    } catch (error) {
        console.error('카드 발급 오류:', error);
        res.json({
            success: false,
            message: '카드 발급 중 오류가 발생했습니다.'
        });
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
        const { token, staff } = req.query;
        
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
        
        res.render('card', {
            title: '괌세이브카드',
            user: { ...user, agency_name: agency ? agency.name : 'Unknown' },
            banner: banner,
            usages: usages.slice(0, 5),
            stores: stores,
            isStaffMode: isStaffMode,
            success: null,
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
            success: null,
            error: null
        });
    } catch (error) {
        console.error('여행사 관리 페이지 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
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
