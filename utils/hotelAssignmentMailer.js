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

    // 생년월일은 YYYY-MM-DD 로만 깔끔하게 표시
    const formatBirthDate = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value; // 파싱 안 되면 원본 그대로
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    // 객실별 HTML 생성
    let roomsHTML = '';
    let roomCharges = []; // 각 룸별 요금 저장
    let breakfastCharges = []; // 각 룸별 조식 요금 저장
    let confirmationFields = '';
    
    rooms.forEach((room, idx) => {
        const roomNum = idx + 1;

        // 룸 요금: room_rate가 없으면 total_selling_price / nights 로 보정
        let roomRate = parseFloat(room.room_rate || 0);
        if (roomRate === 0 && room.total_selling_price && nights > 0) {
            roomRate = parseFloat(room.total_selling_price) / nights;
        }
        const roomCharge = roomRate * nights;
        roomCharges.push({ roomNum, roomRate, nights, roomCharge });
        
        // 투숙객 정보 (A4 미리보기와 동일한 테이블 레이아웃 적용)
        const guests = room.guests || [];
        let guestRowsHTML = '';
        guests.forEach((guest, guestIdx) => {
            const paxType = guest.is_adult ? 'Adult' : (guest.is_child ? 'Child' : 'Infant');
            const guestNameEn = guest.english_name || guest.guest_name_en || '';
            const birthRaw = guest.birth_date || guest.date_of_birth || '';
            const birthFormatted = formatBirthDate(birthRaw);
            guestRowsHTML += `
                <tr style="font-size: 13px;">
                    <td style="padding: 3px 4px; border: 1px solid #000;">${guestIdx + 1}</td>
                    <td style="padding: 3px 4px; border: 1px solid #000;">${guestNameEn}</td>
                    <td style="padding: 3px 4px; border: 1px solid #000;">${paxType}</td>
                    <td style="padding: 3px 4px; border: 1px solid #000;">${birthFormatted}</td>
                </tr>
            `;
        });

        let guestsTableHTML = '';
        if (guests.length > 0) {
            guestsTableHTML = `
                <tr style="font-size: 13px; font-weight: 600;">
                    <td style="padding: 3px 4px; border: 1px solid #000; width: 40px;">No</td>
                    <td style="padding: 3px 4px; border: 1px solid #000; width: 170px;">English Name</td>
                    <td style="padding: 3px 4px; border: 1px solid #000; width: 90px;">Pax Type</td>
                    <td style="padding: 3px 4px; border: 1px solid #000; width: 120px;">Date of Birth</td>
                </tr>
                ${guestRowsHTML}
            `;
        } else {
            guestsTableHTML = `
                <tr style="font-size: 13px;">
                    <td colspan="4" style="padding: 4px; border: 1px solid #000; text-align: center;">No guest information</td>
                </tr>
            `;
        }
        
        // 조식 정보 (횟수만)
        let breakfastHTML = '';
        if (room.breakfast_included) {
            // 기본적으로 저장된 카운트 사용
            let adultCount = parseInt(room.breakfast_adult_count || 0);
            let childCount = parseInt(room.breakfast_child_count || 0);

            // 카운트가 0이고 투숙객 정보가 있으면 투숙객에서 다시 계산
            if (adultCount === 0 && childCount === 0 && room.guests && room.guests.length > 0) {
                room.guests.forEach((guest) => {
                    if (guest.age_category === 'adult' || guest.is_adult) {
                        adultCount++;
                    } else if (guest.age_category === 'child' || guest.is_child) {
                        childCount++;
                    }
                });
            }

            const adultPrice = parseFloat(room.breakfast_adult_price || 0);
            const childPrice = parseFloat(room.breakfast_child_price || 0);

            // 별도 일수 정보가 없으므로 박수(nights)를 기준으로 계산
            const breakfastDays = nights;
            const adultTotal = adultCount * breakfastDays;
            const childTotal = childCount * breakfastDays;
            
            const breakfastCharge = (adultTotal * adultPrice) + (childTotal * childPrice);
            breakfastCharges.push({ roomNum, adultCount, childCount, nights: breakfastDays, adultTotal, childTotal, adultPrice, childPrice, breakfastCharge });
            
            breakfastHTML = `
                <tr style="font-size: 13px;">
                    <td colspan="4" style="padding: 2px 4px; border: 1px solid #000;">
                        <strong>Breakfast: ☑ Included</strong> │ Adult: ${adultCount}×${breakfastDays}=${adultTotal} │ Child: ${childCount}×${breakfastDays}=${childTotal}
                    </td>
                </tr>
            `;
        } else {
            breakfastHTML = `
                <tr style="font-size: 13px;">
                    <td colspan="4" style="padding: 2px 4px; border: 1px solid #000;"><strong>Breakfast: ☐ Not Included</strong></td>
                </tr>
            `;
        }
        
        roomsHTML += `
            <tr style="font-size: 14px;">
                <td colspan="4" style="padding: 6px; border: 1px solid #000;">
                    <strong>ROOM ${roomNum}:</strong> ${room.room_type_name || ''} │ <strong>Promo:</strong> ${room.promotion_code || '-'}
                </td>
            </tr>
            ${guestsTableHTML}
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
            <td style="padding: 3px; border: 1px solid #000;">Room ${r.roomNum}:</td>
            <td style="padding: 3px; border: 1px solid #000; text-align: right;">$${r.roomCharge.toFixed(2)}</td>
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
            <td style="padding: 3px; border: 1px solid #000;">Breakfast Room ${b.roomNum}:</td>
            <td style="padding: 3px; border: 1px solid #000; text-align: right;">${breakfastDetail} = $${b.breakfastCharge.toFixed(2)}</td>
        </tr>
        `;
        totalAmount += b.breakfastCharge;
    });
    
    // 추가 서비스 (IN_HOTEL만 표시)
    if (extras && extras.length > 0) {
        let effectiveExtras = extras;

        // hotel_reservation_extras 처럼 notes 컬럼이 있는 경우 OUT_HOTEL 제외
        if (effectiveExtras.length > 0 && Object.prototype.hasOwnProperty.call(effectiveExtras[0], 'notes')) {
            effectiveExtras = effectiveExtras.filter(e => (e.notes || 'IN_HOTEL') !== 'OUT_HOTEL');
        }

        if (effectiveExtras.length > 0) {
            let extrasDetail = '';
            let extrasTotal = 0;

            effectiveExtras.forEach((extra, idx) => {
                // hotel_assignment_extras: charge
                // hotel_reservation_extras: total_selling_price
                const rawCharge =
                    (typeof extra.charge !== 'undefined' && extra.charge !== null)
                        ? extra.charge
                        : extra.total_selling_price;
                const charge = parseFloat(rawCharge || 0);

                extrasTotal += charge;
                extrasDetail += `${extra.item_name} $${charge.toFixed(2)}`;
                if (idx < effectiveExtras.length - 1) extrasDetail += ' + ';
            });
            
            paymentHTML += `
            <tr style="font-size: 9px;">
                <td style="padding: 3px; border: 1px solid #000;">Extra Services:</td>
                <td style="padding: 3px; border: 1px solid #000; text-align: right;">${extrasDetail} = $${extrasTotal.toFixed(2)}</td>
            </tr>
            `;
            totalAmount += extrasTotal;
        }
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
    
    // 호텔 컨펌 섹션 (컴팩트 버전) -> 스타일 대폭 수정 (LUXFIND)
    const contactPerson = reservation.reservation_created_by || reservation.agency_contact_person || 'LUXFIND Staff';
    const agencyName = 'LUXFIND';
    const changeReason = reservation.changes_description || '';
    const reasonText = (assignmentType === 'REVISE' || assignmentType === 'CANCEL') && changeReason
        ? ` │ 사유: ${changeReason}`
        : '';

    // 룸 수에 따라 Room #n Confirmation No. 필드 동적 생성
    const roomConfirmationLine = rooms.map((room, idx) => {
        const roomNum = idx + 1;
        return `Room #${roomNum} Confirmation No.: <span style="display: inline-block; min-width: 160px; border-bottom: 1px solid #000;">&nbsp;</span>`;
    }).join('&nbsp;&nbsp;');

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700&display=swap');

        @media print {
            @page {
                size: A4;
                margin: 15mm;
            }
            body {
                margin: 0;
                padding: 0;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .no-print {
                display: none !important;
            }
        }

        body {
            font-family: 'Noto Sans KR', 'Malgun Gothic', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            margin: 0;
            padding: 24px;
            color: #2c3e50;
            max-width: 1000px;
            margin: 0 auto;
            -webkit-font-smoothing: antialiased;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 16px;
            font-size: 13px;
        }

        /* 흑백 프린트용: 테이블 구분선을 진하게, 배경색 없이 */
        td {
            padding: 8px 12px;
            border: 1px solid #000;
            vertical-align: middle;
        }

        .header {
            background: #2c3e50;
            color: #fff;
            text-align: center;
            padding: 20px;
            margin-bottom: 16px;
        }

        .header h3 {
            margin: 0;
            font-size: 26px;
            font-weight: 800;
            letter-spacing: -0.5px;
        }

        .header p {
            margin: 8px 0 0 0;
            font-size: 16px;
            font-weight: 600;
        }

        .section-title {
            background: #34495e;
            color: #fff;
            font-weight: 600;
            padding: 10px 14px;
            border-radius: 4px;
            font-size: 15px;
            margin-top: 24px;
            margin-bottom: 8px;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .info-label {
            /* 테이블 셀은 배경색 제거, 글자만 강조 */
            background: #ffffff;
            font-weight: 600;
            width: 150px;
            color: #2c3e50;
        }

        .no-border {
            border: none !important;
        }

        .text-right {
            text-align: right;
        }

        .footer {
            margin-top: 32px;
            border-top: 2px solid #2c3e50;
            padding-top: 16px;
            text-align: center;
            font-size: 12px;
            color: #7f8c8d;
        }
    </style>
</head>
<body>
    <!-- 프린트 버튼 (출력 시 숨김) -->
    <div class="no-print" style="text-align: center; margin-bottom: 20px;">
        <button onclick="window.print()" style="padding: 12px 40px; font-size: 18px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
            🖨️ Print Assignment
        </button>
    </div>
    
    <!-- 타이틀 -->
    <div class="header">
        <h3>🏨 ${title}</h3>
        <p>LUXFIND (럭스파인드)${reasonText}</p>
    </div>
    
    <!-- 헤더 정보 -->
    <div style="text-align: right; padding: 10px; background: #f8f9fa; border: 1px solid #ccc; margin-bottom: 20px;">
        <strong>📅 Sent:</strong> ${new Date().toLocaleString('en-US')} | <strong>👤 Contact:</strong> ${contactPerson}
    </div>
    
    <!-- 예약 기본정보 (1행: Hotel + Flight, 2행: Check-in / Check-out + Nights) -->
    <table style="margin-bottom: 20px;">
        <tr>
            <td class="info-label">Hotel</td>
            <td colspan="2" style="font-size: 16px; font-weight: bold;">${reservation.hotel_name_en || reservation.hotel_name || ''}</td>
            <td style="text-align: right;">
                Flight: ${reservation.arrival_flight || ''} / ${reservation.departure_flight || ''}
            </td>
        </tr>
        <tr>
            <td class="info-label">Check-in</td>
            <td>${formatDate(checkIn)}</td>
            <td class="info-label">Check-out</td>
            <td>
                ${formatDate(checkOut)}
                <span style="margin-left: 8px;"><strong>${nights}</strong> Nights</span>
            </td>
        </tr>
    </table>
    
    <!-- 객실 정보 -->
    <table style="margin-top: 5px;">
        ${roomsHTML}
    </table>
    
    <!-- 금액 정보 -->
    <table style="margin-top: 5px;">
        ${paymentHTML}
        <tr>
            <td colspan="2" style="padding: 10px;">&nbsp;</td>
        </tr>
        <tr style="font-size: 18px;">
            <td style="padding: 12px;"><strong>TOTAL AMOUNT:</strong></td>
            <td style="padding: 12px; text-align: right;"><strong>$${totalAmount.toFixed(2)}</strong></td>
        </tr>
    </table>
    
    <!-- 내부 메모 (호텔 전달사항) -->
    ${reservation.internal_memo ? `
    <div style="margin-top: 18px; padding: 15px; border: 1px solid #333; background: #fffacd;">
        ${reservation.internal_memo}
    </div>
    ` : ''}
    
    <!-- Hotel Confirmation Section (Compact 2-line area) -->
    <div style="margin-top: 24px; padding: 18px; border: 2px solid #2c3e50; border-radius: 8px; background: #f8f9fa;">
        <p style="margin: 6px 0 4px 0; font-size: 13px;">
            ${roomConfirmationLine}
        </p>
        <p style="margin: 4px 0 0 0; font-size: 13px;">
            Date: <span style="display: inline-block; min-width: 140px; border-bottom: 1px solid #000;">&nbsp;</span>
            &nbsp;&nbsp;Staff Name: <span style="display: inline-block; min-width: 160px; border-bottom: 1px solid #000;">&nbsp;</span>
        </p>
    </div>
</body>
</html>
    `;
}

// 이메일 본문용 HTML 생성 (AI 문구 반영)
function generateEmailHTML(emailContent, assignmentLink, assignmentData) {
    const wrapText = (text, maxLen = 100) => {
        if (!text) return '';
        const words = text.split(/\s+/);
        const lines = [];
        let current = '';

        for (const word of words) {
            if (!word) continue;
            if (!current.length) {
                current = word;
            } else if ((current + ' ' + word).length > maxLen) {
                lines.push(current);
                current = word;
            } else {
                current += ' ' + word;
            }
        }

        if (current) lines.push(current);
        return lines.join('\n');
    };

    const formatDate = (value) => {
        if (!value) return '';
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return value;
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const checkInDate = formatDate(assignmentData.check_in_date);
    const checkOutDate = formatDate(assignmentData.check_out_date);
    const guestName =
        assignmentData.rooms &&
        assignmentData.rooms[0] &&
        assignmentData.rooms[0].guests &&
        assignmentData.rooms[0].guests[0]
            ? assignmentData.rooms[0].guests[0].guest_name_en ||
              assignmentData.rooms[0].guests[0].english_name ||
              assignmentData.rooms[0].guests[0].guest_name_ko ||
              'Guest'
            : 'Guest';

    return `
<!DOCTYPE html>
<html lang="en">
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
            
            <p>${wrapText(emailContent.body || '').replace(/\n/g, '<br><br>')}</p>
            
            <div class="info-box">
                <p><strong>🏨 Hotel:</strong> ${assignmentData.hotel_name}</p>
                <p><strong>👤 Guest:</strong> ${guestName}</p>
                <p><strong>📅 Check-in:</strong> ${checkInDate}</p>
                <p><strong>📅 Check-out:</strong> ${checkOutDate}</p>
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
            <p><strong>LUXFIND</strong></p>
            <p style="font-size: 14px; color: #666; margin-top: 10px;">
                E-mail: luxfind01@gmail.com
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
