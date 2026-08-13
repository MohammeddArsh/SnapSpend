import assert from 'node:assert';
import { test } from 'node:test';
import {
    categoryTotalsForExpenses,
    countExpenseItems,
    buildMonthlySummary,
    percentChange,
    compareMonthSnapshots,
    buildYearlyStats,
    categoryTrends,
    aggregateExpenses,
    aggregateIncome,
} from '../js/assistantStats.js';

// ---------------------------------------------------------------------------
// Deterministic, hand-checkable synthetic data. Amounts are chosen so every
// expected value below is verifiable by hand.
// ---------------------------------------------------------------------------

function exp(amount, month, merchant, category, opts = {}) {
    return {
        amount,
        date: `${month}-10`,
        month,
        merchant,
        expense_categories: { name: category },
        expense_receipt_items: opts.items || [],
        ...opts.rest,
    };
}

function income(source, amount, month) {
    return {
        amount,
        date_credited: `${month}-28`,
        month,
        income_sources: { name: source },
    };
}

// May 2026: income 3500, expenses 850
const mayIncome = [
    income('Salary', 3000, '2026-05'),
    income('Freelance', 500, '2026-05'),
];
const mayExpenses = [
    exp(300, '2026-05', 'Lidl', 'Groceries'),
    exp(250, '2026-05', 'Bolt', 'Travel'),
    exp(80, '2026-05', 'Apollo', 'Pharmacy'),
    exp(120, '2026-05', 'IKEA', 'Households'),
    exp(50, '2026-05', 'Other', 'Miscellaneous'),
    // Supermarket receipt split across line-item categories
    exp(50, '2026-05', 'Carrefour', 'Groceries', { items: [
        { category: 'Beverages', price: 40 },
        { category: 'Households', price: 10 },
    ] }),
];

// June 2026: income 3200, expenses 950
const juneIncome = [
    income('Salary', 3000, '2026-06'),
    income('Bonus', 200, '2026-06'),
];
const juneExpenses = [
    exp(400, '2026-06', 'Lidl', 'Groceries'),
    exp(200, '2026-06', 'Bolt', 'Travel'),
    exp(90, '2026-06', 'Apollo', 'Pharmacy'),
    exp(150, '2026-06', 'IKEA', 'Households'),
    exp(60, '2026-06', 'Other', 'Miscellaneous'),
    // Receipt split: Groceries 35 + Pharmacy 15
    exp(50, '2026-06', 'Carrefour', 'Groceries', { items: [
        { category: 'Groceries', price: 35 },
        { category: 'Pharmacy', price: 15 },
    ] }),
];

// ---------------------------------------------------------------------------
// categoryTotalsForExpenses
// ---------------------------------------------------------------------------

test('receipt items are split per line-item category; manual entries use parent category', () => {
    const totals = categoryTotalsForExpenses(juneExpenses);
    assert.deepStrictEqual(totals, {
        Groceries: 435,   // 400 manual + 35 receipt
        Travel: 200,
        Pharmacy: 105,    // 90 manual + 15 receipt
        Households: 150,
        Miscellaneous: 60,
    });
});

test('receipt line items map granular tags onto canonical categories', () => {
    const totals = categoryTotalsForExpenses(mayExpenses);
    assert.strictEqual(totals.Groceries, 340); // 300 manual + 40 receipt ('Beverages' -> Groceries)
    assert.strictEqual(totals.Households, 130); // 120 manual + 10 receipt
});

// ---------------------------------------------------------------------------
// buildMonthlySummary
// ---------------------------------------------------------------------------

test('June summary: income, expenses, savings and savingsRate', () => {
    const s = buildMonthlySummary(juneIncome, juneExpenses);
    assert.strictEqual(s.income, 3200);
    assert.strictEqual(s.expenses, 950);
    assert.strictEqual(s.savings, 2250);
    assert.strictEqual(s.savingsRate, 70.31); // 2250 / 3200 * 100
});

test('empty data yields a zeroed summary', () => {
    const s = buildMonthlySummary([], []);
    assert.strictEqual(s.income, 0);
    assert.strictEqual(s.expenses, 0);
    assert.strictEqual(s.savings, 0);
    assert.strictEqual(s.savingsRate, 0);
    assert.deepStrictEqual(s.categoryTotals, {});
});

