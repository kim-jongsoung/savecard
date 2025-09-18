const OpenAI = require('openai');

// OpenAI 클라이언트 초기화
let openai = null;
try {
    if (process.env.OPENAI_API_KEY) {
        openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        console.log('✅ OpenAI 클라이언트 초기화 성공');
    } else {
        console.log('⚠️ OPENAI_API_KEY 환경변수가 설정되지 않음');
    }
} catch (error) {
    console.error('❌ OpenAI 클라이언트 초기화 실패:', error.message);
}

/**
 * OpenAI API를 사용하여 예약 텍스트를 JSON으로 파싱
 * @param {string} rawText - 파싱할 원본 예약 텍스트
 * @returns {Promise<Object>} - 파싱된 예약 데이터 JSON
 */
async function parseBooking(rawText) {
    // OpenAI API 키가 없으면 에러 발생
    if (!openai) {
        throw new Error('OpenAI API 키가 설정되지 않았습니다. OPENAI_API_KEY 환경변수를 확인하세요.');
    }

    try {
        console.log('🤖 OpenAI API 파싱 시작...');
        console.log('📝 입력 텍스트 길이:', rawText.length);

        const systemPrompt = `
당신은 예약 정보를 정확하게 파싱하는 전문가입니다.
아래 예약 텍스트를 반드시 이 JSON 스키마에 맞게 변환해줘.
출력은 JSON 오브젝트만 반환하고, 다른 텍스트는 포함하지 마.

스키마 필드:
id, reservation_number, confirmation_number, channel, product_name, total_amount,
package_type, usage_date, usage_time, quantity,
korean_name, english_first_name, english_last_name, email, phone, kakao_id,
guest_count, memo, reservation_datetime,
created_at, updated_at,
issue_code_id, code_issued, code_issued_at, platform_name,
people_adult, people_child, people_infant,
adult_unit_price, child_unit_price, payment_status

중요한 파싱 규칙:
1. 예약번호는 숫자로만 구성된 것을 찾으세요 (예: 460033)
2. 확인번호는 "PROD:" 등이 포함된 것을 찾으세요 (예: PROD:9e052e)
3. 채널은 "NOL", "KLOOK", "VIATOR" 등을 찾으세요
4. 금액에서 "$" 기호와 쉼표를 제거하고 숫자(float)만 추출하세요
5. 날짜는 YYYY-MM-DD 형식으로 변환하세요
6. 시간은 HH:MM 형식으로 변환하세요
7. 전화번호에서 "+82 "를 제거하고 "010-"으로 시작하게 하세요
8. 성인/소아 인원수는 "성인 3소아 0" 형태에서 추출하세요
9. 단가는 총금액을 총인원수로 나누어 계산하세요 (float)
10. 예약확정 상태면 payment_status를 "confirmed"로 설정하세요
11. 바우처가 등록되었으면 code_issued를 true로 설정하세요
12. 필드 누락 금지, 모르면 null
13. 금액은 숫자(float), 인원은 정수
14. created_at, updated_at은 "NOW()" 문자열로 채워라
15. id는 null로 설정 (DB에서 자동생성)
16. issue_code_id는 null로 설정

JSON 스키마 예시:
{
  "id": null,
  "reservation_number": "460033",
  "confirmation_number": "PROD:9e052e",
  "channel": "NOL",
  "product_name": "괌 공항-호텔 왕복 편도 픽업 셔틀",
  "total_amount": 45.00,
  "package_type": "왕복 셔틀",
  "usage_date": "2025-11-11",
  "usage_time": "09:35",
  "quantity": 3,
  "korean_name": "홍연숙",
  "english_first_name": "Yeonsook",
  "english_last_name": "Hong",
  "email": "yeonssuk@naver.com",
  "phone": "010-3007-4644",
  "kakao_id": "yeonssuk@naver.com",
  "guest_count": 3,
  "memo": "출국편 LJ0920 / 11월14일 00:20",
  "reservation_datetime": "2025-09-18T00:45:26",
  "created_at": "NOW()",
  "updated_at": "NOW()",
  "issue_code_id": null,
  "code_issued": true,
  "code_issued_at": "2025-09-18T10:11:09",
  "platform_name": "VASCO",
  "people_adult": 3,
  "people_child": 0,
  "people_infant": 0,
  "adult_unit_price": 15.00,
  "child_unit_price": null,
  "payment_status": "confirmed"
}
`;

        const userPrompt = `
다음 예약 텍스트를 분석하여 JSON으로 변환해주세요:

${rawText}
`;

        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt }
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
            max_tokens: 2000
        });

        const parsedData = JSON.parse(completion.choices[0].message.content);
        
        // 데이터 후처리 및 검증
        const processedData = postProcessData(parsedData);
        
        console.log('✅ OpenAI 파싱 완료');
        console.log('📊 파싱 결과:', {
            reservation_number: processedData.reservation_number,
            platform_name: processedData.platform_name,
            product_name: processedData.product_name,
            korean_name: processedData.korean_name,
            guest_count: processedData.guest_count,
            usage_date: processedData.usage_date,
            total_amount: processedData.total_amount
        });

        return processedData;

    } catch (error) {
        console.error('❌ OpenAI 파싱 오류:', error.message);
        
        // OpenAI API 오류 시 기본 구조 반환
        return getDefaultBookingData(rawText);
    }
}

