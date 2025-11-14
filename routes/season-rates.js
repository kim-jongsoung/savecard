/**
 * 시즌별 기본 요금 관리 API
 * - 시즌 × 룸타입별 기본 요금
 * - 이 요금은 참고용이며, 실제 예약은 프로모션 요금 사용
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
// 시즌별 요금 조회
// GET /api/season-rates?hotel_id=1
// ==========================================
router.get('/api/season-rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id } = req.query;
  
  try {
    if (!hotel_id) {
      return res.status(400).json({ error: '호텔을 선택해주세요.' });
    }
    
    // 테이블 존재 확인
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'season_rates'
      )`
    );
    
    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({ 
        error: '시즌 요금 테이블이 생성되지 않았습니다. 서버 로그를 확인하거나 관리자에게 문의하세요.' 
      });
    }
    
    const result = await pool.query(
      `SELECT 
        sr.id,
        sr.hotel_id,
        sr.season_type_id,
        sr.room_type_id,
        sr.base_rate,
        sr.currency,
        sr.notes,
        st.season_code,
        st.season_name,
        rt.room_type_name
      FROM season_rates sr
      JOIN season_types st ON sr.season_type_id = st.id
      JOIN room_types rt ON sr.room_type_id = rt.id
      WHERE sr.hotel_id = $1
      ORDER BY st.display_order, rt.room_type_name`,
      [hotel_id]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 시즌 요금 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌별 요금 등록/수정
// POST /api/season-rates
// ==========================================
router.post('/api/season-rates', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, season_type_id, room_type_id, base_rate, currency, notes } = req.body;
  
  try {
    if (!hotel_id || !season_type_id || !room_type_id || base_rate === undefined) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // UPSERT
    const result = await pool.query(
      `INSERT INTO season_rates 
        (hotel_id, season_type_id, room_type_id, base_rate, currency, notes)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (hotel_id, season_type_id, room_type_id)
       DO UPDATE SET
         base_rate = $4,
         currency = $5,
         notes = $6,
         updated_at = NOW()
       RETURNING *`,
      [hotel_id, season_type_id, room_type_id, base_rate, currency || 'USD', notes]
    );
    
    res.json({ success: true, rate: result.rows[0] });
  } catch (error) {
    console.error('❌ 시즌별 요금 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌별 요금 일괄 등록/수정
// POST /api/season-rates/bulk
// ==========================================
router.post('/api/season-rates/bulk', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, rates } = req.body;
  // rates: [{ season_type_id: 1, room_type_id: 1, base_rate: 200 }, ...]
  
  try {
    if (!hotel_id || !Array.isArray(rates) || rates.length === 0) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const rate of rates) {
        const { season_type_id, room_type_id, base_rate, currency, notes } = rate;
        
        await client.query(
          `INSERT INTO season_rates 
            (hotel_id, season_type_id, room_type_id, base_rate, currency, notes)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (hotel_id, season_type_id, room_type_id)
           DO UPDATE SET
             base_rate = $4,
             currency = $5,
             notes = $6,
             updated_at = NOW()`,
          [hotel_id, season_type_id, room_type_id, base_rate, currency || 'USD', notes]
        );
      }
      
      await client.query('COMMIT');
      res.json({ success: true, updated: rates.length });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ 시즌별 요금 일괄 업데이트 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌별 요금 삭제
// DELETE /api/season-rates/:id
// ==========================================
router.delete('/api/season-rates/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM season_rates WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '요금을 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, rate: result.rows[0] });
  } catch (error) {
    console.error('❌ 시즌별 요금 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
