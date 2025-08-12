const express = require('express');
const path = require('path');
const session = require('express-session');
const { pool } = require('./database');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
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

// 메인 페이지
app.get('/', async (req, res) => {
  try {
    const storesResult = await pool.query('SELECT * FROM stores ORDER BY name');
    const bannersResult = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY display_order');
    
    res.render('index', { 
      title: '메인',
      stores: storesResult.rows,
      banners: bannersResult.rows 
    });
  } catch (err) {
    console.error('메인 페이지 오류:', err);
    res.render('index', { title: '메인', stores: [], banners: [] });
  }
});

// 제휴업체 목록 페이지
app.get('/stores', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stores ORDER BY category, name');
    res.render('stores', { title: '제휴업체', stores: result.rows });
  } catch (err) {
    console.error('제휴업체 목록 오류:', err);
    res.render('stores', { title: '제휴업체', stores: [] });
  }
});

// 카드 사용 페이지
app.get('/card', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stores ORDER BY name');
    res.render('card', { title: '카드 사용', stores: result.rows });
  } catch (err) {
    console.error('카드 사용 페이지 오류:', err);
    res.render('card', { title: '카드 사용', stores: [] });
  }
});

// 카드 발급 페이지
app.get('/issue', (req, res) => {
  res.render('issue', { title: '카드 발급' });
});

// 카드 발급 처리
app.post('/issue', async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    const cardNumber = 'GSC' + Date.now();
    
    await pool.query(
      'INSERT INTO cards (card_number, holder_name, phone, email) VALUES ($1, $2, $3, $4)',
      [cardNumber, name, phone, email]
    );
    
    res.json({ success: true, cardNumber });
  } catch (err) {
    console.error('카드 발급 오류:', err);
    res.json({ success: false, message: '카드 발급 중 오류가 발생했습니다.' });
  }
});

// 제휴업체 신청 처리
app.post('/api/partner-application', async (req, res) => {
  try {
    const { businessName, contactName, phone, email, businessType, location, discountOffer, additionalInfo } = req.body;
    
    await pool.query(
      'INSERT INTO partner_applications (business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [businessName, contactName, phone, email, businessType, location, discountOffer, additionalInfo]
    );
    
    res.json({ success: true, message: '제휴업체 신청이 완료되었습니다.' });
  } catch (err) {
    console.error('제휴업체 신청 오류:', err);
    res.json({ success: false, message: '신청 처리 중 오류가 발생했습니다.' });
  }
});

// 할인 적용 처리
app.post('/api/apply-discount', async (req, res) => {
  try {
    const { storeName } = req.body;
    
    await pool.query(
      'UPDATE stores SET usage_count = usage_count + 1 WHERE name = $1',
      [storeName]
    );
    
    res.json({ success: true, message: '할인이 적용되었습니다.' });
  } catch (err) {
    console.error('할인 적용 오류:', err);
    res.json({ success: false, message: '할인 적용 중 오류가 발생했습니다.' });
  }
});

// 관리자 로그인 페이지
app.get('/admin/login', (req, res) => {
  res.render('admin/login', { title: '관리자 로그인' });
});

// 관리자 로그인 처리
app.post('/admin/login', (req, res) => {
  const { username, password } = req.body;
  
  if (username === 'luxfind01' && password === 'vasco01@') {
    req.session.adminId = username;
    res.redirect('/admin/dashboard');
  } else {
    res.render('admin/login', { title: '관리자 로그인', error: '잘못된 계정 정보입니다.' });
  }
});

// 관리자 로그아웃
app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

// 관리자 대시보드
app.get('/admin/dashboard', requireAuth, async (req, res) => {
  try {
    const storesCount = await pool.query('SELECT COUNT(*) FROM stores');
    const applicationsCount = await pool.query('SELECT COUNT(*) FROM partner_applications');
    const cardsCount = await pool.query('SELECT COUNT(*) FROM cards');
    
    res.render('admin/dashboard', {
      title: '관리자 대시보드',
      storesCount: storesCount.rows[0].count,
      applicationsCount: applicationsCount.rows[0].count,
      cardsCount: cardsCount.rows[0].count
    });
  } catch (err) {
    console.error('대시보드 오류:', err);
    res.render('admin/dashboard', { title: '관리자 대시보드', storesCount: 0, applicationsCount: 0, cardsCount: 0 });
  }
});

