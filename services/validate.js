/**
 * Validation Service using Ajv for schema validation
 * Supports both core fields and dynamic field validation
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ 
    allErrors: true, 
    removeAdditional: true,
    coerceTypes: true 
});
addFormats(ajv);

// Core reservation schema
const coreReservationSchema = {
    type: 'object',
    properties: {
        reservation_number: { type: ['string', 'null'], maxLength: 100 },
        confirmation_number: { type: ['string', 'null'], maxLength: 100 },
        channel: { type: ['string', 'null'], maxLength: 50 },
        platform_name: { type: ['string', 'null'], maxLength: 50 },
        product_name: { type: ['string', 'null'], maxLength: 255 },
        package_type: { type: ['string', 'null'], maxLength: 100 },
        total_amount: { type: ['number', 'null'], minimum: 0 },
        quantity: { type: ['integer', 'null'], minimum: 1 },
        guest_count: { type: ['integer', 'null'], minimum: 1 },
        korean_name: { type: ['string', 'null'], maxLength: 100 },
        english_first_name: { type: ['string', 'null'], maxLength: 50 },
        english_last_name: { type: ['string', 'null'], maxLength: 50 },
        email: { type: ['string', 'null'], format: 'email', maxLength: 255 },
        phone: { type: ['string', 'null'], maxLength: 50 },
        kakao_id: { type: ['string', 'null'], maxLength: 100 },
        people_adult: { type: ['integer', 'null'], minimum: 0 },
        people_child: { type: ['integer', 'null'], minimum: 0 },
        people_infant: { type: ['integer', 'null'], minimum: 0 },
        adult_unit_price: { type: ['number', 'null'], minimum: 0 },
        child_unit_price: { type: ['number', 'null'], minimum: 0 },
        usage_date: { type: ['string', 'null'], format: 'date' },
        usage_time: { type: ['string', 'null'], pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' },
        reservation_datetime: { type: ['string', 'null'], format: 'date-time' },
        payment_status: { 
            type: ['string', 'null'], 
            enum: ['pending', 'confirmed', 'cancelled', 'refunded', 'failed', null] 
        },
        review_status: {
            type: ['string', 'null'],
            enum: ['pending', 'needs_review', 'reviewed', 'confirmed', 'cancelled', null]
        },
        memo: { type: ['string', 'null'], maxLength: 1000 }
    },
    additionalProperties: false
};

const coreValidator = ajv.compile(coreReservationSchema);

/**
 * Validate core reservation fields
 * @param {Object} data - Reservation data
 * @returns {Object} - { valid: boolean, errors: array, data: object }
 */
function validateCore(data) {
    const valid = coreValidator(data);
    return {
        valid,
        errors: coreValidator.errors || [],
        data: valid ? data : null
    };
}

/**
 * Create dynamic validator from field definitions
 * @param {Array} fieldDefs - Field definitions from database
 * @returns {Function} - Validator function
 */
function createDynamicValidator(fieldDefs) {
    const schema = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true
    };

    for (const field of fieldDefs) {
        const prop = { type: ['string', 'null'] };

        switch (field.type) {
            case 'number':
                prop.type = ['number', 'null'];
                break;
            case 'boolean':
                prop.type = ['boolean', 'null'];
                break;
            case 'date':
                prop.format = 'date';
                break;
            case 'time':
                prop.pattern = '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$';
                break;
            case 'datetime':
                prop.format = 'date-time';
                break;
            case 'email':
                prop.format = 'email';
                break;
            case 'phone':
                prop.pattern = '^[+]?[0-9\\s\\-\\(\\)]+$';
                break;
            case 'select':
            case 'multiselect':
                if (field.options && field.options.options) {
                    if (field.type === 'multiselect') {
                        prop.type = ['array', 'null'];
                        prop.items = { enum: field.options.options };
                    } else {
                        prop.enum = [...field.options.options, null];
                    }
                }
                break;
        }

        if (field.pattern) {
            prop.pattern = field.pattern;
        }

        schema.properties[field.key] = prop;

        if (field.required) {
            schema.required.push(field.key);
        }
    }

    return ajv.compile(schema);
}