// ---------------------------------------------------------------------------
// percentChange
// ---------------------------------------------------------------------------

test('percentChange conventions', () => {
    assert.strictEqual(percentChange(950, 850), 11.76);
    assert.strictEqual(percentChange(3200, 3500), -8.57);
    assert.strictEqual(percentChange(100, 0), null);        // zero base -> null
    assert.strictEqual(percentChange(-100, -200), 50);      // |previous| base
    assert.strictEqual(percentChange(50, 50), 0);
});

// ---------------------------------------------------------------------------
// compareMonthSnapshots
// ---------------------------------------------------------------------------

test('June vs May deltas', () => {
    const c = compareMonthSnapshots(
        { month: '2026-06', incomeRows: juneIncome, expenseRows: juneExpenses },
        { month: '2026-05', incomeRows: mayIncome, expenseRows: mayExpenses }
    );

    assert.strictEqual(c.current.income, 3200);
    assert.strictEqual(c.previous.expenses, 850);
    assert.strictEqual(c.deltas.income.absolute, -300);
    assert.strictEqual(c.deltas.income.percent, -8.57);
    assert.strictEqual(c.deltas.expenses.absolute, 100);
    assert.strictEqual(c.deltas.expenses.percent, 11.76);
    assert.strictEqual(c.deltas.savings.absolute, -400);
    assert.strictEqual(c.deltas.savings.percent, -15.09);
    assert.strictEqual(c.deltas.savingsRate.absolute, -5.4); // percentage points
});

test('per-category deltas', () => {
    const c = compareMonthSnapshots(
        { month: '2026-06', incomeRows: juneIncome, expenseRows: juneExpenses },
        { month: '2026-05', incomeRows: mayIncome, expenseRows: mayExpenses }
    );
    assert.strictEqual(c.categoryDeltas.Groceries.absolute, 95);   // 435 - 340
    assert.strictEqual(c.categoryDeltas.Groceries.percent, 27.94);
    assert.strictEqual(c.categoryDeltas.Pharmacy.absolute, 25);    // 105 - 80
    assert.strictEqual(c.categoryDeltas.Pharmacy.percent, 31.25);
    assert.strictEqual(c.categoryDeltas.Travel.absolute, -50);
});

test('a month with no prior data yields null percent deltas', () => {
    const c = compareMonthSnapshots(
        { month: '2026-06', incomeRows: juneIncome, expenseRows: juneExpenses },
        { month: '2026-05', incomeRows: [], expenseRows: [] }
    );
    assert.strictEqual(c.deltas.expenses.percent, null);
    assert.strictEqual(c.deltas.expenses.absolute, 950);
    assert.strictEqual(c.deltas.income.absolute, 3200);
});

// ---------------------------------------------------------------------------
// buildYearlyStats
// ---------------------------------------------------------------------------

test('yearly rollup across May + June 2026', () => {
    const allIncome = [...mayIncome, ...juneIncome];
    const allExpenses = [...mayExpenses, ...juneExpenses];
    const y = buildYearlyStats('2026', allIncome, allExpenses);

    assert.strictEqual(y.income, 6700);
    assert.strictEqual(y.expenses, 1800);
    assert.strictEqual(y.savings, 4900);
    assert.strictEqual(y.savingsRate, 73.13); // 4900 / 6700 * 100
    assert.strictEqual(y.months.length, 2);
    assert.strictEqual(y.months[0].month, '2026-05');
    assert.strictEqual(y.months[0].income, 3500);
    assert.strictEqual(y.months[1].expenses, 950);
    assert.strictEqual(y.highestSpendMonth.month, '2026-06');
    assert.strictEqual(y.highestSpendMonth.amount, 950);
    assert.strictEqual(y.lowestSpendMonth.month, '2026-05');
    assert.strictEqual(y.lowestSpendMonth.amount, 850);
});

test('year with only one spending month', () => {
    const y = buildYearlyStats('2026', [], juneExpenses);
    assert.strictEqual(y.months.length, 1);
    assert.strictEqual(y.highestSpendMonth.month, '2026-06');
    assert.strictEqual(y.lowestSpendMonth.month, '2026-06');
});

