const express = require('express');
const router = express.Router();
const crypto = require('crypto');

/**
 * 수배서 생성 API
 * POST /api/hotel-assignment-management/create
 */
router.post('/create', async (req, res) => {
    const { reservation_id, assignment_type, changes_description, sent_by } = req.body;
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 예약 정보 조회 (rooms, guests, extras 포함)
        const reservationQuery = await client.query(`
            SELECT 
                hr.*,
                h.hotel_name,
                h.hotel_name_en,
                ba.agency_name as booking_agency_name,
                ba.contact_person as agency_contact_person,
                ba.contact_email as agency_contact_email
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
                rt.room_type_name,
                rt.hotel_room_name
            FROM hotel_reservation_rooms hrr
            LEFT JOIN room_types rt ON hrr.room_type_id = rt.id
            WHERE hrr.reservation_id = $1
            ORDER BY hrr.id
        `, [reservation_id]);
        
        const rooms = roomsQuery.rows;
        
        // 3. 투숙객 정보 조회
        for (let room of rooms) {
            const guestsQuery = await client.query(`
                SELECT *
                FROM hotel_reservation_guests
                WHERE reservation_room_id = $1
                ORDER BY id
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
        // 4. 추가 항목 조회 (OUT_HOTEL 표시는 호텔 수배서에서 제외)
        const extrasQuery = await client.query(`
            SELECT *
            FROM hotel_reservation_extras
            WHERE reservation_id = $1
              AND COALESCE(notes, 'IN_HOTEL') != 'OUT_HOTEL'
            ORDER BY id
        `, [reservation_id]);
        
        const extras = extrasQuery.rows;
        
        // 5. revision_number 계산
        let revisionNumber = 0;
        if (assignment_type === 'REVISE') {
            const countQuery = await client.query(`
                SELECT COUNT(*) as count
                FROM hotel_assignments
                WHERE reservation_id = $1 AND assignment_type = 'REVISE'
            `, [reservation_id]);
            revisionNumber = parseInt(countQuery.rows[0].count) + 1;
        }
        
        // 6. assignment_token 생성
        const assignmentToken = crypto.randomBytes(32).toString('hex');
        
        // 7. 박수 계산
        const checkIn = new Date(reservation.check_in_date);
        const checkOut = new Date(reservation.check_out_date);
        const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
        
        // 8. 호텔 지불액 계산 (total_amount - agency_fee)
        const totalAmount = parseFloat(reservation.total_amount || 0);
        const agencyFee = parseFloat(reservation.agency_fee || 0);
        const hotelPayment = totalAmount - agencyFee;
        
        // 9. hotel_assignments 테이블에 INSERT
        const assignmentQuery = await client.query(`
            INSERT INTO hotel_assignments (
                reservation_id, assignment_type, revision_number, assignment_token,
                hotel_id, hotel_name, booking_agency_id, booking_agency_name,
                agency_contact_person, agency_contact_email,
                check_in_date, check_out_date, nights,
                arrival_flight, departure_flight,
                total_amount, agency_fee, hotel_payment,
                internal_memo, changes_description,
                sent_by, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                $11, $12, $13, $14, $15, $16, $17, $18,
                $19, $20, $21, NOW(), NOW()
            ) RETURNING id
        `, [
            reservation_id, assignment_type, revisionNumber, assignmentToken,
            reservation.hotel_id, reservation.hotel_name_en || reservation.hotel_name,
            reservation.booking_agency_id, reservation.booking_agency_name,
            reservation.agency_contact_person, reservation.agency_contact_email,
            reservation.check_in_date, reservation.check_out_date, nights,
            reservation.arrival_flight, reservation.departure_flight,
            totalAmount, agencyFee, hotelPayment,
            reservation.internal_memo, changes_description,
            sent_by
        ]);
        
        const assignmentId = assignmentQuery.rows[0].id;
        
        // 10. hotel_assignment_rooms 테이블에 INSERT (예약 객실의 confirmation_number도 복사)
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            
            // room_rate 계산 (없으면 총 판매가 / 박수)
            let roomRate = parseFloat(room.room_rate || 0);
            if (roomRate === 0 && room.total_selling_price && nights > 0) {
                roomRate = parseFloat(room.total_selling_price) / nights;
            }
            
            // ⭐ 객실별 확정번호 사용 (각 객실마다 다른 확정번호 가능)
            const confirmationNumber = room.confirmation_number || null;
            
            const roomQuery = await client.query(`
                INSERT INTO hotel_assignment_rooms (
                    assignment_id, room_number, room_type_id, room_type_name,
                    room_rate, promotion_code, confirmation_number,
                    breakfast_included, breakfast_days, breakfast_adult_count, breakfast_adult_price,
                    breakfast_child_count, breakfast_child_price
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING id
            `, [
                assignmentId, i + 1, room.room_type_id, room.hotel_room_name || room.room_type_name,
                roomRate, room.promotion_code, confirmationNumber,
                room.breakfast_included, room.breakfast_days, room.breakfast_adult_count, room.breakfast_adult_price,
                room.breakfast_child_count, room.breakfast_child_price
            ]);
            
            const assignmentRoomId = roomQuery.rows[0].id;
            
            // 11. hotel_assignment_guests 테이블에 INSERT
            for (let j = 0; j < room.guests.length; j++) {
                const guest = room.guests[j];
                // age_category를 is_adult, is_child, is_infant으로 변환
                const isAdult = guest.age_category === 'adult';
                const isChild = guest.age_category === 'child';
                const isInfant = guest.age_category === 'infant';
                
                await client.query(`
                    INSERT INTO hotel_assignment_guests (
                        assignment_room_id, guest_number,
                        guest_name_ko, guest_name_en, birth_date,
                        is_adult, is_child, is_infant
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    assignmentRoomId, j + 1,
                    guest.guest_name_ko, guest.guest_name_en,
                    guest.date_of_birth, isAdult, isChild, isInfant
                ]);
            }
        }
        
        // 12. hotel_assignment_extras 테이블에 INSERT (호텔로 전달할 인호텔 항목만)
        for (let i = 0; i < extras.length; i++) {
            const extra = extras[i];
            await client.query(`
                INSERT INTO hotel_assignment_extras (
                    assignment_id, item_number, item_name, charge
                ) VALUES ($1, $2, $3, $4)
            `, [
                assignmentId,
                i + 1,
                extra.item_name,
                parseFloat(extra.total_selling_price) || 0
            ]);
        }
        
        // 13. 상태 자동 변경
        if (assignment_type === 'CANCEL') {
            // CANCEL 전송 시 예약 상태를 'cancelled'로 변경
            await client.query(`
                UPDATE hotel_reservations
                SET status = 'cancelled', updated_at = NOW()
                WHERE id = $1
            `, [reservation_id]);
            console.log(`✅ 예약 ID ${reservation_id} 상태가 'cancelled'로 변경되었습니다.`);
        } else if (assignment_type === 'NEW' || assignment_type === 'REVISE') {
            // 수배서 생성 시 pending/modifying → processing으로 변경
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
            message: '수배서가 생성되었습니다.',
            assignment_id: assignmentId,
            assignment_token: assignmentToken,
            assignment_type,
            revision_number: revisionNumber
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 수배서 생성 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * 수배서 목록 조회 API
 * GET /api/hotel-assignment-management/list/:reservationId
 */
router.get('/list/:reservationId', async (req, res) => {
    const { reservationId } = req.params;
    const pool = req.app.get('pool');
    
    try {
        const query = await pool.query(`
            SELECT 
                id, reservation_id, assignment_type, revision_number, assignment_token,
                sent_to_email, sent_at, sent_by,
                email_viewed, viewed_at, view_count,
                changes_description, created_at
            FROM hotel_assignments
            WHERE reservation_id = $1
            ORDER BY created_at DESC
        `, [reservationId]);
        
        res.json({
            success: true,
            assignments: query.rows
        });
        
    } catch (error) {
        console.error('❌ 수배서 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 수배서 상세 조회 API
 * GET /api/hotel-assignment-management/:assignmentId
 */
router.get('/:assignmentId', async (req, res) => {
    const { assignmentId } = req.params;
    const pool = req.app.get('pool');
    
    try {
        // 1. 수배서 기본 정보
        const assignmentQuery = await pool.query(`
            SELECT * FROM hotel_assignments WHERE id = $1
        `, [assignmentId]);
        
        if (assignmentQuery.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: '수배서를 찾을 수 없습니다.'
            });
        }
        
        const assignment = assignmentQuery.rows[0];
        
        // 2. 객실 정보
        const roomsQuery = await pool.query(`
            SELECT * FROM hotel_assignment_rooms
            WHERE assignment_id = $1
            ORDER BY room_number
        `, [assignmentId]);
        
        const rooms = roomsQuery.rows;
        
        // 3. 투숙객 정보
        for (let room of rooms) {
            const guestsQuery = await pool.query(`
                SELECT * FROM hotel_assignment_guests
                WHERE assignment_room_id = $1
                ORDER BY guest_number
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
        // 4. 추가 항목
        const extrasQuery = await pool.query(`
            SELECT * FROM hotel_assignment_extras
            WHERE assignment_id = $1
            ORDER BY item_number
        `, [assignmentId]);
        
        assignment.rooms = rooms;
        assignment.extras = extrasQuery.rows;
        
        res.json({
            success: true,
            assignment
        });
        
    } catch (error) {
        console.error('❌ 수배서 조회 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * 이메일 전송 API
 * POST /api/hotel-assignment-management/:assignmentId/send
 */
router.post('/:assignmentId/send', async (req, res) => {
    const { assignmentId } = req.params;
    const { hotel_email } = req.body;
    const pool = req.app.get('pool');
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. 수배서 정보 조회 (rooms, guests, extras 포함)
        const assignmentQuery = await client.query(`
            SELECT * FROM hotel_assignments WHERE id = $1
        `, [assignmentId]);
        
        if (assignmentQuery.rows.length === 0) {
            throw new Error('수배서를 찾을 수 없습니다.');
        }
        
        const assignment = assignmentQuery.rows[0];
        
        // 2. 객실 정보
        const roomsQuery = await client.query(`
            SELECT * FROM hotel_assignment_rooms
            WHERE assignment_id = $1
            ORDER BY room_number
        `, [assignmentId]);
        
        const rooms = roomsQuery.rows;
        
        // 3. 투숙객 정보
        for (let room of rooms) {
            const guestsQuery = await client.query(`
                SELECT * FROM hotel_assignment_guests
                WHERE assignment_room_id = $1
                ORDER BY guest_number
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
        // 4. 추가 항목
        const extrasQuery = await client.query(`
            SELECT * FROM hotel_assignment_extras
            WHERE assignment_id = $1
            ORDER BY item_number
        `, [assignmentId]);
        
        assignment.rooms = rooms;
        assignment.extras = extrasQuery.rows;
        
        // 5. AI 이메일 문구 생성
        const { generateHotelEmailContent } = require('../utils/hotelEmailGenerator');
        const emailContent = await generateHotelEmailContent(assignment);
        
        // 6. HTML 생성
        const { generateAssignmentHTML, generateEmailHTML } = require('../utils/hotelAssignmentMailer');
        
        // 6-1. 첨부파일용 수배서 HTML (A4 형식)
        const assignmentHTML = generateAssignmentHTML(assignment, assignment.assignment_type, assignment.revision_number);
        
        // 6-2. 공개 링크
        const assignmentLink = `${process.env.BASE_URL || 'https://www.guamsavecard.com'}/hotel-assignment/view/${assignment.assignment_token}`;
        
        // 6-3. 이메일 본문 HTML (AI 문구 + 스타일)
        const emailHTML = generateEmailHTML(emailContent, assignmentLink, assignment);
        
        // 7. 이메일 발송 설정
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        // 8. 전송할 이메일 주소 결정
        const toEmail = hotel_email || assignment.agency_contact_email;
        if (!toEmail) {
            throw new Error('전송할 이메일 주소가 없습니다.');
        }

        const typeLabel =
            assignment.assignment_type === 'NEW'
                ? 'NEW BOOKING'
                : assignment.assignment_type === 'REVISE'
                ? 'REVISED BOOKING'
                : 'CANCELLATION';

        const formatDate = (value) => {
            if (!value) return '';
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return value;
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };

        const checkInDateLabel = formatDate(assignment.check_in_date);

        // 대표 게스트 (첫 번째 객실의 첫 번째 투숙객)
        let leadGuestName = 'Guest';
        if (assignment.rooms && assignment.rooms[0] && assignment.rooms[0].guests && assignment.rooms[0].guests[0]) {
            const g = assignment.rooms[0].guests[0];
            leadGuestName = g.english_name || g.guest_name_en || g.guest_name_ko || 'Guest';
        }

        // 제목: [타입] Check-in 날짜 - 게스트이름 - LUXFIND
        const mailSubject = `[${typeLabel}] Check-in ${checkInDateLabel} - ${leadGuestName} - LUXFIND`;
        
        // ⭐ 로그인한 직원의 이름과 이메일 조회 (세션의 username 사용)
        let senderEmail = process.env.SMTP_USER; // 기본값
        let senderName = 'LUXFIND'; // 기본값
        const currentUsername = req.session?.adminUsername;
        
        console.log('🔍 [수배서 발송] 세션 정보:', {
            adminUsername: currentUsername,
            adminId: req.session?.adminId,
            sessionExists: !!req.session
        });
        
        if (currentUsername) {
            try {
                const staffQuery = await pool.query(`
                    SELECT email, full_name, username FROM admin_users 
                    WHERE username = $1 AND is_active = true
                    LIMIT 1
                `, [currentUsername]);
                
                console.log('🔍 [수배서 발송] DB 조회 결과:', {
                    found: staffQuery.rows.length > 0,
                    data: staffQuery.rows[0]
                });
                
                if (staffQuery.rows.length > 0) {
                    const staff = staffQuery.rows[0];
                    
                    // 직원 이름 설정
                    if (staff.full_name) {
                        senderName = staff.full_name;
                    }
                    
                    // 직원 이메일 설정
                    if (staff.email) {
                        senderEmail = staff.email;
                        console.log(`✅ 로그인 직원 정보 사용: ${senderName} <${senderEmail}>`);
                    } else {
                        console.log(`⚠️ 직원 이메일 없음, 기본 이메일 사용: ${currentUsername}`);
                    }
                } else {
                    console.log(`⚠️ 직원 정보 없음, 기본값 사용: ${currentUsername}`);
                }
            } catch (error) {
                console.error('⚠️ 직원 정보 조회 실패, 기본값 사용:', error.message);
            }
        } else {
            console.log('⚠️ 세션 정보 없음, 기본값 사용');
        }
        
        console.log(`📧 [최종 발신자 정보] 이름: ${senderName}, 이메일: ${senderEmail}`);
        
        // 9. 이메일 전송
        const info = await transporter.sendMail({
            from: `"${senderName}" <${senderEmail}>`,
            replyTo: senderEmail,
            to: toEmail,
            subject: mailSubject,
            html: emailHTML,
            text: `
${emailContent.greeting}

Guest: ${leadGuestName}
Check-in: ${checkInDateLabel}

${emailContent.body}

${emailContent.closing}

View Assignment: ${assignmentLink}
            `.trim(),
            attachments: [
                {
                    filename: `Assignment_${assignment.assignment_type}_${new Date().getTime()}.html`,
                    content: assignmentHTML
                }
            ]
        });
        
        // 10. 전송 정보 업데이트
        await client.query(`
            UPDATE hotel_assignments
            SET 
                sent_to_email = $1,
                sent_at = NOW(),
                email_message_id = $2
            WHERE id = $3
        `, [toEmail, info.messageId, assignmentId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '이메일이 전송되었습니다.',
            sent_to: toEmail,
            assignment_link: assignmentLink,
            message_id: info.messageId
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 이메일 전송 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    } finally {
        client.release();
    }
});

/**
 * 공개 링크 조회 (호텔용)
 * GET /hotel-assignment/view/:token
 */
router.get('/view/:token', async (req, res) => {
    const { token } = req.params;
    const pool = req.app.get('pool');
    
    try {
        // 1. 수배서 조회
        const assignmentQuery = await pool.query(`
            SELECT ha.*, hr.created_by as reservation_created_by
            FROM hotel_assignments ha
            LEFT JOIN hotel_reservations hr ON ha.reservation_id = hr.id
            WHERE ha.assignment_token = $1
        `, [token]);
        
        if (assignmentQuery.rows.length === 0) {
            return res.status(404).send('수배서를 찾을 수 없습니다.');
        }
        
        const assignment = assignmentQuery.rows[0];
        
        // 2. 객실 정보
        const roomsQuery = await pool.query(`
            SELECT * FROM hotel_assignment_rooms
            WHERE assignment_id = $1
            ORDER BY room_number
        `, [assignment.id]);
        
        const rooms = roomsQuery.rows;
        
        // 3. 투숙객 정보
        for (let room of rooms) {
            const guestsQuery = await pool.query(`
                SELECT * FROM hotel_assignment_guests
                WHERE assignment_room_id = $1
                ORDER BY guest_number
            `, [room.id]);
            room.guests = guestsQuery.rows;
        }
        
        // 4. 추가 항목
        const extrasQuery = await pool.query(`
            SELECT * FROM hotel_assignment_extras
            WHERE assignment_id = $1
            ORDER BY item_number
        `, [assignment.id]);
        
        assignment.rooms = rooms;
        assignment.extras = extrasQuery.rows;
        
        // 5. 열람 정보 업데이트
        await pool.query(`
            UPDATE hotel_assignments
            SET 
                email_viewed = true,
                viewed_at = CASE WHEN viewed_at IS NULL THEN NOW() ELSE viewed_at END,
                view_count = view_count + 1
            WHERE id = $1
        `, [assignment.id]);
        
        // 6. HTML 렌더링
        const { generateAssignmentHTML } = require('../utils/hotelAssignmentMailer');
        const htmlContent = generateAssignmentHTML(assignment, assignment.assignment_type, assignment.revision_number);
        
        res.send(htmlContent);
        
    } catch (error) {
        console.error('❌ 공개 링크 조회 오류:', error);
        res.status(500).send('오류가 발생했습니다.');
    }
});

module.exports = router;
