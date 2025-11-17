const express = require('express');
const router = express.Router();

/**
 * 프로모션 코드 체크 및 요금 조회 API
 * POST /api/hotel-promotions/check-and-get-rates
 */
router.post('/check-and-get-rates', async (req, res) => {
    const { promo_code, hotel_id, room_type_id, check_in_date, check_out_date, booking_date } = req.body;
    
    try {
        const pool = req.app.get('pool');
        
        console.log('🔍 프로모션 체크 요청:', { promo_code, hotel_id, room_type_id, check_in_date, check_out_date, booking_date });
        
        // 1-1. 먼저 프로모션 존재 여부 확인 (디버깅용)
        const debugPromo = await pool.query(`
            SELECT promo_code, promo_name, is_active, 
                   booking_start_date, booking_end_date,
                   stay_start_date, stay_end_date
            FROM promotions
            WHERE promo_code = $1 AND hotel_id = $2
        `, [promo_code, hotel_id]);
        
        if (debugPromo.rows.length > 0) {
            const p = debugPromo.rows[0];
            console.log('📋 프로모션 정보:', {
                code: p.promo_code,
                name: p.promo_name,
                is_active: p.is_active,
                booking_period: `${p.booking_start_date} ~ ${p.booking_end_date}`,
                stay_period: `${p.stay_start_date} ~ ${p.stay_end_date}`
            });
        } else {
            console.log('❌ 프로모션 없음:', promo_code);
        }
        
        // 1. 프로모션 코드 유효성 확인
        const promoResult = await pool.query(`
            SELECT * FROM promotions
            WHERE promo_code = $1
              AND hotel_id = $2
              AND is_active = true
              AND $3::date BETWEEN booking_start_date AND booking_end_date
              AND $4::date BETWEEN stay_start_date AND stay_end_date
              AND $5::date BETWEEN stay_start_date AND stay_end_date
        `, [promo_code, hotel_id, booking_date || new Date(), check_in_date, check_out_date]);
        
        if (promoResult.rows.length === 0) {
            console.log('❌ 프로모션 유효성 검증 실패:', {
                promo_code,
                booking_date: booking_date || new Date().toISOString().split('T')[0],
                check_in_date,
                check_out_date
            });
            return res.json({
                valid: false,
                message: '유효하지 않은 프로모션 코드이거나 적용 기간이 아닙니다.'
            });
        }
        
        console.log('✅ 프로모션 유효성 검증 통과:', promo_code);
        
        const promotion = promoResult.rows[0];
        
        // 2. 총 박수 계산
        const checkInDate = new Date(check_in_date);
        const checkOutDate = new Date(check_out_date);
        const totalNights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
        
        console.log(`💰 총 박수: ${totalNights}박, 체크인: ${check_in_date}, 체크아웃: ${check_out_date}`);
        
        // 3. 날짜별 요금 조회 (연박 조건에 맞는 최저가만 선택)
        const ratesResult = await pool.query(`
            WITH RankedRates AS (
                SELECT 
                    stay_date,
                    min_nights,
                    rate_per_night,
                    ROW_NUMBER() OVER (
                        PARTITION BY stay_date 
                        ORDER BY 
                            CASE WHEN min_nights <= $5 THEN min_nights ELSE 0 END DESC,
                            rate_per_night ASC
                    ) as rn
                FROM promotion_daily_rates
                WHERE promotion_id = $1
                  AND room_type_id = $2
                  AND stay_date >= $3::date
                  AND stay_date < $4::date
                  AND min_nights <= $5
            )
            SELECT 
                stay_date,
                min_nights,
                rate_per_night
            FROM RankedRates
            WHERE rn = 1
            ORDER BY stay_date ASC
        `, [promotion.id, room_type_id, check_in_date, check_out_date, totalNights]);
        
        console.log(`📊 조회된 날짜별 요금: ${ratesResult.rows.length}일분`);
        if (ratesResult.rows.length === 0) {
            console.log('❌ 날짜별 요금 없음 - promotion_daily_rates 테이블 확인 필요');
        }
        
        // 4. 총 요금 계산 (날짜별 요금 합산)
        let total_room_rate = 0;
        const daily_rates = [];
        
        for (const rate of ratesResult.rows) {
            total_room_rate += parseFloat(rate.rate_per_night);
            daily_rates.push({
                stay_date: rate.stay_date,
                min_nights: rate.min_nights,
                rate_per_night: parseFloat(rate.rate_per_night)
            });
        }
        
        console.log(`💵 총 객실요금: $${total_room_rate} (${daily_rates.length}일간)`);
        
        // 4. 베네핏 조회
        const benefitsResult = await pool.query(`
            SELECT 
                benefit_type,
                benefit_name,
                benefit_value,
                quantity,
                description
            FROM promotion_benefits
            WHERE promotion_id = $1
        `, [promotion.id]);
        
        // 5. 응답 반환
        res.json({
            valid: true,
            promotion: {
                id: promotion.id,
                promo_code: promotion.promo_code,
                promo_name: promotion.promo_name,
                booking_start_date: promotion.booking_start_date,
                booking_end_date: promotion.booking_end_date,
                stay_start_date: promotion.stay_start_date,
                stay_end_date: promotion.stay_end_date
            },
            daily_rates: daily_rates,
            total_room_rate: total_room_rate,
            benefits: benefitsResult.rows.map(b => ({
                benefit_type: b.benefit_type,
                benefit_name: b.benefit_name,
                benefit_value: b.benefit_value,
                quantity: b.quantity,
                description: b.description
            }))
        });
        
    } catch (error) {
        console.error('프로모션 체크 오류:', error);
        res.status(500).json({
            valid: false,
            message: '프로모션 확인 중 오류가 발생했습니다.'
        });
    }
});

