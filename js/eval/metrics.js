// js/eval/metrics.js
// Pure scoring functions that compare ground-truth receipt JSON with model output.
// Mirrors the normalized shape produced by parserEngine.js:
//   { vendor, date, total_amount, purchased_items: [[name, qty, price, currency, category], ...] }

const VENDOR_SUFFIXES = /\b(gmbh|ltd|limited|sarl|s\.l|inc|corp|corporation|co\.|company|store|supermarket|e\.v|kg|ag|sa|llc|group|plc|se)\b/g;

export function normalizeVendor(name) {
    if (!name) return '';
    return String(name)
        .toLowerCase()
        .replace(VENDOR_SUFFIXES, ' ')
        .replace(/[^a-z0-9]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalizes any common date format into YYYY-MM-DD (or null when unparseable).
 */
export function normalizeDate(str) {
    if (!str) return null;
    str = String(str).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    if (/^\d{4}\/\d{2}\/\d{2}$/.test(str)) return str.replace(/\//g, '-');

    const dmy = str.match(/^(\d{1,2})[.\/\-](\d{1,2})[.\/\-](\d{4})$/);
    if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;

    const parsed = new Date(str);
    if (!isNaN(parsed.getTime())) {
        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return null;
}

export function tokenizeName(name) {
    if (!name) return [];
    return String(name)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1);
}

/**
 * Token-F1 between two item names (treats the strings as token sets).
 */
export function nameTokenF1(predicted, actual) {
    const p = new Set(tokenizeName(predicted));
    const a = new Set(tokenizeName(actual));
    if (p.size === 0 && a.size === 0) return 1;
    if (p.size === 0 || a.size === 0) return 0;

    let overlap = 0;
    p.forEach(t => { if (a.has(t)) overlap++; });

    const precision = overlap / p.size;
    const recall = overlap / a.size;
    return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/**
 * Scores one receipt. `truth` and `predicted` follow the parserEngine output shape.
 */
export function scoreReceipt(truth, predicted) {
    const isObject = predicted && typeof predicted === 'object' && !Array.isArray(predicted);
    const valid =
        isObject &&
        typeof predicted.vendor !== 'undefined' &&
        typeof predicted.date !== 'undefined' &&
        typeof predicted.total_amount !== 'undefined' &&
        Array.isArray(predicted.purchased_items);

    if (!isObject) {
        return {
            valid: false, validJson: false,
            vendorExact: false, vendorNorm: false, dateExact: false,
            totalExact: false, totalRelErr: null,
            itemCountMatch: false, itemNameF1: 0, qtyMatch: null, priceRelErr: null, categoryMatch: null,
            itemsCompared: 0, itemCountPred: null, itemCountTruth: null
        };
    }

    const items = (predicted.purchased_items || []).map(it => {
        const [name, qty, price, currency, category] = it;
        return { name, qty, price, currency, category };
    });
    const truthItems = (truth.purchased_items || []).map(it => {
        const [name, qty, price, currency, category] = it;
        return { name, qty, price, currency, category };
    });

    const pairs = Math.min(items.length, truthItems.length);
    let nameF1Sum = 0, qtyMatchCount = 0, priceRelErrSum = 0, catMatchCount = 0, qtyCompared = 0;

    for (let i = 0; i < pairs; i++) {
        const pred = items[i];
        const act = truthItems[i];

        nameF1Sum += nameTokenF1(pred.name, act.name);

        const qtyOk = Number(pred.qty) === Number(act.qty);
        if (qtyOk) qtyMatchCount++;
        if (Number(act.qty) > 0) qtyCompared++;

        const p = Number(pred.price) || 0;
        const a = Number(act.price) || 0;
        if (a > 0) {
            priceRelErrSum += Math.abs(p - a) / a;
        }

        if (String(pred.category).toLowerCase() === String(act.category).toLowerCase()) catMatchCount++;
    }

    const truthTotal = Number(truth.total_amount) || 0;
    const predTotal = Number(predicted.total_amount) || 0;

    return {
        valid,
        validJson: true,
        vendorExact: String(predicted.vendor || '').trim().toLowerCase() === String(truth.vendor || '').trim().toLowerCase(),
        vendorNorm: normalizeVendor(predicted.vendor) === normalizeVendor(truth.vendor),
        dateExact: (() => {
            const a = normalizeDate(predicted.date);
            const b = normalizeDate(truth.date);
            return !!(a && b && a === b);
        })(),
        totalExact: Math.abs(predTotal - truthTotal) < 0.005,
        totalRelErr: truthTotal > 0 ? Math.abs(predTotal - truthTotal) / truthTotal : null,
        itemCountMatch: items.length === truthItems.length,
        itemNameF1: pairs > 0 ? nameF1Sum / pairs : (items.length === 0 && truthItems.length === 0 ? 1 : 0),
        qtyMatch: qtyCompared > 0 ? qtyMatchCount / qtyCompared : null,
        priceRelErr: pairs > 0 ? priceRelErrSum / pairs : null,
        categoryMatch: pairs > 0 ? catMatchCount / pairs : null,
        itemsCompared: pairs,
        itemCountPred: items.length,
        itemCountTruth: truthItems.length
    };
}

/**
 * Averages per-receipt scores into a summary row for one (model × prompt) combination.
 */
export function summarizeScores(scoreList) {
    const n = scoreList.length;
    if (n === 0) return null;

    const avg = (fn, fallback = null) => {
        const vals = scoreList.map(fn).filter(v => v !== null && v !== undefined);
        if (vals.length === 0) return fallback;
        return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const pct = (v) => (v === null ? null : v * 100);

    return {
        receipts: n,
        validRate: pct(avg(s => (s.valid ? 1 : 0))),
        vendorExactRate: pct(avg(s => (s.vendorExact ? 1 : 0))),
        vendorNormRate: pct(avg(s => (s.vendorNorm ? 1 : 0))),
        dateExactRate: pct(avg(s => (s.dateExact ? 1 : 0))),
        totalExactRate: pct(avg(s => (s.totalExact ? 1 : 0))),
        totalRelErrAvg: avg(s => s.totalRelErr),
        itemCountMatchRate: pct(avg(s => (s.itemCountMatch ? 1 : 0))),
        itemNameF1Avg: avg(s => s.itemNameF1),
        qtyMatchRate: pct(avg(s => s.qtyMatch)),
        priceRelErrAvg: avg(s => s.priceRelErr),
        categoryMatchRate: pct(avg(s => s.categoryMatch)),
        overallScore: null // computed later as weighted blend
    };
}

/**
 * Single 0-100 quality number for ranking (model, prompt) combinations.
 */
export function overallScore(summary) {
    if (!summary) return 0;
    return (
        (summary.validRate || 0) * 0.15 +
        (summary.vendorNormRate || 0) * 0.15 +
        (summary.dateExactRate || 0) * 0.2 +
        (summary.totalExactRate || 0) * 0.2 +
        (summary.itemNameF1Avg || 0) * 100 * 0.15 +
        (summary.categoryMatchRate || 0) * 0.15
    );
}
