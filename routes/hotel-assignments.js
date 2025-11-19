const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { sendHotelAssignment, generateAssignmentHTML } = require('../utils/hotelAssignmentMailer');

/**
 * 호텔 수배서 생성 및 전송 API
 * POST /api/hotel-assignments
 */
router.post('/', async (req, res) => {
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
                h.email as hotel_email_default,
                ba.agency_name as booking_agency_name,
                ba.contact_person as agency_contact_person,
                ba.email as agency_email
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
        
        // 3. 각 객실의 투숙객 정보 조회
        for (let room of roomsQuery.rows) {
            const guestsQuery = await client.query(`
                SELECT *
                FROM hotel_room_guests
                WHERE room_id = $1
                ORDER BY id
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
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
                ba.email as agency_email
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
        
        // 3. 투숙객 정보 조회
        for (let room of roomsQuery.rows) {
            const guestsQuery = await pool.query(`
                SELECT *
                FROM hotel_room_guests
                WHERE room_id = $1
                ORDER BY id
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
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
        
        // 6. 최신 이력에서 타입과 리바이스 번호 가져오기
        const latestHistory = historyQuery.rows[historyQuery.rows.length - 1];
        const assignmentType = latestHistory ? latestHistory.assignment_type : 'NEW';
        const revisionNumber = latestHistory ? latestHistory.revision_number : 0;
        
        // 7. HTML 생성
        const html = generateAssignmentHTML(reservation, assignmentType, revisionNumber);
        
        res.send(html);
        
    } catch (error) {
        console.error('❌ 수배서 조회 오류:', error);
        res.status(500).send('수배서를 불러오는 중 오류가 발생했습니다.');
    }
});

module.exports = router;
