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
// 호텔 목록 조회
// GET /api/hotels?country=&region=&search=&is_active=
// ==========================================
router.get('/api/hotels', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { country, region, search, is_active } = req.query;
  
  try {
    let query = `
      SELECT 
        id, hotel_code, hotel_name, hotel_name_en,
        country, region, address,
        contact_email, contact_phone,
        reservation_email, reservation_fax, contact_person,
        check_in_time, check_out_time,
        is_active, created_at, updated_at
      FROM hotels
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    // 국가 필터
    if (country) {
      query += ` AND country = $${paramIndex}`;
      params.push(country);
      paramIndex++;
    }
    
    // 지역 필터
    if (region) {
      query += ` AND region = $${paramIndex}`;
      params.push(region);
      paramIndex++;
    }
    
    // 검색 (호텔명, 호텔코드)
    if (search) {
      query += ` AND (hotel_name ILIKE $${paramIndex} OR hotel_code ILIKE $${paramIndex} OR hotel_name_en ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    // 활성화 상태 필터
    if (is_active !== undefined && is_active !== '') {
      query += ` AND is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    query += ` ORDER BY country, region, hotel_name`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 호텔 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 상세 조회
// GET /api/hotels/:id
// ==========================================
router.get('/api/hotels/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'SELECT * FROM hotels WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '호텔을 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 호텔 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 등록
// POST /api/hotels
// ==========================================
router.post('/api/hotels', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    hotel_code,
    hotel_name,
    hotel_name_en,
    country,
    region,
    address,
    contact_email,
    contact_phone,
    reservation_email,
    reservation_fax,
    contact_person,
    check_in_time,
    check_out_time,
    description,
    is_active
  } = req.body;
  
  try {
    // 호텔 코드 중복 체크
    const checkResult = await pool.query(
      'SELECT id FROM hotels WHERE hotel_code = $1',
      [hotel_code]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 호텔 코드입니다.' });
    }
    
    const result = await pool.query(
      `INSERT INTO hotels (
        hotel_code, hotel_name, hotel_name_en,
        country, region, address,
        contact_email, contact_phone,
        reservation_email, reservation_fax, contact_person,
        check_in_time, check_out_time, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        hotel_code, hotel_name, hotel_name_en,
        country, region, address,
        contact_email, contact_phone,
        reservation_email, reservation_fax, contact_person,
        check_in_time || '15:00', check_out_time || '11:00',
        description, is_active !== false
      ]
    );
    
    res.json({ success: true, hotel: result.rows[0] });
  } catch (error) {
    console.error('❌ 호텔 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 수정
// PUT /api/hotels/:id
// ==========================================
router.put('/api/hotels/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    hotel_code,
    hotel_name,
    hotel_name_en,
    country,
    region,
    address,
    contact_email,
    contact_phone,
    reservation_email,
    reservation_fax,
    contact_person,
    check_in_time,
    check_out_time,
    description,
    is_active
  } = req.body;
  
  try {
    // 호텔 존재 확인
    const checkExist = await pool.query('SELECT id FROM hotels WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '호텔을 찾을 수 없습니다.' });
    }
    
    // 호텔 코드 중복 체크 (자기 자신 제외)
    const checkCode = await pool.query(
      'SELECT id FROM hotels WHERE hotel_code = $1 AND id != $2',
      [hotel_code, id]
    );
    
    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 호텔 코드입니다.' });
    }
    
    const result = await pool.query(
      `UPDATE hotels SET
        hotel_code = $1,
        hotel_name = $2,
        hotel_name_en = $3,
        country = $4,
        region = $5,
        address = $6,
        contact_email = $7,
        contact_phone = $8,
        reservation_email = $9,
        reservation_fax = $10,
        contact_person = $11,
        check_in_time = $12,
        check_out_time = $13,
        description = $14,
        is_active = $15,
        updated_at = NOW()
      WHERE id = $16
      RETURNING *`,
      [
        hotel_code, hotel_name, hotel_name_en,
        country, region, address,
        contact_email, contact_phone,
        reservation_email, reservation_fax, contact_person,
        check_in_time, check_out_time, description, is_active,
        id
      ]
    );
    
    res.json({ success: true, hotel: result.rows[0] });
  } catch (error) {
    console.error('❌ 호텔 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 삭제 (소프트 삭제 - is_active = false)
// DELETE /api/hotels/:id
// ==========================================
router.delete('/api/hotels/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 호텔 존재 확인
    const checkExist = await pool.query('SELECT id FROM hotels WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '호텔을 찾을 수 없습니다.' });
    }
    
    // 예약이 있는지 확인
    const checkReservations = await pool.query(
      'SELECT COUNT(*) as count FROM hotel_reservations WHERE hotel_id = $1',
      [id]
    );
    
    if (parseInt(checkReservations.rows[0].count) > 0) {
      // 예약이 있으면 소프트 삭제
      await pool.query(
        'UPDATE hotels SET is_active = false, updated_at = NOW() WHERE id = $1',
        [id]
      );
      return res.json({ success: true, message: '호텔이 비활성화되었습니다. (예약 건이 존재함)' });
    }
    
    // 예약이 없으면 완전 삭제도 가능하지만, 일단 소프트 삭제로 통일
    await pool.query(
      'UPDATE hotels SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: '호텔이 삭제되었습니다.' });
  } catch (error) {
    console.error('❌ 호텔 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 국가 목록 조회 (중복 제거)
// GET /api/hotels/meta/countries
// ==========================================
router.get('/api/hotels/meta/countries', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT DISTINCT country 
       FROM hotels 
       WHERE country IS NOT NULL 
       ORDER BY country`
    );
    
    res.json(result.rows.map(row => row.country));
  } catch (error) {
    console.error('❌ 국가 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 지역 목록 조회 (국가별)
// GET /api/hotels/meta/regions?country=
// ==========================================
router.get('/api/hotels/meta/regions', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { country } = req.query;
  
  try {
    let query = `
      SELECT DISTINCT region 
      FROM hotels 
      WHERE region IS NOT NULL
    `;
    const params = [];
    
    if (country) {
      query += ' AND country = $1';
      params.push(country);
    }
    
    query += ' ORDER BY region';
    
    const result = await pool.query(query, params);
    res.json(result.rows.map(row => row.region));
  } catch (error) {
    console.error('❌ 지역 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
