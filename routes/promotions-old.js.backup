/**
 * 프로모션 관리 API
 * 
 * 기능:
 * - 프로모션 목록 조회
 * - 프로모션 상세 조회 (할인 및 베네핏 포함)
 * - 프로모션 등록 (할인 및 베네핏 함께 등록)
 * - 프로모션 수정
 * - 프로모션 삭제
 * - 프로모션 코드 검증
 */

const express = require('express');
const router = express.Router();

// 로그인 체크 미들웨어
function requireLogin(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

// ==========================================
// 프로모션 목록 조회
// GET /api/promotions
// ==========================================
router.get('/api/promotions', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, is_active, promo_code } = req.query;
  
  try {
    let query = `
      SELECT 
        p.*,
        h.hotel_name,
        h.hotel_code,
        COUNT(DISTINCT prd.id) as discount_count,
        COUNT(DISTINCT pb.id) as benefit_count
      FROM promotions p
      JOIN hotels h ON p.hotel_id = h.id
      LEFT JOIN promotion_room_discounts prd ON p.id = prd.promotion_id
      LEFT JOIN promotion_benefits pb ON p.id = pb.promotion_id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (hotel_id) {
      query += ` AND p.hotel_id = $${paramIndex}`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += ` AND p.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    if (promo_code) {
      query += ` AND p.promo_code ILIKE $${paramIndex}`;
      params.push(`%${promo_code}%`);
      paramIndex++;
    }
    
    query += ` GROUP BY p.id, h.hotel_name, h.hotel_code`;
    query += ` ORDER BY p.created_at DESC`;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 프로모션 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 프로모션 상세 조회 (할인 및 베네핏 포함)
// GET /api/promotions/:id
// ==========================================
router.get('/api/promotions/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 프로모션 기본 정보
    const promoResult = await pool.query(
      `SELECT p.*, h.hotel_name, h.hotel_code
       FROM promotions p
       JOIN hotels h ON p.hotel_id = h.id
       WHERE p.id = $1`,
      [id]
    );
    
    if (promoResult.rows.length === 0) {
      return res.status(404).json({ error: '프로모션을 찾을 수 없습니다.' });
    }
    
    const promotion = promoResult.rows[0];
    
    // 객실별 할인 정보
    const discountsResult = await pool.query(
      `SELECT prd.*, rt.room_type_name, rt.room_type_code
       FROM promotion_room_discounts prd
       JOIN room_types rt ON prd.room_type_id = rt.id
       WHERE prd.promotion_id = $1
       ORDER BY rt.room_type_code`,
      [id]
    );
    
    promotion.discounts = discountsResult.rows;
    
    // 베네핏 정보
    const benefitsResult = await pool.query(
      `SELECT * FROM promotion_benefits
       WHERE promotion_id = $1
       ORDER BY created_at`,
      [id]
    );
    
    promotion.benefits = benefitsResult.rows;
    
    res.json(promotion);
  } catch (error) {
    console.error('❌ 프로모션 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 프로모션 등록 (할인 및 베네핏 함께)
// POST /api/promotions
// ==========================================
router.post('/api/promotions', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    hotel_id,
    promo_code,
    promo_name,
    booking_start_date,
    booking_end_date,
    stay_start_date,
    stay_end_date,
    discount_type,
    min_nights,
    max_nights,
    description,
    terms_and_conditions,
    is_active,
    discounts,  // [{ room_type_id, discount_value }]
    benefits    // [{ benefit_type, benefit_name, benefit_value, quantity }]
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 필수값 체크
    if (!hotel_id || !promo_code || !promo_name || !booking_start_date || !booking_end_date || !stay_start_date || !stay_end_date) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // 날짜 유효성 체크
    if (new Date(booking_end_date) < new Date(booking_start_date)) {
      return res.status(400).json({ error: '예약 종료일은 시작일보다 늦어야 합니다.' });
    }
    
    if (new Date(stay_end_date) < new Date(stay_start_date)) {
      return res.status(400).json({ error: '투숙 종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 프로모션 코드 중복 체크
    const checkCode = await client.query(
      'SELECT id FROM promotions WHERE hotel_id = $1 AND promo_code = $2',
      [hotel_id, promo_code]
    );
    
    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 프로모션 코드입니다.' });
    }
    
    // 프로모션 등록
    const promoResult = await client.query(
      `INSERT INTO promotions (
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        discount_type, min_nights, max_nights,
        description, terms_and_conditions, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        discount_type || 'amount', min_nights || 1, max_nights,
        description, terms_and_conditions, is_active !== false
      ]
    );
    
    const promotionId = promoResult.rows[0].id;
    
    // 객실별 할인 등록
    if (discounts && discounts.length > 0) {
      for (const discount of discounts) {
        await client.query(
          `INSERT INTO promotion_room_discounts (
            promotion_id, room_type_id, discount_value, discounted_rate, description
          ) VALUES ($1, $2, $3, $4, $5)`,
          [
            promotionId,
            discount.room_type_id,
            discount.discount_value,
            discount.discounted_rate || null,
            discount.description || null
          ]
        );
      }
    }
    
    // 베네핏 등록
    if (benefits && benefits.length > 0) {
      for (const benefit of benefits) {
        await client.query(
          `INSERT INTO promotion_benefits (
            promotion_id, benefit_type, benefit_name, benefit_value, quantity, description
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            promotionId,
            benefit.benefit_type,
            benefit.benefit_name,
            benefit.benefit_value || null,
            benefit.quantity || 1,
            benefit.description || null
          ]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, promotion: promoResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 프로모션 등록 오류:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 프로모션 수정
// PUT /api/promotions/:id
// ==========================================
router.put('/api/promotions/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    hotel_id,
    promo_code,
    promo_name,
    booking_start_date,
    booking_end_date,
    stay_start_date,
    stay_end_date,
    discount_type,
    min_nights,
    max_nights,
    description,
    terms_and_conditions,
    is_active,
    discounts,
    benefits
  } = req.body;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 존재 확인
    const checkExist = await client.query('SELECT id FROM promotions WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '프로모션을 찾을 수 없습니다.' });
    }
    
    // 날짜 유효성 체크
    if (new Date(booking_end_date) < new Date(booking_start_date)) {
      return res.status(400).json({ error: '예약 종료일은 시작일보다 늦어야 합니다.' });
    }
    
    if (new Date(stay_end_date) < new Date(stay_start_date)) {
      return res.status(400).json({ error: '투숙 종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 프로모션 코드 중복 체크 (자기 자신 제외)
    const checkCode = await client.query(
      'SELECT id FROM promotions WHERE hotel_id = $1 AND promo_code = $2 AND id != $3',
      [hotel_id, promo_code, id]
    );
    
    if (checkCode.rows.length > 0) {
      return res.status(400).json({ error: '이미 존재하는 프로모션 코드입니다.' });
    }
    
    // 프로모션 수정
    const promoResult = await client.query(
      `UPDATE promotions SET
        hotel_id = $1,
        promo_code = $2,
        promo_name = $3,
        booking_start_date = $4,
        booking_end_date = $5,
        stay_start_date = $6,
        stay_end_date = $7,
        discount_type = $8,
        min_nights = $9,
        max_nights = $10,
        description = $11,
        terms_and_conditions = $12,
        is_active = $13,
        updated_at = NOW()
      WHERE id = $14
      RETURNING *`,
      [
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        discount_type || 'amount', min_nights || 1, max_nights,
        description, terms_and_conditions, is_active !== false,
        id
      ]
    );
    
    // 기존 할인 및 베네핏 삭제
    await client.query('DELETE FROM promotion_room_discounts WHERE promotion_id = $1', [id]);
    await client.query('DELETE FROM promotion_benefits WHERE promotion_id = $1', [id]);
    
    // 새 할인 등록
    if (discounts && discounts.length > 0) {
      for (const discount of discounts) {
        await client.query(
          `INSERT INTO promotion_room_discounts (
            promotion_id, room_type_id, discount_value, discounted_rate, description
          ) VALUES ($1, $2, $3, $4, $5)`,
          [id, discount.room_type_id, discount.discount_value, discount.discounted_rate || null, discount.description || null]
        );
      }
    }
    
    // 새 베네핏 등록
    if (benefits && benefits.length > 0) {
      for (const benefit of benefits) {
        await client.query(
          `INSERT INTO promotion_benefits (
            promotion_id, benefit_type, benefit_name, benefit_value, quantity, description
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [id, benefit.benefit_type, benefit.benefit_name, benefit.benefit_value || null, benefit.quantity || 1, benefit.description || null]
        );
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, promotion: promoResult.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 프로모션 수정 오류:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 프로모션 삭제
// DELETE /api/promotions/:id
// ==========================================
router.delete('/api/promotions/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 할인 및 베네핏 삭제 (CASCADE로 자동 삭제되지만 명시적으로)
    await client.query('DELETE FROM promotion_benefits WHERE promotion_id = $1', [id]);
    await client.query('DELETE FROM promotion_room_discounts WHERE promotion_id = $1', [id]);
    
    // 프로모션 삭제
    const result = await client.query('DELETE FROM promotions WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '프로모션을 찾을 수 없습니다.' });
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, promotion: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 프로모션 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 프로모션 코드 검증 (예약 시 사용)
// GET /api/promotions/validate/:promo_code
// ==========================================
router.get('/api/promotions/validate/:promo_code', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { promo_code } = req.params;
  const { hotel_id, booking_date, check_in_date } = req.query;
  
  try {
    if (!hotel_id || !booking_date || !check_in_date) {
      return res.status(400).json({ error: '호텔, 예약일, 체크인일을 입력해주세요.' });
    }
    
    // 프로모션 조회
    const promoResult = await pool.query(
      `SELECT p.*, h.hotel_name
       FROM promotions p
       JOIN hotels h ON p.hotel_id = h.id
       WHERE p.hotel_id = $1 
         AND p.promo_code = $2
         AND p.is_active = true
         AND p.booking_start_date <= $3
         AND p.booking_end_date >= $3
         AND p.stay_start_date <= $4
         AND p.stay_end_date >= $4`,
      [hotel_id, promo_code, booking_date, check_in_date]
    );
    
    if (promoResult.rows.length === 0) {
      return res.status(404).json({ 
        error: '유효하지 않은 프로모션 코드이거나 적용 기간이 아닙니다.' 
      });
    }
    
    const promotion = promoResult.rows[0];
    
    // 할인 정보 조회
    const discountsResult = await pool.query(
      `SELECT prd.*, rt.room_type_name
       FROM promotion_room_discounts prd
       JOIN room_types rt ON prd.room_type_id = rt.id
       WHERE prd.promotion_id = $1`,
      [promotion.id]
    );
    
    promotion.discounts = discountsResult.rows;
    
    // 베네핏 정보 조회
    const benefitsResult = await pool.query(
      `SELECT * FROM promotion_benefits WHERE promotion_id = $1`,
      [promotion.id]
    );
    
    promotion.benefits = benefitsResult.rows;
    
    res.json({ valid: true, promotion });
  } catch (error) {
    console.error('❌ 프로모션 검증 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
