// js/categoryMapping.js
// Maps a granular product / item / merchant label ("milk", "jeans", "Zara")
// onto one of the app's canonical broad categories (Groceries, Pharmacy,
// Travel, Households, Miscellaneous) — the same way receipts are classified
// when they are scanned.
//
// Pure module: unit-testable under `node --test` (no I/O, no DOM).

import { mapToCanonical } from './categories.js';
import { classifyExpense } from './classifier.js';

const CANONICAL_CATEGORY_OBJECTS = [
    { id: 'groceries', name: 'Groceries' },
    { id: 'pharmacy', name: 'Pharmacy' },
    { id: 'travel', name: 'Travel' },
    { id: 'households', name: 'Households' },
    { id: 'miscellaneous', name: 'Miscellaneous' },
];

// Labels that mapToCanonical explicitly resolves to Miscellaneous (as opposed
// to returning it as its "unknown" default).
const EXPLICIT_MISCELLANEOUS = new Set(['miscellaneous', 'misc', 'general', 'other', 'uncategorized']);

/**
 * Resolves any label to a canonical category name.
 *
 * Strategy: the granular tag map (categories.js, used by the Dashboard's
 * receipt-split logic) wins when it knows the label — e.g. 'beverages' is
 * Groceries. For labels the granular map does not know (e.g. 'milk', 'jeans',
 * 'Zara'), fall back to the app's own receipt classifier so the answer matches
 * how the app would categorize the purchase.
 *
 * @param {string} label - e.g. "milk", "beverages", "jeans", "shirt", "Zara"
 * @returns {string|null} One of the canonical category names, or null for empty input.
 */
export function resolveCanonicalCategory(label) {
    const term = String(label || '').trim();
    if (!term) return null;
    const key = term.toLowerCase();

    const canonical = mapToCanonical(key);
    if (canonical !== 'Miscellaneous' || EXPLICIT_MISCELLANEOUS.has(key)) {
        return canonical;
    }

    const classification = classifyExpense(
        { merchant: term, note: term, items: [{ name: term }] },
        CANONICAL_CATEGORY_OBJECTS
    );
    return (classification && classification.categoryName) || canonical;
}