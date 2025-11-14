/**
 * 시즌 달력 관리 API
 * - 날짜별 시즌 할당 (재고관리와 유사한 달력 방식)
 * - 5가지 시즌: 비수기, 평수기, 성수기, 극성수기, 시즌미정
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
// 시즌 타입 목록 조회
// GET /api/season-types
// ==========================================
router.get('/api/season-types', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  
  try {
    const result = await pool.query(
      `SELECT * FROM season_types 
       WHERE is_active = true 
       ORDER BY display_order`
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 시즌 타입 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 달력 조회 (월별)
// GET /api/season-calendar?hotel_id=1&year=2025&month=11
// ==========================================
router.get('/api/season-calendar', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, year, month } = req.query;
  
  try {
    if (!hotel_id || !year || !month) {
      return res.status(400).json({ error: '호텔, 년도, 월을 입력해주세요.' });
    }
    
    // 테이블 존재 확인
    const tableCheck = await pool.query(
      `SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'season_types'
      )`
    );
    
    if (!tableCheck.rows[0].exists) {
      return res.status(500).json({ 
        error: '시즌 테이블이 생성되지 않았습니다. Supabase SQL Editor에서 마이그레이션을 실행해주세요.' 
      });
    }
    
    // 해당 월의 시작일과 종료일
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    
    const result = await pool.query(
      `SELECT 
        sc.id,
        sc.calendar_date,
        sc.season_type_id,
        sc.notes,
        st.season_code,
        st.season_name,
        st.color_code
      FROM season_calendar sc
      JOIN season_types st ON sc.season_type_id = st.id
      WHERE sc.hotel_id = $1
        AND sc.calendar_date >= $2
        AND sc.calendar_date <= $3
      ORDER BY sc.calendar_date`,
      [hotel_id, startDate, endDate]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 시즌 달력 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 달력 일괄 등록/수정
// POST /api/season-calendar/bulk
// ==========================================
router.post('/api/season-calendar/bulk', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, updates } = req.body;
  // updates: [{ date: '2025-11-15', season_type_id: 1 }, ...]
  
  try {
    if (!hotel_id || !Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ error: '잘못된 요청입니다.' });
    }
    
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      for (const update of updates) {
        const { date, season_type_id } = update;
        
        // UPSERT (있으면 업데이트, 없으면 삽입)
        await client.query(
          `INSERT INTO season_calendar (hotel_id, season_type_id, calendar_date)
           VALUES ($1, $2, $3)
           ON CONFLICT (hotel_id, calendar_date)
           DO UPDATE SET 
             season_type_id = $2,
             updated_at = NOW()`,
          [hotel_id, season_type_id, date]
        );
      }
      
      await client.query('COMMIT');
      res.json({ success: true, updated: updates.length });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    
  } catch (error) {
    console.error('❌ 시즌 달력 일괄 업데이트 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 시즌 달력 삭제 (특정 날짜)
// DELETE /api/season-calendar
// ==========================================
router.delete('/api/season-calendar', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, date } = req.body;
  
  try {
    if (!hotel_id || !date) {
      return res.status(400).json({ error: '호텔과 날짜를 입력해주세요.' });
    }
    
    const result = await pool.query(
      'DELETE FROM season_calendar WHERE hotel_id = $1 AND calendar_date = $2 RETURNING *',
      [hotel_id, date]
    );
    
    res.json({ success: true, deleted: result.rows.length });
  } catch (error) {
    console.error('❌ 시즌 달력 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