/**
 * 일반 요금 조회 API (프로모션 미적용)
 * POST /api/hotel-promotions/get-regular-rates
 */
router.post('/get-regular-rates', async (req, res) => {
    const { hotel_id, room_type_id, check_in_date, check_out_date } = req.body;
    
    try {
        const pool = req.app.get('pool');
        
        // room_rates 테이블에서 날짜별 요금 조회
        const ratesResult = await pool.query(`
            SELECT 
                apply_date as stay_date,
                rate_amount as rate_per_night,
                breakfast_rate,
                breakfast_included
            FROM room_rates
            WHERE room_type_id = $1
              AND apply_date >= $2::date
              AND apply_date < $3::date
              AND is_available = true
            ORDER BY apply_date ASC
        `, [room_type_id, check_in_date, check_out_date]);
        
        if (ratesResult.rows.length === 0) {
            // room_rates에 없으면 room_types의 기본 요금 사용
            const roomTypeResult = await pool.query(`
                SELECT base_room_rate, breakfast_rate_per_person, breakfast_included
                FROM room_types
                WHERE id = $1 AND is_active = true
            `, [room_type_id]);
            
            if (roomTypeResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '해당 객실 타입의 요금 정보를 찾을 수 없습니다.'
                });
            }
            
            const roomType = roomTypeResult.rows[0];
            const nights = Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / (1000 * 60 * 60 * 24));
            
            return res.json({
                success: true,
                daily_rates: [],
                base_rate: parseFloat(roomType.base_room_rate || 0),
                total_room_rate: parseFloat(roomType.base_room_rate || 0) * nights,
                breakfast_rate: parseFloat(roomType.breakfast_rate_per_person || 0),
                breakfast_included: roomType.breakfast_included
            });
        }
        
        // 총 요금 계산
        let total_room_rate = 0;
        const daily_rates = [];
        
        for (const rate of ratesResult.rows) {
            total_room_rate += parseFloat(rate.rate_per_night);
            daily_rates.push({
                stay_date: rate.stay_date,
                rate_per_night: parseFloat(rate.rate_per_night),
                breakfast_rate: parseFloat(rate.breakfast_rate || 0),
                breakfast_included: rate.breakfast_included
            });
        }
        
        res.json({
            success: true,
            daily_rates: daily_rates,
            total_room_rate: total_room_rate
        });
        
    } catch (error) {
        console.error('일반 요금 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '요금 조회 중 오류가 발생했습니다.'
        });
    }
});

/**
 * 프로모션 목록 조회 API
 * GET /api/hotel-promotions/list?hotel_id=1&is_active=true
 */
router.get('/list', async (req, res) => {
    const { hotel_id, is_active } = req.query;
    
    try {
        const pool = req.app.get('pool');
        
        let query = `
            SELECT 
                id,
                hotel_id,
                promo_code,
                promo_name,
                booking_start_date,
                booking_end_date,
                stay_start_date,
                stay_end_date,
                is_active
            FROM promotions
            WHERE 1=1
        `;
        
        const params = [];
        
        if (hotel_id) {
            params.push(hotel_id);
            query += ` AND hotel_id = $${params.length}`;
        }
        
        if (is_active === 'true') {
            query += ` AND is_active = true`;
            // 현재 날짜가 예약 가능 기간 내인지 확인
            query += ` AND CURRENT_DATE BETWEEN booking_start_date AND booking_end_date`;
        }
        
        query += ` ORDER BY promo_code`;
        
        const result = await pool.query(query, params);
        
        res.json(result.rows);
        
    } catch (error) {
        console.error('프로모션 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '프로모션 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
