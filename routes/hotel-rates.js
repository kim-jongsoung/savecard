/**
 * 호텔 요금 관리 API
 * 
 * 기능:
 * - 요금 목록 조회 (호텔별, 객실별, 시즌별)
 * - 요금 상세 조회
 * - 요금 등록
 * - 요금 수정
 * - 요금 삭제
 * - 요금 복사
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
// 요금 목록 조회
// GET /api/hotel-rates
// ==========================================
router.get('/api/hotel-rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, season_id, rate_type, is_active } = req.query;
  
  try {
    let query = `
      SELECT 
        hr.*,
        h.hotel_name,
        h.hotel_code,
        rt.room_type_name,
        rt.room_type_code,
        s.season_name,
        s.season_code,
        s.start_date as season_start,
        s.end_date as season_end
      FROM hotel_rates hr
      JOIN hotels h ON hr.hotel_id = h.id
      JOIN room_types rt ON hr.room_type_id = rt.id
      LEFT JOIN seasons s ON hr.season_id = s.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (hotel_id) {
      query += ` AND hr.hotel_id = $${paramIndex}`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (room_type_id) {
      query += ` AND hr.room_type_id = $${paramIndex}`;
      params.push(room_type_id);
      paramIndex++;
    }
    
    if (season_id) {
      query += ` AND hr.season_id = $${paramIndex}`;
      params.push(season_id);
      paramIndex++;
    }
    
    if (rate_type) {
      query += ` AND hr.rate_type = $${paramIndex}`;
      params.push(rate_type);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += ` AND hr.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    query += ` ORDER BY h.hotel_name, rt.room_type_code, s.priority DESC NULLS LAST, hr.rate_type`;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 요금 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 요금 상세 조회
// GET /api/hotel-rates/:id
// ==========================================
router.get('/api/hotel-rates/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        hr.*,
        h.hotel_name,
        h.hotel_code,
        rt.room_type_name,
        rt.room_type_code,
        s.season_name,
        s.season_code
      FROM hotel_rates hr
      JOIN hotels h ON hr.hotel_id = h.id
      JOIN room_types rt ON hr.room_type_id = rt.id
      LEFT JOIN seasons s ON hr.season_id = s.id
      WHERE hr.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금을 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 요금 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 요금 등록
// POST /api/hotel-rates
// ==========================================
router.post('/api/hotel-rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    hotel_id,
    room_type_id,
    season_id,
    rate_type,
    rate_per_night,
    min_nights,
    max_nights,
    effective_date,
    expiry_date,
    currency,
    description,
    is_active
  } = req.body;
  
  try {
    // 필수값 체크
    if (!hotel_id || !room_type_id || !rate_per_night) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // 요금 양수 체크
    if (parseFloat(rate_per_night) <= 0) {
      return res.status(400).json({ error: '요금은 0보다 커야 합니다.' });
    }
    
    // 날짜 유효성 체크
    if (effective_date && expiry_date && new Date(expiry_date) < new Date(effective_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 중복 체크 (같은 호텔, 객실, 시즌, 요금타입)
    const checkDup = await pool.query(
      `SELECT id FROM hotel_rates 
       WHERE hotel_id = $1 AND room_type_id = $2 
       AND (season_id = $3 OR (season_id IS NULL AND $3 IS NULL))
       AND rate_type = $4`,
      [hotel_id, room_type_id, season_id, rate_type || 'base']
    );
    
    if (checkDup.rows.length > 0) {
      return res.status(400).json({ 
        error: '동일한 조건의 요금이 이미 존재합니다. 기존 요금을 수정하거나 삭제 후 등록해주세요.' 
      });
    }
    
    const result = await pool.query(
      `INSERT INTO hotel_rates (
        hotel_id, room_type_id, season_id, rate_type, rate_per_night,
        min_nights, max_nights, effective_date, expiry_date, 
        currency, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        hotel_id,
        room_type_id,
        season_id,
        rate_type || 'base',
        rate_per_night,
        min_nights || 1,
        max_nights,
        effective_date,
        expiry_date,
        currency || 'USD',
        description,
        is_active !== false
      ]
    );
    
    res.json({ success: true, rate: result.rows[0] });
  } catch (error) {
    console.error('❌ 요금 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 요금 수정
// PUT /api/hotel-rates/:id
// ==========================================
router.put('/api/hotel-rates/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    hotel_id,
    room_type_id,
    season_id,
    rate_type,
    rate_per_night,
    min_nights,
    max_nights,
    effective_date,
    expiry_date,
    currency,
    description,
    is_active
  } = req.body;
  
  try {
    // 존재 확인
    const checkExist = await pool.query('SELECT id FROM hotel_rates WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '요금을 찾을 수 없습니다.' });
    }
    
    // 요금 양수 체크
    if (parseFloat(rate_per_night) <= 0) {
      return res.status(400).json({ error: '요금은 0보다 커야 합니다.' });
    }
    
    // 날짜 유효성 체크
    if (effective_date && expiry_date && new Date(expiry_date) < new Date(effective_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 중복 체크 (자기 자신 제외)
    const checkDup = await pool.query(
      `SELECT id FROM hotel_rates 
       WHERE hotel_id = $1 AND room_type_id = $2 
       AND (season_id = $3 OR (season_id IS NULL AND $3 IS NULL))
       AND rate_type = $4 AND id != $5`,
      [hotel_id, room_type_id, season_id, rate_type || 'base', id]
    );
    
    if (checkDup.rows.length > 0) {
      return res.status(400).json({ 
        error: '동일한 조건의 요금이 이미 존재합니다.' 
      });
    }
    
    const result = await pool.query(
      `UPDATE hotel_rates SET
        hotel_id = $1,
        room_type_id = $2,
        season_id = $3,
        rate_type = $4,
        rate_per_night = $5,
        min_nights = $6,
        max_nights = $7,
        effective_date = $8,
        expiry_date = $9,
        currency = $10,
        description = $11,
        is_active = $12,
        updated_at = NOW()
      WHERE id = $13
      RETURNING *`,
      [
        hotel_id,
        room_type_id,
        season_id,
        rate_type || 'base',
        rate_per_night,
        min_nights || 1,
        max_nights,
        effective_date,
        expiry_date,
        currency || 'USD',
        description,
        is_active !== false,
        id
      ]
    );
    
    res.json({ success: true, rate: result.rows[0] });
  } catch (error) {
    console.error('❌ 요금 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 요금 삭제
// DELETE /api/hotel-rates/:id
// ==========================================
router.delete('/api/hotel-rates/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM hotel_rates WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금을 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, rate: result.rows[0] });
  } catch (error) {
    console.error('❌ 요금 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 요금 복사
// POST /api/hotel-rates/:id/copy
// ==========================================
router.post('/api/hotel-rates/:id/copy', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { target_room_type_ids, target_season_id } = req.body;
  
  try {
    // 원본 요금 조회
    const original = await pool.query('SELECT * FROM hotel_rates WHERE id = $1', [id]);
    if (original.rows.length === 0) {
      return res.status(404).json({ error: '원본 요금을 찾을 수 없습니다.' });
    }
    
    const rate = original.rows[0];
    const copiedRates = [];
    
    // 여러 객실 타입에 복사
    if (target_room_type_ids && target_room_type_ids.length > 0) {
      for (const roomTypeId of target_room_type_ids) {
        // 중복 체크
        const checkDup = await pool.query(
          `SELECT id FROM hotel_rates 
           WHERE hotel_id = $1 AND room_type_id = $2 
           AND (season_id = $3 OR (season_id IS NULL AND $3 IS NULL))
           AND rate_type = $4`,
          [rate.hotel_id, roomTypeId, target_season_id || rate.season_id, rate.rate_type]
        );
        
        if (checkDup.rows.length === 0) {
          const copied = await pool.query(
            `INSERT INTO hotel_rates (
              hotel_id, room_type_id, season_id, rate_type, rate_per_night,
              min_nights, max_nights, effective_date, expiry_date, 
              currency, description, is_active
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *`,
            [
              rate.hotel_id,
              roomTypeId,
              target_season_id || rate.season_id,
              rate.rate_type,
              rate.rate_per_night,
              rate.min_nights,
              rate.max_nights,
              rate.effective_date,
              rate.expiry_date,
              rate.currency,
              rate.description,
              rate.is_active
            ]
          );
          copiedRates.push(copied.rows[0]);
        }
      }
    }
    
    res.json({ 
      success: true, 
      message: `${copiedRates.length}개의 요금이 복사되었습니다.`,
      rates: copiedRates 
    });
  } catch (error) {
    console.error('❌ 요금 복사 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 특정 날짜의 요금 조회 (견적 시스템용)
// GET /api/hotel-rates/lookup
// ==========================================
router.get('/api/hotel-rates/lookup', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, check_in_date } = req.query;
  
  try {
    if (!hotel_id || !room_type_id || !check_in_date) {
      return res.status(400).json({ error: '호텔, 객실타입, 체크인 날짜를 입력해주세요.' });
    }
    
    // 1. 해당 날짜에 적용되는 시즌 조회 (우선순위 높은 순)
    const seasonResult = await pool.query(
      `SELECT id, season_name, priority
       FROM seasons
       WHERE hotel_id = $1 
         AND is_active = true
         AND start_date <= $2 
         AND end_date >= $2
       ORDER BY priority DESC
       LIMIT 1`,
      [hotel_id, check_in_date]
    );
    
    let rate = null;
    
    // 2. 시즌 요금 조회
    if (seasonResult.rows.length > 0) {
      const season = seasonResult.rows[0];
      const rateResult = await pool.query(
        `SELECT hr.*, s.season_name
         FROM hotel_rates hr
         LEFT JOIN seasons s ON hr.season_id = s.id
         WHERE hr.hotel_id = $1 
           AND hr.room_type_id = $2 
           AND hr.season_id = $3
           AND hr.is_active = true
           AND (hr.effective_date IS NULL OR hr.effective_date <= $4)
           AND (hr.expiry_date IS NULL OR hr.expiry_date >= $4)
         LIMIT 1`,
        [hotel_id, room_type_id, season.id, check_in_date]
      );
      
      if (rateResult.rows.length > 0) {
        rate = rateResult.rows[0];
        rate.applied_season = season.season_name;
      }
    }
    
    // 3. 시즌 요금이 없으면 기본 요금 조회
    if (!rate) {
      const baseRateResult = await pool.query(
        `SELECT * FROM hotel_rates
         WHERE hotel_id = $1 
           AND room_type_id = $2 
           AND season_id IS NULL
           AND rate_type = 'base'
           AND is_active = true
           AND (effective_date IS NULL OR effective_date <= $3)
           AND (expiry_date IS NULL OR expiry_date >= $3)
         LIMIT 1`,
        [hotel_id, room_type_id, check_in_date]
      );
      
      if (baseRateResult.rows.length > 0) {
        rate = baseRateResult.rows[0];
        rate.applied_season = '기본 요금';
      }
    }
    
    if (!rate) {
      return res.status(404).json({ error: '해당 날짜에 적용 가능한 요금이 없습니다.' });
    }
    
    res.json(rate);
  } catch (error) {
    console.error('❌ 요금 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
