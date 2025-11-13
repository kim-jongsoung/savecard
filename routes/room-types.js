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
// 객실 타입 목록 조회 (호텔별)
// GET /api/room-types?hotel_id=&search=&is_active=
// ==========================================
router.get('/api/room-types', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, search, is_active } = req.query;
  
  try {
    let query = `
      SELECT 
        rt.*,
        h.hotel_name,
        h.country,
        h.region
      FROM room_types rt
      LEFT JOIN hotels h ON rt.hotel_id = h.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    // 호텔 필터
    if (hotel_id) {
      query += ` AND rt.hotel_id = $${paramIndex}`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    // 검색 (객실 타입명, 코드, 호텔 객실명)
    if (search) {
      query += ` AND (rt.room_type_name ILIKE $${paramIndex} OR rt.room_type_code ILIKE $${paramIndex} OR rt.hotel_room_name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    // 활성화 상태 필터
    if (is_active !== undefined && is_active !== '') {
      query += ` AND rt.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    query += ` ORDER BY h.hotel_name, rt.room_type_code`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 객실 타입 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 객실 타입 상세 조회
// GET /api/room-types/:id
// ==========================================
router.get('/api/room-types/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT rt.*, h.hotel_name 
       FROM room_types rt 
       LEFT JOIN hotels h ON rt.hotel_id = h.id 
       WHERE rt.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '객실 타입을 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 객실 타입 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 객실 타입 등록
// POST /api/room-types
// ==========================================
router.post('/api/room-types', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    hotel_id,
    room_type_code,
    room_type_name,
    hotel_room_name,
    description,
    max_adults,
    max_children,
    max_infants,
    max_total_occupancy,
    base_room_rate,
    breakfast_included,
    breakfast_rate_per_person,
    extra_adult_rate,
    extra_child_rate,
    is_active
  } = req.body;
  
  try {
    // 중복 체크 (같은 호텔에 같은 코드)
    const checkResult = await pool.query(
      'SELECT id FROM room_types WHERE hotel_id = $1 AND room_type_code = $2',
      [hotel_id, room_type_code]
    );
    
    if (checkResult.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 객실 타입 코드입니다.' });
    }
    
    const result = await pool.query(
      `INSERT INTO room_types (
        hotel_id, room_type_code, room_type_name, hotel_room_name, description,
        max_adults, max_children, max_infants, max_total_occupancy,
        base_room_rate, breakfast_included, breakfast_rate_per_person,
        extra_adult_rate, extra_child_rate, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        hotel_id, room_type_code, room_type_name, hotel_room_name, description,
        max_adults || 2, max_children || 1, max_infants || 1, max_total_occupancy || 3,
        base_room_rate, breakfast_included || false, breakfast_rate_per_person || 0,
        extra_adult_rate || 0, extra_child_rate || 0, is_active !== false
      ]
    );
    
    res.json({ success: true, roomType: result.rows[0] });
  } catch (error) {
    console.error('❌ 객실 타입 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 객실 타입 수정
// PUT /api/room-types/:id
// ==========================================
router.put('/api/room-types/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    hotel_id,
    room_type_code,
    room_type_name,
    hotel_room_name,
    description,
    max_adults,
    max_children,
    max_infants,
    max_total_occupancy,
    base_room_rate,
    breakfast_included,
    breakfast_rate_per_person,
    extra_adult_rate,
    extra_child_rate,
    is_active
  } = req.body;
  
  try {
    // 존재 확인
    const checkExist = await pool.query('SELECT id FROM room_types WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '객실 타입을 찾을 수 없습니다.' });
    }
    
    // 중복 체크 (자기 자신 제외)
    const checkCode = await pool.query(
      'SELECT id FROM room_types WHERE hotel_id = $1 AND room_type_code = $2 AND id != $3',
      [hotel_id, room_type_code, id]
    );
    
    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 객실 타입 코드입니다.' });
    }
    
    const result = await pool.query(
      `UPDATE room_types SET
        hotel_id = $1,
        room_type_code = $2,
        room_type_name = $3,
        hotel_room_name = $4,
        description = $5,
        max_adults = $6,
        max_children = $7,
        max_infants = $8,
        max_total_occupancy = $9,
        base_room_rate = $10,
        breakfast_included = $11,
        breakfast_rate_per_person = $12,
        extra_adult_rate = $13,
        extra_child_rate = $14,
        is_active = $15,
        updated_at = NOW()
      WHERE id = $16
      RETURNING *`,
      [
        hotel_id, room_type_code, room_type_name, hotel_room_name, description,
        max_adults, max_children, max_infants, max_total_occupancy,
        base_room_rate, breakfast_included, breakfast_rate_per_person,
        extra_adult_rate, extra_child_rate, is_active,
        id
      ]
    );
    
    res.json({ success: true, roomType: result.rows[0] });
  } catch (error) {
    console.error('❌ 객실 타입 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 객실 타입 삭제
// DELETE /api/room-types/:id
// ==========================================
router.delete('/api/room-types/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 존재 확인
    const checkExist = await pool.query('SELECT id FROM room_types WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '객실 타입을 찾을 수 없습니다.' });
    }
    
    // 예약이 있는지 확인
    const checkReservations = await pool.query(
      'SELECT COUNT(*) as count FROM hotel_reservation_rooms WHERE room_type_id = $1',
      [id]
    );
    
    if (parseInt(checkReservations.rows[0].count) > 0) {
      // 예약이 있으면 소프트 삭제
      await pool.query(
        'UPDATE room_types SET is_active = false, updated_at = NOW() WHERE id = $1',
        [id]
      );
      return res.json({ success: true, message: '객실 타입이 비활성화되었습니다. (예약 건이 존재함)' });
    }
    
    // 예약이 없으면 소프트 삭제
    await pool.query(
      'UPDATE room_types SET is_active = false, updated_at = NOW() WHERE id = $1',
      [id]
    );
    
    res.json({ success: true, message: '객실 타입이 삭제되었습니다.' });
  } catch (error) {
    console.error('❌ 객실 타입 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔별 객실 타입 목록 (간단)
// GET /api/hotels/:hotel_id/room-types
// ==========================================
router.get('/api/hotels/:hotel_id/room-types', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT id, room_type_code, room_type_name, hotel_room_name, is_active
       FROM room_types
       WHERE hotel_id = $1 AND is_active = true
       ORDER BY room_type_code`,
      [hotel_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 호텔별 객실 타입 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
