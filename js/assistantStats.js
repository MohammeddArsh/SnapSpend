// js/assistantStats.js
// Pure, deterministic financial aggregation used by the AI assistant.
//
// Every function here is a pure calculation over the same raw row shapes the
// rest of the app fetches (see dashboard.js / reports.js), so the assistant's
// numbers ALWAYS match what the user sees on screen:
//   - expense row : { amount, month, date, merchant,
//                     expense_categories: { name } | null,
//                     expense_receipt_items: [{ category, price }] | [] }
//   - income  row : { amount, month, date_credited,
//                     income_sources: { name } | null }
//
// No I/O, no globals, no DOM — unit-testable under `node --test` like
// classifier.js.

import { mapToCanonical } from './categories.js';

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Counts expense items per category exactly like the Expenses page's category
 * counters: every receipt line-item counts as one item under its stored
 * category, and every manual entry counts as one item under its parent
 * category. Items tagged 'general'/'other' fall back to the parent category,
 * mirroring flattenExpenseEntries in expenses.js.
 */
export function countExpenseItems(expenseRows) {
    const counts = {};
    for (const item of expenseRows || []) {
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach((ri) => {
                const raw = String(ri.category || '').trim();
                const cat = raw && !['general', 'other'].includes(raw.toLowerCase())
                    ? raw
                    : (item.expense_categories?.name || 'Uncategorized');
                counts[cat] = (counts[cat] || 0) + 1;
            });
        } else {
            const cat = item.expense_categories?.name || 'Uncategorized';
            counts[cat] = (counts[cat] || 0) + 1;
        }
    }
    return counts;
}

/**
 * Per-entry category spending using the same rule as the Dashboard pie chart:
 * scanned receipts are split across their line-item categories; manual entries
 * fall back to the parent category amount.
 */
export function categoryTotalsForExpenses(expenseRows) {
    const totals = {};
    (expenseRows || []).forEach((item) => {
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach((ri) => {
                const catName = mapToCanonical(ri.category || 'Miscellaneous');
                totals[catName] = (totals[catName] || 0) + (parseFloat(ri.price) || 0);
            });
        } else {
            const catName = mapToCanonical(item.expense_categories?.name || 'Miscellaneous');
            totals[catName] = (totals[catName] || 0) + parseFloat(item.amount);
        }
    });
    return totals;
}

/**
 * One month's snapshot: income, expenses, savings, savings rate and
 * per-category totals. Mirrors the Dashboard Net Savings card + pie chart.
 */
export function buildMonthlySummary(incomeRows, expenseRows) {
    const income = (incomeRows || []).reduce((sum, r) => sum + num(r.amount), 0);
    const categoryTotals = categoryTotalsForExpenses(expenseRows);
    const expenses = Object.values(categoryTotals).reduce((a, b) => a + b, 0);
    const savings = income - expenses;
    const savingsRate = income > 0 ? (savings / income) * 100 : 0;

    const cleanTotals = {};
    for (const [name, amount] of Object.entries(categoryTotals)) {
        cleanTotals[name] = round2(amount);
    }

    return {
        income: round2(income),
        expenses: round2(expenses),
        savings: round2(savings),
        savingsRate: round2(savingsRate),
        categoryTotals: cleanTotals,
    };
}

/**
 * Percentage change between two values (null when previous is zero).
 * Uses |previous| so a negative base (negative savings) still gives a sensible
 * signed delta — same convention as the Reports MoM matrix.
 */
export function percentChange(current, previous) {
    const p = num(previous);
    if (p === 0) return null;
    return round2(((num(current) - p) / Math.abs(p)) * 100);
}

/**
 * Side-by-side comparison of two monthly summaries with absolute + % deltas,
 * plus per-category deltas. Matches the Reports "MoM Comparison Matrix".
 */
