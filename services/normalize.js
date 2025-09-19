/**
 * Data Normalization Service
 * Normalizes and standardizes reservation data
 */

const crypto = require('crypto');

/**
 * Normalize reservation data
 * @param {Object} data - Raw reservation data
 * @returns {Object} - Normalized data
 */
function normalizeReservation(data) {
    const normalized = { ...data };

    // Normalize dates
    if (normalized.usage_date) {
        normalized.usage_date = normalizeDate(normalized.usage_date);
    }
    if (normalized.reservation_datetime) {
        normalized.reservation_datetime = normalizeDateTime(normalized.reservation_datetime);
    }

    // Normalize time
    if (normalized.usage_time) {
        normalized.usage_time = normalizeTime(normalized.usage_time);
    }

    // Normalize numbers
    if (normalized.total_amount) {
        normalized.total_amount = parseFloat(normalized.total_amount);
    }
    if (normalized.adult_unit_price) {
        normalized.adult_unit_price = parseFloat(normalized.adult_unit_price);
    }
    if (normalized.child_unit_price) {
        normalized.child_unit_price = parseFloat(normalized.child_unit_price);
    }

    // Normalize integers
    normalized.guest_count = parseInt(normalized.guest_count) || 1;
    normalized.people_adult = parseInt(normalized.people_adult) || 1;
    normalized.people_child = parseInt(normalized.people_child) || 0;
    normalized.people_infant = parseInt(normalized.people_infant) || 0;
    normalized.quantity = parseInt(normalized.quantity) || 1;

    // Normalize strings
    if (normalized.korean_name) {
        normalized.korean_name = normalized.korean_name.trim();
    }
    if (normalized.english_first_name) {
        normalized.english_first_name = normalizeEnglishName(normalized.english_first_name);
    }
    if (normalized.english_last_name) {
        normalized.english_last_name = normalizeEnglishName(normalized.english_last_name);
    }

    // Normalize email
    if (normalized.email) {
        normalized.email = normalizeEmail(normalized.email);
    }

    // Normalize phone
    if (normalized.phone) {
        normalized.phone = normalizePhone(normalized.phone);
    }

    // Normalize channel and platform
    normalized.channel = normalizeChannel(normalized.channel);
    normalized.platform_name = normalizePlatform(normalized.platform_name);

    // Normalize payment status
    normalized.payment_status = normalizePaymentStatus(normalized.payment_status);

    // Calculate guest count if not provided
    if (!normalized.guest_count || normalized.guest_count < 1) {
        normalized.guest_count = normalized.people_adult + normalized.people_child + normalized.people_infant;
    }

    // Calculate unit prices if total amount is provided
    if (normalized.total_amount && normalized.people_adult > 0) {
        if (!normalized.adult_unit_price) {
            normalized.adult_unit_price = Math.round((normalized.total_amount / normalized.people_adult) * 100) / 100;
        }
        if (!normalized.child_unit_price && normalized.people_child > 0) {
            normalized.child_unit_price = normalized.adult_unit_price; // Default to same as adult
        }
    }

    // Generate reservation number if missing
    if (!normalized.reservation_number) {
        normalized.reservation_number = generateReservationNumber();
    }

    // Set default review status
    if (!normalized.review_status) {
        normalized.review_status = 'needs_review';
    }

    return normalized;
}

/**
 * Normalize date to YYYY-MM-DD format
 * @param {string|Date} dateInput - Date input
 * @returns {string|null} - Normalized date or null
 */
function normalizeDate(dateInput) {
    if (!dateInput) return null;

    try {
        const date = new Date(dateInput);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().split('T')[0]; // YYYY-MM-DD
    } catch (error) {
        return null;
    }
}

/**
 * Normalize datetime to ISO format
 * @param {string|Date} datetimeInput - Datetime input
 * @returns {string|null} - Normalized datetime or null
 */
function normalizeDateTime(datetimeInput) {
    if (!datetimeInput) return null;

    try {
        const date = new Date(datetimeInput);
        if (isNaN(date.getTime())) return null;
        
        return date.toISOString().replace('T', ' ').split('.')[0]; // YYYY-MM-DD HH:MM:SS
    } catch (error) {
        return null;
    }
}

/**
 * Normalize time to HH:MM format
 * @param {string} timeInput - Time input
 * @returns {string|null} - Normalized time or null
 */
function normalizeTime(timeInput) {
    if (!timeInput) return null;

    // Remove any non-digit and non-colon characters
    const cleaned = timeInput.replace(/[^\d:]/g, '');
    
    // Match HH:MM pattern
    const timeMatch = cleaned.match(/^(\d{1,2}):?(\d{2})$/);
    if (timeMatch) {
        const hours = parseInt(timeMatch[1]);
        const minutes = parseInt(timeMatch[2]);
        
        if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
        }
    }

    return null;
}

/**
 * Normalize English name (capitalize first letter)
 * @param {string} name - Name input
 * @returns {string} - Normalized name
 */
