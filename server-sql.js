const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// PostgreSQL 연결 설정
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// EJS 템플릿 엔진 및 기본 미들웨어(세션 포함)를 라우트 등록 전에 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
  secret: 'guam-savecard-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 }
}));

// 사용자 인증 가드
function requireUserAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// ==================== 사용자 로그인/로그아웃 ====================
app.get('/login', async (req, res) => {
  try {
    if (req.session && req.session.userId) {
      // 세션 유효성 검증: 존재하지 않는 유저면 세션 제거 후 로그인 화면
      const check = await pool.query('SELECT id FROM users WHERE id = $1', [req.session.userId]);
      if (check.rows.length > 0) {
        return res.redirect('/my-card');
      } else {
        req.session.destroy(() => res.render('login', { title: '로그인', error: null }));
        return;
      }
    }
    res.render('login', { title: '로그인', error: null });
  } catch (e) {
    console.error('로그인 페이지 세션 검증 오류:', e);
    res.render('login', { title: '로그인', error: null });
  }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    if (!email || !password) {
      return res.render('login', { title: '로그인', error: '이메일과 비밀번호를 입력해주세요.' });
    }
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [String(email).trim().toLowerCase()]);
    if (userResult.rows.length === 0) {
      return res.render('login', { title: '로그인', error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    const user = userResult.rows[0];
    if (String(user.password) !== String(password)) {
      return res.render('login', { title: '로그인', error: '이메일 또는 비밀번호가 올바르지 않습니다.' });
    }
    req.session.userId = user.id;
    res.redirect('/my-card');
  } catch (e) {
    console.error('로그인 오류:', e);
    res.render('login', { title: '로그인', error: '로그인 중 오류가 발생했습니다.' });
  }
});

app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/');
  });
});

// 편의상 GET 요청도 지원
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// ==================== 내 카드 페이지 ====================
app.get('/my-card', requireUserAuth, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT u.*, a.name as agency_name FROM users u JOIN agencies a ON u.agency_id = a.id WHERE u.id = $1',
      [req.session.userId]
    );
    if (userResult.rows.length === 0) {
      // 세션의 userId가 유효하지 않음 → 세션 정리 후 로그인으로
      req.session.destroy(() => {
        return res.redirect('/login');
      });
      return; // destroy 콜백으로 반환되므로 여기서 종료
    }
    const user = userResult.rows[0];
    // 최근 사용 이력 10건
    const usageResult = await pool.query(
      `SELECT cu.*, s.name as store_name
       FROM card_usages cu
       LEFT JOIN stores s ON s.code = cu.store_code
       WHERE cu.token = $1
       ORDER BY cu.used_at DESC
       LIMIT 10`,
      [user.token]
    );
    res.render('my-card', {
      title: '내 카드',
      user: user,
      usages: usageResult.rows
    });
  } catch (e) {
    console.error('내 카드 페이지 오류:', e);
    // 오류 시에도 루프 방지를 위해 세션 제거 후 로그인 이동
    req.session.destroy(() => {
      res.redirect('/login');
    });
  }
});

// 스키마 보정: 배너 위치/설명/클릭수 컬럼 확보
async function ensureSchema() {
  try {
    await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS display_locations INTEGER[] DEFAULT '{1}'");
    await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS click_count INTEGER DEFAULT 0");
    await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS description TEXT");
    await pool.query("ALTER TABLE banners ADD COLUMN IF NOT EXISTS title VARCHAR(255)");
    await pool.query("ALTER TABLE stores ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true");
    // Ensure users.email exists and is unique
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)");
    await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS users_email_ux ON users (email)");
  } catch (e) {
    console.error('스키마 확인/수정 오류:', e);
  }
}
ensureSchema();

// QR 코드 저장 디렉토리 생성
const qrDir = path.join(__dirname, 'qrcodes');
fs.ensureDirSync(qrDir);

// (위로 이동) 기본 미들웨어 및 EJS 설정은 라우트보다 먼저 설정됨

// QR 코드 이미지 정적 파일 제공
app.use('/qrcodes', express.static(qrDir));

