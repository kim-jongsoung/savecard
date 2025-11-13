const express = require('express');
const router = express.Router();

// 미들웨어: 로그인 체크
function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

// ==========================================
// 거래처 목록 조회 (한국 여행사)
// GET /api/booking-agencies?search=&is_active=
// ==========================================
router.get('/api/booking-agencies', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { search, is_active } = req.query;
  
  try {
    let query = `
      SELECT 
        id, agency_code, agency_name, agency_type,
        contact_person, contact_email, contact_phone,
        commission_rate, payment_terms, bank_info,
        is_active, created_at, updated_at
      FROM booking_agencies
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    // 검색 (거래처명, 코드, 담당자)
    if (search) {
      query += ` AND (agency_name ILIKE $${paramIndex} OR agency_code ILIKE $${paramIndex} OR contact_person ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    // 활성화 상태 필터
    if (is_active !== undefined && is_active !== '') {
      query += ` AND is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    query += ` ORDER BY agency_name`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 거래처 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 거래처 상세 조회
// GET /api/booking-agencies/:id
// ==========================================
router.get('/api/booking-agencies/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM booking_agencies WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 거래처 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 거래처 등록
// POST /api/booking-agencies
// ==========================================
router.post('/api/booking-agencies', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    agency_code,
    agency_name,
    agency_type,
    contact_person,
    contact_email,
    contact_phone,
    commission_rate,
    payment_terms,
    bank_info,
    is_active
  } = req.body;
  
  try {
    // 거래처 코드 중복 체크
    const checkResult = await pool.query(
      'SELECT id FROM booking_agencies WHERE agency_code = $1',
      [agency_code]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 거래처 코드입니다.' });
    }
    
    const result = await pool.query(
      `INSERT INTO booking_agencies (
        agency_code, agency_name, agency_type,
        contact_person, contact_email, contact_phone,
        commission_rate, payment_terms, bank_info, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        agency_code, agency_name, agency_type,
        contact_person, contact_email, contact_phone,
        commission_rate || 0, payment_terms, bank_info, is_active !== false
      ]
    );
    
    res.json({ success: true, agency: result.rows[0] });
  } catch (error) {
    console.error('❌ 거래처 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 거래처 수정
// PUT /api/booking-agencies/:id
// ==========================================
router.put('/api/booking-agencies/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    agency_code,
    agency_name,
    agency_type,
    contact_person,
    contact_email,
    contact_phone,
    commission_rate,
    payment_terms,
    bank_info,
    is_active
  } = req.body;
  
  try {
    // 거래처 존재 확인
    const checkExist = await pool.query('SELECT id FROM booking_agencies WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
    }
    
    // 거래처 코드 중복 체크 (자기 자신 제외)
    const checkCode = await pool.query(
      'SELECT id FROM booking_agencies WHERE agency_code = $1 AND id != $2',
      [agency_code, id]
    );
    
    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 거래처 코드입니다.' });
    }
    
    const result = await pool.query(
      `UPDATE booking_agencies SET
        agency_code = $1,
        agency_name = $2,
        agency_type = $3,
        contact_person = $4,
        contact_email = $5,
        contact_phone = $6,
        commission_rate = $7,
        payment_terms = $8,
        bank_info = $9,
        is_active = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *`,
      [
        agency_code, agency_name, agency_type,
        contact_person, contact_email, contact_phone,
        commission_rate, payment_terms, bank_info, is_active,
        id
      ]
    );
    
    res.json({ success: true, agency: result.rows[0] });
  } catch (error) {
    console.error('❌ 거래처 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 거래처 삭제 (소프트 삭제)
// DELETE /api/booking-agencies/:id
// ==========================================
router.delete('/api/booking-agencies/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 거래처 존재 확인
    const checkExist = await pool.query('SELECT id FROM booking_agencies WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '거래처를 찾을 수 없습니다.' });
    }
    
    // 예약이 있는지 확인
    const checkReservations = await pool.query(
      'SELECT COUNT(*) as count FROM hotel_reservations WHERE booking_agency_id = $1',
      [id]
    );
    
    if (parseInt(checkReservations.rows[0].count) > 0) {
      // 예약이 있으면 소프트 삭제
      await pool.query(
        'UPDATE booking_agencies SET is_active = false, updated_at = NOW() WHERE id = $1',
        [id]
      );
      return res.json({ success: true, message: '거래처가 비활성화되었습니다. (예약 건이 존재함)' });
    }
    
    // 예약이 없으면 소프트 삭제
    await pool.query(
      'UPDATE booking_agencies SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: '거래처가 삭제되었습니다.' });
  } catch (error) {
    console.error('❌ 거래처 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
