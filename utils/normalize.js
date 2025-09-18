/**
 * 파싱된 데이터 정규화 모듈
 * 숫자/날짜 포맷 표준화, 채널/플랫폼 이름 매핑, 단가 계산 등
 */

/**
 * 파싱된 데이터를 정규화
 * @param {Object} parsed - OpenAI에서 파싱된 원본 데이터
 * @returns {Object} - 정규화된 데이터
 */
function normalizeParsed(parsed) {
    const normalized = { ...parsed };
    
    // 1. 채널/플랫폼 이름 매핑
    normalized.channel = normalizeChannel(parsed.channel);
    normalized.platform_name = normalizePlatform(parsed.platform_name);
    
    // 2. 숫자 필드 정규화
    normalized.total_amount = normalizeAmount(parsed.total_amount);
    normalized.quantity = normalizeInteger(parsed.quantity, 1);
    normalized.guest_count = normalizeInteger(parsed.guest_count, 1);
    normalized.people_adult = normalizeInteger(parsed.people_adult, 1);
    normalized.people_child = normalizeInteger(parsed.people_child, 0);
    normalized.people_infant = normalizeInteger(parsed.people_infant, 0);
    normalized.adult_unit_price = normalizeAmount(parsed.adult_unit_price);
    normalized.child_unit_price = normalizeAmount(parsed.child_unit_price);
    
    // 3. 날짜/시간 정규화
    normalized.usage_date = normalizeDate(parsed.usage_date);
    normalized.usage_time = normalizeTime(parsed.usage_time);
    normalized.reservation_datetime = normalizeDateTime(parsed.reservation_datetime);
    normalized.code_issued_at = normalizeDateTime(parsed.code_issued_at);
    
    // 4. 문자열 필드 정리
    normalized.phone = normalizePhone(parsed.phone);
    normalized.email = normalizeEmail(parsed.email);
    normalized.payment_status = normalizePaymentStatus(parsed.payment_status);
    
    // 5. 예약번호 생성 (없는 경우)
    if (!normalized.reservation_number) {
        normalized.reservation_number = generateReservationNumber();
    }
    
    // 6. 총 인원수 재계산
    normalized.guest_count = normalized.people_adult + normalized.people_child + normalized.people_infant;
    
    // 7. 단가 자동 계산
    if (normalized.total_amount && normalized.people_adult > 0 && !normalized.adult_unit_price) {
        normalized.adult_unit_price = Math.round(normalized.total_amount / normalized.people_adult * 100) / 100;
    }
    
    if (normalized.total_amount && normalized.people_child > 0 && !normalized.child_unit_price) {
        normalized.child_unit_price = normalized.adult_unit_price || Math.round(normalized.total_amount / normalized.guest_count * 100) / 100;
    }
    
    // 8. Boolean 필드 정규화
    normalized.code_issued = normalizeBoolean(parsed.code_issued);
    
    return normalized;
}

/**
 * 채널명 정규화
 */
function normalizeChannel(channel) {
    if (!channel) return '웹';
    
    const channelMap = {
        'nol': 'NOL',
        'nol 인터파크': 'NOL 인터파크',
        'interpark': 'NOL 인터파크',
        'klook': 'KLOOK',
        'viator': 'VIATOR',
        'getyourguide': 'GetYourGuide',
        'expedia': 'EXPEDIA',
        '웹': '웹',
        'web': '웹'
    };
    
    const normalized = channelMap[channel.toLowerCase()] || channel;
    return normalized;
}

/**
 * 플랫폼명 정규화
 */
function normalizePlatform(platform) {
    if (!platform) return 'NOL';
    
    const platformMap = {
        'nol': 'NOL',
        'vasco': 'VASCO',
        'klook': 'KLOOK',
        'viator': 'VIATOR',
        'getyourguide': 'GETYOURGUIDE',
        'expedia': 'EXPEDIA',
        'other': 'OTHER'
    };
    
    return platformMap[platform.toLowerCase()] || platform.toUpperCase();
}

/**
 * 금액 정규화
 */
function normalizeAmount(amount) {
    if (!amount) return null;
    
    const parsed = parseFloat(amount);
    return isNaN(parsed) ? null : Math.round(parsed * 100) / 100;
}

/**
 * 정수 정규화
 */
function normalizeInteger(value, defaultValue = 0) {
    if (!value) return defaultValue;
    
    const parsed = parseInt(value);
    return isNaN(parsed) ? defaultValue : Math.max(0, parsed);
}

/**
 * 날짜 정규화 (YYYY-MM-DD)
 */
function normalizeDate(dateStr) {
    if (!dateStr) return null;
    
    try {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().split('T')[0];
    } catch (error) {
        return null;
    }
}

/**
 * 시간 정규화 (HH:MM)
 */
function normalizeTime(timeStr) {
    if (!timeStr) return null;
    
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):([0-5][0-9])$/;
    if (timeRegex.test(timeStr)) {
        return timeStr;
    }
    
    // 다양한 시간 형식 처리
    const timePatterns = [
        /(\d{1,2}):(\d{2})/,
        /(\d{1,2})시\s*(\d{2})분?/,
        /(\d{1,2}):\s*(\d{2})/
    ];
    
    for (const pattern of timePatterns) {
        const match = timeStr.match(pattern);
        if (match) {
            const hours = parseInt(match[1]);
            const minutes = parseInt(match[2]);
            
            if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
        }
    }
    
    return null;
}

/**
 * 날짜시간 정규화
 */
function normalizeDateTime(datetimeStr) {
    if (!datetimeStr) return null;
    
    try {
        const date = new Date(datetimeStr);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().replace('T', ' ').split('.')[0];
    } catch (error) {
        return null;
    }
}

/**
 * 전화번호 정규화
 */
function normalizePhone(phone) {
    if (!phone) return null;
    
    // 숫자, +, -, 공백만 남기고 제거
    let cleaned = phone.replace(/[^\d\+\-\s]/g, '');
    
    // 한국 전화번호 패턴 정리
    if (cleaned.startsWith('+82')) {
        cleaned = '0' + cleaned.substring(3);
    }
    
    // 하이픈 추가 (010-1234-5678 형식)
    if (/^010\d{8}$/.test(cleaned.replace(/[\s\-]/g, ''))) {
        const digits = cleaned.replace(/[\s\-]/g, '');
        cleaned = `${digits.substring(0, 3)}-${digits.substring(3, 7)}-${digits.substring(7)}`;
    }
    
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * 이메일 정규화
 */
function normalizeEmail(email) {
    if (!email) return null;
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const trimmed = email.trim().toLowerCase();
    
    return emailRegex.test(trimmed) ? trimmed : null;
}

/**
 * 결제상태 정규화
 */
function normalizePaymentStatus(status) {
    if (!status) return 'pending';
    
    const statusMap = {
        'confirmed': 'confirmed',
        'pending': 'pending',
        'cancelled': 'cancelled',
        'refunded': 'refunded',
        '확정': 'confirmed',
        '대기': 'pending',
        '취소': 'cancelled',
        '환불': 'refunded',
        '예약확정': 'confirmed',
        '예약대기': 'pending'
    };
    
    return statusMap[status.toLowerCase()] || 'pending';
}

/**
 * Boolean 값 정규화
 */
function normalizeBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lower = value.toLowerCase();
        return lower === 'true' || lower === 'yes' || lower === '1' || lower === 'y';
    }
    return Boolean(value);
}

/**
 * 예약번호 생성
 */
function generateReservationNumber() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `AUTO_${timestamp}_${random}`;
}

module.exports = {
    normalizeReservationData: normalizeParsed,
    normalizeParsed
};
