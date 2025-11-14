const express = require('express');
const router = express.Router();

/**
 * 호텔 예약 저장 API
 * POST /api/hotel-reservations
 */
router.post('/', async (req, res) => {
    const {
        reservation_number,
        booking_agency_id,
        hotel_id,
        check_in_date,
        check_out_date,
        nights,
        status,
        promotion_id,
        promo_code,
        special_requests,
        internal_memo,
        rooms,
        extras
    } = req.body;
    
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 호텔 예약 메인 레코드 저장
        const reservationResult = await client.query(`
            INSERT INTO hotel_reservations (
                reservation_number,
                booking_agency_id,
                hotel_id,
                check_in_date,
                check_out_date,
                nights,
                status,
                special_requests,
                internal_memo,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id
        `, [
            reservation_number,
            booking_agency_id || null,
            hotel_id,
            check_in_date,
            check_out_date,
            nights,
            status || 'pending',
            special_requests || null,
            internal_memo || null
        ]);
        
        const reservationId = reservationResult.rows[0].id;
        
        // 2. 각 객실별 정보 저장
        let totalRooms = 0;
        let totalAdults = 0;
        let totalChildren = 0;
        let totalInfants = 0;
        let totalGuests = 0;
        let totalSellingPrice = 0;
        let totalCostPrice = 0;
        
        for (const room of rooms) {
            totalRooms++;
            
            // 2-1. 객실 레코드 저장
            const roomResult = await client.query(`
                INSERT INTO hotel_reservation_rooms (
                    reservation_id,
                    room_number,
                    room_type_id,
                    adults_count,
                    children_count,
                    infants_count,
                    total_guests,
                    created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                RETURNING id
            `, [
                reservationId,
                totalRooms,
                room.room_type_id,
                0, // 투숙객 정보에서 계산
                0,
                0,
                0
            ]);
            
            const roomId = roomResult.rows[0].id;
            
            // 2-2. 투숙객 정보 저장
            let roomAdults = 0;
            let roomChildren = 0;
            let roomInfants = 0;
            
            for (let i = 0; i < room.guests.length; i++) {
                const guest = room.guests[i];
                const isPrimary = i === 0;
                
                // 연령대 카운트
                if (guest.age_category === 'adult') roomAdults++;
                else if (guest.age_category === 'child') roomChildren++;
                else if (guest.age_category === 'infant') roomInfants++;
                
                await client.query(`
                    INSERT INTO hotel_reservation_guests (
                        reservation_room_id,
                        guest_type,
                        guest_name_ko,
                        guest_name_en,
                        date_of_birth,
                        age_category,
                        phone,
                        email,
                        created_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                `, [
                    roomId,
                    isPrimary ? 'primary' : 'companion',
                    guest.guest_name_ko || null,
                    guest.guest_name_en || null,
                    guest.date_of_birth || null,
                    guest.age_category || 'adult',
                    isPrimary ? (guest.phone || null) : null,
                    isPrimary ? (guest.email || null) : null
                ]);
            }
            
            // 객실별 인원 수 업데이트
            await client.query(`
                UPDATE hotel_reservation_rooms
                SET adults_count = $1,
                    children_count = $2,
                    infants_count = $3,
                    total_guests = $4
                WHERE id = $5
            `, [roomAdults, roomChildren, roomInfants, roomAdults + roomChildren + roomInfants, roomId]);
            
            totalAdults += roomAdults;
            totalChildren += roomChildren;
            totalInfants += roomInfants;
            totalGuests += (roomAdults + roomChildren + roomInfants);
        }
        
        // 3. 추가 항목 저장
        let totalExtrasPrice = 0;
        
        if (extras && extras.length > 0) {
            for (const extra of extras) {
                const pricingType = extra.pricing_type || 'flat';
                let totalPrice = 0;
                
                if (pricingType === 'per_person') {
                    const adultTotal = (parseInt(extra.adult_count) || 0) * (parseFloat(extra.adult_price) || 0);
                    const childTotal = (parseInt(extra.child_count) || 0) * (parseFloat(extra.child_price) || 0);
                    const infantTotal = (parseInt(extra.infant_count) || 0) * (parseFloat(extra.infant_price) || 0);
                    totalPrice = (adultTotal + childTotal + infantTotal) * (parseInt(extra.quantity) || 1);
                    
                    await client.query(`
                        INSERT INTO hotel_reservation_extras (
                            reservation_id,
                            item_name,
                            item_type,
                            quantity,
                            adult_count,
                            adult_price,
                            child_count,
                            child_price,
                            infant_count,
                            infant_price,
                            total_selling_price,
                            currency,
                            created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
                    `, [
                        reservationId,
                        extra.item_name,
                        'per_person',
                        parseInt(extra.quantity) || 1,
                        parseInt(extra.adult_count) || 0,
                        parseFloat(extra.adult_price) || 0,
                        parseInt(extra.child_count) || 0,
                        parseFloat(extra.child_price) || 0,
                        parseInt(extra.infant_count) || 0,
                        parseFloat(extra.infant_price) || 0,
                        totalPrice,
                        'USD'
                    ]);
                } else {
                    totalPrice = (parseFloat(extra.unit_price) || 0) * (parseInt(extra.quantity) || 1);
                    
                    await client.query(`
                        INSERT INTO hotel_reservation_extras (
                            reservation_id,
                            item_name,
                            item_type,
                            quantity,
                            unit_price,
                            total_selling_price,
                            currency,
                            created_at
                        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    `, [
                        reservationId,
                        extra.item_name,
                        'flat',
                        parseInt(extra.quantity) || 1,
                        parseFloat(extra.unit_price) || 0,
                        totalPrice,
                        'USD'
                    ]);
                }
                
                totalExtrasPrice += totalPrice;
            }
        }
        
        // 4. 프로모션 정보가 있으면 요금 계산 (간단 버전)
        // 실제로는 promotion_daily_rates에서 날짜별 요금을 합산해야 함
        // 여기서는 임시로 기본 요금 사용
        const roomTypeResult = await client.query(`
            SELECT base_room_rate FROM room_types WHERE id = $1
        `, [rooms[0].room_type_id]);
        
        const baseRate = parseFloat(roomTypeResult.rows[0]?.base_room_rate || 0);
        const roomCharge = baseRate * nights * totalRooms;
        totalSellingPrice = roomCharge + totalExtrasPrice;
        
        // 5. 예약 요약 정보 업데이트
        await client.query(`
            UPDATE hotel_reservations
            SET total_rooms = $1,
                total_guests = $2,
                total_adults = $3,
                total_children = $4,
                total_infants = $5,
                total_selling_price = $6,
                total_cost_price = $7,
                total_margin = $8,
                currency = $9
            WHERE id = $10
        `, [
            totalRooms,
            totalGuests,
            totalAdults,
            totalChildren,
            totalInfants,
            totalSellingPrice,
            totalCostPrice,
            totalSellingPrice - totalCostPrice,
            'USD',
            reservationId
        ]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '호텔 예약이 성공적으로 저장되었습니다.',
            reservation_id: reservationId
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('호텔 예약 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 저장 중 오류가 발생했습니다: ' + error.message
        });
    } finally {
        client.release();
    }
});

/**
 * 호텔 예약 목록 조회
 * GET /api/hotel-reservations
 */
router.get('/', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        
        const result = await client.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                ba.agency_name
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            ORDER BY hr.created_at DESC
        `);
        
        res.json(result.rows);
    } catch (error) {
        console.error('호텔 예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

module.exports = router;
