/**
 * 시즌 관리 API
 * 
 * 기능:
 * - 시즌 목록 조회 (호텔별, 날짜별 필터링)
 * - 시즌 상세 조회
 * - 시즌 등록
 * - 시즌 수정
 * - 시즌 삭제
 * - 중첩 시즌 검증
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
// 시즌 목록 조회
// GET /api/seasons
// ==========================================
router.get('/api/seasons', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, is_active, year, month } = req.query;
  
  try {
    let query = `
      SELECT 
        s.*,
        h.hotel_name,
        h.hotel_code
      FROM seasons s
      JOIN hotels h ON s.hotel_id = h.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (hotel_id) {
      query += ` AND s.hotel_id = $${paramIndex}`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += ` AND s.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    // 특정 년/월에 겹치는 시즌 조회
    if (year && month) {
      const startOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      const endOfMonth = new Date(year, month, 0).getDate();
      const endOfMonthDate = `${year}-${String(month).padStart(2, '0')}-${endOfMonth}`;
      
      query += ` AND (
        (s.start_date <= $${paramIndex} AND s.end_date >= $${paramIndex})
        OR (s.start_date <= $${paramIndex + 1} AND s.end_date >= $${paramIndex + 1})
        OR (s.start_date >= $${paramIndex} AND s.end_date <= $${paramIndex + 1})
      )`;
      params.push(startOfMonth, endOfMonthDate);
      paramIndex += 2;
    }
    
    query += ` ORDER BY s.hotel_id, s.priority DESC, s.start_date`;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 시즌 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 상세 조회
// GET /api/seasons/:id
// ==========================================
router.get('/api/seasons/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        s.*,
        h.hotel_name,
        h.hotel_code
      FROM seasons s
      JOIN hotels h ON s.hotel_id = h.id
      WHERE s.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '시즌을 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 시즌 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 등록
// POST /api/seasons
// ==========================================
router.post('/api/seasons', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    hotel_id,
    season_name,
    season_code,
    start_date,
    end_date,
    priority,
    description,
    is_active
  } = req.body;
  
  try {
    // 필수값 체크
    if (!hotel_id || !season_name || !start_date || !end_date) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // 날짜 유효성 체크
    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 시즌 코드 중복 체크 (같은 호텔 내)
    if (season_code) {
      const checkCode = await pool.query(
        'SELECT id FROM seasons WHERE hotel_id = $1 AND season_code = $2',
        [hotel_id, season_code]
      );
      
      if (checkCode.rows.length > 0) {
        return res.status(400).json({ error: '이미 존재하는 시즌 코드입니다.' });
      }
    }
    
    const result = await pool.query(
      `INSERT INTO seasons (
        hotel_id, season_name, season_code, 
        start_date, end_date, priority, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *`,
      [
        hotel_id, 
        season_name, 
        season_code, 
        start_date, 
        end_date, 
        priority || 0, 
        description, 
        is_active !== false
      ]
    );
    
    res.json({ success: true, season: result.rows[0] });
  } catch (error) {
    console.error('❌ 시즌 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 수정
// PUT /api/seasons/:id
// ==========================================
router.put('/api/seasons/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    hotel_id,
    season_name,
    season_code,
    start_date,
    end_date,
    priority,
    description,
    is_active
  } = req.body;
  
  try {
    // 존재 확인
    const checkExist = await pool.query('SELECT id FROM seasons WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '시즌을 찾을 수 없습니다.' });
    }
    
    // 날짜 유효성 체크
    if (new Date(end_date) < new Date(start_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    // 시즌 코드 중복 체크 (자기 자신 제외)
    if (season_code) {
      const checkCode = await pool.query(
        'SELECT id FROM seasons WHERE hotel_id = $1 AND season_code = $2 AND id != $3',
        [hotel_id, season_code, id]
      );
      
      if (checkCode.rows.length > 0) {
        return res.status(400).json({ error: '이미 존재하는 시즌 코드입니다.' });
      }
    }
    
    const result = await pool.query(
      `UPDATE seasons SET
        hotel_id = $1,
        season_name = $2,
        season_code = $3,
        start_date = $4,
        end_date = $5,
        priority = $6,
        description = $7,
        is_active = $8,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *`,
      [
        hotel_id,
        season_name,
        season_code,
        start_date,
        end_date,
        priority || 0,
        description,
        is_active !== false,
        id
      ]
    );
    
    res.json({ success: true, season: result.rows[0] });
  } catch (error) {
    console.error('❌ 시즌 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 삭제
// DELETE /api/seasons/:id
// ==========================================
router.delete('/api/seasons/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 해당 시즌을 사용하는 요금이 있는지 확인
    const checkRates = await pool.query(
      'SELECT COUNT(*) as count FROM hotel_rates WHERE season_id = $1',
      [id]
    );
    
    if (parseInt(checkRates.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: '이 시즌을 사용하는 요금이 있습니다. 먼저 요금을 삭제하거나 변경해주세요.' 
      });
    }
    
    const result = await pool.query(
      'DELETE FROM seasons WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '시즌을 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, season: result.rows[0] });
  } catch (error) {
    console.error('❌ 시즌 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 중첩 시즌 조회 (특정 호텔의 특정 기간에 겹치는 시즌들)
// GET /api/seasons/overlaps
// ==========================================
router.get('/api/seasons/overlaps', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, start_date, end_date } = req.query;
  
  try {
    if (!hotel_id || !start_date || !end_date) {
      return res.status(400).json({ error: '호텔, 시작일, 종료일을 입력해주세요.' });
    }
    
    const result = await pool.query(
      `SELECT s.*, h.hotel_name
      FROM seasons s
      JOIN hotels h ON s.hotel_id = h.id
      WHERE s.hotel_id = $1
        AND s.is_active = true
        AND (
          (s.start_date <= $2 AND s.end_date >= $2)
          OR (s.start_date <= $3 AND s.end_date >= $3)
          OR (s.start_date >= $2 AND s.end_date <= $3)
        )
      ORDER BY s.priority DESC, s.start_date`,
      [hotel_id, start_date, end_date]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 중첩 시즌 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