/**
 * Validate extras fields using field definitions
 * @param {Object} extras - Extras data
 * @param {Array} fieldDefs - Field definitions
 * @returns {Object} - { valid: boolean, errors: array, data: object }
 */
function validateExtras(extras, fieldDefs) {
    if (!fieldDefs || fieldDefs.length === 0) {
        return { valid: true, errors: [], data: extras };
    }

    const validator = createDynamicValidator(fieldDefs);
    const valid = validator(extras);

    return {
        valid,
        errors: validator.errors || [],
        data: valid ? extras : null
    };
}

/**
 * Validate complete reservation (core + extras)
 * @param {Object} data - Complete reservation data
 * @param {Array} fieldDefs - Field definitions for extras
 * @returns {Object} - { valid: boolean, errors: array, coreData: object, extrasData: object }
 */
function validateReservation(data, fieldDefs = []) {
    const { extras, ...coreData } = data;

    const coreResult = validateCore(coreData);
    const extrasResult = validateExtras(extras || {}, fieldDefs);

    return {
        valid: coreResult.valid && extrasResult.valid,
        errors: [...coreResult.errors, ...extrasResult.errors],
        coreData: coreResult.data,
        extrasData: extrasResult.data
    };
}

/**
 * Check for missing required fields and return flags
 * @param {Object} data - Reservation data
 * @param {Array} fieldDefs - Field definitions
 * @returns {Object} - { missing: array, ambiguous: array }
 */
function checkDataQuality(data, fieldDefs = []) {
    const flags = { missing: [], ambiguous: [] };

    // Check core required fields
    const coreRequired = ['product_name', 'korean_name'];
    for (const field of coreRequired) {
        if (!data[field] || data[field].toString().trim() === '') {
            flags.missing.push(field);
        }
    }

    // Check dynamic required fields
    for (const fieldDef of fieldDefs) {
        if (fieldDef.required && fieldDef.is_active) {
            const value = data.extras?.[fieldDef.key];
            if (!value || value.toString().trim() === '') {
                flags.missing.push(`extras.${fieldDef.key}`);
            }
        }
    }

    // Check for ambiguous data (contains placeholder text, etc.)
    const ambiguousPatterns = [
        /^(tbd|tba|pending|unknown|n\/a|na|null|undefined)$/i,
        /^[?]+$/,
        /^-+$/,
        /^\.+$/
    ];

    const checkAmbiguous = (value, fieldName) => {
        if (typeof value === 'string') {
            for (const pattern of ambiguousPatterns) {
                if (pattern.test(value.trim())) {
                    flags.ambiguous.push(fieldName);
                    break;
                }
            }
        }
    };

    // Check core fields for ambiguous data
    Object.keys(data).forEach(key => {
        if (key !== 'extras' && data[key]) {
            checkAmbiguous(data[key], key);
        }
    });

    // Check extras fields for ambiguous data
    if (data.extras) {
        Object.keys(data.extras).forEach(key => {
            checkAmbiguous(data.extras[key], `extras.${key}`);
        });
    }

    return flags;
}

/**
 * Format validation errors for user display
 * @param {Array} errors - Ajv validation errors
 * @returns {Array} - Formatted error messages
 */
function formatErrors(errors) {
    return errors.map(error => {
        const field = error.instancePath.replace(/^\//, '') || error.params?.missingProperty || 'data';
        
        switch (error.keyword) {
            case 'required':
                return `${field} is required`;
            case 'format':
                return `${field} must be a valid ${error.params.format}`;
            case 'pattern':
                return `${field} format is invalid`;
            case 'enum':
                return `${field} must be one of: ${error.params.allowedValues.join(', ')}`;
            case 'type':
                return `${field} must be of type ${error.params.type}`;
            case 'minimum':
                return `${field} must be at least ${error.params.limit}`;
            case 'maximum':
                return `${field} must be at most ${error.params.limit}`;
            case 'maxLength':
                return `${field} must be at most ${error.params.limit} characters`;
            default:
                return `${field}: ${error.message}`;
        }
    });
}

module.exports = {
    validateCore,
    validateExtras,
    validateReservation,
    checkDataQuality,
    formatErrors,
    createDynamicValidator
};
