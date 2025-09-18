const Ajv = require('ajv');
const addFormats = require('ajv-formats');

// Ajv 인스턴스 생성
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// 예약 데이터 스키마 정의
const reservationSchema = {
    type: 'object',
    properties: {
        id: { type: ['integer', 'null'] },
        reservation_number: { type: 'string', minLength: 1 },
        confirmation_number: { type: ['string', 'null'] },
        channel: { type: ['string', 'null'] },
        product_name: { type: ['string', 'null'] },
        total_amount: { type: ['number', 'null'], minimum: 0 },
        package_type: { type: ['string', 'null'] },
        usage_date: { 
            type: ['string', 'null'], 
            pattern: '^\\d{4}-\\d{2}-\\d{2}$'
        },
        usage_time: { 
            type: ['string', 'null'], 
            pattern: '^\\d{2}:\\d{2}$'
        },
        quantity: { type: 'integer', minimum: 1 },
        korean_name: { type: ['string', 'null'] },
        english_first_name: { type: ['string', 'null'] },
        english_last_name: { type: ['string', 'null'] },
        email: { 
            type: ['string', 'null'], 
            format: 'email'
        },
        phone: { type: ['string', 'null'] },
        kakao_id: { type: ['string', 'null'] },
        guest_count: { type: 'integer', minimum: 1 },
        memo: { type: ['string', 'null'] },
        reservation_datetime: { 
            type: ['string', 'null'], 
            pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$'
        },
        created_at: { type: ['string', 'null'] },
        updated_at: { type: ['string', 'null'] },
        issue_code_id: { type: ['integer', 'null'] },
        code_issued: { type: 'boolean' },
        code_issued_at: { 
            type: ['string', 'null'], 
            pattern: '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$'
        },
        platform_name: { type: ['string', 'null'] },
        people_adult: { type: 'integer', minimum: 0 },
        people_child: { type: 'integer', minimum: 0 },
        people_infant: { type: 'integer', minimum: 0 },
        adult_unit_price: { type: ['number', 'null'], minimum: 0 },
        child_unit_price: { type: ['number', 'null'], minimum: 0 },
        payment_status: { 
            type: 'string',
            enum: ['pending', 'confirmed', 'cancelled', 'refunded']
        }
    },
    required: [
        'reservation_number',
        'quantity',
        'guest_count',
        'people_adult',
        'people_child',
        'people_infant',
        'code_issued',
        'payment_status'
    ],
    additionalProperties: false
};

// 스키마 컴파일
const validateReservation = ajv.compile(reservationSchema);

/**
 * 예약 데이터 검증
 * @param {Object} data - 검증할 예약 데이터
 * @returns {Object} - { valid: boolean, errors: array, flags: array }
 */
function validateReservationData(data) {
    const valid = validateReservation(data);
    const errors = validateReservation.errors || [];
    
    // 비즈니스 로직 검증
    const businessErrors = [];
    const flags = [];
    
    // 1. 인원수 일치 검증
    const totalPeople = (data.people_adult || 0) + (data.people_child || 0) + (data.people_infant || 0);
    if (data.guest_count !== totalPeople) {
        businessErrors.push({
            instancePath: '/guest_count',
            message: `총 인원수(${data.guest_count})와 세부 인원수 합계(${totalPeople})가 일치하지 않습니다.`
        });
        flags.push('인원수_불일치');
    }
    
    // 2. 필수 정보 누락 검사
    if (!data.korean_name && !data.english_first_name) {
        flags.push('이름_누락');
    }
    
    if (!data.email && !data.phone) {
        flags.push('연락처_누락');
    }
    
    if (!data.product_name) {
        flags.push('상품명_누락');
    }
    
    if (!data.usage_date) {
        flags.push('이용일_누락');
    }
    
    // 3. 금액 관련 검증
    if (data.total_amount && data.adult_unit_price && data.people_adult > 0) {
        const expectedTotal = data.adult_unit_price * data.people_adult + 
                            (data.child_unit_price || 0) * (data.people_child || 0);
        const diff = Math.abs(data.total_amount - expectedTotal);
        
        if (diff > 1) { // 1달러 이상 차이
            flags.push('금액_불일치');
        }
    }
    
    // 4. 날짜 유효성 검증
    if (data.usage_date) {
        const usageDate = new Date(data.usage_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (usageDate < today) {
            flags.push('과거_이용일');
        }
    }
    
    // 5. 예약번호 형식 검증
    if (data.reservation_number && data.reservation_number.length < 3) {
        flags.push('예약번호_형식_오류');
    }
    
    const allErrors = [...errors, ...businessErrors];
    
    return {
        valid: valid && businessErrors.length === 0,
        errors: allErrors,
        flags: flags,
        summary: {
            total_errors: allErrors.length,
            schema_errors: errors.length,
            business_errors: businessErrors.length,
            flags_count: flags.length
        }
    };
}

/**
 * 드래프트 데이터에서 최종 데이터 병합
 * @param {Object} parsed - 파싱된 데이터
 * @param {Object} normalized - 정규화된 데이터
 * @param {Object} manual - 수동 수정 데이터
 * @returns {Object} - 병합된 최종 데이터
 */
function mergeDraftData(parsed, normalized, manual) {
    // 수동 수정 > 정규화 > 파싱 순서로 우선순위
    const merged = {
        ...parsed,
        ...normalized,
        ...manual
    };
    
    // created_at, updated_at 처리
    if (merged.created_at === 'NOW()') {
        delete merged.created_at; // DB에서 자동 설정
    }
    if (merged.updated_at === 'NOW()') {
        delete merged.updated_at; // DB에서 자동 설정
    }
    
    // null 값 정리
    Object.keys(merged).forEach(key => {
        if (merged[key] === 'null' || merged[key] === '') {
            merged[key] = null;
        }
    });
    
    return merged;
}

module.exports = {
    validateReservationData,
    mergeDraftData
};
