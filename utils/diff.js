/**
 * Deep object comparison and diff utilities
 */

/**
 * Calculate deep diff between two objects
 * @param {Object} oldObj - Original object
 * @param {Object} newObj - New object
 * @returns {Object} - Diff object showing changes
 */
function deepDiff(oldObj, newObj) {
    const diff = {};
    
    // Get all unique keys from both objects
    const allKeys = new Set([
        ...Object.keys(oldObj || {}),
        ...Object.keys(newObj || {})
    ]);

    for (const key of allKeys) {
        const oldValue = oldObj?.[key];
        const newValue = newObj?.[key];

        if (oldValue === undefined && newValue !== undefined) {
            // New key added
            diff[key] = { action: 'added', new: newValue };
        } else if (oldValue !== undefined && newValue === undefined) {
            // Key removed
            diff[key] = { action: 'removed', old: oldValue };
        } else if (!deepEqual(oldValue, newValue)) {
            // Value changed
            if (isObject(oldValue) && isObject(newValue)) {
                // Nested object - recurse
                const nestedDiff = deepDiff(oldValue, newValue);
                if (Object.keys(nestedDiff).length > 0) {
                    diff[key] = { action: 'modified', nested: nestedDiff };
                }
            } else {
                // Simple value change
                diff[key] = { action: 'changed', old: oldValue, new: newValue };
            }
        }
    }

    return diff;
}

/**
 * Check if two values are deeply equal
 * @param {*} a - First value
 * @param {*} b - Second value
 * @returns {boolean} - True if equal
 */
function deepEqual(a, b) {
    if (a === b) return true;
    
    if (a == null || b == null) return a === b;
    
    if (typeof a !== typeof b) return false;
    
    if (typeof a !== 'object') return a === b;
    
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    
    if (Array.isArray(a)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }
        return true;
    }
    
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    
    if (keysA.length !== keysB.length) return false;
    
    for (const key of keysA) {
        if (!keysB.includes(key)) return false;
        if (!deepEqual(a[key], b[key])) return false;
    }
    
    return true;
}

/**
 * Check if value is an object (not array or null)
 * @param {*} obj - Value to check
 * @returns {boolean} - True if object
 */
function isObject(obj) {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}

/**
 * Apply diff to an object (for rollback purposes)
 * @param {Object} obj - Original object
 * @param {Object} diff - Diff to apply
 * @returns {Object} - Object with diff applied
 */
function applyDiff(obj, diff) {
    const result = { ...obj };
    
    for (const [key, change] of Object.entries(diff)) {
        switch (change.action) {
            case 'added':
                delete result[key];
                break;
            case 'removed':
                result[key] = change.old;
                break;
            case 'changed':
                result[key] = change.old;
                break;
            case 'modified':
                if (isObject(result[key])) {
                    result[key] = applyDiff(result[key], change.nested);
                }
                break;
        }
    }
    
    return result;
}

/**
 * Get human-readable summary of changes
 * @param {Object} diff - Diff object
 * @param {string} prefix - Key prefix for nested objects
 * @returns {Array} - Array of change descriptions
 */
function getDiffSummary(diff, prefix = '') {
    const summary = [];
    
    for (const [key, change] of Object.entries(diff)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        switch (change.action) {
            case 'added':
                summary.push(`Added ${fullKey}: ${formatValue(change.new)}`);
                break;
            case 'removed':
                summary.push(`Removed ${fullKey}: ${formatValue(change.old)}`);
                break;
            case 'changed':
                summary.push(`Changed ${fullKey}: ${formatValue(change.old)} → ${formatValue(change.new)}`);
                break;
            case 'modified':
                const nestedSummary = getDiffSummary(change.nested, fullKey);
                summary.push(...nestedSummary);
                break;
        }
    }
    
    return summary;
}

/**
 * Format value for display
 * @param {*} value - Value to format
 * @returns {string} - Formatted value
 */
function formatValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `"${value}"`;
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
}

/**
 * Create a simplified diff for audit logs
 * @param {Object} oldObj - Original object
 * @param {Object} newObj - New object
 * @returns {Object} - Simplified diff
 */
function createAuditDiff(oldObj, newObj) {
    const diff = {};
    const allKeys = new Set([
        ...Object.keys(oldObj || {}),
        ...Object.keys(newObj || {})
    ]);

    for (const key of allKeys) {
        const oldValue = oldObj?.[key];
        const newValue = newObj?.[key];

        if (!deepEqual(oldValue, newValue)) {
            diff[key] = {
                old: oldValue,
                new: newValue
            };
        }
    }

    return diff;
}

/**
 * Check if diff contains significant changes (ignore timestamps, etc.)
 * @param {Object} diff - Diff object
 * @param {Array} ignoreKeys - Keys to ignore
 * @returns {boolean} - True if has significant changes
 */
function hasSignificantChanges(diff, ignoreKeys = ['updated_at', 'lock_version']) {
    const significantKeys = Object.keys(diff).filter(key => !ignoreKeys.includes(key));
    return significantKeys.length > 0;
}

/**
 * Merge multiple diffs into one
 * @param {Array} diffs - Array of diff objects
 * @returns {Object} - Merged diff
 */
function mergeDiffs(diffs) {
    const merged = {};
    
    for (const diff of diffs) {
        for (const [key, change] of Object.entries(diff)) {
            if (merged[key]) {
                // If key already exists, keep the original 'old' value and update 'new' value
                if (change.action === 'changed' && merged[key].action === 'changed') {
                    merged[key] = {
                        action: 'changed',
                        old: merged[key].old,
                        new: change.new
                    };
                } else {
                    // For other cases, last change wins
                    merged[key] = change;
                }
            } else {
                merged[key] = change;
            }
        }
    }
    
    return merged;
}

/**
 * Extract field changes for specific field types
 * @param {Object} diff - Diff object
 * @param {Array} fieldTypes - Field types to extract
 * @returns {Object} - Filtered diff
 */
function extractFieldChanges(diff, fieldTypes = ['core', 'extras']) {
    const extracted = {
        core: {},
        extras: {}
    };

    for (const [key, change] of Object.entries(diff)) {
        if (key.startsWith('extras.')) {
            const extrasKey = key.replace('extras.', '');
            extracted.extras[extrasKey] = change;
        } else {
            extracted.core[key] = change;
        }
    }

    return extracted;
}

module.exports = {
    deepDiff,
    deepEqual,
    applyDiff,
    getDiffSummary,
    createAuditDiff,
    hasSignificantChanges,
    mergeDiffs,
    extractFieldChanges,
    formatValue
};
