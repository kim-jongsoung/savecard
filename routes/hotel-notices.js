const express = require('express');
const router = express.Router();

// 로그인 체크 미들웨어
function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: '로그인이 필요합니다.' });
  }
  next();
}

// ==========================================
// 호텔 공지사항 조회 (공개)
// GET /api/hotel-notices?hotel_id=1
// ==========================================
router.get('/api/hotel-notices', async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id } = req.query;
  
  try {
    if (!hotel_id) {
      return res.status(400).json({ error: 'hotel_id가 필요합니다.' });
    }
    
    const result = await pool.query(`
      SELECT 
        id,
        hotel_id,
        notice_text,
        created_at,
        created_by
      FROM hotel_notices
      WHERE hotel_id = $1 AND is_active = TRUE
      ORDER BY created_at DESC
    `, [hotel_id]);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 공지사항 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 공지사항 추가 (관리자)
// POST /api/hotel-notices
// ==========================================
router.post('/api/hotel-notices', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { hotel_id, notice_text } = req.body;
  const created_by = req.session.user.username || req.session.user.email;
  
  try {
    if (!hotel_id || !notice_text) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    const result = await pool.query(`
      INSERT INTO hotel_notices (hotel_id, notice_text, created_by)
      VALUES ($1, $2, $3)
      RETURNING *
    `, [hotel_id, notice_text.trim(), created_by]);
    
    console.log('✅ 공지사항 추가:', result.rows[0]);
    res.json({ success: true, notice: result.rows[0] });
  } catch (error) {
    console.error('❌ 공지사항 추가 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 호텔 공지사항 삭제 (관리자)
// DELETE /api/hotel-notices/:id
// ==========================================
router.delete('/api/hotel-notices/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    // 소프트 삭제 (is_active = FALSE)
    const result = await pool.query(`
      UPDATE hotel_notices
      SET is_active = FALSE
      WHERE id = $1
      RETURNING *
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '공지사항을 찾을 수 없습니다.' });
    }
    
    console.log('✅ 공지사항 삭제:', result.rows[0]);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ 공지사항 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
