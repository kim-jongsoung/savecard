const nodemailer = require('nodemailer');

// SMTP 전송자 설정
function createTransporter() {
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp.gmail.com',
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

// 호텔 수배서 HTML 생성 (A4 1장 최적화, 영문)
function generateAssignmentHTML(reservation, assignmentType = 'NEW', revisionNumber = 0) {
    const rooms = reservation.rooms || [];
    const extras = reservation.extras || [];
    const history = reservation.assignment_history || [];
    
    // 타이틀 결정
    let title = 'NEW BOOKING REQUEST';
    if (assignmentType === 'REVISE') {
        title = `REVISE #${revisionNumber} REQUEST`;
    } else if (assignmentType === 'CANCEL') {
        title = 'CANCELLATION REQUEST';
    }
    
    // 체크인/아웃 날짜 포맷
    const checkIn = new Date(reservation.check_in_date || reservation.check_in);
    const checkOut = new Date(reservation.check_out_date || reservation.check_out);
    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    
    const formatDate = (date) => {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dayName = days[date.getDay()];
        return `${year}-${month}-${day} (${dayName})`;
    };
    
    // 객실별 HTML 생성
    let roomsHTML = '';
    let totalRoomCharge = 0;
    let totalBreakfastCharge = 0;
    let confirmationFields = '';
    
    rooms.forEach((room, idx) => {
        const roomNum = idx + 1;
        const roomCharge = parseFloat(room.room_rate || 0) * nights;
        totalRoomCharge += roomCharge;
        
        // 투숙객 정보
        let guestsHTML = '';
        const guests = room.guests || [];
        guests.forEach((guest, guestIdx) => {
            const guestType = guest.is_adult ? 'Adult' : (guest.is_child ? 'Child' : 'Infant');
            const guestNameEn = guest.english_name || guest.guest_name_en || '';
            guestsHTML += `
                <tr style="font-size: 9px;">
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">Guest${guestIdx + 1}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guest.korean_name || guest.guest_name_ko || ''}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guestNameEn}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guestType}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guest.birth_date || guest.date_of_birth || ''}</td>
                </tr>
            `;
        });
        
        // 조식 정보
        let breakfastHTML = '';
        let breakfastCharge = 0;
        if (room.breakfast_included) {
            const adultCount = room.breakfast_adult_count || 0;
            const childCount = room.breakfast_child_count || 0;
            const adultPrice = parseFloat(room.breakfast_adult_price || 0);
            const childPrice = parseFloat(room.breakfast_child_price || 0);
            
            const adultTotal = adultCount * nights;
            const childTotal = childCount * nights;
            
            breakfastCharge = (adultTotal * adultPrice) + (childTotal * childPrice);
            totalBreakfastCharge += breakfastCharge;
            
            breakfastHTML = `
                <tr style="font-size: 9px;">
                    <td colspan="2" style="padding: 2px 4px; border: 1px solid #ddd;"><strong>☑ Breakfast Included</strong></td>
                    <td colspan="3" style="padding: 2px 4px; border: 1px solid #ddd;">
                        Adult: ${adultCount}×${nights}=${adultTotal} | Child: ${childCount}×${nights}=${childTotal}
                    </td>
                </tr>
            `;
        } else {
            breakfastHTML = `
                <tr style="font-size: 9px;">
                    <td colspan="5" style="padding: 2px 4px; border: 1px solid #ddd;"><strong>☐ Breakfast Not Included</strong></td>
                </tr>
            `;
        }
        
        roomsHTML += `
            <tr style="background: #f8f9fa; font-size: 10px;">
                <td colspan="5" style="padding: 4px; border: 1px solid #ddd;">
                    <strong>ROOM ${roomNum}:</strong> ${room.room_type_name || ''} | 
                    <strong>Promo:</strong> ${room.promotion_code || '-'} | 
                    <strong>Rate:</strong> $${room.room_rate || 0}/Night
                </td>
            </tr>
            ${guestsHTML}
            ${breakfastHTML}
        `;
        
        confirmationFields += `
            <tr style="font-size: 10px;">
                <td style="padding: 4px; border: 1px solid #ddd;"><strong>Room ${roomNum} Confirmation#:</strong></td>
                <td style="padding: 4px; border: 1px solid #ddd; border-bottom: 1px solid #333;">
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </td>
            </tr>
        `;
    });
    
    // 추가 서비스 금액
    let totalExtrasCharge = 0;
    let extrasHTML = '';
    if (extras && extras.length > 0) {
        extras.forEach(extra => {
            const charge = parseFloat(extra.charge || 0);
            totalExtrasCharge += charge;
            extrasHTML += `${extra.item_name} $${charge.toFixed(2)} | `;
        });
        extrasHTML = extrasHTML.slice(0, -3); // 마지막 " | " 제거
    }
    
    const totalAmount = totalRoomCharge + totalBreakfastCharge + totalExtrasCharge;
    
    // 변경 이력
    let historyHTML = '';
    if (history && history.length > 0) {
        history.forEach(h => {
            const date = new Date(h.sent_at);
            const dateStr = `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
            const typeLabel = h.assignment_type === 'NEW' ? 'NEW' : (h.assignment_type === 'REVISE' ? `R${h.revision_number}` : 'CXL');
            historyHTML += `[${typeLabel}] ${dateStr} (${h.sent_by}) - ${h.changes_description || ''} | `;
        });
        historyHTML = historyHTML.slice(0, -3);
    } else {
        historyHTML = `[NEW] Initial booking`;
    }
    
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @media print {
            @page { margin: 10mm; size: A4; }
            body { margin: 0; padding: 0; }
            .no-print { display: none !important; }
        }
        body {
            font-family: 'Courier New', monospace;
            font-size: 10px;
            line-height: 1.2;
            margin: 0;
            padding: 10px;
            color: #000;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 4px;
        }
        td {
            padding: 2px 4px;
            border: 1px solid #333;
        }
        .header {
            background: #000;
            color: #fff;
            font-size: 14px;
            font-weight: bold;
            text-align: center;
            padding: 8px;
        }
        .section-title {
            background: #ddd;
            font-weight: bold;
            padding: 4px;
            border: 1px solid #333;
        }
        .no-border {
            border: none;
        }
    </style>
</head>
<body>
    <!-- 프린트 버튼 (출력 시 숨김) -->
    <div class="no-print" style="text-align: center; margin-bottom: 10px;">
        <button onclick="window.print()" style="padding: 10px 30px; font-size: 14px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">
            🖨️ Print
        </button>
    </div>
    
    <!-- 타이틀 -->
    <div class="header">
        🏨 ${title}
    </div>
    
    <!-- 헤더 정보 -->
    <table style="margin-top: 4px;">
        <tr style="font-size: 9px;">
            <td style="width: 50%; padding: 3px;"><strong>Sent:</strong> ${new Date().toLocaleString('en-US')}</td>
            <td style="width: 50%; padding: 3px;"><strong>Agency:</strong> ${reservation.booking_agency_name || ''}</td>
        </tr>
        <tr style="font-size: 9px;">
            <td style="padding: 3px;"><strong>Contact:</strong> ${reservation.agency_contact_person || ''}</td>
            <td style="padding: 3px;"><strong>Hotel:</strong> ${reservation.hotel_name || ''}</td>
        </tr>
    </table>
    
    <!-- 예약 기본정보 -->
    <table>
        <tr style="font-size: 9px;">
            <td style="width: 30%; padding: 3px;"><strong>Check-in:</strong> ${formatDate(checkIn)}</td>
            <td style="width: 35%; padding: 3px;"><strong>Check-out:</strong> ${formatDate(checkOut)}</td>
            <td style="width: 35%; padding: 3px;"><strong>Nights:</strong> ${nights}</td>
        </tr>
        <tr style="font-size: 9px;">
            <td colspan="3" style="padding: 3px;"><strong>Flight:</strong> ${reservation.arrival_flight || ''} / ${reservation.departure_flight || ''}</td>
        </tr>
    </table>
    
    <!-- 객실 정보 -->
    <table>
        ${roomsHTML}
    </table>
    
    <!-- 금액 정보 -->
    <table>
        <tr class="section-title" style="font-size: 10px;">
            <td colspan="2">PAYMENT TO HOTEL (TAX INCLUDED)</td>
        </tr>
        <tr style="font-size: 9px;">
            <td style="padding: 3px;"><strong>Room Charges:</strong></td>
            <td style="padding: 3px; text-align: right;">$${totalRoomCharge.toFixed(2)}</td>
        </tr>
        ${totalBreakfastCharge > 0 ? `
        <tr style="font-size: 9px;">
            <td style="padding: 3px;"><strong>Breakfast:</strong></td>
            <td style="padding: 3px; text-align: right;">$${totalBreakfastCharge.toFixed(2)}</td>
        </tr>
        ` : ''}
        ${totalExtrasCharge > 0 ? `
        <tr style="font-size: 9px;">
            <td style="padding: 3px;"><strong>Extra Services:</strong> ${extrasHTML}</td>
            <td style="padding: 3px; text-align: right;">$${totalExtrasCharge.toFixed(2)}</td>
        </tr>
        ` : ''}
        <tr style="font-size: 11px; background: #f0f0f0;">
            <td style="padding: 4px;"><strong>💰 TOTAL:</strong></td>
            <td style="padding: 4px; text-align: right;"><strong>$${totalAmount.toFixed(2)}</strong></td>
        </tr>
    </table>
    
    <!-- 내부 메모 -->
    ${reservation.internal_memo ? `
    <table>
        <tr class="section-title" style="font-size: 9px;">
            <td>Internal Memo</td>
        </tr>
        <tr style="font-size: 9px;">
            <td style="padding: 3px;">${reservation.internal_memo}</td>
        </tr>
    </table>
    ` : ''}
    
    <!-- 변경 이력 -->
    <table>
        <tr class="section-title" style="font-size: 9px;">
            <td>REVISION HISTORY</td>
        </tr>
        <tr style="font-size: 8px;">
            <td style="padding: 3px;">${historyHTML}</td>
        </tr>
    </table>
    
    <!-- 호텔 컨펌 섹션 -->
    <table>
        <tr class="section-title" style="font-size: 10px;">
            <td colspan="2">✍️ HOTEL CONFIRMATION SECTION</td>
        </tr>
        ${confirmationFields}
        <tr style="font-size: 9px;">
            <td colspan="2" style="padding: 3px;"><strong>Hotel Notes/Comments:</strong></td>
        </tr>
        <tr style="font-size: 9px;">
            <td colspan="2" style="padding: 15px 3px; border-bottom: 1px solid #333;">
                &nbsp;
            </td>
        </tr>
        <tr style="font-size: 9px;">
            <td style="padding: 4px; width: 50%;"><strong>Hotel Staff Name:</strong> _________________</td>
            <td style="padding: 4px; width: 50%;"><strong>Date:</strong> _________________</td>
        </tr>
    </table>
</body>
</html>
    `;
}

// 호텔 수배서 이메일 발송
async function sendHotelAssignment(reservation, hotelEmail, assignmentType = 'NEW', revisionNumber = 0, sentBy = 'Admin') {
    try {
        console.log('📧 호텔 수배서 발송 시작...', assignmentType);
        
        // 수배서 HTML 생성
        const assignmentHTML = generateAssignmentHTML(reservation, assignmentType, revisionNumber);
        
        // 수배서 공개 링크 생성
        const assignmentLink = `${process.env.BASE_URL || 'https://www.guamsavecard.com'}/hotel-assignment/view/${reservation.assignment_token}`;
        
        // 이메일 제목
        let subject = '';
        if (assignmentType === 'NEW') {
            subject = `[NEW BOOKING] ${reservation.hotel_name} - ${reservation.check_in_date || reservation.check_in}`;
        } else if (assignmentType === 'REVISE') {
            subject = `[REVISE #${revisionNumber}] ${reservation.hotel_name} - ${reservation.check_in_date || reservation.check_in}`;
        } else if (assignmentType === 'CANCEL') {
            subject = `[CANCELLATION] ${reservation.hotel_name} - ${reservation.check_in_date || reservation.check_in}`;
        }
        
        // 이메일 본문
        const emailHTML = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            text-align: center;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .content {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .button {
            display: inline-block;
            background: #667eea;
            color: white !important;
            text-decoration: none;
            padding: 12px 30px;
            border-radius: 5px;
            font-weight: bold;
            margin: 10px 0;
        }
        .footer {
            text-align: center;
            font-size: 12px;
            color: #999;
            margin-top: 20px;
        }
    </style>
</head>
<body>
    <div class="header">
        <h2 style="margin: 0;">🏨 Hotel Booking ${assignmentType === 'NEW' ? 'Request' : (assignmentType === 'REVISE' ? 'Revision' : 'Cancellation')}</h2>
    </div>
    
    <div class="content">
        <p>Dear ${reservation.hotel_name} Team,</p>
        
        <p>${assignmentType === 'NEW' ? 'We would like to request a new booking with the following details:' : 
            (assignmentType === 'REVISE' ? `This is a revision (${revisionNumber}) to the existing booking:` : 
            'We would like to cancel the following booking:')}</p>
        
        <p><strong>Check-in:</strong> ${reservation.check_in_date || reservation.check_in}<br>
        <strong>Check-out:</strong> ${reservation.check_out_date || reservation.check_out}<br>
        <strong>Guest Name:</strong> ${reservation.rooms && reservation.rooms[0] && reservation.rooms[0].guests && reservation.rooms[0].guests[0] ? 
            (reservation.rooms[0].guests[0].english_name || reservation.rooms[0].guests[0].guest_name_en || '') : ''}</p>
        
        <p>Please review the detailed assignment document by clicking the button below:</p>
        
        <div style="text-align: center;">
            <a href="${assignmentLink}" class="button">📄 View Assignment Document</a>
        </div>
        
        <p style="font-size: 12px; color: #666;">Or copy this link: <a href="${assignmentLink}">${assignmentLink}</a></p>
        
        <p>Please confirm the booking and provide the confirmation number(s) by replying to this email or updating the document directly.</p>
        
        <p>Thank you for your cooperation.</p>
        
        <p><strong>${reservation.booking_agency_name || 'Guam Save Card'}</strong><br>
        ${reservation.agency_contact_person || ''}<br>
        ${reservation.agency_email || process.env.SMTP_USER}</p>
    </div>
    
    <div class="footer">
        <p>This email was automatically sent from our reservation management system.</p>
    </div>
</body>
</html>
        `;
        
        // SMTP 전송
        const transporter = createTransporter();
        
        const mailOptions = {
            from: `"${reservation.booking_agency_name || 'Guam Save Card'}" <${process.env.SMTP_USER}>`,
            replyTo: reservation.agency_email || process.env.SMTP_USER,
            to: hotelEmail,
            subject: subject,
            html: emailHTML,
            attachments: [
                {
                    filename: `Assignment_${assignmentType}_${new Date().getTime()}.html`,
                    content: assignmentHTML
                }
            ]
        };
        
        const info = await transporter.sendMail(mailOptions);
        
        console.log('✅ 호텔 수배서 이메일 발송 완료:', info.messageId);
        
        return {
            success: true,
            messageId: info.messageId,
            assignmentLink: assignmentLink,
            sentAt: new Date(),
            sentBy: sentBy
        };
        
    } catch (error) {
        console.error('❌ 호텔 수배서 이메일 발송 실패:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    sendHotelAssignment,
    generateAssignmentHTML
};
