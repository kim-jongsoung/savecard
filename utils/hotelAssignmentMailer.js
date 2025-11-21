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
    let roomCharges = []; // 각 룸별 요금 저장
    let breakfastCharges = []; // 각 룸별 조식 요금 저장
    let confirmationFields = '';
    
    rooms.forEach((room, idx) => {
        const roomNum = idx + 1;
        const roomRate = parseFloat(room.room_rate || 0);
        const roomCharge = roomRate * nights;
        roomCharges.push({ roomNum, roomRate, nights, roomCharge });
        
        // 투숙객 정보
        let guestsHTML = '';
        const guests = room.guests || [];
        guests.forEach((guest, guestIdx) => {
            const guestType = guest.is_adult ? 'Adult' : (guest.is_child ? 'Child' : 'Infant');
            const guestNameEn = guest.english_name || guest.guest_name_en || '';
            guestsHTML += `
                <tr style="font-size: 9px;">
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">Guest${guestIdx + 1}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guestNameEn}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guestType}</td>
                    <td style="padding: 2px 4px; border: 1px solid #ddd;">${guest.birth_date || guest.date_of_birth || ''}</td>
                </tr>
            `;
        });
        
        // 조식 정보 (횟수만)
        let breakfastHTML = '';
        if (room.breakfast_included) {
            const adultCount = room.breakfast_adult_count || 0;
            const childCount = room.breakfast_child_count || 0;
            const adultPrice = parseFloat(room.breakfast_adult_price || 0);
            const childPrice = parseFloat(room.breakfast_child_price || 0);
            
            const adultTotal = adultCount * nights;
            const childTotal = childCount * nights;
            
            const breakfastCharge = (adultTotal * adultPrice) + (childTotal * childPrice);
            breakfastCharges.push({ roomNum, adultCount, childCount, nights, adultTotal, childTotal, adultPrice, childPrice, breakfastCharge });
            
            breakfastHTML = `
                <tr style="font-size: 9px;">
                    <td colspan="4" style="padding: 2px 4px; border: 1px solid #ddd;">
                        <strong>Breakfast: ☑ Included</strong> │ Adult: ${adultCount}×${nights}=${adultTotal} │ Child: ${childCount}×${nights}=${childTotal}
                    </td>
                </tr>
            `;
        } else {
            breakfastHTML = `
                <tr style="font-size: 9px;">
                    <td colspan="4" style="padding: 2px 4px; border: 1px solid #ddd;"><strong>Breakfast: ☐ Not Included</strong></td>
                </tr>
            `;
        }
        
        roomsHTML += `
            <tr style="background: #f8f9fa; font-size: 10px;">
                <td colspan="4" style="padding: 4px; border: 1px solid #ddd;">
                    <strong>ROOM ${roomNum}:</strong> ${room.room_type_name || ''} │ <strong>Promo:</strong> ${room.promotion_code || '-'} │ <strong>Rate:</strong> $${roomRate}/Night
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
    
    // PAYMENT TO HOTEL 섹션 생성
    let paymentHTML = '';
    let totalAmount = 0;
    
    // 룸 요금
    roomCharges.forEach(r => {
        paymentHTML += `
        <tr style="font-size: 9px;">
            <td style="padding: 3px;">Room ${r.roomNum}:</td>
            <td style="padding: 3px; text-align: right;">$${r.roomRate}×${r.nights} nights = $${r.roomCharge.toFixed(2)}</td>
        </tr>
        `;
        totalAmount += r.roomCharge;
    });
    
    // 조식 요금
    breakfastCharges.forEach(b => {
        let breakfastDetail = '';
        if (b.adultTotal > 0 && b.childTotal > 0) {
            breakfastDetail = `Adult $${b.adultPrice}×${b.adultTotal} + Child $${b.childPrice}×${b.childTotal}`;
        } else if (b.adultTotal > 0) {
            breakfastDetail = `Adult $${b.adultPrice}×${b.adultTotal}`;
        } else if (b.childTotal > 0) {
            breakfastDetail = `Child $${b.childPrice}×${b.childTotal}`;
        }
        
        paymentHTML += `
        <tr style="font-size: 9px;">
            <td style="padding: 3px;">Breakfast Room ${b.roomNum}:</td>
            <td style="padding: 3px; text-align: right;">${breakfastDetail} = $${b.breakfastCharge.toFixed(2)}</td>
        </tr>
        `;
        totalAmount += b.breakfastCharge;
    });
    
    // 추가 서비스
    if (extras && extras.length > 0) {
        let extrasDetail = '';
        let extrasTotal = 0;
        extras.forEach((extra, idx) => {
            const charge = parseFloat(extra.charge || 0);
            extrasTotal += charge;
            extrasDetail += `${extra.item_name} $${charge.toFixed(2)}`;
            if (idx < extras.length - 1) extrasDetail += ' + ';
        });
        
        paymentHTML += `
        <tr style="font-size: 9px;">
            <td style="padding: 3px;">Extra Services:</td>
            <td style="padding: 3px; text-align: right;">${extrasDetail} = $${extrasTotal.toFixed(2)}</td>
        </tr>
        `;
        totalAmount += extrasTotal;
    }
    
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
        ${paymentHTML}
        <tr style="font-size: 9px;">
            <td colspan="2" style="padding: 3px;">&nbsp;</td>
        </tr>
        <tr style="font-size: 11px; background: #f0f0f0;">
            <td style="padding: 4px;"><strong>💰 TOTAL AMOUNT:</strong></td>
            <td style="padding: 4px; text-align: right;"><strong>$${totalAmount.toFixed(2)}</strong></td>
        </tr>
    </table>
    
    <!-- 내부 메모 (호텔 전달사항) -->
    ${reservation.internal_memo ? `
    <table>
        <tr class="section-title" style="font-size: 9px;">
            <td>Notes to Hotel</td>
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

// 이메일 본문용 HTML 생성 (AI 문구 반영)
function generateEmailHTML(emailContent, assignmentLink, assignmentData) {
    return `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${emailContent.subject}</title>
    <style>
        body {
            font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 10px;
            padding: 30px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px 8px 0 0;
            margin: -30px -30px 20px -30px;
        }
        .header h1 {
            margin: 0;
            font-size: 22px;
        }
        .content {
            margin: 20px 0;
        }
        .info-box {
            background: #f8f9fa;
            border-left: 4px solid #667eea;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
        }
        .info-box p {
            margin: 5px 0;
        }
        .info-box strong {
            color: #667eea;
        }
        .button-container {
            text-align: center;
            margin: 30px 0;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white !important;
            text-decoration: none;
            padding: 15px 40px;
            border-radius: 25px;
            font-weight: bold;
            font-size: 16px;
            box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);
        }
        .button:hover {
            box-shadow: 0 6px 20px rgba(102, 126, 234, 0.6);
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
            text-align: center;
        }
        .link-text {
            font-size: 12px;
            color: #666;
            word-break: break-all;
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🏨 ${assignmentData.assignment_type === 'NEW' ? 'Booking Request' : (assignmentData.assignment_type === 'REVISE' ? 'Booking Revision' : 'Cancellation Request')}</h1>
        </div>
        
        <div class="content">
            <p>${emailContent.greeting}</p>
            
            <p>${emailContent.body.replace(/\n/g, '<br>')}</p>
            
            <div class="info-box">
                <p><strong>🏨 Hotel:</strong> ${assignmentData.hotel_name}</p>
                <p><strong>👤 Guest:</strong> ${assignmentData.rooms && assignmentData.rooms[0] && assignmentData.rooms[0].guests && assignmentData.rooms[0].guests[0] ? (assignmentData.rooms[0].guests[0].english_name || 'Guest') : 'Guest'}</p>
                <p><strong>📅 Check-in:</strong> ${assignmentData.check_in_date}</p>
                <p><strong>📅 Check-out:</strong> ${assignmentData.check_out_date}</p>
                <p><strong>🌙 Nights:</strong> ${assignmentData.nights}</p>
            </div>
            
            <div class="button-container">
                <a href="${assignmentLink}" class="button">
                    📄 View Assignment Document
                </a>
            </div>
            
            <p class="link-text">
                Or copy this link: <br>
                <a href="${assignmentLink}">${assignmentLink}</a>
            </p>
            
            <p style="margin-top: 30px;">${emailContent.closing}</p>
            <p><strong>${assignmentData.agency_contact_person || 'Reservation Team'}</strong></p>
            <p style="font-size: 14px; color: #666; margin-top: 10px;">
                ${assignmentData.booking_agency_name || 'Guam Save Card'}<br>
                ${assignmentData.agency_contact_email || 'support@guamsavecard.com'}
            </p>
        </div>
        
        <div class="footer">
            <p>This email was automatically sent from our reservation management system.</p>
        </div>
    </div>
</body>
</html>
    `;
}

// 호텔 수배서 이메일 발송
async function sendHotelAssignment(reservation, hotelEmail, assignmentType = 'NEW', revisionNumber = 0, sentBy = 'Admin') {
    // ... (기존 코드와 동일하게 유지하되 사용 안함 - 라우트에서 직접 처리)
    // 호환성을 위해 남겨둡니다.
}

module.exports = {
    sendHotelAssignment,
    generateAssignmentHTML,
    generateEmailHTML
};