// 관리자 인증 미들웨어
function requireAuth(req, res, next) {
    console.log('🔐 인증 체크:', {
        url: req.url,
        adminId: req.session.adminId,
        sessionExists: !!req.session
    });
    if (!req.session.adminId) {
        console.log('❌ 인증 실패 - 로그인 페이지로 리디렉션');
        return res.redirect('/admin/login');
    }
    console.log('✅ 인증 성공 - 다음 미들웨어로 진행');
    next();
}

// 사용자 인증 미들웨어
function requireUserAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login');
  }
  next();
}

// ==================== 메인 페이지 ====================
app.get('/', async (req, res) => {
    try {
        // 메인 페이지용 배너 조회 (위치 1)
        const bannerResult = await pool.query(`
            SELECT * FROM banners 
            WHERE is_active = true AND $1 = ANY(display_locations)
            ORDER BY display_order ASC
        `, [1]);
        
        res.render('index', {
            title: '괌세이브카드',
            message: '괌 여행의 필수 할인카드',
            banners: bannerResult.rows
        });
    } catch (error) {
        console.error('메인 페이지 배너 조회 오류:', error);
        res.render('index', {
            title: '괌세이브카드',
            message: '괌 여행의 필수 할인카드',
            banners: []
        });
    }
});

// ==================== 제휴업체 목록 ====================
app.get('/stores', async (req, res) => {
    try {
        const storesResult = await pool.query(`
            SELECT * FROM stores 
            ORDER BY usage_count DESC NULLS LAST, name ASC
        `);
        
        // 카테고리별로 그룹화
        const categories = {};
        storesResult.rows.forEach(store => {
            if (!categories[store.category]) {
                categories[store.category] = [];
            }
            categories[store.category].push(store);
        });
        
        // 제휴업체 목록 페이지용 배너 조회 (위치 3)
        const bannerResult = await pool.query(`
            SELECT * FROM banners 
            WHERE is_active = true
            ORDER BY display_order ASC
        `);

        res.render('stores', {
            title: '제휴업체 목록',
            stores: storesResult.rows,
            categories: categories,
            banners: bannerResult.rows
        });

    } catch (error) {
        console.error('제휴업체 목록 조회 오류:', error);
        res.render('stores', {
            title: '제휴업체 목록',
            stores: [],
            categories: {},
            banners: []
        });
    }
});

// ==================== 카드 발급 ====================
app.get('/register', async (req, res) => {
    try {
        const agenciesResult = await pool.query(`
            SELECT * FROM agencies 
            ORDER BY sort_order ASC, name ASC
        `);
        
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: agenciesResult.rows,
            error: null,
            success: null
        });
    } catch (error) {
        console.error('여행사 목록 조회 오류:', error);
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: [],
            error: '시스템 오류가 발생했습니다.',
            success: null
        });
    }
});

