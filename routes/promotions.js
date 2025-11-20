/**
 * 프로모션 관리 API v2 (재설계)
 * 
 * 핵심 변경사항:
 * - 날짜별 + 연박별 요금 관리
 * - promotion_daily_rates 테이블 사용
 * - 실제 예약 시스템과 완전 연동
 * 
 * API:
 * - GET    /api/promotions              프로모션 목록
 * - GET    /api/promotions/:id          프로모션 상세
 * - POST   /api/promotions              프로모션 등록
 * - PUT    /api/promotions/:id          프로모션 수정
 * - DELETE /api/promotions/:id          프로모션 삭제
 * - POST   /api/promotions/:id/rates    날짜별 요금 일괄 등록
 * - GET    /api/promotions/validate     프로모션 검증 및 요금 계산
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
        COUNT(DISTINCT pdr.id) as rate_count,
        COUNT(DISTINCT pb.id) as benefit_count
      FROM promotions p
      JOIN hotels h ON p.hotel_id = h.id
      LEFT JOIN promotion_daily_rates pdr ON p.id = pdr.promotion_id
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
// 프로모션 상세 조회 (요금 및 베네핏 포함)
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
    
    // 날짜별 요금 정보
    const ratesResult = await pool.query(
      `SELECT pdr.*, rt.room_type_name, rt.room_type_code
       FROM promotion_daily_rates pdr
       JOIN room_types rt ON pdr.room_type_id = rt.id
       WHERE pdr.promotion_id = $1
       ORDER BY pdr.stay_date, rt.room_type_code, pdr.min_nights`,
      [id]
    );
    
    promotion.rates = ratesResult.rows;
    
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
// 프로모션 등록
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
    description,
    terms_and_conditions,
    is_active
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
        description, terms_and_conditions, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`,
      [
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        description, terms_and_conditions, is_active !== false
      ]
    );
    
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
    description,
    terms_and_conditions,
    is_active
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
        description = $8,
        terms_and_conditions = $9,
        is_active = $10,
        updated_at = NOW()
      WHERE id = $11
      RETURNING *`,
      [
        hotel_id, promo_code, promo_name,
        booking_start_date, booking_end_date,
        stay_start_date, stay_end_date,
        description, terms_and_conditions, is_active !== false,
        id
      ]
    );
    
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
    
    // CASCADE로 자동 삭제되지만 명시적으로
    await client.query('DELETE FROM promotion_benefits WHERE promotion_id = $1', [id]);
    await client.query('DELETE FROM promotion_daily_rates WHERE promotion_id = $1', [id]);
    
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
// 날짜별 요금 일괄 등록/수정
// POST /api/promotions/:id/rates
// ==========================================
router.post('/api/promotions/:id/rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { rates } = req.body;  // [{ room_type_id, stay_date, min_nights, max_nights, rate_per_night, currency }]
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 프로모션 존재 확인
    const checkPromo = await client.query('SELECT id FROM promotions WHERE id = $1', [id]);
    if (checkPromo.rows.length === 0) {
      return res.status(404).json({ error: '프로모션을 찾을 수 없습니다.' });
    }
    
    if (!rates || !Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: '요금 데이터가 필요합니다.' });
    }
    
    // ⭐ 기존 요금 모두 삭제 (UI에서 삭제된 요금도 DB에서 제거)
    await client.query('DELETE FROM promotion_daily_rates WHERE promotion_id = $1', [id]);
    
    const results = [];
    
    for (const rate of rates) {
      const { room_type_id, stay_date, min_nights, max_nights, rate_per_night, currency, notes } = rate;
      
      // 필수값 체크
      if (!room_type_id || !stay_date || !min_nights || !rate_per_night) {
        continue;  // 필수값 없으면 스킵
      }
      
      // INSERT (기존 데이터는 이미 삭제했으므로 충돌 없음)
      const result = await client.query(
        `INSERT INTO promotion_daily_rates (
          promotion_id, room_type_id, stay_date, 
          min_nights, max_nights, rate_per_night, currency, notes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [id, room_type_id, stay_date, min_nights, max_nights || null, rate_per_night, currency || 'USD', notes || null]
      );
      
      results.push(result.rows[0]);
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, count: results.length, rates: results });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 요금 일괄 등록 오류:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 날짜별 요금 조회
// GET /api/promotions/:id/rates
// ==========================================
router.get('/api/promotions/:id/rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { room_type_id, stay_date_from, stay_date_to } = req.query;
  
  try {
    let query = `
      SELECT pdr.*, rt.room_type_name, rt.room_type_code
      FROM promotion_daily_rates pdr
      JOIN room_types rt ON pdr.room_type_id = rt.id
      WHERE pdr.promotion_id = $1
    `;
    const params = [id];
    let paramIndex = 2;
    
    if (room_type_id) {
      query += ` AND pdr.room_type_id = $${paramIndex}`;
      params.push(room_type_id);
      paramIndex++;
    }
    
    if (stay_date_from) {
      query += ` AND pdr.stay_date >= $${paramIndex}`;
      params.push(stay_date_from);
      paramIndex++;
    }
    
    if (stay_date_to) {
      query += ` AND pdr.stay_date <= $${paramIndex}`;
      params.push(stay_date_to);
      paramIndex++;
    }
    
    query += ` ORDER BY pdr.stay_date, rt.room_type_code, pdr.min_nights`;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 요금 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 베네핏 등록/수정
// POST /api/promotions/:id/benefits
// ==========================================
router.post('/api/promotions/:id/benefits', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { benefits } = req.body;  // [{ benefit_type, benefit_name, benefit_value, quantity, description }]
  
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // 기존 베네핏 삭제
    await client.query('DELETE FROM promotion_benefits WHERE promotion_id = $1', [id]);
    
    // 새 베네핏 등록
    const results = [];
    if (benefits && benefits.length > 0) {
      for (const benefit of benefits) {
        const result = await client.query(
          `INSERT INTO promotion_benefits (
            promotion_id, benefit_type, benefit_name, benefit_value, quantity, description
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING *`,
          [id, benefit.benefit_type, benefit.benefit_name, benefit.benefit_value || null, benefit.quantity || 1, benefit.description || null]
        );
        results.push(result.rows[0]);
      }
    }
    
    await client.query('COMMIT');
    
    res.json({ success: true, count: results.length, benefits: results });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ 베네핏 등록 오류:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// ==========================================
// 프로모션 검증 및 요금 계산 (예약 시 사용)
// GET /api/promotions/validate
// ==========================================
router.get('/api/promotions/validate', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, promo_code, booking_date, check_in_date, check_out_date, room_type_id } = req.query;
  
  try {
    if (!hotel_id || !promo_code || !booking_date || !check_in_date || !check_out_date || !room_type_id) {
      return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }
    
    // 1. 프로모션 기본 검증
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
         AND p.stay_end_date >= $5`,
      [hotel_id, promo_code, booking_date, check_in_date, check_out_date]
    );
    
    if (promoResult.rows.length === 0) {
      return res.status(404).json({ 
        valid: false,
        error: '유효하지 않은 프로모션 코드이거나 적용 기간이 아닙니다.' 
      });
    }
    
    const promotion = promoResult.rows[0];
    
    // 2. 숙박 일수 계산
    const checkIn = new Date(check_in_date);
    const checkOut = new Date(check_out_date);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    if (nights <= 0) {
      return res.status(400).json({ valid: false, error: '체크아웃 날짜가 체크인보다 빠릅니다.' });
    }
    
    // 3. 각 날짜별 요금 조회 (연박 할인 적용)
    const dailyRates = [];
    let totalAmount = 0;
    
    for (let i = 0; i < nights; i++) {
      const stayDate = new Date(checkIn);
      stayDate.setDate(stayDate.getDate() + i);
      const stayDateStr = stayDate.toISOString().split('T')[0];
      
      // 해당 날짜, 객실, 연박 조건에 맞는 요금 찾기
      const rateResult = await pool.query(
        `SELECT * FROM promotion_daily_rates
         WHERE promotion_id = $1
           AND room_type_id = $2
           AND stay_date = $3
           AND min_nights <= $4
           AND (max_nights IS NULL OR max_nights >= $4)
         ORDER BY min_nights DESC
         LIMIT 1`,
        [promotion.id, room_type_id, stayDateStr, nights]
      );
      
      if (rateResult.rows.length === 0) {
        return res.status(404).json({ 
          valid: false,
          error: `${stayDateStr} 날짜에 등록된 요금이 없습니다.` 
        });
      }
      
      const rate = rateResult.rows[0];
      dailyRates.push({
        stay_date: stayDateStr,
        rate_per_night: parseFloat(rate.rate_per_night),
        currency: rate.currency,
        min_nights: rate.min_nights,
        max_nights: rate.max_nights
      });
      
      totalAmount += parseFloat(rate.rate_per_night);
    }
    
    // 4. 베네핏 조회
    const benefitsResult = await pool.query(
      `SELECT * FROM promotion_benefits WHERE promotion_id = $1`,
      [promotion.id]
    );
    
    res.json({
      valid: true,
      promotion: {
        id: promotion.id,
        promo_code: promotion.promo_code,
        promo_name: promotion.promo_name,
        hotel_name: promotion.hotel_name
      },
      nights,
      daily_rates: dailyRates,
      total_amount: totalAmount,
      currency: dailyRates[0]?.currency || 'USD',
      benefits: benefitsResult.rows
    });
    
  } catch (error) {
    console.error('❌ 프로모션 검증 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 룸타입별 프로모션 목록 조회 (인박스용)
// GET /api/promotions/room-type/:roomTypeId/rates
// ==========================================
router.get('/api/promotions/room-type/:roomTypeId/rates', async (req, res) => {
  const pool = req.app.locals.pool;
  const { roomTypeId } = req.params;
  const { checkIn, checkOut } = req.query;
  
  console.log('📋 룸타입별 프로모션 조회:', { roomTypeId, checkIn, checkOut });
  
  if (!roomTypeId || !checkIn || !checkOut) {
    return res.status(400).json({ 
      success: false, 
      error: '필수 파라미터 누락 (roomTypeId, checkIn, checkOut)' 
    });
  }
  
  try {
    // 1. 날짜 배열 생성
    const dates = [];
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      dates.push(d.toISOString().split('T')[0]);
    }
    
    const nights = dates.length;
    console.log('  📅 투숙일:', dates, `(${nights}박)`);
    
    // 2. 적용 가능한 프로모션 조회
    const promosQuery = `
      SELECT DISTINCT
        p.id as promotion_id,
        p.promo_code,
        p.promo_name,
        p.description,
        p.booking_start_date,
        p.booking_end_date,
        p.stay_start_date,
        p.stay_end_date
      FROM promotions p
      WHERE p.is_active = true
        AND p.booking_start_date <= CURRENT_DATE
        AND p.booking_end_date >= CURRENT_DATE
        AND p.stay_start_date <= $1::date
        AND p.stay_end_date >= $2::date
        AND EXISTS (
          SELECT 1 FROM promotion_daily_rates pdr
          WHERE pdr.promotion_id = p.id
            AND pdr.room_type_id = $3
            AND pdr.stay_date = ANY($4::date[])
        )
      ORDER BY p.promo_code
    `;
    
    const promosResult = await pool.query(promosQuery, [checkIn, checkOut, roomTypeId, dates]);
    console.log(`  ✅ 적용 가능한 프로모션: ${promosResult.rows.length}개`);
    
    if (promosResult.rows.length === 0) {
      return res.json({
        success: true,
        promotions: [],
        message: '선택한 날짜에 적용 가능한 프로모션이 없습니다.'
      });
    }
    
    // 3. 각 프로모션별 날짜별 요금 조회 및 총액 계산
    const promotionsWithRates = [];
    
    for (const promo of promosResult.rows) {
      const ratesQuery = `
        SELECT 
          stay_date,
          rate_per_night,
          min_nights,
          currency
        FROM promotion_daily_rates
        WHERE promotion_id = $1
          AND room_type_id = $2
          AND stay_date = ANY($3::date[])
        ORDER BY stay_date
      `;
      
      const ratesResult = await pool.query(ratesQuery, [promo.promotion_id, roomTypeId, dates]);
      
      // 모든 날짜에 대한 요금이 있는지 확인
      if (ratesResult.rows.length !== nights) {
        console.log(`  ⚠️ ${promo.promo_code}: 일부 날짜 요금 없음 (${ratesResult.rows.length}/${nights})`);
        continue; // 요금이 없는 날짜가 있으면 제외
      }
      
      // 총액 계산
      const totalAmount = ratesResult.rows.reduce((sum, r) => sum + parseFloat(r.rate_per_night), 0);
      const avgRate = Math.round(totalAmount / nights);
      
      // 특전 조회
      const benefitsQuery = `
        SELECT 
          benefit_type,
          benefit_name,
          benefit_value,
          quantity,
          description
        FROM promotion_benefits
        WHERE promotion_id = $1
        ORDER BY id
      `;
      const benefitsResult = await pool.query(benefitsQuery, [promo.promotion_id]);
      
      promotionsWithRates.push({
        promotion_id: promo.promotion_id,
        promo_code: promo.promo_code,
        promo_name: promo.promo_name,
        description: promo.description,
        total_amount: Math.round(totalAmount),
        avg_rate: avgRate,
        nights: nights,
        dates: ratesResult.rows.map(r => ({
          date: r.stay_date,
          rate: parseFloat(r.rate_per_night)
        })),
        benefits: benefitsResult.rows,
        currency: ratesResult.rows[0]?.currency || 'USD'
      });
      
      console.log(`  💰 ${promo.promo_code}: $${Math.round(totalAmount)} (평균 $${avgRate}/박)`);
    }
    
    res.json({
      success: true,
      promotions: promotionsWithRates,
      room_type_id: parseInt(roomTypeId),
      check_in: checkIn,
      check_out: checkOut,
      nights: nights
    });
    
  } catch (error) {
    console.error('❌ 룸타입별 프로모션 조회 오류:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

module.exports = router;
