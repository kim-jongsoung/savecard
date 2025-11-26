const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { sendHotelAssignment, generateAssignmentHTML, generateVoucherInvoiceHTML } = require('../utils/hotelAssignmentMailer');

// 임시 디버그 엔드포인트 - 수배서 이력 확인
router.get('/debug/history', async (req, res) => {
    const pool = req.app.get('pool');
    try {
        const result = await pool.query(`
            SELECT * FROM hotel_assignment_history 
            ORDER BY sent_at DESC 
            LIMIT 20
        `);
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

// 임시 디버그 엔드포인트 - 예약 상태 확인
router.get('/debug/reservations', async (req, res) => {
    const pool = req.app.get('pool');
    try {
        const result = await pool.query(`
            SELECT id, status, assignment_token, created_at 
            FROM hotel_reservations 
            ORDER BY id DESC 
            LIMIT 20
        `);
        res.json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });
    } catch (error) {
        res.json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 호텔 수배서 생성 및 전송 API
 * POST /api/hotel-assignments
 */
router.post('/', async (req, res) => {
    console.log('🔵 POST /api/hotel-assignments 호출됨');
    console.log('📦 요청 body:', req.body);
    
    const {
        reservation_id,
        hotel_email,
        assignment_type = 'NEW', // NEW, REVISE, CANCEL
        changes_description = '',
        sent_by = 'Admin'
    } = req.body;
    
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 예약 정보 조회 (rooms, guests, extras 포함)
        const reservationQuery = await client.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                COALESCE(h.reservation_email, h.contact_email) as hotel_email_default,
                ba.agency_name as booking_agency_name,
                ba.contact_person as agency_contact_person,
                ba.contact_email as agency_email
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            WHERE hr.id = $1
        `, [reservation_id]);
        
        if (reservationQuery.rows.length === 0) {
            throw new Error('예약을 찾을 수 없습니다.');
        }
        
        const reservation = reservationQuery.rows[0];
        
        // 2. 객실 정보 조회
        const roomsQuery = await client.query(`
            SELECT 
                hrr.*,
                rt.room_type_name
            FROM hotel_reservation_rooms hrr
            LEFT JOIN room_types rt ON hrr.room_type_id = rt.id
            WHERE hrr.reservation_id = $1
            ORDER BY hrr.id
        `, [reservation_id]);
        
        reservation.rooms = roomsQuery.rows;
        
        // 4. 추가 서비스 조회
        const extrasQuery = await client.query(`
            SELECT *
            FROM hotel_reservation_extras
            WHERE reservation_id = $1
            ORDER BY id
        `, [reservation_id]);
        
        reservation.extras = extrasQuery.rows;
        
        // 5. assignment_token 생성 또는 가져오기
        if (!reservation.assignment_token) {
            reservation.assignment_token = crypto.randomBytes(32).toString('hex');
            await client.query(`
                UPDATE hotel_reservations
                SET assignment_token = $1
                WHERE id = $2
            `, [reservation.assignment_token, reservation_id]);
        }
        
        // 6. 리바이스 번호 계산
        let revisionNumber = 0;
        if (assignment_type === 'REVISE') {
            const historyCount = await client.query(`
                SELECT COUNT(*) as count
                FROM hotel_assignment_history
                WHERE reservation_id = $1 AND assignment_type = 'REVISE'
            `, [reservation_id]);
            revisionNumber = parseInt(historyCount.rows[0].count) + 1;
        }
        
        // 7. 이전 이력 조회
        const historyQuery = await client.query(`
            SELECT *
            FROM hotel_assignment_history
            WHERE reservation_id = $1
            ORDER BY sent_at ASC
        `, [reservation_id]);
        
        reservation.assignment_history = historyQuery.rows;
        
        // 8. 이메일 발송
        const emailResult = await sendHotelAssignment(
            reservation,
            hotel_email || reservation.hotel_email_default,
            assignment_type,
            revisionNumber,
            sent_by
        );
        
        if (!emailResult.success) {
            throw new Error(`이메일 발송 실패: ${emailResult.error}`);
        }
        
        // 9. 전송 이력 저장
        await client.query(`
            INSERT INTO hotel_assignment_history (
                reservation_id,
                assignment_type,
                revision_number,
                sent_to_email,
                sent_by,
                sent_at,
                email_message_id,
                assignment_link,
                changes_description
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            reservation_id,
            assignment_type,
            revisionNumber,
            hotel_email || reservation.hotel_email_default,
            sent_by,
            emailResult.sentAt,
            emailResult.messageId,
            emailResult.assignmentLink,
            changes_description
        ]);
        
        // 10. 상태 자동 변경
        if (assignment_type === 'CANCEL') {
            // CANCEL 전송 시 예약 상태를 'cancelled'로 변경
            await client.query(`
                UPDATE hotel_reservations
                SET status = 'cancelled', updated_at = NOW()
                WHERE id = $1
            `, [reservation_id]);
            console.log(`✅ 예약 ID ${reservation_id} 상태가 'cancelled'로 변경되었습니다.`);
        } else if (assignment_type === 'NEW' || assignment_type === 'REVISE') {
            // 수배서 전송 시 pending/modifying → processing으로 변경
            await client.query(`
                UPDATE hotel_reservations
                SET status = 'processing', updated_at = NOW()
                WHERE id = $1 AND status IN ('pending', 'modifying')
            `, [reservation_id]);
            console.log(`✅ 예약 ID ${reservation_id} 상태가 'processing'으로 변경되었습니다.`);
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '수배서가 성공적으로 전송되었습니다.',
            assignment_link: emailResult.assignmentLink,
            assignment_type,
            revision_number: revisionNumber,
            sent_at: emailResult.sentAt
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 수배서 전송 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

// 호텔 바우처인보이스 조회 API (예약별 최신 1건)
// GET /api/hotel-assignments/:reservationId/invoice
router.get('/:reservationId/invoice', async (req, res) => {
    const { reservationId } = req.params;
    const pool = req.app.get('pool');

    try {
        const result = await pool.query(`
            SELECT *
            FROM hotel_invoices
            WHERE hotel_reservation_id = $1
            ORDER BY id DESC
            LIMIT 1
        `, [reservationId]);

        if (result.rows.length === 0) {
            return res.json({ success: false, message: '바우처인보이스가 없습니다.' });
        }

        return res.json({ success: true, invoice: result.rows[0] });
    } catch (error) {
        console.error('❌ 바우처인보이스 조회 오류:', error);
        return res.status(500).json({ success: false, message: '바우처인보이스 조회 중 오류가 발생했습니다.' });
    }
});

/**
 * 수배서 전송 이력 조회 API
 * GET /api/hotel-assignments/:reservationId/history
 */
router.get('/:reservationId/history', async (req, res) => {
    const { reservationId } = req.params;
    const pool = req.app.get('pool');
    
    try {
        const result = await pool.query(`
            SELECT *
            FROM hotel_assignment_history
            WHERE reservation_id = $1
            ORDER BY sent_at DESC
        `, [reservationId]);
        
        res.json({
            success: true,
            history: result.rows
        });
    } catch (error) {
        console.error('❌ 이력 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 수배서 공개 링크 (호텔용 출력 페이지)
 * GET /hotel-assignment/:token
 */
router.get('/:token', async (req, res) => {
    const { token } = req.params;
    const pool = req.app.get('pool');
    
    try {
        // 1. 예약 정보 조회
        const reservationQuery = await pool.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                ba.agency_name as booking_agency_name,
                ba.contact_person as agency_contact_person,
                ba.contact_email as agency_email
            FROM hotel_reservations hr
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            WHERE hr.assignment_token = $1
        `, [token]);
        
        if (reservationQuery.rows.length === 0) {
            return res.status(404).send('수배서를 찾을 수 없습니다.');
        }
        
        const reservation = reservationQuery.rows[0];
        
        // 2. 객실 정보 조회
        const roomsQuery = await pool.query(`
            SELECT 
                hrr.*,
                rt.room_type_name
            FROM hotel_reservation_rooms hrr
            LEFT JOIN room_types rt ON hrr.room_type_id = rt.id
            WHERE hrr.reservation_id = $1
            ORDER BY hrr.id
        `, [reservation.id]);
        
        reservation.rooms = roomsQuery.rows;
        
        // 4. 추가 서비스 조회
        const extrasQuery = await pool.query(`
            SELECT *
            FROM hotel_reservation_extras
            WHERE reservation_id = $1
            ORDER BY id
        `, [reservation.id]);
        
        reservation.extras = extrasQuery.rows;
        
        // 5. 전송 이력 조회
        const historyQuery = await pool.query(`
            SELECT *
            FROM hotel_assignment_history
            WHERE reservation_id = $1
            ORDER BY sent_at ASC
        `, [reservation.id]);
        
        reservation.assignment_history = historyQuery.rows;
        
        // 6. 최신 이력에서 타입, 리비전 번호, 사유 가져오기
        const latestHistory = historyQuery.rows[historyQuery.rows.length - 1];
        const assignmentType = latestHistory ? latestHistory.assignment_type : 'NEW';
        const revisionNumber = latestHistory ? latestHistory.revision_number : 0;
        if (latestHistory && latestHistory.changes_description) {
            reservation.changes_description = latestHistory.changes_description;
        }
        
        // 7. 수배서 열람 시간 기록 (최신 이력에만)
        if (latestHistory && !latestHistory.viewed_at) {
            await pool.query(`
                UPDATE hotel_assignment_history
                SET viewed_at = NOW()
                WHERE id = $1
            `, [latestHistory.id]);
            console.log(`✅ 수배서 열람 기록: 예약 ID ${reservation.id}`);
        }
        
        // 8. HTML 생성
        const html = generateAssignmentHTML(reservation, assignmentType, revisionNumber);
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ 수배서 조회 오류:', error);
        res.status(500).send('수배서를 불러오는 중 오류가 발생했습니다.');
    }
});

// 예약의 모든 바우처 인보이스 목록 조회
// GET /api/hotel-assignments/:reservationId/invoices
router.get('/:reservationId/invoices', async (req, res) => {
    const { reservationId } = req.params;
    const pool = req.app.get('pool');
    
    try {
        const result = await pool.query(`
            SELECT * FROM hotel_invoices
            WHERE hotel_reservation_id = $1
            ORDER BY created_at DESC
        `, [reservationId]);
        
        res.json({
            success: true,
            invoices: result.rows
        });
    } catch (error) {
        console.error('❌ 인보이스 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: '인보이스 목록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 바우처 인보이스 삭제
// DELETE /api/hotel-assignments/invoice/:invoiceId
router.delete('/invoice/:invoiceId', async (req, res) => {
    const { invoiceId } = req.params;
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 인보이스 삭제 및 예약 ID 가져오기
        const result = await client.query(`
            DELETE FROM hotel_invoices
            WHERE id = $1
            RETURNING hotel_reservation_id
        `, [invoiceId]);
        
        if (result.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                error: '인보이스를 찾을 수 없습니다.'
            });
        }
        
        const reservationId = result.rows[0].hotel_reservation_id;
        
        // 해당 예약의 남은 인보이스 개수 확인
        const remainingInvoices = await client.query(`
            SELECT COUNT(*) as count
            FROM hotel_invoices
            WHERE hotel_reservation_id = $1
        `, [reservationId]);
        
        // 인보이스가 모두 삭제되었으면 예약 상태를 confirmed로 변경
        if (parseInt(remainingInvoices.rows[0].count) === 0) {
            await client.query(`
                UPDATE hotel_reservations
                SET status = 'confirmed'
                WHERE id = $1
            `, [reservationId]);
        }
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '인보이스가 삭제되었습니다.',
            reservationId: reservationId
        });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 인보이스 삭제 오류:', error);
        res.status(500).json({
            success: false,
            error: '인보이스 삭제 중 오류가 발생했습니다.'
        });
    } finally {
        client.release();
    }
});

// 호텔 바우처인보이스 생성 API (예약 1건 기준)
// POST /api/hotel-assignments/:reservationId/invoice
router.post('/:reservationId/invoice', async (req, res) => {
    const { reservationId } = req.params;
    const { currency = 'USD', discount_usd = 0, surcharge_usd = 0 } = req.body;

    const pool = req.app.get('pool');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1. 예약 기본 정보 및 거래처 조회
        const reservationQuery = await client.query(`
            SELECT hr.*, ba.id AS booking_agency_id
            FROM hotel_reservations hr
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            WHERE hr.id = $1
        `, [reservationId]);

        if (reservationQuery.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ success: false, message: '예약을 찾을 수 없습니다.' });
        }

        const reservation = reservationQuery.rows[0];

        // 2. 기본 금액 계산: 객실 + 조식 + 추가항목 + 수배피
        // 객실 정보 조회
        const roomsResult = await client.query(`
            SELECT * FROM hotel_reservation_rooms WHERE reservation_id = $1
        `, [reservationId]);
        
        // 추가 항목 조회
        const extrasResult = await client.query(`
            SELECT * FROM hotel_reservation_extras WHERE reservation_id = $1
        `, [reservationId]);
        
        const rooms = roomsResult.rows;
        const extras = extrasResult.rows;
        
        // 숙박 일수 계산
        const checkInDate = new Date(reservation.check_in_date);
        const checkOutDate = new Date(reservation.check_out_date);
        const nights = Math.round((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
        
        let totalAmount = 0;
        
        // 객실 요금
        rooms.forEach(room => {
            let roomRate = parseFloat(room.room_rate || 0);
            if (roomRate === 0 && room.total_selling_price && nights > 0) {
                roomRate = parseFloat(room.total_selling_price) / nights;
            }
            totalAmount += roomRate * nights;
            
            // 조식 요금
            const isBreakfastIncluded = room.breakfast_included === true || room.breakfast_included === 'true' || room.breakfast_included === 1;
            if (isBreakfastIncluded) {
                const adultCount = parseInt(room.breakfast_adult_count || 0);
                const childCount = parseInt(room.breakfast_child_count || 0);
                const adultPrice = parseFloat(room.breakfast_adult_price || 0);
                const childPrice = parseFloat(room.breakfast_child_price || 0);
                const breakfastDays = parseInt(room.breakfast_days || nights);
                
                totalAmount += (adultCount * breakfastDays * adultPrice) + (childCount * breakfastDays * childPrice);
            }
        });
        
        // 추가 서비스
        extras.forEach(extra => {
            const charge = parseFloat(extra.charge || extra.total_selling_price || 0);
            totalAmount += charge;
        });
        
        // ⭐ 수배피 추가 (중요!)
        const agencyFee = parseFloat(reservation.agency_fee || 0);
        totalAmount += agencyFee;
        
        const baseAmount = totalAmount;
        const discount = parseFloat(discount_usd || 0);
        const surcharge = parseFloat(surcharge_usd || 0);
        const finalAmountUSD = baseAmount - discount + surcharge;

        // 3. 최신 USD 환율 조회 (없으면 1300 기본값)
        let fxRate = 1300;
        let fxRateDate = new Date();
        try {
            const rateResult = await pool.query(`
                SELECT * FROM exchange_rates
                WHERE currency_code = 'USD'
                ORDER BY rate_date DESC, rate_time DESC
                LIMIT 1
            `);
            if (rateResult.rows.length > 0) {
                fxRate = parseFloat(rateResult.rows[0].rate) || 1300;
                fxRateDate = rateResult.rows[0].rate_date || fxRateDate;
            }
        } catch (e) {
            console.warn('⚠️ 바우처인보이스 환율 조회 실패, 기본값 사용:', e.message);
        }

        const totalAmountKRW = finalAmountUSD * fxRate;

        // 4. 인보이스 번호 생성 (간단 버전)
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const invoiceNumber = `HV-${y}${m}${d}-${reservationId}`;

        // 5. hotel_invoices 레코드 생성
        const insertResult = await client.query(`
            INSERT INTO hotel_invoices (
                invoice_number, hotel_reservation_id, booking_agency_id,
                invoice_date, total_amount, currency,
                fx_rate, fx_rate_date, total_amount_krw,
                status, created_at, updated_at
            ) VALUES ($1, $2, $3, CURRENT_DATE, $4, $5, $6, $7, $8, 'draft', NOW(), NOW())
            ON CONFLICT (invoice_number) DO UPDATE SET
                total_amount = EXCLUDED.total_amount,
                currency = EXCLUDED.currency,
                fx_rate = EXCLUDED.fx_rate,
                fx_rate_date = EXCLUDED.fx_rate_date,
                total_amount_krw = EXCLUDED.total_amount_krw,
                updated_at = NOW()
            RETURNING *
        `, [
            invoiceNumber,
            reservationId,
            reservation.booking_agency_id || null,
            finalAmountUSD,
            currency,
            fxRate,
            fxRateDate,
            totalAmountKRW
        ]);
        
        // 예약 상태를 바우처 단계로 업데이트
        await client.query(`
            UPDATE hotel_reservations
            SET status = 'voucher', updated_at = NOW()
            WHERE id = $1
        `, [reservationId]);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: '바우처인보이스가 생성되었습니다.',
            invoice: insertResult.rows[0]
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 바우처인보이스 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처인보이스 생성 중 오류가 발생했습니다.'
        });
    } finally {
        client.release();
    }
});

// 호텔 바우처인보이스 미리보기 (HTML)
// GET /api/hotel-assignments/invoice/:invoiceId/preview
router.get('/invoice/:invoiceId/preview', async (req, res) => {
    const { invoiceId } = req.params;
    const pool = req.app.get('pool');

    try {
        const invoiceQuery = await pool.query(`
            SELECT 
                i.*,
                hr.agency_fee,
                hr.total_cost_price,
                hr.reservation_number,
                hr.check_in_date,
                hr.check_out_date,
                hr.special_requests,
                h.hotel_name,
                ba.agency_name AS booking_agency_name,
                ba.contact_person AS agency_contact_person,
                ba.contact_email AS agency_email
            FROM hotel_invoices i
            LEFT JOIN hotel_reservations hr ON i.hotel_reservation_id = hr.id
            LEFT JOIN hotels h ON hr.hotel_id = h.id
            LEFT JOIN booking_agencies ba ON hr.booking_agency_id = ba.id
            WHERE i.id = $1
        `, [invoiceId]);

        if (invoiceQuery.rows.length === 0) {
            return res.status(404).send('바우처 인보이스를 찾을 수 없습니다.');
        }

        const row = invoiceQuery.rows[0];
        const reservationId = row.hotel_reservation_id;

        // 객실 정보 조회
        const roomsQuery = await pool.query(`
            SELECT 
                hrr.*, 
                rt.room_type_name
            FROM hotel_reservation_rooms hrr
            LEFT JOIN room_types rt ON hrr.room_type_id = rt.id
            WHERE hrr.reservation_id = $1
            ORDER BY hrr.id
        `, [reservationId]);

        // 투숙객 정보 조회 (hotel_reservation_guests 테이블 사용)
        for (let room of roomsQuery.rows) {
            const guestsQuery = await pool.query(`
                SELECT *
                FROM hotel_reservation_guests
                WHERE reservation_room_id = $1
                ORDER BY id
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }

        // 추가 서비스 조회 (인호텔/아웃호텔 모두 인보이스에 표시)
        const extrasQuery = await pool.query(`
            SELECT *
            FROM hotel_reservation_extras
            WHERE reservation_id = $1
            ORDER BY id
        `, [reservationId]);

        // 수배서 HTML에서는 notes 가 'OUT_HOTEL' 인 항목을 숨기므로,
        // 바우처 인보이스에서는 IN/OUT 모두 표시되도록 notes 값을 정규화한다.
        const extras = extrasQuery.rows.map(e => ({
            ...e,
            notes: 'IN_HOTEL'
        }));

        const reservation = {
            ...row,
            id: reservationId,
            rooms: roomsQuery.rows,
            extras,
            __isVoucherInvoice: true
        };

        const invoice = {
            id: row.id,
            invoice_number: row.invoice_number,
            invoice_date: row.invoice_date,
            due_date: row.due_date,
            total_amount: row.total_amount,
            currency: row.currency,
            fx_rate: row.fx_rate,
            fx_rate_date: row.fx_rate_date,
            total_amount_krw: row.total_amount_krw,
            status: row.status
        };

        console.log('🔍 Invoice Preview - agency_fee:', reservation.agency_fee);
        console.log('🔍 Invoice Preview - total_cost_price:', reservation.total_cost_price);

        const html = generateVoucherInvoiceHTML(reservation, invoice);

        res.send(html);
    } catch (error) {
        console.error('❌ 바우처인보이스 미리보기 오류:', error);
        res.status(500).send('바우처인보이스 미리보기를 생성하는 중 오류가 발생했습니다.');
    }
});

module.exports = router;