export function compareMonthSnapshots(current, previous) {
    const metric = (cur, prev) => {
        const abs = round2(num(cur) - num(prev));
        return {
            current: round2(num(cur)),
            previous: round2(num(prev)),
            absolute: abs,
            percent: percentChange(cur, prev),
        };
    };

    const cur = buildMonthlySummary(current.incomeRows || [], current.expenseRows || []);
    const prev = buildMonthlySummary(previous.incomeRows || [], previous.expenseRows || []);

    const allCategories = new Set([
        ...Object.keys(cur.categoryTotals),
        ...Object.keys(prev.categoryTotals),
    ]);
    const categoryDeltas = {};
    for (const name of allCategories) {
        const c = cur.categoryTotals[name] || 0;
        const p = prev.categoryTotals[name] || 0;
        categoryDeltas[name] = {
            current: round2(c),
            previous: round2(p),
            absolute: round2(c - p),
            percent: percentChange(c, p),
        };
    }

    return {
        current: {
            month: current.month,
            income: cur.income,
            expenses: cur.expenses,
            savings: cur.savings,
            savingsRate: cur.savingsRate,
        },
        previous: {
            month: previous.month,
            income: prev.income,
            expenses: prev.expenses,
            savings: prev.savings,
            savingsRate: prev.savingsRate,
        },
        deltas: {
            income: metric(cur.income, prev.income),
            expenses: metric(cur.expenses, prev.expenses),
            savings: metric(cur.savings, prev.savings),
            savingsRate: metric(cur.savingsRate, prev.savingsRate),
        },
        categoryDeltas,
    };
}

function groupByMonth(rows, monthField) {
    const grouped = {};
    for (const r of rows || []) {
        const m = r[monthField] || String(r.date || r.date_credited || '').slice(0, 7);
        if (!m || !/^\d{4}-\d{2}$/.test(m)) continue;
        (grouped[m] = grouped[m] || []).push(r);
    }
    return grouped;
}

/**
 * Yearly rollup: per-month series, annual totals, annual category totals and
 * the highest/lowest spending months of the year.
 */
export function buildYearlyStats(year, incomeRows, expenseRows) {
    const incomeByMonth = groupByMonth(incomeRows, 'month');
    const expenseByMonth = groupByMonth(expenseRows, 'month');

    const monthKeys = Array.from(
        new Set([...Object.keys(incomeByMonth), ...Object.keys(expenseByMonth)])
    ).sort();

    const months = monthKeys.map((m) => {
        const s = buildMonthlySummary(incomeByMonth[m] || [], expenseByMonth[m] || []);
        return { month: m, income: s.income, expenses: s.expenses, savings: s.savings, savingsRate: s.savingsRate };
    });

    const income = months.reduce((sum, m) => sum + m.income, 0);
    const expenses = months.reduce((sum, m) => sum + m.expenses, 0);
    const savings = income - expenses;
    const savingsRate = income > 0 ? (savings / income) * 100 : 0;

    const withSpend = months.filter((m) => m.expenses > 0);
    const highestSpendMonth = withSpend.length ? withSpend.reduce((a, b) => (b.expenses > a.expenses ? b : a)) : null;
    const lowestSpendMonth = withSpend.length ? withSpend.reduce((a, b) => (b.expenses < a.expenses ? b : a)) : null;

    return {
        year,
        months,
        income: round2(income),
        expenses: round2(expenses),
        savings: round2(savings),
        savingsRate: round2(savingsRate),
        categoryTotals: categoryTotalsForExpenses(expenseRows),
        highestSpendMonth: highestSpendMonth ? { month: highestSpendMonth.month, amount: highestSpendMonth.expenses } : null,
        lowestSpendMonth: lowestSpendMonth ? { month: lowestSpendMonth.month, amount: lowestSpendMonth.expenses } : null,
    };
}

/**
 * Per-category monthly series across a period (for "which months did I spend
 * most on X" questions). Sorted newest-first within each category.
 */
