const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const { pool, testConnection, createTables, migrateFromJSON } = require('./database');
// nodemailer 제거됨
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 이메일 기능 완전 제거됨

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
        await pool.query('SELECT 1');
        next();
    } catch (err) {
        console.error('데이터베이스 연결 오류:', err);
        res.status(500).send('데이터베이스 연결 오류가 발생했습니다.');
    }
}

// 모든 라우트에 데이터베이스 체크 적용
app.use(checkDatabase);

// PostgreSQL 헬퍼 함수들
const dbHelpers = {
    // 사용자 관련
    async getUsers() {
        const result = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
        return result.rows;
    },
    
    async getUserByToken(token) {
        const result = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
        return result.rows[0] || null;
    },
    
    async createUser(userData) {
        const { name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end } = userData;
        const result = await pool.query(
            'INSERT INTO users (name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *',
            [name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end]
        );
        return result.rows[0];
    },
    
    // 여행사 관련
    async getAgencies() {
        const result = await pool.query('SELECT * FROM agencies ORDER BY display_order, name');
        return result.rows;
    },
    
    async getAgencyById(id) {
        const result = await pool.query('SELECT * FROM agencies WHERE id = $1', [id]);
        return result.rows[0] || null;
    },
    
    async getAgencyByCode(code) {
        const result = await pool.query('SELECT * FROM agencies WHERE code = $1', [code]);
        return result.rows[0] || null;
    },
    
    async createAgency(agencyData) {
        const { name, code, discount_info, show_banners_on_landing = true } = agencyData;
        const result = await pool.query(
            'INSERT INTO agencies (name, code, discount_info, show_banners_on_landing, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
            [name, code, discount_info, show_banners_on_landing]
        );
        return result.rows[0];
    },
    
    async updateAgency(id, agencyData) {
        const { name, code, discount_info, show_banners_on_landing } = agencyData;
        const result = await pool.query(
            'UPDATE agencies SET name = $1, code = $2, discount_info = $3, show_banners_on_landing = $4, updated_at = NOW() WHERE id = $5 RETURNING *',
            [name, code, discount_info, show_banners_on_landing, id]
        );
        return result.rows[0];
    },
    
    // 제휴업체 관련
    async getStores() {
        const result = await pool.query('SELECT * FROM stores WHERE is_active = true ORDER BY name');
        return result.rows;
    },
    
    async getStoreById(id) {
        const result = await pool.query('SELECT * FROM stores WHERE id = $1', [id]);
        return result.rows[0] || null;
    },
    
    // 배너 관련
    async getBanners() {
        const result = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY display_order');
        return result.rows;
    },
    
    // 사용 기록 관련
    async getUsages(token = null) {
        if (token) {
            const result = await pool.query('SELECT * FROM usages WHERE token = $1 ORDER BY used_at DESC', [token]);
            return result.rows;
        } else {
            const result = await pool.query('SELECT * FROM usages ORDER BY used_at DESC');
            return result.rows;
        }
    },
    
    async createUsage(usageData) {
        const { token, store_name, used_at = new Date() } = usageData;
        const result = await pool.query(
            'INSERT INTO usages (token, store_name, used_at) VALUES ($1, $2, $3) RETURNING *',
            [token, store_name, used_at]
        );
        return result.rows[0];
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

// 메인 페이지
app.get('/', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        const banners = await dbHelpers.getBanners();
        
        res.render('index', {
            title: '괌세이브카드',
            agencies: agencies,
            banners: banners
        });
    } catch (error) {
        console.error('메인 페이지 오류:', error);
        res.render('index', {
            title: '괌세이브카드',
            agencies: [],
            banners: []
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
    res.render('admin/login', { title: '관리자 로그인' });
});

// 관리자 로그인 처리
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 기본 관리자 계정 (환경변수 또는 하드코딩)
        const adminUsername = process.env.ADMIN_USERNAME || 'admin';
        const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
        
        if (username === adminUsername && password === adminPassword) {
            req.session.adminId = 'admin';
            res.json({ success: true });
        } else {
            res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        }
    } catch (error) {
        console.error('관리자 로그인 오류:', error);
        res.json({ success: false, message: '로그인 처리 중 오류가 발생했습니다.' });
    }
});

// 관리자 로그아웃
app.post('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 관리자 대시보드
app.get('/admin', requireAuth, async (req, res) => {
    try {
        const users = await dbHelpers.getUsers();
        const agencies = await dbHelpers.getAgencies();
        const stores = await dbHelpers.getStores();
        const usages = await dbHelpers.getUsages();
        
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: {
                totalUsers: users.length,
                totalAgencies: agencies.length,
                totalStores: stores.length,
                totalUsages: usages.length
            }
        });
    } catch (error) {
        console.error('관리자 대시보드 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: { totalUsers: 0, totalAgencies: 0, totalStores: 0, totalUsages: 0 }
        });
    }
});

// 여행사 관리 페이지
app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: agencies
        });
    } catch (error) {
        console.error('여행사 관리 페이지 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: []
        });
    }
});

// 여행사 생성
app.post('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const { name, code, discount_info, show_banners_on_landing } = req.body;
        
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
            show_banners_on_landing: show_banners_on_landing === 'true'
        });
        
        res.json({
            success: true,
            message: '여행사가 성공적으로 추가되었습니다.',
            agency: agency
        });
        
    } catch (error) {
        console.error('여행사 생성 오류:', error);
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
        const { name, code, discount_info, show_banners_on_landing } = req.body;
        
        const agency = await dbHelpers.updateAgency(id, {
            name,
            code,
            discount_info,
            show_banners_on_landing: show_banners_on_landing === 'true'
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

// 서버 시작 및 데이터베이스 초기화
app.listen(PORT, async () => {
    console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
    
    try {
        // 데이터베이스 연결 테스트
        await testConnection();
        
        // 테이블 생성
        await createTables();
        console.log('📊 데이터베이스 테이블이 준비되었습니다.');
        
        // JSON 데이터 마이그레이션 (최초 1회만)
        await migrateFromJSON();
        console.log('🔄 데이터 마이그레이션이 완료되었습니다.');
        
    } catch (error) {
        console.error('❌ 서버 초기화 중 오류:', error);
    }
});