app.post('/register', async (req, res) => {
  console.log('🔍 카드 발급 요청 받음:', req.body);
  const { customer_name, agency_code, email, password, password_confirm } = req.body;
  console.log('📝 추출된 데이터:', { customer_name, agency_code, email, password, password_confirm });

  try {
    if (!customer_name || !agency_code || !email || !password || !password_confirm) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '모든 필드를 입력해주세요.',
        success: null
      });
    }

    // 이메일 형식 검증
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emailNorm = String(email).trim().toLowerCase();
    if (!emailRegex.test(emailNorm)) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '유효한 이메일을 입력해주세요.',
        success: null
      });
    }

    // 4자리 숫자 비밀번호 검증
    const passwordRegex = /^[0-9]{4}$/;
    if (!passwordRegex.test(password)) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '비밀번호는 4자리 숫자로 입력해주세요.',
        success: null
      });
    }

    // 비밀번호 일치 검증
    if (password !== password_confirm) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '비밀번호가 일치하지 않습니다.',
        success: null
      });
    }

    // 이메일 중복 검증
    const dup = await pool.query('SELECT 1 FROM users WHERE email = $1', [emailNorm]);
    if (dup.rows.length > 0) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '이미 등록된 이메일입니다. 다른 이메일을 사용해주세요.',
        success: null
      });
    }

    // 여행사 확인
    const agencyResult = await pool.query(
      'SELECT * FROM agencies WHERE agency_code = $1',
      [agency_code]
    );
    if (agencyResult.rows.length === 0) {
      const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
      return res.render('register', {
        title: '괌세이브카드 발급',
        agencies: agenciesResult.rows,
        error: '유효하지 않은 여행사 코드입니다.',
        success: null
      });
    }

    const agency = agencyResult.rows[0];
    const token = uuidv4();

    // 유효기간 설정 (발급월의 1일부터 말일까지)
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-based
    const expirationStart = new Date(year, month, 1);
    const expirationEnd = new Date(year, month + 1, 0);
    const formatDate = (date) => {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mmm = monthNames[date.getMonth()];
      const dd = String(date.getDate()).padStart(2, '0');
      const yy = String(date.getFullYear()).slice(-2);
      return `${mmm}/${dd}/${yy}`;
    };
    const expirationText = `Save Card Expiration Date ${formatDate(expirationStart)}~${formatDate(expirationEnd)}`;

    // QR 코드 생성
    const cardUrl = `${req.protocol}://${req.get('host')}/card?token=${token}`;
    const qrFileName = `${token}.png`;
    const qrFilePath = path.join(qrDir, qrFileName);
    await QRCode.toFile(qrFilePath, cardUrl, {
      width: 300,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    // 사용자 정보 저장
    await pool.query(
      `INSERT INTO users (customer_name, agency_id, email, token, password, qr_image_path, expiration_start, expiration_end, expiration_text, issued_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        customer_name,
        agency.id,
        emailNorm,
        token,
        password,
        `/qrcodes/${qrFileName}`,
        expirationStart.toISOString(),
        expirationEnd.toISOString(),
        expirationText,
        now.toISOString()
      ]
    );

    res.redirect(`/register/success?token=${token}`);
  } catch (error) {
    console.error('카드 발급 오류:', error);
    const agenciesResult = await pool.query('SELECT * FROM agencies ORDER BY sort_order ASC');
    res.render('register', {
      title: '괌세이브카드 발급',
      agencies: agenciesResult.rows,
      error: '카드 발급 중 오류가 발생했습니다.',
      success: null
    });
  }
});

app.get('/register/success', async (req, res) => {
    const { token } = req.query;
    console.log('🔍 발급 성공 페이지 접근:', { token });
    
    if (!token) {
        console.log('❌ 토큰이 없음');
        return res.redirect('/register');
    }

    try {
        console.log('🔍 토큰으로 사용자 조회 중:', token);
        const userResult = await pool.query(
            'SELECT u.*, a.name as agency_name FROM users u JOIN agencies a ON u.agency_id = a.id WHERE u.token = $1',
            [token]
        );
        console.log('📝 사용자 조회 결과:', userResult.rows.length, '개');
        
        if (userResult.rows.length === 0) {
            console.log('❌ 토큰에 해당하는 사용자 없음');
            return res.redirect('/register');
        }

        const user = userResult.rows[0];
        const cardUrl = `${req.protocol}://${req.get('host')}/register/success?token=${token}`;
        
        // 발급 완료 페이지용 배너 조회 (위치 2)
        const bannerResult = await pool.query(`
            SELECT * FROM banners 
            WHERE is_active = true
            ORDER BY display_order ASC
        `);

        res.render('register-success', {
            title: '괌세이브카드 발급 완료',
            user: user,
            cardUrl: cardUrl,
            qrImageUrl: user.qr_image_path,
            banners: bannerResult.rows
        });

    } catch (error) {
        console.error('발급 성공 페이지 오류:', error);
        res.redirect('/register');
    }
});

// 비밀번호 인증 API
app.post('/api/verify-password', async (req, res) => {
    const { token, password } = req.body;
    
    try {
        const userResult = await pool.query(
            'SELECT * FROM users WHERE token = $1',
            [token]
        );
        
        if (userResult.rows.length === 0) {
            return res.json({ success: false, message: '유효하지 않은 카드입니다.' });
        }
        
        const user = userResult.rows[0];
        
        if (user.password === password) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
        }
        
    } catch (error) {
        console.error('비밀번호 인증 오류:', error);
        res.json({ success: false, message: '인증 처리 중 오류가 발생했습니다.' });
    }
});

