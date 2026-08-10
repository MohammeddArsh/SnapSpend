// Utilities for Personal Finance Tracker

/**
 * Formats a numeric value as EUR (€).
 * Example: €1,234.50 or €1,000
 */
export function formatCurrency(amount, currency = 'EUR') {
    const num = parseFloat(amount || 0);
    if (isNaN(num)) return '€0';

    return new Intl.NumberFormat('en-IE', {
        style: 'currency',
        currency: 'EUR',
        maximumFractionDigits: 2,
        minimumFractionDigits: 0
    }).format(num);
}

/**
 * Resolves a human-readable display string for YYYY-MM
 * Input: "2026-05" -> "May 2026"
 */
export function getMonthName(yearMonthString) {
    if (!yearMonthString || yearMonthString.length !== 7) return '';
    const [year, month] = yearMonthString.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * Calculates YYYY-MM string of previous month
 */
export function getPrevMonth(yearMonthString) {
    const [year, month] = yearMonthString.split('-').map(Number);
    const date = new Date(year, month - 1 - 1, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Calculates YYYY-MM string of next month
 */
export function getNextMonth(yearMonthString) {
    const [year, month] = yearMonthString.split('-').map(Number);
    const date = new Date(year, month - 1 + 1, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Safely runs a feedback check to ensure database elements aren't empty
 */
export function validateAmount(amount) {
    const parsed = parseFloat(amount);
    return !isNaN(parsed) && parsed >= 0;
}

/**
 * Escapes characters with HTML entities to protect against XSS injections.
 */
export function escapeHTML(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
