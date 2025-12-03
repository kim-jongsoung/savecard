/**
 * 가격 계산 API (공개)
 * 
 * 호텔 객실 요금 계산 (프로모션 포함)
 * 로그인 불필요 - 공개 페이지에서 사용
 */

const express = require('express');
const router = express.Router();

// ==========================================
// 가격 계산 (공개 - 로그인 불필요)
// GET /api/price-calculator/public
// ==========================================
router.get('/api/price-calculator/public', async (req, res) => {
  console.log('🌐 공개 가격 계산 API 호출');
  const pool = req.app.locals.pool;
  const { hotel_id, room_type_id, check_in, check_out, promo_id } = req.query;
  
  try {
    // 필수 파라미터 체크
    if (!hotel_id || !room_type_id || !check_in || !check_out) {
      return res.status(400).json({ 
        error: '필수 파라미터가 누락되었습니다. (hotel_id, room_type_id, check_in, check_out)' 
      });
    }
    
    // 날짜 유효성 체크
    const checkInDate = new Date(check_in);
    const checkOutDate = new Date(check_out);
    
    if (checkOutDate <= checkInDate) {
      return res.status(400).json({ 
        error: '체크아웃 날짜는 체크인 날짜보다 이후여야 합니다.' 
      });
    }
    
    // 박수 계산
    const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
    
    console.log('📊 가격 계산 요청:', { hotel_id, room_type_id, check_in, check_out, nights, promo_id });
    
    let totalRoomRate = 0;
    const dailyRates = [];
    
    // 프로모션 사용 여부
    if (promo_id) {
      // 프로모션 요금 조회
      const promoQuery = `
        SELECT 
          pdr.stay_date,
          pdr.rate_per_night,
          pdr.currency,
          p.promo_code,
          p.promo_name
        FROM promotion_daily_rates pdr
        JOIN promotions p ON pdr.promotion_id = p.id
        WHERE pdr.promotion_id = $1
          AND pdr.room_type_id = $2
          AND pdr.stay_date >= $3
          AND pdr.stay_date < $4
          AND p.is_active = true
        ORDER BY pdr.stay_date
      `;
      
      const promoResult = await pool.query(promoQuery, [promo_id, room_type_id, check_in, check_out]);
      
      if (promoResult.rows.length === 0) {
        return res.status(404).json({ 
          error: '선택한 프로모션의 요금 정보를 찾을 수 없습니다.' 
        });
      }
      
      // 모든 날짜에 대한 요금이 있는지 확인
      if (promoResult.rows.length < nights) {
        return res.status(400).json({ 
          error: `선택한 기간의 일부 날짜에 프로모션 요금이 설정되지 않았습니다. (${promoResult.rows.length}/${nights}일)` 
        });
      }
      
      // 총 요금 계산
      promoResult.rows.forEach(row => {
        totalRoomRate += parseFloat(row.rate_per_night);
        dailyRates.push({
          date: row.stay_date,
          rate: parseFloat(row.rate_per_night),
          currency: row.currency
        });
      });
      
      console.log('✅ 프로모션 요금 계산 완료:', { 
        promo_code: promoResult.rows[0].promo_code,
        total: totalRoomRate 
      });
      
    } else {
      // 일반 요금 조회 (시즌/기본 요금)
      const ratesQuery = `
        SELECT 
          sr.stay_date,
          sr.rate_per_night,
          sr.currency,
          s.season_name
        FROM season_rates sr
        LEFT JOIN seasons s ON sr.season_id = s.id
        WHERE sr.room_type_id = $1
          AND sr.stay_date >= $2
          AND sr.stay_date < $3
        ORDER BY sr.stay_date
      `;
      
      const ratesResult = await pool.query(ratesQuery, [room_type_id, check_in, check_out]);
      
      if (ratesResult.rows.length === 0) {
        // 기본 요금 조회
        const defaultRateQuery = `
          SELECT base_rate, currency
          FROM room_types
          WHERE id = $1
        `;
        
        const defaultResult = await pool.query(defaultRateQuery, [room_type_id]);
        
        if (defaultResult.rows.length === 0) {
          return res.status(404).json({ 
            error: '객실 타입을 찾을 수 없습니다.' 
          });
        }
        
        const baseRate = parseFloat(defaultResult.rows[0].base_rate) || 0;
        totalRoomRate = baseRate * nights;
        
        // 날짜별 요금 생성
        for (let i = 0; i < nights; i++) {
          const date = new Date(checkInDate);
          date.setDate(date.getDate() + i);
          dailyRates.push({
            date: date.toISOString().split('T')[0],
            rate: baseRate,
            currency: defaultResult.rows[0].currency || 'USD'
          });
        }
        
        console.log('✅ 기본 요금 사용:', { base_rate: baseRate, total: totalRoomRate });
        
      } else {
        // 시즌 요금 사용
        if (ratesResult.rows.length < nights) {
          // 일부 날짜만 시즌 요금이 있는 경우, 기본 요금으로 채우기
          const defaultRateQuery = `
            SELECT base_rate, currency
            FROM room_types
            WHERE id = $1
          `;
          
          const defaultResult = await pool.query(defaultRateQuery, [room_type_id]);
          const baseRate = parseFloat(defaultResult.rows[0].base_rate) || 0;
          
          // 날짜별 맵 생성
          const rateMap = {};
          ratesResult.rows.forEach(row => {
            rateMap[row.stay_date.toISOString().split('T')[0]] = parseFloat(row.rate_per_night);
          });
          
          // 모든 날짜에 대해 요금 계산
          for (let i = 0; i < nights; i++) {
            const date = new Date(checkInDate);
            date.setDate(date.getDate() + i);
            const dateStr = date.toISOString().split('T')[0];
            const rate = rateMap[dateStr] || baseRate;
            
            totalRoomRate += rate;
            dailyRates.push({
              date: dateStr,
              rate: rate,
              currency: 'USD'
            });
          }
        } else {
          // 모든 날짜에 시즌 요금이 있는 경우
          ratesResult.rows.forEach(row => {
            totalRoomRate += parseFloat(row.rate_per_night);
            dailyRates.push({
              date: row.stay_date,
              rate: parseFloat(row.rate_per_night),
              currency: row.currency
            });
          });
        }
        
        console.log('✅ 시즌 요금 계산 완료:', { total: totalRoomRate });
      }
    }
    
    // 응답
    res.json({
      hotel_id: parseInt(hotel_id),
      room_type_id: parseInt(room_type_id),
      check_in,
      check_out,
      nights,
      promo_id: promo_id ? parseInt(promo_id) : null,
      total_room_rate: totalRoomRate,
      daily_rates: dailyRates,
      currency: dailyRates[0]?.currency || 'USD'
    });
    
  } catch (error) {
    console.error('❌ 가격 계산 오류:', error);
    res.status(500).json({ 
      error: '가격 계산 중 오류가 발생했습니다.',
      details: error.message 
    });
  }
});

module.exports = router;
