/**
 * Custom error classes and error handling utilities
 */

/**
 * Base application error class
 */
class AppError extends Error {
    constructor(message, statusCode = 500, errorCode = null, details = null) {
        super(message);
        this.name = this.constructor.name;
        this.statusCode = statusCode;
        this.errorCode = errorCode;
        this.details = details;
        this.timestamp = new Date().toISOString();
        
        Error.captureStackTrace(this, this.constructor);
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            statusCode: this.statusCode,
            errorCode: this.errorCode,
            details: this.details,
            timestamp: this.timestamp
        };
    }
}

/**
 * Validation error
 */
class ValidationError extends AppError {
    constructor(message, details = null) {
        super(message, 400, 'VALIDATION_ERROR', details);
    }
}

/**
 * Not found error
 */
class NotFoundError extends AppError {
    constructor(resource = 'Resource') {
        super(`${resource} not found`, 404, 'NOT_FOUND');
    }
}

/**
 * Conflict error (duplicate, constraint violation)
 */
class ConflictError extends AppError {
    constructor(message, details = null) {
        super(message, 409, 'CONFLICT', details);
    }
}

/**
 * Authentication error
 */
class AuthenticationError extends AppError {
    constructor(message = 'Authentication required') {
        super(message, 401, 'AUTHENTICATION_ERROR');
    }
}

/**
 * Authorization error
 */
class AuthorizationError extends AppError {
    constructor(message = 'Insufficient permissions') {
        super(message, 403, 'AUTHORIZATION_ERROR');
    }
}

/**
 * Rate limit error
 */
class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded') {
        super(message, 429, 'RATE_LIMIT_EXCEEDED');
    }
}

/**
 * External service error
 */
class ExternalServiceError extends AppError {
    constructor(service, message, originalError = null) {
        super(`${service} service error: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR', {
            service,
            originalError: originalError?.message
        });
    }
}

/**
 * Database error
 */
class DatabaseError extends AppError {
    constructor(message, originalError = null) {
        super(`Database error: ${message}`, 500, 'DATABASE_ERROR', {
            originalError: originalError?.message,
            code: originalError?.code
        });
    }
}

/**
 * Business logic error
 */
class BusinessLogicError extends AppError {
    constructor(message, details = null) {
        super(message, 422, 'BUSINESS_LOGIC_ERROR', details);
    }
}

/**
 * Parse PostgreSQL errors into appropriate error types
 */
function parsePostgreSQLError(error) {
    const { code, constraint, detail } = error;

    switch (code) {
        case '23505': // unique_violation
            return new ConflictError('Duplicate entry', {
                constraint,
                detail,
                field: extractFieldFromConstraint(constraint)
            });
        
        case '23503': // foreign_key_violation
            return new ValidationError('Referenced record does not exist', {
                constraint,
                detail
            });
        
        case '23502': // not_null_violation
            return new ValidationError('Required field is missing', {
                constraint,
                detail
            });
        
        case '23514': // check_violation
            return new ValidationError('Value does not meet constraints', {
                constraint,
                detail
            });
        
        case '42P01': // undefined_table
            return new DatabaseError('Table does not exist', error);
        
        case '42703': // undefined_column
            return new DatabaseError('Column does not exist', error);
        
        default:
            return new DatabaseError(error.message, error);
    }
}

/**
 * Extract field name from PostgreSQL constraint name
 */
function extractFieldFromConstraint(constraint) {
    if (!constraint) return null;
    
    // Common patterns: table_field_key, idx_table_field, etc.
    const patterns = [
        /_([^_]+)_key$/,
        /_([^_]+)_idx$/,
        /idx_[^_]+_([^_]+)$/
    ];
    
    for (const pattern of patterns) {
        const match = constraint.match(pattern);
        if (match) return match[1];
    }
    
    return constraint;
}

/**
 * Express error handler middleware
 */
function errorHandler(err, req, res, next) {
    // Log error
    console.error('❌ Error occurred:', {
        url: req.url,
        method: req.method,
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });

    // Handle different error types
    let error = err;

    // Parse PostgreSQL errors
    if (err.code && typeof err.code === 'string' && err.code.match(/^[0-9A-Z]{5}$/)) {
        error = parsePostgreSQLError(err);
    }

    // Handle non-AppError instances
    if (!(error instanceof AppError)) {
        if (error.name === 'ValidationError') {
            error = new ValidationError(error.message, error.details);
        } else if (error.name === 'CastError') {
            error = new ValidationError('Invalid data format');
        } else {
            error = new AppError(
                process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
                500,
                'INTERNAL_ERROR'
            );
        }
    }

    // Send error response
    const response = {
        success: false,
        message: error.message,
        error_code: error.errorCode,
        timestamp: error.timestamp
    };

    // Add details in development mode
    if (process.env.NODE_ENV === 'development') {
        response.details = error.details;
        response.stack = error.stack;
    }

    res.status(error.statusCode).json(response);
}

/**
 * Async error wrapper for route handlers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}

/**
 * Create error response object
 */
function createErrorResponse(message, statusCode = 500, errorCode = null, details = null) {
    return {
        success: false,
        message,
        error_code: errorCode,
        details: process.env.NODE_ENV === 'development' ? details : undefined,
        timestamp: new Date().toISOString()
    };
}

/**
 * Validate required fields
 */
function validateRequired(data, requiredFields) {
    const missing = [];
    
    for (const field of requiredFields) {
        if (data[field] === undefined || data[field] === null || data[field] === '') {
            missing.push(field);
        }
    }
    
    if (missing.length > 0) {
        throw new ValidationError(`Missing required fields: ${missing.join(', ')}`, {
            missing_fields: missing
        });
    }
}

/**
 * Validate field types
 */
function validateTypes(data, fieldTypes) {
    const errors = [];
    
    for (const [field, expectedType] of Object.entries(fieldTypes)) {
        const value = data[field];
        
        if (value !== undefined && value !== null) {
            const actualType = Array.isArray(value) ? 'array' : typeof value;
            
            if (actualType !== expectedType) {
                errors.push(`${field} must be of type ${expectedType}, got ${actualType}`);
            }
        }
    }
    
    if (errors.length > 0) {
        throw new ValidationError('Type validation failed', {
            type_errors: errors
        });
    }
}

/**
 * Validate enum values
 */
function validateEnum(data, enumFields) {
    const errors = [];
    
    for (const [field, allowedValues] of Object.entries(enumFields)) {
        const value = data[field];
        
        if (value !== undefined && value !== null && !allowedValues.includes(value)) {
            errors.push(`${field} must be one of: ${allowedValues.join(', ')}`);
        }
    }
    
    if (errors.length > 0) {
        throw new ValidationError('Enum validation failed', {
            enum_errors: errors
        });
    }
}

module.exports = {
    AppError,
    ValidationError,
    NotFoundError,
    ConflictError,
    AuthenticationError,
    AuthorizationError,
    RateLimitError,
    ExternalServiceError,
    DatabaseError,
    BusinessLogicError,
    parsePostgreSQLError,
    errorHandler,
    asyncHandler,
    createErrorResponse,
    validateRequired,
    validateTypes,
    validateEnum
};
