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
나는 다양한 여행사/예약사에서 붙여넣은 예약 텍스트(rawText)를 
PostgreSQL DB 스키마에 맞게 항상 동일한 JSON 구조로 변환하고 싶어. 
출력은 반드시 JSON 오브젝트 하나만 반환해야 하고, 다른 텍스트나 설명은 절대 포함하지 마. 

🎯 JSON 스키마 (DB 컬럼):
id, reservation_number, confirmation_number, channel, product_name, total_amount,
package_type, usage_date, usage_time, quantity,
korean_name, english_first_name, english_last_name, email, phone, kakao_id,
guest_count, memo, reservation_datetime,
created_at, updated_at,
issue_code_id, code_issued, code_issued_at, platform_name,
people_adult, people_child, people_infant,
adult_unit_price, child_unit_price, payment_status

📌 규칙:
- 모든 필드는 반드시 포함 (값을 모르면 null)
- 금액은 숫자(float), 인원은 정수
- 날짜는 YYYY-MM-DD, 시간은 HH:MM
- created_at, updated_at은 "NOW()" 문자열로 채운다
- 취소된 예약은 payment_status="cancelled"
- id는 null (DB 자동생성)
- issue_code_id는 null

✅ 출력 예시:
{
  "id": null,
  "reservation_number": "459447",
  "confirmation_number": "PROD:d7cb49",
  "channel": "NOL 인터파크",
  "product_name": "괌 정글리버크루즈 원주민문화체험 맹글로브숲 수공예품만들기 물소타기",
  "total_amount": 304.00,
  "package_type": "개별이동 + 점심포함",
  "usage_date": "2025-10-09",
  "usage_time": null,
  "quantity": 3,
  "korean_name": "구병모",
  "english_first_name": "BYUNGMO",
  "english_last_name": "KU",
  "email": "ddendden@naver.com",
  "phone": "010-7939-3990",
  "kakao_id": "ddendde",
  "guest_count": 3,
  "memo": "호텔: 츠바키 타워. 항공편 정보: 출국 LJ0917 9월 20일 새벽 02:30, 귀국 LJ0918 9월 23일 새벽 03:40. 짐 정보: 골프백 2개, 유모차 1개, 캐리어 4개. 중요사항: 괌 출국편 새벽 3시 및 3시 이후 출발편은 전날 23:30-00:00 사이 픽업합니다. 동의 하시는 분만 구매 부탁드립니다. 기타 요청사항: 아이 알레르기 있음, 견과류 제외 요청.",
  "reservation_datetime": "2025-09-17T02:27:14",
  "created_at": "NOW()",
  "updated_at": "NOW()",
  "issue_code_id": null,
  "code_issued": true,
  "code_issued_at": "2025-09-17T11:22:47",
  "platform_name": "VASCO",
  "people_adult": 2,
  "people_child": 1,
  "people_infant": 0,
  "adult_unit_price": 101.33,
  "child_unit_price": 101.33,
  "payment_status": "confirmed"
}

📋 memo 필드 작성 규칙:
- memo 필드에 고객이 요청한 모든 사항을 서술형으로 그대로 저장
- 항공편 정보 (출국편/귀국편 코드, 날짜, 시간)
- 짐 정보 (골프백, 유모차, 캐리어 등 수량과 종류)
- 호텔 정보
- 특별 요청사항 (알레르기, 식이제한, 픽업 관련 등)
- 중요 안내사항
- 기타 모든 고객 메모나 요청사항
- 원본 텍스트에서 찾을 수 있는 모든 부가 정보를 자연스러운 문장으로 정리
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
        reservation_number: data.reservation_number || `AI_${Date.now()}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
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
        reservation_number: `FALLBACK_${Date.now()}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`,
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