/**
 * 파싱된 데이터 후처리 및 검증
 * @param {Object} data - OpenAI에서 파싱된 원본 데이터
 * @returns {Object} - 후처리된 데이터
 */
function postProcessData(data) {
    // 기본값 설정
    const processed = {
        reservation_number: data.reservation_number || `AI_${Date.now().toString().slice(-8)}`,
        confirmation_number: data.confirmation_number || null,
        channel: data.channel || '웹',
        product_name: data.product_name || '상품명 미확인',
        total_amount: parseFloat(data.total_amount) || null,
        package_type: data.package_type || null,
        usage_date: validateDate(data.usage_date),
        usage_time: validateTime(data.usage_time),
        quantity: parseInt(data.quantity) || 1,
        korean_name: data.korean_name || null,
        english_first_name: data.english_first_name || null,
        english_last_name: data.english_last_name || null,
        email: validateEmail(data.email),
        phone: cleanPhone(data.phone),
        kakao_id: data.kakao_id || null,
        guest_count: parseInt(data.guest_count) || 1,
        memo: data.memo || null,
        reservation_datetime: validateDateTime(data.reservation_datetime),
        platform_name: data.platform_name || 'OTHER',
        people_adult: parseInt(data.people_adult) || 1,
        people_child: parseInt(data.people_child) || 0,
        people_infant: parseInt(data.people_infant) || 0,
        adult_unit_price: parseFloat(data.adult_unit_price) || null,
        child_unit_price: parseFloat(data.child_unit_price) || null,
        payment_status: data.payment_status || '대기'
    };

    // 총 인원수 재계산
    processed.guest_count = processed.people_adult + processed.people_child + processed.people_infant;

    // 단가 자동 계산
    if (processed.total_amount && processed.people_adult > 0 && !processed.adult_unit_price) {
        processed.adult_unit_price = Math.round(processed.total_amount / processed.people_adult * 100) / 100;
    }

    return processed;
}

/**
 * 날짜 형식 검증 및 변환
 * @param {string} dateStr - 날짜 문자열
 * @returns {string|null} - YYYY-MM-DD 형식 또는 null
 */
function validateDate(dateStr) {
    if (!dateStr) return null;
    
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().split('T')[0]; // YYYY-MM-DD
    } catch (error) {
        return null;
    }
}

/**
 * 시간 형식 검증 및 변환
 * @param {string} timeStr - 시간 문자열
 * @returns {string|null} - HH:MM 형식 또는 null
 */
function validateTime(timeStr) {
    if (!timeStr) return null;
    
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (timeRegex.test(timeStr)) {
        return timeStr;
    }
    
    return null;
}

/**
 * 날짜시간 형식 검증 및 변환
 * @param {string} datetimeStr - 날짜시간 문자열
 * @returns {string|null} - YYYY-MM-DD HH:MM:SS 형식 또는 null
 */
function validateDateTime(datetimeStr) {
    if (!datetimeStr) return null;
    
    try {
        const date = new Date(datetimeStr);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().replace('T', ' ').split('.')[0]; // YYYY-MM-DD HH:MM:SS
    } catch (error) {
        return null;
    }
}

/**
 * 이메일 형식 검증
 * @param {string} email - 이메일 문자열
 * @returns {string|null} - 유효한 이메일 또는 null
 */
function validateEmail(email) {
    if (!email) return null;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) ? email : null;
}

/**
 * 전화번호 정리
 * @param {string} phone - 전화번호 문자열
 * @returns {string|null} - 정리된 전화번호 또는 null
 */
function cleanPhone(phone) {
    if (!phone) return null;
    
    // 숫자, +, -, 공백만 남기고 제거
    const cleaned = phone.replace(/[^\d\+\-\s]/g, '');
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * OpenAI API 실패 시 기본 데이터 구조 반환
 * @param {string} rawText - 원본 텍스트
 * @returns {Object} - 기본 예약 데이터 구조
 */
function getDefaultBookingData(rawText) {
    console.log('⚠️ OpenAI API 실패 - 기본 구조 반환');
    
    return {
        reservation_number: `FALLBACK_${Date.now().toString().slice(-8)}`,
        confirmation_number: null,
        channel: '웹',
        product_name: '상품명 미확인',
        total_amount: null,
        package_type: null,
        usage_date: null,
        usage_time: null,
        quantity: 1,
        korean_name: null,
        english_first_name: null,
        english_last_name: null,
        email: null,
        phone: null,
        kakao_id: null,
        guest_count: 1,
        memo: `원본 텍스트: ${rawText.substring(0, 200)}...`,
        reservation_datetime: null,
        platform_name: 'OTHER',
        people_adult: 1,
        people_child: 0,
        people_infant: 0,
        adult_unit_price: null,
        child_unit_price: null,
        payment_status: '대기'
    };
}

module.exports = {
    parseBooking
};
