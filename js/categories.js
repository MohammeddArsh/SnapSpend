// Canonical expense categories used across SnapSpend.
// Every expense entry (manual or scanned) maps onto exactly one of these.

export const CANONICAL_CATEGORIES = ['Groceries', 'Pharmacy', 'Travel', 'Households', 'Miscellaneous'];

// Single source of truth for category colors across the whole app.
// Pick a hue for each canonical category that is clearly distinct from the
// others and from the purple/indigo brand gradient.
export const CATEGORY_COLORS = {
    'Groceries': '#10b981',      // emerald
    'Pharmacy': '#0ea5e9',       // sky
    'Travel': '#8b5cf6',         // violet
    'Households': '#f59e0b',     // amber
    'Miscellaneous': '#64748b'   // slate
};

// Curated palette for user-created (custom) categories. Distinct 500-level
// hues, deliberately avoiding the purple/indigo range used by the brand.
export const CUSTOM_CATEGORY_PALETTE = [
    '#ef4444', // red
    '#06b6d4', // cyan
    '#84cc16', // lime
    '#f97316', // orange
    '#ec4899', // pink
    '#14b8a6', // teal
    '#eab308', // yellow
    '#3b82f6', // blue
    '#f43f5e', // rose
    '#22d3ee', // sky bright
    '#a3e635', // lime bright
    '#fb923c'  // orange bright
];

// Stable string hash so a custom category always resolves to the same color,
// no matter which view renders it.
function stableColorIndex(name) {
    let hash = 0;
    const str = String(name || '').toLowerCase();
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash % CUSTOM_CATEGORY_PALETTE.length;
}

/**
 * Resolves the display color for any category name.
 * Canonical categories use hand-picked hues; custom categories get a stable
 * color from the extended palette. Unknown/empty names fall back to slate.
 * @param {string|null|undefined} name
 * @returns {string} Hex color
 */
export function getCategoryColor(name) {
    if (!name) return CATEGORY_COLORS['Miscellaneous'];
    const key = String(name).trim().toLowerCase();
    if (key === 'general' || key === 'uncategorized') return CATEGORY_COLORS['Miscellaneous'];
    for (const canonical of CANONICAL_CATEGORIES) {
        if (canonical.toLowerCase() === key) return CATEGORY_COLORS[canonical];
    }
    return CUSTOM_CATEGORY_PALETTE[stableColorIndex(name)];
}

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
