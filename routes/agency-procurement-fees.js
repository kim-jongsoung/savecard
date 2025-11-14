/**
 * 거래처별 수배피 관리 API
 * 
 * 기능:
 * - 수배피 목록 조회
 * - 수배피 상세 조회
 * - 수배피 등록
 * - 수배피 수정
 * - 수배피 삭제
 * - 수배피 계산 (예약 시스템용)
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
// 수배피 목록 조회
// GET /api/agency-procurement-fees
// ==========================================
router.get('/api/agency-procurement-fees', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_id, hotel_id, is_active } = req.query;
  
  try {
    let query = `
      SELECT 
        apf.*,
        ba.agency_name,
        ba.agency_code,
        h.hotel_name
      FROM agency_procurement_fees apf
      JOIN booking_agencies ba ON apf.agency_id = ba.id
      LEFT JOIN hotels h ON apf.hotel_id = h.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (agency_id) {
      query += ` AND apf.agency_id = $${paramIndex}`;
      params.push(agency_id);
      paramIndex++;
    }
    
    if (hotel_id) {
      query += ` AND (apf.hotel_id = $${paramIndex} OR apf.hotel_id IS NULL)`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (is_active !== undefined) {
      query += ` AND apf.is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }
    
    query += ` ORDER BY ba.agency_name, h.hotel_name NULLS FIRST, apf.created_at DESC`;
    
    const result = await pool.query(query, params);
    
    res.json(result.rows);
  } catch (error) {
    console.error('❌ 수배피 목록 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 수배피 계산 (예약 시스템용) - /:id 보다 먼저 정의해야 함
// GET /api/agency-procurement-fees/calculate
// ==========================================
router.get('/api/agency-procurement-fees/calculate', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { agency_id, hotel_id, check_in_date, nights } = req.query;
  
  try {
    console.log('🔍 수배피 계산 API 호출:', { agency_id, hotel_id, check_in_date, nights });
    
    if (!agency_id || !nights) {
      console.log('⚠️ 필수 파라미터 누락');
      return res.status(400).json({ error: '거래처, 숙박일수를 입력해주세요.' });
    }
    
    const nightsNum = parseInt(nights);
    
    // 테이블 존재 확인
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'agency_procurement_fees'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('⚠️ agency_procurement_fees 테이블이 존재하지 않습니다.');
      return res.json({ 
        fee: 0, 
        message: '수배피 테이블이 설정되지 않았습니다.',
        details: null 
      });
    }
    
    // 해당 거래처의 수배피 조회 (우선순위: 호텔별 > 전체)
    let query = `
      SELECT * FROM agency_procurement_fees
      WHERE agency_id = $1
        AND is_active = true
    `;
    const params = [agency_id];
    let paramIndex = 2;
    
    if (hotel_id) {
      query += ` AND (hotel_id = $${paramIndex} OR hotel_id IS NULL)`;
      params.push(hotel_id);
      paramIndex++;
    }
    
    if (check_in_date) {
      query += ` AND (effective_date IS NULL OR effective_date <= $${paramIndex})`;
      params.push(check_in_date);
      paramIndex++;
      
      query += ` AND (expiry_date IS NULL OR expiry_date >= $${paramIndex - 1})`;
    }
    
    query += ` ORDER BY hotel_id DESC NULLS LAST, effective_date DESC NULLS LAST LIMIT 1`;
    
    console.log('📝 수배피 조회 쿼리:', query, params);
    const result = await pool.query(query, params);
    console.log('📊 수배피 조회 결과:', result.rows.length, '건');
    
    if (result.rows.length === 0) {
      return res.json({ 
        fee: 0, 
        message: '적용 가능한 수배피가 없습니다.',
        details: null 
      });
    }
    
    const feePolicy = result.rows[0];
    let calculatedFee = 0;
    let calculation = '';
    
    if (feePolicy.fee_type === 'per_night') {
      // 1박당 방식
      calculatedFee = feePolicy.fee_per_night * nightsNum;
      calculation = `$${feePolicy.fee_per_night} × ${nightsNum}박 = $${calculatedFee}`;
    } else if (feePolicy.fee_type === 'flat') {
      // 정액제 방식
      if (feePolicy.max_nights_for_fee && nightsNum > feePolicy.max_nights_for_fee) {
        // N박 이상 정액 고정
        calculatedFee = feePolicy.flat_fee_amount;
        calculation = `${nightsNum}박 (${feePolicy.max_nights_for_fee}박 초과) = $${calculatedFee} 고정`;
      } else {
        // N박까지는 1박당
        calculatedFee = feePolicy.fee_per_night * nightsNum;
        calculation = `$${feePolicy.fee_per_night} × ${nightsNum}박 = $${calculatedFee}`;
      }
    }
    
    console.log('✅ 수배피 계산 완료:', { fee: calculatedFee, calculation });
    res.json({
      fee: calculatedFee,
      calculation,
      details: feePolicy
    });
  } catch (error) {
    console.error('❌ 수배피 계산 오류:', error);
    console.error('스택:', error.stack);
    res.status(500).json({ error: error.message, details: error.stack });
  }
});

// ==========================================
// 수배피 상세 조회
// GET /api/agency-procurement-fees/:id
// ==========================================
router.get('/api/agency-procurement-fees/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      `SELECT 
        apf.*,
        ba.agency_name,
        ba.agency_code,
        h.hotel_name
      FROM agency_procurement_fees apf
      JOIN booking_agencies ba ON apf.agency_id = ba.id
      LEFT JOIN hotels h ON apf.hotel_id = h.id
      WHERE apf.id = $1`,
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '수배피를 찾을 수 없습니다.' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('❌ 수배피 상세 조회 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 수배피 등록
// POST /api/agency-procurement-fees
// ==========================================
router.post('/api/agency-procurement-fees', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const {
    agency_id,
    hotel_id,
    fee_name,
    fee_type,
    fee_per_night,
    max_nights_for_fee,
    flat_fee_amount,
    effective_date,
    expiry_date,
    description,
    is_active
  } = req.body;
  
  try {
    // 필수값 체크
    if (!agency_id || !fee_name || !fee_type) {
      return res.status(400).json({ error: '필수 항목을 입력해주세요.' });
    }
    
    // fee_type 검증
    if (!['per_night', 'flat'].includes(fee_type)) {
      return res.status(400).json({ error: '수배피 타입은 per_night 또는 flat이어야 합니다.' });
    }
    
    // 날짜 유효성 체크
    if (effective_date && expiry_date && new Date(expiry_date) < new Date(effective_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    const result = await pool.query(
      `INSERT INTO agency_procurement_fees (
        agency_id, hotel_id, fee_name, fee_type,
        fee_per_night, max_nights_for_fee, flat_fee_amount,
        effective_date, expiry_date, description, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        agency_id,
        hotel_id || null,
        fee_name,
        fee_type,
        fee_per_night || null,
        max_nights_for_fee || null,
        flat_fee_amount || null,
        effective_date || null,
        expiry_date || null,
        description,
        is_active !== false
      ]
    );
    
    res.json({ success: true, fee: result.rows[0] });
  } catch (error) {
    console.error('❌ 수배피 등록 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 수배피 수정
// PUT /api/agency-procurement-fees/:id
// ==========================================
router.put('/api/agency-procurement-fees/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  const {
    agency_id,
    hotel_id,
    fee_name,
    fee_type,
    fee_per_night,
    max_nights_for_fee,
    flat_fee_amount,
    effective_date,
    expiry_date,
    description,
    is_active
  } = req.body;
  
  try {
    // 존재 확인
    const checkExist = await pool.query('SELECT id FROM agency_procurement_fees WHERE id = $1', [id]);
    if (checkExist.rows.length === 0) {
      return res.status(404).json({ error: '수배피를 찾을 수 없습니다.' });
    }
    
    // 날짜 유효성 체크
    if (effective_date && expiry_date && new Date(expiry_date) < new Date(effective_date)) {
      return res.status(400).json({ error: '종료일은 시작일보다 늦어야 합니다.' });
    }
    
    const result = await pool.query(
      `UPDATE agency_procurement_fees SET
        agency_id = $1,
        hotel_id = $2,
        fee_name = $3,
        fee_type = $4,
        fee_per_night = $5,
        max_nights_for_fee = $6,
        flat_fee_amount = $7,
        effective_date = $8,
        expiry_date = $9,
        description = $10,
        is_active = $11,
        updated_at = NOW()
      WHERE id = $12
      RETURNING *`,
      [
        agency_id,
        hotel_id || null,
        fee_name,
        fee_type,
        fee_per_night || null,
        max_nights_for_fee || null,
        flat_fee_amount || null,
        effective_date || null,
        expiry_date || null,
        description,
        is_active !== false,
        id
      ]
    );
    
    res.json({ success: true, fee: result.rows[0] });
  } catch (error) {
    console.error('❌ 수배피 수정 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 수배피 삭제
// DELETE /api/agency-procurement-fees/:id
// ==========================================
router.delete('/api/agency-procurement-fees/:id', requireLogin, async (req, res) => {
  const pool = req.app.locals.pool;
  const { id } = req.params;
  
  try {
    const result = await pool.query(
      'DELETE FROM agency_procurement_fees WHERE id = $1 RETURNING *',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '수배피를 찾을 수 없습니다.' });
    }
    
    res.json({ success: true, fee: result.rows[0] });
  } catch (error) {
    console.error('❌ 수배피 삭제 오류:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