export function categoryTrends(expenseRows) {
    const byCategory = {};
    for (const item of expenseRows || []) {
        const month = item.month || String(item.date || '').slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month)) continue;
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach((ri) => {
                const cat = mapToCanonical(ri.category || 'Miscellaneous');
                (byCategory[cat] = byCategory[cat] || {})[month] = (byCategory[cat][month] || 0) + (parseFloat(ri.price) || 0);
            });
        } else {
            const cat = mapToCanonical(item.expense_categories?.name || 'Miscellaneous');
            (byCategory[cat] = byCategory[cat] || {})[month] = (byCategory[cat][month] || 0) + parseFloat(item.amount);
        }
    }

    return Object.entries(byCategory)
        .map(([category, byMonth]) => ({
            category,
            total: round2(Object.values(byMonth).reduce((a, b) => a + b, 0)),
            months: Object.entries(byMonth)
                .map(([month, amount]) => ({ month, amount: round2(amount) }))
                .sort((a, b) => (a.month < b.month ? 1 : -1)),
        }))
        .sort((a, b) => b.total - a.total);
}

/**
 * Deterministic aggregation for generic expense queries (query_expenses tool
 * groupBy). For category grouping the receipt-split rule applies (an entry can
 * contribute to several categories); month/merchant use the parent amount.
 *
 * @param {Array} expenseRows
 * @param {string} by - 'month' | 'category' | 'merchant' | 'month+category'
 * @returns {Array<{month?: string, category?: string, merchant?: string, amount: number}>}
 */
export function aggregateExpenses(expenseRows, by) {
    const rows = expenseRows || [];
    const out = [];

    if (by === 'category') {
        const totals = categoryTotalsForExpenses(rows);
        return Object.entries(totals)
            .map(([category, amount]) => ({ category, amount: round2(amount) }))
            .sort((a, b) => b.amount - a.amount);
    }

    if (by === 'merchant') {
        const totals = {};
        rows.forEach((r) => {
            const merchant = String(r.merchant || 'Unassigned').trim() || 'Unassigned';
            totals[merchant] = (totals[merchant] || 0) + num(r.amount);
        });
        return Object.entries(totals)
            .map(([merchant, amount]) => ({ merchant, amount: round2(amount) }))
            .sort((a, b) => b.amount - a.amount);
    }

    if (by === 'month' || by === 'month+category' || by === 'month+merchant') {
        const map = {};
        rows.forEach((r) => {
            const month = r.month || String(r.date || '').slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(month)) return;
            const category = by === 'month+category'
                ? mapToCanonical(r.expense_categories?.name || 'Miscellaneous')
                : null;
            const merchant = by === 'month+merchant'
                ? String(r.merchant || 'Unassigned').trim() || 'Unassigned'
                : null;
            const key = by === 'month'
                ? month
                : `${month}__${category || merchant}`;
            map[key] = map[key] || { month, amount: 0 };
            if (category) map[key].category = category;
            if (merchant) map[key].merchant = merchant;
            map[key].amount += num(r.amount);
        });
        return Object.values(map)
            .map((r) => ({ ...r, amount: round2(r.amount) }))
            .sort((a, b) => (a.month < b.month ? 1 : -1));
    }

    return out;
}

/**
 * Deterministic aggregation for income queries (query_expenses tool groupBy).
 *
 * @param {Array} incomeRows
 * @param {string} by - 'source' | 'month'
 * @returns {Array<{source?: string, month?: string, amount: number}>}
 */
export function aggregateIncome(incomeRows, by) {
    const rows = incomeRows || [];
    if (by === 'source') {
        const totals = {};
        rows.forEach((r) => {
            const source = String(r.income_sources?.name || 'Unassigned').trim() || 'Unassigned';
            totals[source] = (totals[source] || 0) + num(r.amount);
        });
        return Object.entries(totals)
            .map(([source, amount]) => ({ source, amount: round2(amount) }))
            .sort((a, b) => b.amount - a.amount);
    }
    if (by === 'month') {
        const map = {};
        rows.forEach((r) => {
            const month = r.month || String(r.date_credited || '').slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(month)) return;
            map[month] = (map[month] || 0) + num(r.amount);
        });
        return Object.entries(map)
            .map(([month, amount]) => ({ month, amount: round2(amount) }))
            .sort((a, b) => (a.month < b.month ? 1 : -1));
    }
    return [];
}