// ==================== 카드 사용 ====================
app.get('/card', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.render('error', {
            title: '오류',
            message: '유효하지 않은 접근입니다.',
            error: { status: 400 }
        });
    }

    try {
        const userResult = await pool.query(
            'SELECT u.*, a.name as agency_name FROM users u JOIN agencies a ON u.agency_id = a.id WHERE u.token = $1',
            [token]
        );
        
        if (userResult.rows.length === 0) {
            return res.render('error', {
                title: '카드를 찾을 수 없음',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }

        const user = userResult.rows[0];
        
        // 유효기간 검증
        if (user.expiration_end) {
            const now = new Date();
            const expirationEnd = new Date(user.expiration_end);
            
            if (now > expirationEnd) {
                return res.render('error', {
                    title: 'Card Expired',
                    message: 'This Save Card has expired. Please get a new card.',
                    error: { status: 410 }
                });
            }
        }

        const storesResult = await pool.query(
            'SELECT * FROM stores ORDER BY usage_count DESC NULLS LAST, name ASC'
        );

        // 해당 사용자의 사용 이력 조회
        const usagesResult = await pool.query(`
            SELECT u.*, s.name AS store_name
            FROM usages u
            LEFT JOIN stores s 
              ON LOWER(REPLACE(s.name, ' ', '')) = LOWER(REPLACE(u.store_code, ' ', ''))
            WHERE u.token = $1
            ORDER BY u.used_at DESC
            LIMIT 10
        `, [user.token]);

        res.render('card', {
            title: '괌세이브카드 사용',
            user: user,
            stores: storesResult.rows,
            usages: usagesResult.rows,
            success: req.query.success || null,
            error: req.query.error || null
        });

    } catch (error) {
        console.error('카드 페이지 오류:', error);
        res.render('error', {
            title: '시스템 오류',
            message: '카드 정보를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

app.post('/card/use', async (req, res) => {
    const { token, store_code } = req.body;

    if (!token || !store_code) {
        return res.json({
            success: false,
            message: '토큰과 제휴처명을 모두 입력해주세요.'
        });
    }

    try {
        const userResult = await pool.query(
            'SELECT * FROM users WHERE token = $1',
            [token]
        );
        
        if (userResult.rows.length === 0) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }

        const user = userResult.rows[0];

        // 유효기간 검증
        if (user.expiration_end) {
            const now = new Date();
            const expirationEnd = new Date(user.expiration_end);
            
            if (now > expirationEnd) {
                return res.json({
                    success: false,
                    message: 'This Save Card has expired. Please get a new card.'
                });
            }
        }

        // 사용 이력 저장
        await pool.query(`
            INSERT INTO usages (token, store_code, used_at, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            token,
            store_code.trim(),
            new Date().toISOString(),
            req.ip || '',
            req.get('User-Agent') || ''
        ]);

        // 제휴업체 사용 횟수 증가
        try {
            const storeResult = await pool.query(`
                SELECT * FROM stores 
                WHERE LOWER(name) LIKE LOWER($1) OR LOWER(REPLACE(name, ' ', '')) LIKE LOWER(REPLACE($1, ' ', ''))
                LIMIT 1
            `, [`%${store_code.trim()}%`]);
            
            if (storeResult.rows.length > 0) {
                const store = storeResult.rows[0];
                await pool.query(
                    'UPDATE stores SET usage_count = COALESCE(usage_count, 0) + 1 WHERE id = $1',
                    [store.id]
                );
                
                console.log(`제휴업체 "${store.name}" 사용 횟수 증가: ${(store.usage_count || 0) + 1}`);
            }
        } catch (storeUpdateError) {
            console.error('제휴업체 사용 횟수 업데이트 오류:', storeUpdateError);
            // 사용 횟수 업데이트 실패해도 카드 사용은 성공으로 처리
        }

        res.json({
            success: true,
            message: '할인 사용이 완료되었습니다!'
        });

    } catch (error) {
        console.error('카드 사용 처리 오류:', error);
        res.json({
            success: false,
            message: '사용 처리 중 오류가 발생했습니다.'
        });
    }
});

// ==================== 관리자 ====================
app.get('/admin/login', (req, res) => {
    if (req.session.adminId) {
        return res.redirect('/admin');
    }
    res.render('admin/login', {
        title: '관리자 로그인',
        error: null
    });
});

app.post('/admin/login', async (req, res) => {
    const { username, password } = req.body;

    // 간단한 하드코딩된 관리자 계정
    if (username === 'luxfind01' && password === 'vasco01@') {
        req.session.adminId = 1;
        req.session.adminUsername = 'luxfind01';
        res.redirect('/admin');
    } else {
        res.render('admin/login', {
            title: '관리자 로그인',
            error: '아이디 또는 비밀번호가 잘못되었습니다.'
        });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// 관리자 대시보드
app.get('/admin', requireAuth, async (req, res) => {
    try {
        const stats = {
            totalUsers: 0,
            totalUsages: 0,
            totalStores: 0,
            totalAgencies: 0
        };
        
        const userCountResult = await pool.query('SELECT COUNT(*) FROM users');
        stats.totalUsers = parseInt(userCountResult.rows[0].count);
        
        const usageCountResult = await pool.query('SELECT COUNT(*) FROM usages');
        stats.totalUsages = parseInt(usageCountResult.rows[0].count);
        
        const storeCountResult = await pool.query('SELECT COUNT(*) FROM stores');
        stats.totalStores = parseInt(storeCountResult.rows[0].count);
        
        const agencyCountResult = await pool.query('SELECT COUNT(*) FROM agencies');
        stats.totalAgencies = parseInt(agencyCountResult.rows[0].count);
        
        // 최근 사용 이력 조회
        const recentUsagesResult = await pool.query(`
            SELECT u.*, us.customer_name, s.name AS store_name, a.name AS agency_name
            FROM usages u
            LEFT JOIN users us ON u.token = us.token
            LEFT JOIN stores s 
              ON LOWER(REPLACE(s.name, ' ', '')) = LOWER(REPLACE(u.store_code, ' ', ''))
            LEFT JOIN agencies a ON us.agency_id = a.id
            ORDER BY u.used_at DESC
            LIMIT 10
        `);
        
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: stats,
            recentUsages: recentUsagesResult.rows,
            adminUsername: req.session.adminUsername || 'Admin'
        });
    } catch (error) {
        console.error('대시보드 통계 조회 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: { totalUsers: 0, totalUsages: 0, totalStores: 0, totalAgencies: 0 },
            recentUsages: [],
            adminUsername: req.session.adminUsername || 'Admin'
        });
    }
});

// 제휴업체 신청 API
app.post('/partner-application', async (req, res) => {
    console.log('📝 제휴업체 신청 API 호출');
    console.log('Request body:', req.body);
    
    try {
        const { businessName, email, contactName } = req.body;
        // phone은 스키마에서 NOT NULL이므로 값이 없으면 빈 문자열로 저장
        const phone = (req.body.phone || '').toString().trim();
        
        console.log('추출된 데이터:', { businessName, email, contactName, phone });
        
        // 입력 검증
        if (!businessName || !email || !contactName) {
            console.log('❌ 입력 검증 실패:', { businessName, email, contactName });
            return res.status(400).json({ 
                success: false, 
                message: '모든 필드를 입력해주세요.' 
            });
        }
        
        // 새로운 신청 데이터 저장
        await pool.query(`
            INSERT INTO partner_applications (business_name, contact_name, phone, email, status, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            businessName,
            contactName,
            phone,
            email,
            'pending',
            new Date().toISOString()
        ]);
        
        console.log('새로운 제휴업체 신청 저장 완료');
        
        res.json({ 
            success: true, 
            message: '신청이 성공적으로 접수되었습니다.' 
        });
        
    } catch (error) {
        console.error('제휴업체 신청 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '서버 오류가 발생했습니다.' 
        });
    }
});

// 관리자 - 제휴업체 신청 관리
app.get('/admin/partner-applications', requireAuth, async (req, res) => {
    try {
        const applicationsResult = await pool.query(`
            SELECT * FROM partner_applications 
            ORDER BY created_at DESC
        `);
        
        res.render('admin/partner-applications', {
            title: '제휴업체 신청 관리',
            applications: applicationsResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('제휴업체 신청 목록 조회 오류:', error);
        res.render('admin/partner-applications', {
            title: '제휴업체 신청 관리',
            applications: [],
            adminUsername: req.session?.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.'
        });
    }
});

// 관리자 - 여행사 관리
app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agenciesResult = await pool.query(`
            SELECT * FROM agencies 
            ORDER BY sort_order ASC, name ASC
        `);
        
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: agenciesResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('여행사 목록 조회 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: [],
            adminUsername: req.session.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/agencies', requireAuth, async (req, res) => {
    const { name, agency_code, contact_email, contact_phone, sort_order } = req.body;
    
    try {
        await pool.query(`
            INSERT INTO agencies (name, agency_code, contact_email, contact_phone, sort_order)
            VALUES ($1, $2, $3, $4, $5)
        `, [name, agency_code, contact_email, contact_phone, sort_order || 999]);
        
        res.redirect('/admin/agencies');
    } catch (error) {
        console.error('여행사 추가 오류:', error);
        res.redirect('/admin/agencies?error=add_failed');
    }
});

app.delete('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM agencies WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('여행사 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

app.put('/admin/agencies/:id', requireAuth, async (req, res) => {
    const { name, agency_code, contact_email, contact_phone, sort_order } = req.body;
    
    try {
        await pool.query(`
            UPDATE agencies 
            SET name = $1, agency_code = $2, contact_email = $3, contact_phone = $4, sort_order = $5, updated_at = CURRENT_TIMESTAMP
            WHERE id = $6
        `, [name, agency_code, contact_email, contact_phone, sort_order, req.params.id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('여행사 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

// 관리자 - 제휴업체 관리
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const storesResult = await pool.query(`
            SELECT * FROM stores 
            ORDER BY usage_count DESC NULLS LAST, name ASC
        `);
        
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: storesResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('제휴업체 목록 조회 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: [],
            adminUsername: req.session.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/stores', requireAuth, async (req, res) => {
    const { name, category, discount, location, address, phone, hours, description, image_url } = req.body;
    const loc = (address && address.trim()) ? address.trim() : (location || null);
    
    try {
        await pool.query(`
            INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [name, category, discount, loc, phone, hours, description, image_url, 0]);
        
        res.redirect('/admin/stores');
    } catch (error) {
        console.error('제휴업체 추가 오류:', error);
        res.redirect('/admin/stores?error=add_failed');
    }
});

app.put('/admin/stores/:id', requireAuth, async (req, res) => {
    const { name, category, discount, location, address, phone, hours, description, image_url, usage_count } = req.body;
    const loc = (address && address.trim()) ? address.trim() : (location || null);
    
    try {
        await pool.query(`
            UPDATE stores 
            SET name = $1, category = $2, discount = $3, location = $4, phone = $5, 
                hours = $6, description = $7, image_url = $8, usage_count = $9, updated_at = CURRENT_TIMESTAMP
            WHERE id = $10
        `, [name, category, discount, loc, phone, hours, description, image_url, usage_count, req.params.id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('제휴업체 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

// 관리자 - 제휴업체 단건 조회 (수정 모달용)
app.get('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM stores WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ message: 'not_found' });
        const row = result.rows[0];
        // 뷰와의 키 정합: address는 location을 매핑, website는 스키마에 없어 null 반환
        res.json({
            id: row.id,
            name: row.name,
            category: row.category,
            description: row.description,
            discount: row.discount,
            address: row.location,
            phone: row.phone,
            website: null,
            image_url: row.image_url,
            usage_count: row.usage_count,
            is_active: row.is_active
        });
    } catch (error) {
        console.error('제휴업체 단건 조회 오류:', error);
        res.status(500).json({ message: 'server_error' });
    }
});

// 관리자 - 제휴업체 활성/비활성 토글
app.post('/admin/stores/:id/toggle', requireAuth, async (req, res) => {
    try {
        const cur = await pool.query('SELECT is_active FROM stores WHERE id = $1', [req.params.id]);
        if (cur.rows.length === 0) return res.json({ success: false, message: 'not_found' });
        const next = cur.rows[0].is_active === true ? false : true;
        await pool.query('UPDATE stores SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [next, req.params.id]);
        res.json({ success: true, is_active: next });
    } catch (error) {
        console.error('제휴업체 토글 오류:', error);
        res.json({ success: false, message: '토글 중 오류가 발생했습니다.' });
    }
});

app.delete('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM stores WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('제휴업체 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// 관리자 - 레거시 제휴업체 데이터(stores.json) 백필
app.get('/admin/tools/backfill-stores', requireAuth, async (req, res) => {
    try {
        const storesPath = path.join(__dirname, 'data', 'stores.json');
        if (!fs.existsSync(storesPath)) {
            return res.status(404).send('stores.json 파일을 찾을 수 없습니다. (data/stores.json)');
        }

        const stores = JSON.parse(fs.readFileSync(storesPath, 'utf8'));
        let updated = 0;
        let inserted = 0;

        for (const s of stores) {
            const name = (s.name || '').trim();
            if (!name) continue;
            const category = s.category || null;
            const discount = s.discount || s.discount_info || null;
            const location = (s.address && s.address.trim()) ? s.address.trim() : (s.location || null);
            const phone = s.phone || null;
            const hours = s.hours || null;
            const description = s.description || null;
            const image_url = s.image_url || s.imageUrl || null;
            const usage_count = Number.isFinite(s.usage_count) ? s.usage_count : 0;

            // 우선 이름(case-insensitive)으로 업데이트 시도
            const up = await pool.query(`
                UPDATE stores
                SET category = $2, discount = $3, location = $4, phone = $5, hours = $6,
                    description = $7, image_url = $8, updated_at = CURRENT_TIMESTAMP
                WHERE LOWER(name) = LOWER($1)
            `, [name, category, discount, location, phone, hours, description, image_url]);

            if (up.rowCount > 0) {
                updated += up.rowCount;
                // 사용 횟수는 기존 값 보존 기본. 필요 시 덮어쓰기 원하면 아래 주석 해제
                // await pool.query('UPDATE stores SET usage_count = $2 WHERE LOWER(name)=LOWER($1)', [name, usage_count]);
                continue;
            }

            // 없으면 신규 삽입
            await pool.query(`
                INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count, is_active)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
            `, [name, category, discount, location, phone, hours, description, image_url, usage_count]);
            inserted += 1;
        }

        const msg = `백필 완료 - 업데이트: ${updated}건, 신규: ${inserted}건`;
        console.log('🛠  ' + msg);
        // 관리자 스토어 페이지로 리다이렉트하며 결과 노출
        return res.redirect(`/admin/stores?success=${encodeURIComponent(msg)}`);
    } catch (error) {
        console.error('레거시 제휴업체 백필 오류:', error);
        return res.redirect('/admin/stores?error=' + encodeURIComponent('백필 중 오류가 발생했습니다.'));
    }
});

// 관리자 - 배너 관리
app.get('/admin/banners', requireAuth, async (req, res) => {
    try {
        const bannersResult = await pool.query(`
            SELECT * FROM banners 
            ORDER BY display_order ASC, created_at DESC
        `);
        
        res.render('admin/banners', {
            title: '배너 관리',
            banners: bannersResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null
        });
    } catch (error) {
        console.error('배너 목록 조회 오류:', error);
        res.render('admin/banners', {
            title: '배너 관리',
            banners: [],
            adminUsername: req.session.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/banners', requireAuth, async (req, res) => {
    const { advertiser_name, title, image_url, link_url, display_order, display_locations, description } = req.body;
    
    try {
        let locations = [];
        if (Array.isArray(display_locations)) {
            locations = display_locations.map(v => parseInt(v)).filter(v => !Number.isNaN(v));
        } else if (display_locations) {
            const v = parseInt(display_locations);
            if (!Number.isNaN(v)) locations = [v];
        } else {
            locations = [1];
        }
        const finalTitle = (title && title.trim()) ? title.trim() : (advertiser_name || '').trim();
        await pool.query(`
            INSERT INTO banners (title, advertiser_name, image_url, link_url, description, display_order, display_locations, is_active)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [finalTitle, advertiser_name, image_url, link_url, description || null, display_order || 0, locations, true]);
        
        res.redirect('/admin/banners');
    } catch (error) {
        console.error('배너 추가 오류:', error);
        res.redirect('/admin/banners?error=add_failed');
    }
});

app.put('/admin/banners/:id', requireAuth, async (req, res) => {
    const { advertiser_name, title, image_url, link_url, description, display_order, display_locations, is_active } = req.body;
    
    try {
        let locations = [];
        if (Array.isArray(display_locations)) {
            locations = display_locations.map(v => parseInt(v)).filter(v => !Number.isNaN(v));
        } else if (display_locations) {
            const v = parseInt(display_locations);
            if (!Number.isNaN(v)) locations = [v];
        }
        const finalTitle = (title && title.trim()) ? title.trim() : (advertiser_name || '').trim();
        await pool.query(`
            UPDATE banners 
            SET title = $1, advertiser_name = $2, image_url = $3, link_url = $4, description = $5, display_order = $6, 
                display_locations = $7, is_active = $8, updated_at = CURRENT_TIMESTAMP
            WHERE id = $9
        `, [finalTitle, advertiser_name, image_url, link_url, description || null, display_order, locations, is_active, req.params.id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('배너 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM banners WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('배너 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

app.post('/admin/banners/:id/toggle', requireAuth, async (req, res) => {
    try {
        await pool.query(`
            UPDATE banners 
            SET is_active = NOT is_active, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
        `, [req.params.id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('배너 활성화 토글 오류:', error);
        res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
    }
});

// 관리자 - 사용자 관리
app.get('/admin/users', requireAuth, async (req, res) => {
    try {
        const usersResult = await pool.query(`
            SELECT u.*, a.name as agency_name 
            FROM users u 
            LEFT JOIN agencies a ON u.agency_id = a.id 
            ORDER BY u.issued_at DESC
        `);
        
        res.render('admin/users', {
            title: '사용자 관리',
            users: usersResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null,
            totalPages: 1,
            currentPage: 1
        });
    } catch (error) {
        console.error('사용자 목록 조회 오류:', error);
        res.render('admin/users', {
            title: '사용자 관리',
            users: [],
            adminUsername: req.session.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.',
            totalPages: 1,
            currentPage: 1
        });
    }
});

// 관리자 - 사용 이력 관리
app.get('/admin/usages', requireAuth, async (req, res) => {
    try {
        const usagesResult = await pool.query(`
            SELECT u.*, us.customer_name, a.name as agency_name
            FROM usages u
            LEFT JOIN users us ON u.token = us.token
            LEFT JOIN agencies a ON us.agency_id = a.id
            ORDER BY u.used_at DESC
            LIMIT 1000
        `);
        
        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: usagesResult.rows,
            adminUsername: req.session.adminUsername || 'Admin',
            success: req.query.success || null,
            error: req.query.error || null,
            totalPages: 1,
            currentPage: 1
        });
    } catch (error) {
        console.error('사용 이력 조회 오류:', error);
        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: [],
            adminUsername: req.session.adminUsername || 'Admin',
            success: null,
            error: '데이터 조회 중 오류가 발생했습니다.',
            totalPages: 1,
            currentPage: 1
        });
    }
});

// 배너 클릭 추적
app.post('/banner/click/:id', async (req, res) => {
    try {
        await pool.query(`
            UPDATE banners 
            SET click_count = COALESCE(click_count, 0) + 1 
            WHERE id = $1
        `, [req.params.id]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('배너 클릭 추적 오류:', error);
        res.json({ success: false });
    }
});

// 서버 시작
async function startServer() {
    try {
        // 데이터베이스 연결 테스트
        await pool.query('SELECT 1');
        console.log('✅ PostgreSQL 연결 성공!');
        
        app.listen(PORT, () => {
            console.log(`🚀 서버가 포트 ${PORT}에서 실행 중입니다.`);
            console.log(`📱 메인 페이지: http://localhost:${PORT}`);
            console.log(`🔧 관리자 페이지: http://localhost:${PORT}/admin`);
        });
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

startServer();