function normalizeEnglishName(name) {
    if (!name) return name;
    
    return name.trim()
        .split(' ')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

/**
 * Normalize email address
 * @param {string} email - Email input
 * @returns {string|null} - Normalized email or null
 */
function normalizeEmail(email) {
    if (!email) return null;
    
    const cleaned = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    return emailRegex.test(cleaned) ? cleaned : null;
}

/**
 * Normalize phone number
 * @param {string} phone - Phone input
 * @returns {string|null} - Normalized phone or null
 */
function normalizePhone(phone) {
    if (!phone) return null;
    
    // Remove all non-digit characters except + and -
    const cleaned = phone.replace(/[^\d+\-\s()]/g, '');
    
    return cleaned.length > 0 ? cleaned : null;
}

/**
 * Normalize channel name
 * @param {string} channel - Channel input
 * @returns {string} - Normalized channel
 */
function normalizeChannel(channel) {
    if (!channel) return '웹';
    
    const channelMap = {
        'web': '웹',
        'mobile': '모바일',
        'app': '앱',
        'phone': '전화',
        'email': '이메일',
        'walk-in': '현장',
        'partner': '제휴사'
    };
    
    const normalized = channel.toLowerCase().trim();
    return channelMap[normalized] || channel;
}

/**
 * Normalize platform name
 * @param {string} platform - Platform input
 * @returns {string} - Normalized platform
 */
function normalizePlatform(platform) {
    if (!platform) return 'OTHER';
    
    const platformMap = {
        'nol': 'NOL',
        'klook': 'KLOOK',
        'viator': 'VIATOR',
        'getyourguide': 'GETYOURGUIDE',
        'expedia': 'EXPEDIA',
        'booking.com': 'BOOKING',
        'agoda': 'AGODA',
        'vasco': 'VASCO'
    };
    
    const normalized = platform.toLowerCase().trim();
    return platformMap[normalized] || platform.toUpperCase();
}

/**
 * Normalize payment status
 * @param {string} status - Payment status input
 * @returns {string} - Normalized status
 */
function normalizePaymentStatus(status) {
    if (!status) return 'pending';
    
    const statusMap = {
        'paid': 'confirmed',
        'completed': 'confirmed',
        'success': 'confirmed',
        'confirmed': 'confirmed',
        'pending': 'pending',
        'waiting': 'pending',
        'cancelled': 'cancelled',
        'canceled': 'cancelled',
        'refunded': 'refunded',
        'failed': 'failed',
        'error': 'failed'
    };
    
    const normalized = status.toLowerCase().trim();
    return statusMap[normalized] || status;
}

/**
 * Generate unique reservation number
 * @returns {string} - Generated reservation number
 */
function generateReservationNumber() {
    const timestamp = Date.now().toString().slice(-8);
    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
    return `AUTO_${timestamp}_${random}`;
}

/**
 * Generate origin hash for idempotency
 * @param {string} rawText - Original raw text
 * @returns {string} - SHA-256 hash
 */
function generateOriginHash(rawText) {
    if (!rawText) return null;
    
    return crypto.createHash('sha256')
        .update(rawText.trim())
        .digest('hex');
}

/**
 * Deep merge objects (for extras)
 * @param {Object} target - Target object
 * @param {Object} source - Source object
 * @returns {Object} - Merged object
 */
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    
    return result;
}

/**
 * Normalize extras data based on field definitions
 * @param {Object} extras - Extras data
 * @param {Array} fieldDefs - Field definitions
 * @returns {Object} - Normalized extras
 */
function normalizeExtras(extras, fieldDefs = []) {
    if (!extras || typeof extras !== 'object') return {};
    
    const normalized = {};
    
    for (const fieldDef of fieldDefs) {
        const value = extras[fieldDef.key];
        if (value === undefined || value === null) continue;
        
        switch (fieldDef.type) {
            case 'number':
                const num = parseFloat(value);
                if (!isNaN(num)) normalized[fieldDef.key] = num;
                break;
            case 'boolean':
                normalized[fieldDef.key] = Boolean(value);
                break;
            case 'date':
                const date = normalizeDate(value);
                if (date) normalized[fieldDef.key] = date;
                break;
            case 'time':
                const time = normalizeTime(value);
                if (time) normalized[fieldDef.key] = time;
                break;
            case 'datetime':
                const datetime = normalizeDateTime(value);
                if (datetime) normalized[fieldDef.key] = datetime;
                break;
            case 'email':
                const email = normalizeEmail(value);
                if (email) normalized[fieldDef.key] = email;
                break;
            case 'phone':
                const phone = normalizePhone(value);
                if (phone) normalized[fieldDef.key] = phone;
                break;
            case 'multiselect':
                if (Array.isArray(value)) {
                    normalized[fieldDef.key] = value.filter(v => v && v.trim());
                }
                break;
            default:
                if (typeof value === 'string' && value.trim()) {
                    normalized[fieldDef.key] = value.trim();
                } else if (typeof value !== 'string') {
                    normalized[fieldDef.key] = value;
                }
        }
    }
    
    return normalized;
}

module.exports = {
    normalizeReservation,
    normalizeDate,
    normalizeDateTime,
    normalizeTime,
    normalizeEmail,
    normalizePhone,
    normalizeChannel,
    normalizePlatform,
    normalizePaymentStatus,
    generateReservationNumber,
    generateOriginHash,
    deepMerge,
    normalizeExtras
};
