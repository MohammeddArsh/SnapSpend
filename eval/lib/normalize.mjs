// eval/lib/normalize.mjs
// Mirrors parserEngine.normalizeParsedOutput: coerces raw model output into
// the canonical receipt JSON shape used by the ground-truth data and the
// metrics module. Item categories are mapped via the app's canonical map.

import { mapToCanonical } from '../../js/categories.js';

/**
 * Extracts a JSON object from model text, tolerating code fences and stray text.
 */
export function extractJSON(text) {
    const trimmed = String(text).trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : trimmed;

    try {
        return JSON.parse(candidate);
    } catch (e) {
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start !== -1 && end > start) {
            const slice = candidate.slice(start, end + 1);
            try {
                return JSON.parse(slice);
            } catch (e2) {
                /* fall through */
            }
        }
        throw new Error(`Model output was not valid JSON: ${candidate.slice(0, 300)}`);
    }
}

const toNum = (v, fallback = 0) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
};

/**
 * Normalizes parsed model output into the canonical shape:
 * { vendor, date, total_amount, purchased_items: [[name, qty, price, currency, category], ...] }
 */
export function normalizeParsedOutput(parsedData) {
    const formattedItems = (parsedData.purchased_items || []).map((item) => [
        item.name || "Unknown Item",
        toNum(item.quantity, 1) > 0 ? toNum(item.quantity, 1) : 1,
        toNum(item.price, 0),
        item.currency || "EUR",
        mapToCanonical(item.category),
    ]);

    return {
        vendor: parsedData.vendor || "Unknown",
        date: parsedData.date || "",
        total_amount: toNum(parsedData.total_amount, 0),
        purchased_items: formattedItems,
    };
}