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
// 월별 재고 조회
// GET /api/inventory?hotel_id=&room_type_id=&year=&month=
// ==========================================
router.get('/api/inventory', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, year, month } = req.query;
  
  try {
    // 기본값: 현재 년월
    const targetYear = year || new Date().getFullYear();
    const targetMonth = month || (new Date().getMonth() + 1);
    
    // 해당 월의 시작일과 종료일
    const startDate = `${targetYear}-${String(targetMonth).padStart(2, '0')}-01`;
    const endDate = new Date(targetYear, targetMonth, 0); // 마지막 날
    const endDateStr = `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
    
    let query = `
      SELECT 
        ri.*,
        h.hotel_name,
        h.hotel_code,
        rt.room_type_code,
        rt.room_type_name
      FROM room_inventory ri
      LEFT JOIN hotels h ON ri.hotel_id = h.id
      LEFT JOIN room_types rt ON ri.room_type_id = rt.id
      WHERE ri.inventory_date >= $1 AND ri.inventory_date <= $2
    `;
    
    const params = [startDate, endDateStr];
    let paramIndex = 3;
    
    if (hotel_id) {
      query += ` AND ri.hotel_id = $${paramIndex}`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (room_type_id) {
      query += ` AND ri.room_type_id = $${paramIndex}`;
      params.push(room_type_id);
      paramIndex++;
    }
    
    query += ` ORDER BY ri.inventory_date, h.hotel_name, rt.room_type_code`;
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 재고 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 재고 일괄 등록/수정
// POST /api/inventory/bulk
// ==========================================
router.post('/api/inventory/bulk', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, start_date, end_date, days_of_week, available_rooms, notes } = req.body;
  
  try {
    if (!hotel_id || !room_type_id || !start_date || !end_date) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // 날짜 범위 생성
    const start = new Date(start_date);
    const end = new Date(end_date);
    const datesArray = [];
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dayOfWeek = d.getDay(); // 0=일, 1=월, ..., 6=토
      
      // 요일 필터 적용 (선택된 요일만)
      if (days_of_week && days_of_week.length > 0) {
        if (!days_of_week.includes(dayOfWeek)) {
          continue;
        }
      }
      
      datesArray.push(new Date(d));
    }
    
    // 일괄 UPSERT
    let successCount = 0;
    let errorCount = 0;
    
    for (const date of datesArray) {
      try {
        const dateStr = date.toISOString().split('T')[0];
        
        await pool.query(`
          INSERT INTO room_inventory (
            hotel_id, room_type_id, inventory_date, available_rooms, notes
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (hotel_id, room_type_id, inventory_date)
          DO UPDATE SET
            available_rooms = EXCLUDED.available_rooms,
            notes = EXCLUDED.notes,
            updated_at = NOW()
        `, [hotel_id, room_type_id, dateStr, available_rooms || 0, notes]);
        
        successCount++;
      } catch (error) {
        console.error(`재고 등록 실패 (${date}):`, error);
        errorCount++;
      }
    }
    
    res.json({ 
      success: true, 
      message: `${successCount}개 등록 완료${errorCount > 0 ? `, ${errorCount}개 실패` : ''}`,
      successCount,
      errorCount
    });
  } catch (error) {
    console.error('❌ 재고 일괄 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 재고 수정 (단일)
// PUT /api/inventory/:id
// ==========================================
router.put('/api/inventory/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const { available_rooms, allocated_rooms, reserved_rooms, notes } = req.body;
  
  try {
    const result = await pool.query(`
      UPDATE room_inventory SET
        available_rooms = $1,
        allocated_rooms = $2,
        reserved_rooms = $3,
        notes = $4,
        updated_at = NOW()
      WHERE id = $5
      RETURNING *
    `, [available_rooms, allocated_rooms, reserved_rooms, notes, id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '재고를 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, inventory: result.rows[0] });
  } catch (error) {
    console.error('❌ 재고 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 재고 삭제 (일괄)
// POST /api/inventory/delete-bulk
// ==========================================
router.post('/api/inventory/delete-bulk', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, start_date, end_date } = req.body;
  
  try {
    if (!hotel_id || !room_type_id || !start_date || !end_date) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    const result = await pool.query(`
      DELETE FROM room_inventory
      WHERE hotel_id = $1 
        AND room_type_id = $2 
        AND inventory_date >= $3 
        AND inventory_date <= $4
    `, [hotel_id, room_type_id, start_date, end_date]);
    
    res.json({ 
      success: true, 
      message: `${result.rowCount}개 재고 삭제 완료`,
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('❌ 재고 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 재고 요약 (특정 기간)
// GET /api/inventory/summary?hotel_id=&start_date=&end_date=
// ==========================================
router.get('/api/inventory/summary', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, start_date, end_date } = req.query;
  
  try {
    if (!hotel_id || !start_date || !end_date) {
      return res.status(400).json({ error: '필수 파라미터가 누락되었습니다.' });
    }
    
    const result = await pool.query(`
      SELECT 
        rt.id as room_type_id,
        rt.room_type_code,
        rt.room_type_name,
        SUM(ri.available_rooms) as total_available,
        SUM(ri.allocated_rooms) as total_allocated,
        SUM(ri.reserved_rooms) as total_reserved,
        SUM(ri.available_rooms - ri.allocated_rooms - ri.reserved_rooms) as remaining
      FROM room_types rt
      LEFT JOIN room_inventory ri ON rt.id = ri.room_type_id 
        AND ri.inventory_date >= $2 
        AND ri.inventory_date <= $3
      WHERE rt.hotel_id = $1 AND rt.is_active = true
      GROUP BY rt.id, rt.room_type_code, rt.room_type_name
      ORDER BY rt.room_type_code
    `, [hotel_id, start_date, end_date]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 재고 요약 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
