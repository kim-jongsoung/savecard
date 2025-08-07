const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const QRCode = require('qrcode');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const jsonDB = require('./utils/jsonDB');

const app = express();
const PORT = process.env.PORT || 3000;

// QR 코드 저장 디렉토리 생성
const qrDir = path.join(__dirname, 'qrcodes');
fs.ensureDirSync(qrDir);

// 미들웨어 설정
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 세션 설정
app.use(session({
    secret: 'guam-savecard-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

// EJS 템플릿 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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

// ==================== 메인 페이지 ====================
app.get('/', async (req, res) => {
    try {
        // 메인 페이지용 배너 조회 (위치 1)
        const allBanners = await jsonDB.findAll('banners', { is_active: true });
        const mainPageBanners = allBanners.filter(banner => 
            banner.display_locations && banner.display_locations.includes(1)
        ).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

        res.render('index', {
            title: '괌세이브카드',
            message: '괌 여행의 필수 할인카드',
            banners: mainPageBanners
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
        const stores = await jsonDB.findAll('stores', { is_active: true });
        
        // 사용 횟수 순으로 정렬 (많은 순부터)
        const sortedStores = stores.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
        
        // 카테고리별로 그룹화 (정렬된 순서 유지)
        const categories = {};
        sortedStores.forEach(store => {
            if (!categories[store.category]) {
                categories[store.category] = [];
            }
            categories[store.category].push(store);
        });
        
        // 제휴업체 목록 페이지용 배너 조회 (위치 3)
        const allBanners = await jsonDB.findAll('banners', { is_active: true });
        const storesPageBanners = allBanners.filter(banner => 
            banner.display_locations && banner.display_locations.includes(3)
        ).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

        res.render('stores', {
            title: '제휴업체 목록',
            stores: sortedStores,
            categories: categories,
            banners: storesPageBanners
        });

    } catch (error) {
        console.error('제휴업체 목록 조회 오류:', error);
        res.render('stores', {
            title: '제휴업체 목록',
            stores: [],
            categories: {}
        });
    }
});

// ==================== 카드 발급 ====================
app.get('/register', async (req, res) => {
    try {
        const agencies = await jsonDB.read('agencies');
        // 순위별로 정렬
        const sortedAgencies = agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
        
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: sortedAgencies,
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
    const { customer_name, agency_code, password, password_confirm } = req.body;

    try {
        if (!customer_name || !agency_code || !password || !password_confirm) {
            const agencies = await jsonDB.read('agencies');
            const sortedAgencies = agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: sortedAgencies,
                error: '모든 필드를 입력해주세요.',
                success: null
            });
        }
        
        // 4자리 숫자 비밀번호 검증
        const passwordRegex = /^[0-9]{4}$/;
        if (!passwordRegex.test(password)) {
            const agencies = await jsonDB.read('agencies');
            const sortedAgencies = agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: sortedAgencies,
                error: '비밀번호는 4자리 숫자로 입력해주세요.',
                success: null
            });
        }
        
        // 비밀번호 일치 검증
        if (password !== password_confirm) {
            const agencies = await jsonDB.read('agencies');
            const sortedAgencies = agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: sortedAgencies,
                error: '비밀번호가 일치하지 않습니다.',
                success: null
            });
        }

        // 여행사 확인
        const agency = await jsonDB.findOne('agencies', { agency_code });
        if (!agency) {
            const agencies = await jsonDB.read('agencies');
            const sortedAgencies = agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
            return res.render('register', {
                title: '괌세이브카드 발급',
                agencies: sortedAgencies,
                error: '유효하지 않은 여행사 코드입니다.',
                success: null
            });
        }

        const token = uuidv4();
        
        // 유효기간 설정 (발급월의 1일부터 말일까지)
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth(); // 0-based month
        
        const expirationStart = new Date(year, month, 1); // 해당월 1일
        const expirationEnd = new Date(year, month + 1, 0); // 해당월 마지막 날
        
        // 날짜 포맷 (MMM/DD/YY)
        const formatDate = (date) => {
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                               'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
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
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // 사용자 정보 저장
        await jsonDB.insert('users', {
            customer_name,
            agency_id: agency.id,
            token,
            password, // 4자리 비밀번호 저장
            qr_image_path: `/qrcodes/${qrFileName}`,
            expiration_start: expirationStart.toISOString(),
            expiration_end: expirationEnd.toISOString(),
            expiration_text: expirationText,
            issued_at: now.toISOString()
        });

        res.redirect(`/register/success?token=${token}`);

    } catch (error) {
        console.error('카드 발급 오류:', error);
        const agencies = await jsonDB.read('agencies');
        res.render('register', {
            title: '괌세이브카드 발급',
            agencies: agencies,
            error: '카드 발급 중 오류가 발생했습니다.',
            success: null
        });
    }
});

app.get('/register/success', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.redirect('/register');
    }

    try {
        const user = await jsonDB.findOne('users', { token });
        if (!user) {
            return res.redirect('/register');
        }

        const agency = await jsonDB.findById('agencies', user.agency_id);
        const cardUrl = `${req.protocol}://${req.get('host')}/register/success?token=${token}`;
        
        // 발급 완료 페이지용 배너 조회 (위치 2)
        const allBanners = await jsonDB.findAll('banners', { is_active: true });
        const successPageBanners = allBanners.filter(banner => 
            banner.display_locations && banner.display_locations.includes(2)
        ).sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

        res.render('register-success', {
            title: '괌세이브카드 발급 완료',
            user: {
                ...user,
                agency_name: agency ? agency.name : 'Unknown'
            },
            cardUrl: cardUrl,
            qrImageUrl: user.qr_image_path,
            banners: successPageBanners
        });

    } catch (error) {
        console.error('발급 성공 페이지 오류:', error);
        res.redirect('/register');
    }
});

