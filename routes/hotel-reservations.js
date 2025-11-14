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
        reservation_date,  // ⭐ 인박스 입력일 (중요!)
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
                reservation_date,
                check_in_date,
                check_out_date,
                nights,
                status,
                special_requests,
                internal_memo,
                created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
            RETURNING id
        `, [
            reservation_number,
            booking_agency_id || null,
            hotel_id,
            reservation_date || new Date().toISOString().split('T')[0],  // 없으면 오늘 날짜
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
                // item_name이 없으면 스킵
                if (!extra.item_name || extra.item_name.trim() === '') {
                    continue;
                }
                
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
        
        const result = await pool.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                ba.agency_name
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            ORDER BY hr.reservation_date DESC, hr.created_at DESC
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

/**
 * 호텔 예약 상세 조회 (수정용)
 * GET /api/hotel-reservations/:id
 */
router.get('/:id', async (req, res) => {
    try {
        const pool = req.app.get('pool');
        const { id } = req.params;
        
        // 1. 예약 기본 정보
        const reservation = await pool.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                ba.agency_name
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            WHERE hr.id = $1
        `, [id]);
        
        if (reservation.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 2. 객실 정보
        const rooms = await pool.query(`
            SELECT 
                hrr.*,
                rt.room_type_code,
                rt.room_type_name
            FROM hotel_reservation_rooms hrr
            LEFT JOIN room_types rt ON hrr.room_type_id = rt.id
            WHERE hrr.reservation_id = $1
            ORDER BY hrr.room_number
        `, [id]);
        
        // 3. 투숙객 정보
        const guests = await pool.query(`
            SELECT *
            FROM hotel_reservation_guests
            WHERE reservation_room_id = ANY($1)
            ORDER BY reservation_room_id, id
        `, [rooms.rows.map(r => r.id)]);
        
        // 4. 추가 항목
        const extras = await pool.query(`
            SELECT *
            FROM hotel_reservation_extras
            WHERE reservation_id = $1
            ORDER BY id
        `, [id]);
        
        // 데이터 조합
        const data = {
            ...reservation.rows[0],
            rooms: rooms.rows.map(room => ({
                ...room,
                guests: guests.rows.filter(g => g.reservation_room_id === room.id)
            })),
            extras: extras.rows
        };
        
        res.json(data);
        
    } catch (error) {
        console.error('호텔 예약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 상세 조회 중 오류가 발생했습니다.'
        });
    }
});

