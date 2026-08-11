// Canonical expense categories used across SnapSpend.
// Every expense entry (manual or scanned) maps onto exactly one of these.

export const CANONICAL_CATEGORIES = ['Groceries', 'Pharmacy', 'Travel', 'Households', 'Miscellaneous'];

// Maps granular tags (from receipt parsing / legacy data) onto the 5 canonical categories.
const GRANULAR_TO_CANONICAL = {
    // Groceries
    'groceries': 'Groceries',
    'pantry': 'Groceries',
    'beverages': 'Groceries',
    'bakery': 'Groceries',
    'dairy': 'Groceries',
    'produce': 'Groceries',
    'fruits': 'Groceries',
    'vegetables': 'Groceries',
    'meat': 'Groceries',
    'food': 'Groceries',
    'snacks': 'Groceries',
    // Households
    'households': 'Households',
    'household': 'Households',
    'home': 'Households',
    'house': 'Households',
    'furniture': 'Households',
    'furnishings': 'Households',
    'appliances': 'Households',
    'kitchen': 'Households',
    'cleaning': 'Households',
    'detergent': 'Households',
    'utilities': 'Households',
    'garden': 'Households',
    'diy': 'Households',
    // Pharmacy
    'pharmacy': 'Pharmacy',
    'medicine': 'Pharmacy',
    'medication': 'Pharmacy',
    'health': 'Pharmacy',
    'personal care': 'Pharmacy',
    'cosmetics': 'Pharmacy',
    'vitamins': 'Pharmacy',
    'supplements': 'Pharmacy',
    // Travel
    'outings': 'Travel',
    'outing': 'Travel',
    'travel': 'Travel',
    'trips': 'Travel',
    'dining': 'Travel',
    'restaurant': 'Travel',
    'cafe': 'Travel',
    'coffee': 'Travel',
    'entertainment': 'Travel',
    'cinema': 'Travel',
    'tobacco': 'Travel',
    'alcohol': 'Travel',
    'leisure': 'Travel',
    'transport': 'Travel',
    'fuel': 'Travel',
    // Everything else falls through to Miscellaneous
    'miscellaneous': 'Miscellaneous',
    'misc': 'Miscellaneous',
    'general': 'Miscellaneous',
    'other': 'Miscellaneous',
    'electronics': 'Miscellaneous',
    'apparel': 'Miscellaneous',
    'clothing': 'Miscellaneous',
    'shopping': 'Miscellaneous',
    'deposit': 'Miscellaneous',
    'fee': 'Miscellaneous',
    'subscription': 'Miscellaneous',
    'tech': 'Miscellaneous'
};

/**
 * Normalizes any granular category tag into one of the 5 canonical categories.
 * @param {string|null|undefined} granular - e.g. "Pantry", "Beverages", "Tobacco"
 * @returns {string} One of CANONICAL_CATEGORIES
 */
export function mapToCanonical(granular) {
    if (!granular) return 'Miscellaneous';
    const key = String(granular).trim().toLowerCase();
    return GRANULAR_TO_CANONICAL[key] || 'Miscellaneous';
}

/**
 * Legacy category names from the old schema are merged into the canonical set.
 */
export const LEGACY_CATEGORY_MAP = {
    'Travel': 'Travel',
    'Trips / Outings': 'Travel',
    'Outings': 'Travel',
    'Shopping': 'Miscellaneous',
    'Household': 'Households',
    'Tech & Goods': 'Miscellaneous',
    'Miscellaneous': 'Miscellaneous',
    'Groceries': 'Groceries',
    'Pharmacy': 'Pharmacy'
};