// 비밀번호 인증 API
app.post('/verify-password', async (req, res) => {
    const { token, password } = req.body;
    
    try {
        if (!token || !password) {
            return res.json({
                success: false,
                message: '토큰과 비밀번호를 모두 입력해주세요.'
            });
        }
        
        const user = await jsonDB.findOne('users', { token });
        if (!user) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }
        
        // 비밀번호 검증
        if (user.password !== password) {
            return res.json({
                success: false,
                message: '비밀번호가 일치하지 않습니다.'
            });
        }
        
        // 카드 만료 확인
        const now = new Date();
        const expirationEnd = new Date(user.expiration_end);
        if (now > expirationEnd) {
            return res.json({
                success: false,
                message: '만료된 카드입니다.'
            });
        }
        
        res.json({
            success: true,
            message: '인증 성공'
        });
        
    } catch (error) {
        console.error('비밀번호 인증 오류:', error);
        res.json({
            success: false,
            message: '인증 중 오류가 발생했습니다.'
        });
    }
});

// ==================== 카드 페이지 ====================
app.get('/card', async (req, res) => {
    const { token } = req.query;

    if (!token) {
        return res.render('error', {
            title: '잘못된 접근',
            message: '유효하지 않은 카드입니다.',
            error: { status: 400 }
        });
    }

    try {
        const user = await jsonDB.findOne('users', { token });
        if (!user) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }

        const agency = await jsonDB.findById('agencies', user.agency_id);
        
        // 활성화된 광고 배너 조회 (랜덤)
        const banners = await jsonDB.findAll('banners', { is_active: true });
        const banner = banners.length > 0 ? banners[Math.floor(Math.random() * banners.length)] : null;

        // 사용 이력 조회 (최근 5개)
        const allUsages = await jsonDB.findAll('usages', { token });
        const usages = allUsages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(0, 5);

        // 제휴업체 목록 조회
        const stores = await jsonDB.read('stores');

        res.render('card', {
            title: '괌세이브카드',
            user: {
                ...user,
                agency_name: agency ? agency.name : 'Unknown'
            },
            banner: banner,
            usages: usages,
            stores: stores,
            success: null,
            error: null
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
        const user = await jsonDB.findOne('users', { token });
        if (!user) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }

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
        await jsonDB.insert('usages', {
            token,
            store_code: store_code.trim(),
            used_at: new Date().toISOString(),
            ip_address: req.ip || '',
            user_agent: req.get('User-Agent') || ''
        });

        // 제휴업체 사용 횟수 증가
        try {
            const stores = await jsonDB.read('stores');
            const storeIndex = stores.findIndex(store => 
                store.name.toLowerCase().includes(store_code.trim().toLowerCase()) ||
                store.name.toLowerCase().replace(/[()\s]/g, '').includes(store_code.trim().toLowerCase().replace(/[()\s]/g, ''))
            );
            
            if (storeIndex !== -1) {
                const store = stores[storeIndex];
                const newUsageCount = (store.usage_count || 0) + 1;
                
                await jsonDB.update('stores', store.id, {
                    usage_count: newUsageCount
                });
                
                console.log(`제휴업체 "${store.name}" 사용 횟수 증가: ${newUsageCount}`);
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

// 제휴업체 신청 API
app.post('/partner-application', (req, res) => {
    console.log('📝 제휴업체 신청 API 호출');
    console.log('Request body:', req.body);
    console.log('Request headers:', req.headers);
    
    try {
        const { businessName, email, contactName } = req.body;
        
        console.log('추출된 데이터:', { businessName, email, contactName });
        
        // 입력 검증
        if (!businessName || !email || !contactName) {
            console.log('❌ 입력 검증 실패:', { businessName, email, contactName });
            return res.status(400).json({ 
                success: false, 
                message: '모든 필드를 입력해주세요.' 
            });
        }
        
        // 새로운 신청 데이터
        const newApplication = {
            id: Date.now().toString(),
            businessName,
            email,
            contactName,
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        // 파일에서 기존 신청 목록 읽기
        let applications = [];
        try {
            const data = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(data);
        } catch (error) {
            // 파일이 없으면 빈 배열로 시작
            applications = [];
        }
        
        // 새 신청 추가
        applications.push(newApplication);
        
        // 파일에 저장
        fs.writeFileSync(
            path.join(__dirname, 'data', 'partner-applications.json'),
            JSON.stringify(applications, null, 2)
        );
        
        console.log('새로운 제휴업체 신청:', newApplication);
        
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

// 테스트 라우트 - stores 데이터 확인
app.get('/test-stores', async (req, res) => {
    try {
        console.log('=== stores 데이터 테스트 시작 ===');
        const stores = await jsonDB.read('stores');
        console.log('stores 파일에서 읽은 데이터 개수:', stores.length);
        console.log('첫 번째 store 데이터:', stores[0]);
        
        res.json({
            success: true,
            count: stores.length,
            sample: stores.slice(0, 3)
        });
    } catch (error) {
        console.error('stores 데이터 읽기 오류:', error);
        res.json({
            success: false,
            error: error.message
        });
    }
});

app.get('/admin', requireAuth, async (req, res) => {
    try {
        console.log('=== 관리자 대시보드 데이터 로드 시작 ===');
        const stats = await jsonDB.getStats();
        console.log('가져온 통계 데이터:', stats);
        
        const recentUsages = await jsonDB.getRecentUsages(10);
        console.log('최근 사용 내역 개수:', recentUsages.length);

        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: stats,
            recentUsages: recentUsages,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('대시보드 오류:', error);
        res.render('admin/dashboard', {
            title: '관리자 대시보드',
            stats: { total_agencies: 0, total_users: 0, total_usages: 0, total_stores: 0, active_banners: 0 },
            recentUsages: [],
            adminUsername: req.session.adminUsername
        });
    }
});

// 관리자 - 제휴업체 신청 관리 페이지 (새로 추가)
app.get('/admin/partner-applications', requireAuth, async (req, res) => {
    console.log('📋 [새 라우트] 제휴업체 신청 관리 페이지 접근됨');
    console.log('🔐 [새 라우트] 인증 상태:', { adminId: req.session.adminId, sessionExists: !!req.session });
    
    try {
        // 제휴업체 신청 데이터 읽기
        let applications = [];
        try {
            const data = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(data);
            console.log('📁 [새 라우트] 신청 데이터 로드 성공:', applications.length, '건');
        } catch (error) {
            console.log('📁 [새 라우트] 신청 데이터 파일 없음, 빈 배열 사용');
            applications = [];
        }
        
        // 최신 순으로 정렬
        applications.sort((a, b) => new Date(b.createdAt || b.applied_at) - new Date(a.createdAt || a.applied_at));
        
        console.log('🎨 [새 라우트] 템플릿 렌더링 시도 중...');
        res.render('admin/partner-applications', {
            title: '제휴업체 신청 관리',
            applications,
            adminUsername: req.session.adminUsername
        });
        
        console.log('✅ [새 라우트] 템플릿 렌더링 성공!');
        
    } catch (error) {
        console.error('❌ [새 라우트] 제휴업체 신청 목록 오류:', error);
        res.render('error', {
            title: '오류',
            message: '제휴업체 신청 목록을 불러올 수 없습니다.',
            error: { status: 500 }
        });
    }
});

app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agencies = await jsonDB.read('agencies');
        const users = await jsonDB.read('users');

        // 각 여행사별 사용자 수 계산 및 순위별 정렬
        const agenciesWithCount = agencies.map(agency => ({
            ...agency,
            user_count: users.filter(user => user.agency_id === agency.id).length
        })).sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));

        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: agenciesWithCount,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('여행사 목록 조회 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            agencies: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/agencies', requireAuth, async (req, res) => {
    const { name, agency_code, contact_email, contact_phone } = req.body;

    try {
        // 중복 코드 확인
        const existing = await jsonDB.findOne('agencies', { agency_code });
        if (existing) {
            return res.redirect('/admin/agencies?error=이미 존재하는 여행사 코드입니다.');
        }

        // 다음 순위 번호 계산
        const agencies = await jsonDB.read('agencies');
        const maxSortOrder = agencies.reduce((max, agency) => {
            return Math.max(max, agency.sort_order || 0);
        }, 0);

        await jsonDB.insert('agencies', {
            name,
            agency_code,
            contact_email: contact_email || null,
            contact_phone: contact_phone || null,
            sort_order: maxSortOrder + 1
        });

        res.redirect('/admin/agencies?success=여행사가 성공적으로 추가되었습니다.');

    } catch (error) {
        console.error('여행사 추가 오류:', error);
        res.redirect('/admin/agencies?error=여행사 추가 중 오류가 발생했습니다.');
    }
});

app.delete('/admin/agencies/:id', requireAuth, async (req, res) => {
    const agencyId = req.params.id;
    console.log(`여행사 삭제 요청: ID = ${agencyId}`);

    try {
        // 해당 여행사에 연결된 사용자가 있는지 확인
        console.log('사용자 데이터 읽는 중...');
        const users = await jsonDB.read('users');
        console.log(`전체 사용자 수: ${users.length}`);
        
        const connectedUsers = users.filter(user => user.agency_id == agencyId);
        console.log(`연결된 사용자 수: ${connectedUsers.length}`);
        
        // 연결된 고객들을 여행사 없음 상태로 변경
        if (connectedUsers.length > 0) {
            console.log(`${connectedUsers.length}명의 고객을 여행사 없음 상태로 변경 중...`);
            
            for (const user of connectedUsers) {
                await jsonDB.update('users', user.id, {
                    agency_id: null
                });
                console.log(`고객 ID ${user.id} (이름: ${user.customer_name})의 여행사를 null로 변경`);
            }
            
            console.log('모든 고객의 여행사 변경 완료');
        }

        console.log('여행사 삭제 시도 중...');
        const deleteResult = await jsonDB.delete('agencies', agencyId);
        console.log(`삭제 결과: ${deleteResult}`);
        
        if (deleteResult) {
            const message = connectedUsers.length > 0 
                ? `여행사가 성공적으로 삭제되었습니다. ${connectedUsers.length}명의 고객이 여행사 없음 상태로 변경되었습니다.`
                : '여행사가 성공적으로 삭제되었습니다.';
            
            console.log('여행사 삭제 성공');
            res.json({ success: true, message: message });
        } else {
            console.log('여행사 삭제 실패');
            res.json({ success: false, message: '여행사를 찾을 수 없거나 삭제에 실패했습니다.' });
        }

    } catch (error) {
        console.error('여행사 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// 여행사 정보 수정 API
app.put('/admin/agencies/:id', requireAuth, async (req, res) => {
    const agencyId = req.params.id;
    const { name, agency_code, contact_email, contact_phone } = req.body;

    try {
        // 기존 여행사 정보 확인
        const existingAgency = await jsonDB.findById('agencies', agencyId);
        if (!existingAgency) {
            return res.json({ success: false, message: '여행사를 찾을 수 없습니다.' });
        }

        // 다른 여행사에서 같은 코드를 사용하는지 확인
        if (agency_code !== existingAgency.agency_code) {
            const duplicateCode = await jsonDB.findOne('agencies', { agency_code });
            if (duplicateCode && duplicateCode.id != agencyId) {
                return res.json({ success: false, message: '이미 존재하는 여행사 코드입니다.' });
            }
        }

        await jsonDB.update('agencies', agencyId, {
            name: name || existingAgency.name,
            agency_code: agency_code || existingAgency.agency_code,
            contact_email: contact_email !== undefined ? contact_email : existingAgency.contact_email,
            contact_phone: contact_phone !== undefined ? contact_phone : existingAgency.contact_phone
        });

        res.json({ success: true, message: '여행사 정보가 성공적으로 수정되었습니다.' });

    } catch (error) {
        console.error('여행사 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

// 여행사 순위 조정 API
app.post('/admin/agencies/:id/move', requireAuth, async (req, res) => {
    const agencyId = parseInt(req.params.id);
    const { direction } = req.body; // 'up' 또는 'down'

    try {
        const agencies = await jsonDB.read('agencies');
        
        // sort_order로 정렬
        agencies.sort((a, b) => (a.sort_order || 999) - (b.sort_order || 999));
        
        const currentIndex = agencies.findIndex(agency => agency.id === agencyId);
        if (currentIndex === -1) {
            return res.json({ success: false, message: '여행사를 찾을 수 없습니다.' });
        }

        let targetIndex;
        if (direction === 'up' && currentIndex > 0) {
            targetIndex = currentIndex - 1;
        } else if (direction === 'down' && currentIndex < agencies.length - 1) {
            targetIndex = currentIndex + 1;
        } else {
            return res.json({ success: false, message: '더 이상 이동할 수 없습니다.' });
        }

        // 순위 교체
        const currentAgency = agencies[currentIndex];
        const targetAgency = agencies[targetIndex];
        
        const tempOrder = currentAgency.sort_order;
        await jsonDB.update('agencies', currentAgency.id, { sort_order: targetAgency.sort_order });
        await jsonDB.update('agencies', targetAgency.id, { sort_order: tempOrder });

        res.json({ success: true, message: '순위가 성공적으로 변경되었습니다.' });

    } catch (error) {
        console.error('여행사 순위 조정 오류:', error);
        res.json({ success: false, message: '순위 조정 중 오류가 발생했습니다.' });
    }
});

// 여행사 정보 조회 API (수정 모달용)
app.get('/admin/agencies/:id', requireAuth, async (req, res) => {
    const agencyId = req.params.id;

    try {
        const agency = await jsonDB.findById('agencies', agencyId);
        if (!agency) {
            return res.json({ success: false, message: '여행사를 찾을 수 없습니다.' });
        }

        res.json({ success: true, agency });

    } catch (error) {
        console.error('여행사 정보 조회 오류:', error);
        res.json({ success: false, message: '정보 조회 중 오류가 발생했습니다.' });
    }
});

app.get('/admin/users', requireAuth, async (req, res) => {
    try {
        const users = await jsonDB.getUsersWithAgency();

        res.render('admin/users', {
            title: '고객 관리',
            users: users,
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('고객 목록 조회 오류:', error);
        res.render('admin/users', {
            title: '고객 관리',
            users: [],
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });
    }
});

app.get('/admin/usages', requireAuth, async (req, res) => {
    try {
        const usages = await jsonDB.getUsagesWithDetails();

        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: usages,
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });

    } catch (error) {
        console.error('사용 이력 조회 오류:', error);
        res.render('admin/usages', {
            title: '사용 이력 관리',
            usages: [],
            currentPage: 1,
            totalPages: 1,
            adminUsername: req.session.adminUsername
        });
    }
});

app.get('/admin/banners', requireAuth, async (req, res) => {
    try {
        const banners = await jsonDB.read('banners');

        res.render('admin/banners', {
            title: '광고 배너 관리',
            banners: banners,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('배너 목록 조회 오류:', error);
        res.render('admin/banners', {
            title: '광고 배너 관리',
            banners: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/banners', requireAuth, async (req, res) => {
    const { advertiser_name, image_url, link_url, display_order } = req.body;

    try {
        await jsonDB.insert('banners', {
            advertiser_name,
            image_url,
            link_url: link_url || null,
            display_order: parseInt(display_order) || 0,
            is_active: true
        });

        res.redirect('/admin/banners?success=광고 배너가 성공적으로 추가되었습니다.');

    } catch (error) {
        console.error('배너 추가 오류:', error);
        res.redirect('/admin/banners?error=배너 추가 중 오류가 발생했습니다.');
    }
});

app.post('/admin/banners/:id/toggle', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        const banner = await jsonDB.findById('banners', bannerId);
        if (!banner) {
            return res.json({ success: false, message: '배너를 찾을 수 없습니다.' });
        }

        await jsonDB.update('banners', bannerId, {
            is_active: !banner.is_active
        });

        res.json({ success: true });

    } catch (error) {
        console.error('배너 상태 변경 오류:', error);
        res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
    }
});

app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        await jsonDB.delete('banners', bannerId);
        res.json({ success: true });

    } catch (error) {
        console.error('배너 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// ==================== 제휴업체 관리 ====================
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const stores = await jsonDB.read('stores');

        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: stores,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });

    } catch (error) {
        console.error('제휴업체 목록 조회 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

app.post('/admin/stores', requireAuth, async (req, res) => {
    const { name, category, description, discount_info, address, phone, website, image_url } = req.body;

    try {
        await jsonDB.insert('stores', {
            name,
            category,
            description,
            discount_info,
            address: address || null,
            phone: phone || null,
            website: website || null,
            image_url: image_url || 'https://via.placeholder.com/300x200/667eea/FFFFFF?text=' + encodeURIComponent(name),
            is_active: true
        });

        res.redirect('/admin/stores?success=제휴업체가 성공적으로 추가되었습니다.');

    } catch (error) {
        console.error('제휴업체 추가 오류:', error);
        res.redirect('/admin/stores?error=제휴업체 추가 중 오류가 발생했습니다.');
    }
});

app.post('/admin/stores/:id/toggle', requireAuth, async (req, res) => {
    const storeId = req.params.id;

    try {
        const store = await jsonDB.findById('stores', storeId);
        if (!store) {
            return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
        }

        await jsonDB.update('stores', storeId, {
            is_active: !store.is_active
        });

        res.json({ success: true });

    } catch (error) {
        console.error('제휴업체 상태 변경 오류:', error);
        res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
    }
});

app.delete('/admin/stores/:id', requireAuth, async (req, res) => {
    const storeId = req.params.id;

    try {
        await jsonDB.delete('stores', storeId);
        res.json({ success: true });

    } catch (error) {
        console.error('제휴업체 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

app.get('/admin/stores/:id', requireAuth, async (req, res) => {
    const storeId = req.params.id;

    try {
        const store = await jsonDB.findById('stores', storeId);
        
        if (store) {
            res.json(store);
        } else {
            res.status(404).json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
        }

    } catch (error) {
        console.error('제휴업체 조회 오류:', error);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

app.put('/admin/stores/:id', requireAuth, async (req, res) => {
    const storeId = req.params.id;
    const { name, category, description, discount_info, address, phone, website, image_url, usage_count } = req.body;

    console.log('=== 제휴업체 정보 수정 API 호출 ===');
    console.log('Store ID:', storeId);
    console.log('Request Body:', req.body);
    console.log('Usage Count:', usage_count);

    try {
        const updateData = {
            name,
            category,
            description,
            discount_info,
            address: address || null,
            phone: phone || null,
            website: website || null,
            image_url: image_url || null
        };
        
        // 사용 횟수가 제공된 경우에만 업데이트
        if (usage_count !== undefined && usage_count !== null) {
            const parsedUsageCount = parseInt(usage_count);
            if (!isNaN(parsedUsageCount) && parsedUsageCount >= 0) {
                updateData.usage_count = parsedUsageCount;
                console.log('사용 횟수 업데이트:', parsedUsageCount);
            }
        }
        
        const updatedStore = await jsonDB.update('stores', storeId, updateData);

        if (updatedStore) {
            res.json({ success: true });
        } else {
            res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
        }

    } catch (error) {
        console.error('제휴업체 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

// ==================== 배너 광고 관리 ====================
app.post('/admin/banners', requireAuth, async (req, res) => {
    const { advertiser_name, image_url, link_url, description, display_order, display_locations, start_date, end_date } = req.body;

    try {
        // 노출 위치 배열로 변환 (체크박스에서 오는 데이터 처리)
        let locations = [];
        if (display_locations) {
            if (Array.isArray(display_locations)) {
                locations = display_locations.map(loc => parseInt(loc));
            } else {
                locations = [parseInt(display_locations)];
            }
        }

        if (locations.length === 0) {
            return res.redirect('/admin/banners?error=노출 위치를 최소 1개 이상 선택해주세요.');
        }

        // 기간 설정 처리
        const now = new Date();
        const startDate = start_date ? new Date(start_date) : now;
        const endDate = end_date ? new Date(end_date) : new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1년 후

        if (endDate <= startDate) {
            return res.redirect('/admin/banners?error=종료일은 시작일보다 늦어야 합니다.');
        }

        await jsonDB.insert('banners', {
            advertiser_name,
            image_url,
            link_url: link_url || null,
            description: description || '',
            display_order: parseInt(display_order) || 0,
            display_locations: locations,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            click_count: 0,
            is_active: true
        });

        res.redirect('/admin/banners?success=배너 광고가 성공적으로 추가되었습니다.');

    } catch (error) {
        console.error('배너 추가 오류:', error);
        res.redirect('/admin/banners?error=배너 추가 중 오류가 발생했습니다.');
    }
});

app.post('/admin/banners/:id/toggle', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        const banner = await jsonDB.findById('banners', bannerId);
        if (!banner) {
            return res.json({ success: false, message: '배너를 찾을 수 없습니다.' });
        }

        await jsonDB.update('banners', bannerId, {
            is_active: !banner.is_active
        });

        res.json({ success: true });

    } catch (error) {
        console.error('배너 상태 변경 오류:', error);
        res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
    }
});

app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
    const bannerId = req.params.id;

    try {
        await jsonDB.delete('banners', bannerId);
        res.json({ success: true });

    } catch (error) {
        console.error('배너 삭제 오류:', error);
        res.json({ success: false, message: '삭제 중 오류가 발생했습니다.' });
    }
});

// 배너 수정 API
app.put('/admin/banners/:id', requireAuth, async (req, res) => {
    const bannerId = req.params.id;
    const { advertiser_name, image_url, link_url, description, display_order, display_locations, start_date, end_date, click_count } = req.body;

    try {
        const banner = await jsonDB.findById('banners', bannerId);
        if (!banner) {
            return res.json({ success: false, message: '배너를 찾을 수 없습니다.' });
        }

        // 노출 위치 배열로 변환
        let locations = [];
        if (display_locations) {
            if (Array.isArray(display_locations)) {
                locations = display_locations.map(loc => parseInt(loc));
            } else {
                locations = [parseInt(display_locations)];
            }
        }

        if (locations.length === 0) {
            return res.json({ success: false, message: '노출 위치를 최소 1개 이상 선택해주세요.' });
        }

        // 기간 설정 처리
        const startDate = start_date ? new Date(start_date) : new Date(banner.start_date);
        const endDate = end_date ? new Date(end_date) : new Date(banner.end_date);

        if (endDate <= startDate) {
            return res.json({ success: false, message: '종료일은 시작일보다 늦어야 합니다.' });
        }

        await jsonDB.update('banners', bannerId, {
            advertiser_name: advertiser_name || banner.advertiser_name,
            image_url: image_url || banner.image_url,
            link_url: link_url !== undefined ? link_url : banner.link_url,
            description: description !== undefined ? description : banner.description,
            display_order: display_order !== undefined ? parseInt(display_order) : banner.display_order,
            display_locations: locations,
            start_date: startDate.toISOString(),
            end_date: endDate.toISOString(),
            click_count: click_count !== undefined ? parseInt(click_count) : banner.click_count
        });

        res.json({ success: true });

    } catch (error) {
        console.error('배너 수정 오류:', error);
        res.json({ success: false, message: '수정 중 오류가 발생했습니다.' });
    }
});

// 배너 클릭 추적 API
app.post('/banner/click/:id', async (req, res) => {
    const bannerId = req.params.id;

    try {
        const banner = await jsonDB.findById('banners', bannerId);
        if (!banner) {
            return res.json({ success: false, message: '배너를 찾을 수 없습니다.' });
        }

        // 클릭 수 증가
        await jsonDB.update('banners', bannerId, {
            click_count: (banner.click_count || 0) + 1
        });

        res.json({ success: true, click_count: (banner.click_count || 0) + 1 });

    } catch (error) {
        console.error('배너 클릭 추적 오류:', error);
        res.json({ success: false, message: '클릭 추적 중 오류가 발생했습니다.' });
    }
});

// 404 에러 핸들링
app.use((req, res) => {
    res.status(404).render('error', {
        title: '페이지를 찾을 수 없습니다',
        message: '요청하신 페이지가 존재하지 않습니다.',
        error: { status: 404 }
    });
});

// 에러 핸들링
app.use((err, req, res, next) => {
    console.error('서버 에러:', err);
    res.status(err.status || 500).render('error', {
        title: '서버 오류',
        message: '서버에서 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 사용 횟수 업데이트 테스트 페이지
app.get('/test-usage-update', requireAuth, (req, res) => {
    res.render('test-usage-update', {
        title: '사용 횟수 업데이트 테스트'
    });
});

// 관리자 제휴업체 관리 페이지
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const stores = await jsonDB.read('stores');
        
        // 사용 횟수 순으로 정렬 (많은 순부터)
        const sortedStores = stores.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0));
        
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: sortedStores,
            adminUsername: req.session.adminUsername,
            success: req.query.success,
            error: req.query.error
        });
        
    } catch (error) {
        console.error('제휴업체 목록 조회 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            stores: [],
            adminUsername: req.session.adminUsername,
            success: null,
            error: '데이터를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 제휴업체 사용 횟수 수정 API
app.put('/admin/stores/:id/usage-count', requireAuth, async (req, res) => {
    console.log('=== 사용 횟수 업데이트 API 호출 ===');
    console.log('Store ID:', req.params.id);
    console.log('Request Body:', req.body);
    console.log('Session:', req.session);
    
    const storeId = parseInt(req.params.id);
    const { usage_count } = req.body;
    
    console.log('Parsed Store ID:', storeId);
    console.log('Parsed Usage Count:', usage_count);
    
    if (isNaN(storeId)) {
        console.log('오류: 올바르지 않은 제휴업체 ID');
        return res.json({ success: false, message: '올바르지 않은 제휴업체 ID입니다.' });
    }
    
    if (usage_count === undefined || isNaN(usage_count) || usage_count < 0) {
        console.log('오류: 올바르지 않은 사용 횟수');
        return res.json({ success: false, message: '올바른 사용 횟수를 입력해주세요 (0 이상).' });
    }
    
    try {
        const store = await jsonDB.findById('stores', storeId);
        if (!store) {
            return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
        }
        
        await jsonDB.update('stores', storeId, {
            usage_count: parseInt(usage_count)
        });
        
        console.log(`제휴업체 "${store.name}" 사용 횟수 수정: ${usage_count}`);
        
        res.json({ 
            success: true, 
            message: '사용 횟수가 성공적으로 업데이트되었습니다.',
            usage_count: parseInt(usage_count)
        });
        
    } catch (error) {
        console.error('사용 횟수 업데이트 오류:', error);
        res.json({ success: false, message: '사용 횟수 업데이트 중 오류가 발생했습니다.' });
    }
});

// 관리자 - 제휴업체 신청 관리 페이지
console.log('🔧 관리자 제휴업체 신청 관리 라우트 등록됨');
app.get('/admin/partner-applications', requireAuth, (req, res) => {
    console.log('📋 제휴업체 신청 관리 페이지 접근됨');
    console.log('🔐 인증 상태:', { adminId: req.session.adminId, sessionExists: !!req.session });
    
    try {
        // 제휴업체 신청 데이터 읽기
        let applications = [];
        try {
            const data = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(data);
        } catch (error) {
            // 파일이 없으면 빈 배열
            applications = [];
        }
        
        // 최신 순으로 정렬
        applications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        res.render('admin/partner-applications', {
            title: '제휴업체 신청 관리',
            applications
        });
        
    } catch (error) {
        console.error('제휴업체 신청 목록 오류:', error);
        res.render('error', {
            title: '오류',
            message: '제휴업체 신청 목록을 불러올 수 없습니다.'
        });
    }
});

// 제휴업체 신청 페이지
app.get('/partner-apply', (req, res) => {
    res.render('partner-apply');
});

// 제휴업체 신청 API
app.post('/api/partner-apply', (req, res) => {
    try {
        const {
            business_name,
            contact_name,
            email,
            phone,
            business_address,
            business_type,
            proposed_discount,
            business_description,
            additional_notes,
            agree_terms
        } = req.body;
        
        // 필수 필드 검증
        if (!business_name || !contact_name || !email || !phone || !business_address || !business_type || !agree_terms) {
            return res.json({ 
                success: false, 
                message: '필수 필드를 모두 입력해주세요. / Please fill in all required fields.' 
            });
        }
        
        // 신청 데이터 생성
        const application = {
            id: Date.now().toString(),
            business_name,
            contact_name,
            email,
            phone,
            business_address,
            business_type,
            proposed_discount: proposed_discount || '',
            business_description: business_description || '',
            additional_notes: additional_notes || '',
            status: 'pending', // pending, approved, rejected
            applied_at: new Date().toISOString(),
            reviewed_at: null,
            reviewed_by: null,
            notes: ''
        };
        
        // 신청 데이터 저장
        let applications = [];
        try {
            const applicationsData = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(applicationsData);
        } catch (error) {
            // 파일이 없으면 빈 배열로 시작
            applications = [];
        }
        
        applications.push(application);
        
        // 파일에 저장
        fs.writeFileSync(
            path.join(__dirname, 'data', 'partner-applications.json'),
            JSON.stringify(applications, null, 2),
            'utf8'
        );
        
        console.log(`새로운 제휴업체 신청: ${business_name} (${contact_name})`);
        
        res.json({ 
            success: true, 
            message: '신청이 성공적으로 접수되었습니다! / Application submitted successfully!',
            application_id: application.id
        });
        
    } catch (error) {
        console.error('제휴업체 신청 오류:', error);
        res.json({ 
            success: false, 
            message: '신청 처리 중 오류가 발생했습니다. / An error occurred while processing your application.' 
        });
    }
});

// 관리자 - 제휴업체 신청 목록 페이지
console.log('🔧 제휴업체 신청 관리 라우트 등록됨: /admin/partner-applications');
app.get('/admin/partner-applications', requireAuth, (req, res) => {
    console.log('📋 제휴업체 신청 목록 페이지 접근됨');
    console.log('🔐 인증 상태:', { adminId: req.session.adminId, sessionExists: !!req.session });
    console.log('📁 템플릿 파일 경로:', path.join(__dirname, 'views', 'admin', 'partner-applications.ejs'));
    
    try {
        let applications = [];
        try {
            const applicationsData = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(applicationsData);
        } catch (error) {
            applications = [];
        }
        
        // 신청일 순으로 정렬 (최신순)
        applications.sort((a, b) => new Date(b.applied_at) - new Date(a.applied_at));
        
        res.render('admin/partner-applications', { applications });
    } catch (error) {
        console.error('제휴업체 신청 목록 오류:', error);
        res.status(500).send('서버 오류가 발생했습니다.');
    }
});

// 관리자 - 제휴업체 신청 상세 정보 API
app.get('/admin/api/partner-applications/:id', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        
        let applications = [];
        try {
            const applicationsData = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(applicationsData);
        } catch (error) {
            return res.json({ success: false, message: '신청 데이터를 찾을 수 없습니다.' });
        }
        
        const application = applications.find(app => app.id === id);
        
        if (!application) {
            return res.json({ success: false, message: '신청 내역을 찾을 수 없습니다.' });
        }
        
        res.json({ success: true, application });
        
    } catch (error) {
        console.error('제휴업체 신청 상세 정보 오류:', error);
        res.json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

// 관리자 - 제휴업체 신청 상태 업데이트 API
app.put('/admin/api/partner-applications/:id/status', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body;
        
        if (!['pending', 'approved', 'rejected'].includes(status)) {
            return res.json({ success: false, message: '잘못된 상태 값입니다.' });
        }
        
        let applications = [];
        try {
            const applicationsData = fs.readFileSync(path.join(__dirname, 'data', 'partner-applications.json'), 'utf8');
            applications = JSON.parse(applicationsData);
        } catch (error) {
            return res.json({ success: false, message: '신청 데이터를 찾을 수 없습니다.' });
        }
        
        const applicationIndex = applications.findIndex(app => app.id === id);
        
        if (applicationIndex === -1) {
            return res.json({ success: false, message: '신청 내역을 찾을 수 없습니다.' });
        }
        
        // 상태 업데이트
        applications[applicationIndex].status = status;
        applications[applicationIndex].reviewed_at = new Date().toISOString();
        applications[applicationIndex].reviewed_by = 'admin'; // 실제로는 로그인한 관리자 ID
        applications[applicationIndex].notes = notes || '';
        
        // 파일에 저장
        fs.writeFileSync(
            path.join(__dirname, 'data', 'partner-applications.json'),
            JSON.stringify(applications, null, 2),
            'utf8'
        );
        
        console.log(`제휴업체 신청 상태 업데이트: ${applications[applicationIndex].business_name} -> ${status}`);
        
        res.json({ 
            success: true, 
            message: `신청 상태가 ${status === 'approved' ? '승인' : status === 'rejected' ? '거절' : '대기'}로 업데이트되었습니다.`,
            application: applications[applicationIndex]
        });
        
    } catch (error) {
        console.error('제휴업체 신청 상태 업데이트 오류:', error);
        res.json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});





// 서버 시작
app.listen(PORT, () => {
    console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
    console.log(`🌐 메인 페이지: http://localhost:${PORT}`);
    console.log(`🔧 관리자: http://localhost:${PORT}/admin`);
});