/**
 * 호텔 예약 수정 (완전한 업데이트)
 * PUT /api/hotel-reservations/:id
 */
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const {
        hotel_id,
        booking_agency_id,
        reservation_date,
        status,
        check_in_date,
        check_out_date,
        arrival_flight,
        departure_flight,
        special_requests,
        internal_memo,
        total_selling_price,
        rooms,
        extras
    } = req.body;
    
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 예약 존재 확인
        const checkResult = await client.query('SELECT id FROM hotel_reservations WHERE id = $1', [id]);
        if (checkResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 2. 기존 데이터 삭제 (CASCADE로 자동 삭제되지만 명시적으로)
        await client.query('DELETE FROM hotel_reservation_guests WHERE reservation_room_id IN (SELECT id FROM hotel_reservation_rooms WHERE reservation_id = $1)', [id]);
        await client.query('DELETE FROM hotel_reservation_rooms WHERE reservation_id = $1', [id]);
        await client.query('DELETE FROM hotel_reservation_extras WHERE reservation_id = $1', [id]);
        
        // 3. 박수 계산
        let nights = 0;
        if (check_in_date && check_out_date) {
            const checkIn = new Date(check_in_date);
            const checkOut = new Date(check_out_date);
            nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        }
        
        // 4. 객실 및 투숙객 정보 저장
        let totalRooms = 0;
        let totalAdults = 0;
        let totalChildren = 0;
        let totalInfants = 0;
        let totalGuests = 0;
        
        if (rooms && rooms.length > 0) {
            for (const room of rooms) {
                totalRooms++;
                
                // 4-1. 객실 레코드 저장
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
                    id,
                    totalRooms,
                    room.room_type_id,
                    0,
                    0,
                    0,
                    0
                ]);
                
                const roomId = roomResult.rows[0].id;
                
                // 4-2. 투숙객 정보 저장
                let roomAdults = 0;
                let roomChildren = 0;
                let roomInfants = 0;
                
                if (room.guests && room.guests.length > 0) {
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
        }
        
        // 5. 추가 항목 저장
        let totalExtrasPrice = 0;
        
        if (extras && extras.length > 0) {
            for (const extra of extras) {
                if (!extra.item_name || extra.item_name.trim() === '') {
                    continue;
                }
                
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
                        id,
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
                        id,
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
        
        // 6. 예약 메인 정보 업데이트
        await client.query(`
            UPDATE hotel_reservations
            SET 
                hotel_id = $1,
                booking_agency_id = $2,
                reservation_date = $3,
                status = $4,
                check_in_date = $5,
                check_out_date = $6,
                nights = $7,
                arrival_flight = $8,
                departure_flight = $9,
                special_requests = $10,
                internal_memo = $11,
                total_rooms = $12,
                total_guests = $13,
                total_adults = $14,
                total_children = $15,
                total_infants = $16,
                total_selling_price = $17,
                updated_at = NOW()
            WHERE id = $18
        `, [
            hotel_id,
            booking_agency_id || null,
            reservation_date,
            status || 'pending',
            check_in_date,
            check_out_date,
            nights,
            arrival_flight || null,
            departure_flight || null,
            special_requests || null,
            internal_memo || null,
            totalRooms,
            totalGuests,
            totalAdults,
            totalChildren,
            totalInfants,
            total_selling_price || 0,
            id
        ]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '예약이 수정되었습니다.'
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 호텔 예약 수정 오류:', error);
        res.status(500).json({
            success: false,
            error: '예약 수정 중 오류가 발생했습니다: ' + error.message
        });
    } finally {
        client.release();
    }
});

/**
 * 호텔 예약 데이터 AI 파싱
 * POST /admin/hotel-reservations/parse
 */
router.post('/parse', async (req, res) => {
    const { reservationText, customPrompt } = req.body;
    
    if (!reservationText) {
        return res.json({
            success: false,
            message: '파싱할 예약 데이터가 없습니다.'
        });
    }
    
    try {
        const { OpenAI } = require('openai');
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // 호텔 예약 파싱 프롬프트
        let prompt = `다음은 호텔 예약 정보입니다. 이를 JSON 형식으로 파싱해주세요.

예약 정보:
"""
${reservationText}
"""

다음 필드를 추출해주세요:
- reservation_number: 예약번호
- booking_agency: 거래처명/예약처/여행사명 (예: 투어비스, 하나투어, 모두투어 등)
- hotel_name: 호텔명 (정확한 이름)
- check_in_date: 체크인 날짜 (YYYY-MM-DD 형식)
- check_out_date: 체크아웃 날짜 (YYYY-MM-DD 형식)
- special_requests: 특별 요청사항
- rooms: 객실 배열 (예약된 객실 수만큼 생성)
  [
    {
      room_type: "객실 타입",
      guests: [
        {
          name_ko: "한글이름",
          name_en: "ENGLISH NAME",
          age_category: "adult" | "child" | "infant",
          phone: "전화번호 (첫 번째 대표 투숙객만)",
          email: "이메일 (첫 번째 대표 투숙객만)"
        }
      ]
    }
  ]

중요: 
1. rooms 배열은 예약된 객실 수만큼 생성하세요 (1개, 2개, 3개 등)
2. 각 객실마다 guests 배열을 포함하세요
3. 각 객실의 guests 배열은 해당 객실의 투숙객만 포함
4. 첫 번째 객실의 첫 번째 투숙객이 대표 투숙객 (phone, email 포함)
5. age_category는 반드시 "adult", "child", "infant" 중 하나`;

        if (customPrompt) {
            prompt += `\n\n추가 지침:\n${customPrompt}`;
        }

        prompt += `\n\nJSON 형식으로만 응답해주세요. 다른 설명은 포함하지 마세요.`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: '당신은 호텔 예약 정보를 정확하게 파싱하는 전문가입니다.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            temperature: 0.1,
            response_format: { type: 'json_object' }
        });

        const parsedData = JSON.parse(completion.choices[0].message.content);
        
        console.log('🤖 AI 파싱 완료 (호텔):', parsedData);
        
        res.json({
            success: true,
            parsed_data: parsedData,
            parsing_method: 'OpenAI GPT-4o-mini'
        });
    } catch (error) {
        console.error('❌ AI 파싱 오류:', error);
        res.json({
            success: false,
            message: 'AI 파싱 중 오류가 발생했습니다: ' + error.message
        });
    }
});

module.exports = router;