test('year with no data has no best/worst month', () => {
    const y = buildYearlyStats('2026', [], []);
    assert.strictEqual(y.months.length, 0);
    assert.strictEqual(y.highestSpendMonth, null);
    assert.strictEqual(y.lowestSpendMonth, null);
});

// ---------------------------------------------------------------------------
// categoryTrends
// ---------------------------------------------------------------------------

test('per-category monthly series, newest month first', () => {
    const trends = categoryTrends([...mayExpenses, ...juneExpenses]);
    const groceries = trends.find((t) => t.category === 'Groceries');
    assert.strictEqual(groceries.total, 775); // 340 + 435
    assert.deepStrictEqual(groceries.months, [
        { month: '2026-06', amount: 435 },
        { month: '2026-05', amount: 340 },
    ]);
});

// ---------------------------------------------------------------------------
// aggregateExpenses
// ---------------------------------------------------------------------------

test('aggregate by category (receipt-split aware)', () => {
    const rows = aggregateExpenses([...mayExpenses, ...juneExpenses], 'category');
    assert.strictEqual(rows[0].category, 'Groceries');
    assert.strictEqual(rows[0].amount, 775);
    assert.strictEqual(rows.find((r) => r.category === 'Pharmacy').amount, 185); // 80 + 105
});

test('aggregate by merchant', () => {
    const rows = aggregateExpenses([...mayExpenses, ...juneExpenses], 'merchant');
    assert.strictEqual(rows[0].merchant, 'Lidl');
    assert.strictEqual(rows[0].amount, 700); // 300 + 400
});

test('aggregate by month, newest first', () => {
    const rows = aggregateExpenses([...mayExpenses, ...juneExpenses], 'month');
    assert.deepStrictEqual(rows, [
        { month: '2026-06', amount: 950 },
        { month: '2026-05', amount: 850 },
    ]);
});

test('aggregate by month+category', () => {
    const rows = aggregateExpenses([...mayExpenses, ...juneExpenses], 'month+category');
    const junGroceries = rows.find((r) => r.month === '2026-06' && r.category === 'Groceries');
    assert.strictEqual(junGroceries.amount, 450); // 400 manual + 50 receipt parent entry
});

// ---------------------------------------------------------------------------
// aggregateIncome
// ---------------------------------------------------------------------------

test('income by source', () => {
    const rows = aggregateIncome([...mayIncome, ...juneIncome], 'source');
    assert.strictEqual(rows[0].source, 'Salary');
    assert.strictEqual(rows[0].amount, 6000);
    assert.strictEqual(rows.find((r) => r.source === 'Bonus').amount, 200);
});

test('income by month, newest first', () => {
    const rows = aggregateIncome([...mayIncome, ...juneIncome], 'month');
    assert.deepStrictEqual(rows, [
        { month: '2026-06', amount: 3200 },
        { month: '2026-05', amount: 3500 },
    ]);
});

// ---------------------------------------------------------------------------
// countExpenseItems (matches the Expenses page category counters)
// ---------------------------------------------------------------------------

test('June counts: receipt line items and manual entries each count once', () => {
    const counts = countExpenseItems(juneExpenses);
    assert.deepStrictEqual(counts, {
        Groceries: 2,     // Lidl manual + 1 receipt line item
        Travel: 1,
        Pharmacy: 2,      // Apollo manual + 1 receipt line item
        Households: 1,
        Miscellaneous: 1,
    });
});

test('counts use the stored (raw) item category, not the canonical mapping', () => {
    const rows = [
        { amount: 50, month: '2026-06', merchant: 'Carrefour', expense_categories: { name: 'Groceries' }, expense_receipt_items: [
            { category: 'Beverages', price: 40 },
            { category: 'Groceries', price: 10 },
        ] },
    ];
    // 'Beverages' stays under its own counter, mirroring the Expenses page pills.
    assert.deepStrictEqual(countExpenseItems(rows), { Beverages: 1, Groceries: 1 });
});

test('items tagged general/other fall back to the parent category', () => {
    const rows = [
        { amount: 30, month: '2026-06', merchant: 'Store', expense_categories: { name: 'Travel' }, expense_receipt_items: [
            { category: 'general', price: 30 },
        ] },
    ];
    assert.deepStrictEqual(countExpenseItems(rows), { Travel: 1 });
});