// 관리자 - 제휴업체 관리
app.get('/admin/stores', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM stores ORDER BY name');
    res.render('admin/stores', { title: '제휴업체 관리', stores: result.rows });
  } catch (err) {
    console.error('제휴업체 관리 오류:', err);
    res.render('admin/stores', { title: '제휴업체 관리', stores: [] });
  }
});

// 관리자 - 제휴업체 추가
app.post('/admin/stores', requireAuth, async (req, res) => {
  try {
    const { name, category, discount, location, phone, hours, description, imageUrl } = req.body;
    
    await pool.query(
      'INSERT INTO stores (name, category, discount, location, phone, hours, description, image_url, usage_count) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [name, category, discount, location, phone, hours, description, imageUrl, 0]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('제휴업체 추가 오류:', err);
    res.json({ success: false, message: '제휴업체 추가 중 오류가 발생했습니다.' });
  }
});

// 관리자 - 제휴업체 수정
app.put('/admin/stores/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, discount, location, phone, hours, description, imageUrl, usage_count } = req.body;
    
    await pool.query(
      'UPDATE stores SET name = $1, category = $2, discount = $3, location = $4, phone = $5, hours = $6, description = $7, image_url = $8, usage_count = $9, updated_at = CURRENT_TIMESTAMP WHERE id = $10',
      [name, category, discount, location, phone, hours, description, imageUrl, usage_count, id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('제휴업체 수정 오류:', err);
    res.json({ success: false, message: '제휴업체 수정 중 오류가 발생했습니다.' });
  }
});

// 관리자 - 제휴업체 삭제
app.delete('/admin/stores/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM stores WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('제휴업체 삭제 오류:', err);
    res.json({ success: false, message: '제휴업체 삭제 중 오류가 발생했습니다.' });
  }
});

// 관리자 - 제휴업체 신청 관리
app.get('/admin/partner-applications', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM partner_applications ORDER BY created_at DESC');
    res.render('admin/partner-applications', { title: '제휴업체 신청 관리', applications: result.rows });
  } catch (err) {
    console.error('제휴업체 신청 관리 오류:', err);
    res.render('admin/partner-applications', { title: '제휴업체 신청 관리', applications: [] });
  }
});

// 관리자 - 배너 관리
app.get('/admin/banners', requireAuth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM banners ORDER BY display_order');
    res.render('admin/banners', { title: '배너 관리', banners: result.rows });
  } catch (err) {
    console.error('배너 관리 오류:', err);
    res.render('admin/banners', { title: '배너 관리', banners: [] });
  }
});

// 관리자 - 배너 추가
app.post('/admin/banners', requireAuth, async (req, res) => {
  try {
    const { title, imageUrl, linkUrl, displayOrder } = req.body;
    
    await pool.query(
      'INSERT INTO banners (title, image_url, link_url, display_order, is_active) VALUES ($1, $2, $3, $4, $5)',
      [title, imageUrl, linkUrl, displayOrder, true]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('배너 추가 오류:', err);
    res.json({ success: false, message: '배너 추가 중 오류가 발생했습니다.' });
  }
});

// 관리자 - 배너 수정
app.put('/admin/banners/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, imageUrl, linkUrl, displayOrder, isActive } = req.body;
    
    await pool.query(
      'UPDATE banners SET title = $1, image_url = $2, link_url = $3, display_order = $4, is_active = $5 WHERE id = $6',
      [title, imageUrl, linkUrl, displayOrder, isActive, id]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error('배너 수정 오류:', err);
    res.json({ success: false, message: '배너 수정 중 오류가 발생했습니다.' });
  }
});

// 관리자 - 배너 삭제
app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM banners WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('배너 삭제 오류:', err);
    res.json({ success: false, message: '배너 삭제 중 오류가 발생했습니다.' });
  }
});

// 서버 시작
app.listen(PORT, async () => {
  console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
  
  // 데이터베이스 연결 확인
  try {
    await pool.query('SELECT 1');
    console.log('✅ PostgreSQL 데이터베이스 연결 성공');
  } catch (err) {
    console.error('❌ PostgreSQL 데이터베이스 연결 실패:', err.message);
  }
});
