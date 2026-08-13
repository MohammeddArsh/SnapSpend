import { supabase } from './supabase.js';
import { currentUser } from './app.js';
import {
    OUT_OF_SCOPE_PHRASE,
    todayParts,
    buildSystemPrompt,
    QUERY_EXPENSES_TOOL,
    CATEGORY_BREAKDOWN_TOOL,
    FINANCIAL_SUMMARY_TOOL,
    MONTH_OVER_MONTH_TOOL,
    YEARLY_STATS_TOOL,
    CATEGORY_TRENDS_TOOL,
    CATEGORY_COUNT_TOOL,
    CATEGORY_MAPPING_TOOL,
    ALL_TOOL_DECLARATIONS,
} from './assistantPrompt.js';
import {
    categoryTotalsForExpenses,
    countExpenseItems,
    buildMonthlySummary,
    compareMonthSnapshots,
    buildYearlyStats,
    categoryTrends,
    aggregateExpenses,
    aggregateIncome,
} from './assistantStats.js';
import { resolveCanonicalCategory } from './categoryMapping.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'gemini-3.1-flash-lite';
const MAX_TOOL_ROUNDS = 4;

const ALLOWED_TABLES = new Set([
    "expense_entries", "expense_categories", "expense_receipt_items",
    "income_entries", "income_sources",
]);

const ALLOWED_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);

// Refreshed at the start of every request so the executors' "this month / this
// year" defaults always match the system prompt the model just saw.
let today = todayParts();
let currentContext = { page: 'assistant', selectedMonth: '' };

// Conversation memory: persists across page switches (module scope). Keyed to
// the signed-in user so a different account starts with a clean context.
let conversationUserId = null;
let conversationContents = [];

export async function askAssistantClient(question, context = {}) {
    if (!GEMINI_API_KEY) {
        return { error: "VITE_GEMINI_API_KEY is missing in your .env file. Add it and restart the dev server." };
    }
    if (!supabase || !currentUser) {
        return { error: "You are not signed in." };
    }

    const now = new Date();
    today = todayParts(now);
    currentContext = {
        page: typeof context.page === "string" ? context.page : 'assistant',
        selectedMonth: typeof context.selectedMonth === "string" ? context.selectedMonth : '',
    };
    const systemPrompt = buildSystemPrompt({ page: currentContext.page, selectedMonth: currentContext.selectedMonth, now });

    if (conversationUserId !== currentUser.id) {
        conversationUserId = currentUser.id;
        conversationContents = [];
    }
    const contents = [...conversationContents];
    contents.push({ role: "user", parts: [{ text: question }] });
    let rows = [];
    let rounds = 0;

    while (true) {
        let turn;
        try {
            turn = await geminiTurn(contents, systemPrompt);
        } catch (err) {
            return { error: err.message };
        }

        if (!turn.toolCall) {
            const answer = (turn.text || "").trim();
            if (!answer) return { error: "The assistant returned an empty response." };
            contents.push(turn.rawModelContent);
            conversationContents = contents;
            return { answer, rows, toolRounds: rounds, outOfScope: answer === OUT_OF_SCOPE_PHRASE };
        }

        if (rounds >= MAX_TOOL_ROUNDS) {
            contents.push(turn.rawModelContent);
            contents.push({
                role: "user",
                parts: [{
                    functionResponse: {
                        name: turn.toolCall.name,
                        id: turn.toolCall.id,
                        response: {
                            error: "No more tool calls are allowed. Answer using the results already provided, or state that there is no matching data.",
                        },
                    },
                }],
            });
            continue;
        }
        rounds++;

        const result = await executeTool(turn.toolCall);
        if (!result.error && Array.isArray(result.rows)) {
            rows = result.rows;
        }

        contents.push(turn.rawModelContent);
        contents.push({
            role: "user",
            parts: [{
                functionResponse: {
                    name: turn.toolCall.name,
                    id: turn.toolCall.id,
                    response: result.error ? { error: result.error } : { rows: result.rows },
                },
            }],
        });
    }
}

async function geminiTurn(contents, systemPrompt) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: ALL_TOOL_DECLARATIONS }],
        generationConfig: { temperature: 0.1 },
    };

    const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Gemini API error (HTTP ${res.status}): ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const content = data?.candidates?.[0]?.content;
    if (!content) throw new Error("Gemini returned an empty response.");

    const parts = content.parts || [];
    const fcPart = parts.find((p) => p.functionCall);
    const textPart = parts.find((p) => p.text);

    let toolCall;
    if (fcPart) {
        toolCall = {
            name: fcPart.functionCall.name,
            id: fcPart.functionCall.id || `fc_${Date.now()}`,
            args: fcPart.functionCall.args ?? {},
        };
    }

    return { text: textPart?.text, toolCall, rawModelContent: content };
}

async function executeTool(call) {
    switch (call.name) {
        case CATEGORY_BREAKDOWN_TOOL.name:
            return executeCategoryBreakdown(call.args || {});
        case FINANCIAL_SUMMARY_TOOL.name:
            return executeFinancialSummary(call.args || {});
        case MONTH_OVER_MONTH_TOOL.name:
            return executeMonthOverMonth(call.args || {});
        case YEARLY_STATS_TOOL.name:
            return executeYearlyStats(call.args || {});
        case CATEGORY_TRENDS_TOOL.name:
            return executeCategoryTrends(call.args || {});
        case CATEGORY_COUNT_TOOL.name:
            return executeCategoryCount(call.args || {});
        case CATEGORY_MAPPING_TOOL.name:
            return executeCategoryMapping(call.args || {});
        default:
            return executeQueryExpenses(call.args || {});
    }
}

function validMonth(value) {
    return typeof value === "string" && /^\d{4}-\d{2}$/.test(value.trim()) ? value.trim() : "";
}

function validYear(value) {
    return typeof value === "string" && /^\d{4}$/.test(value.trim()) ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// Expense/income fetching shared by the aggregated tools. Rows are returned in
// the raw shape assistantStats expects (nested selectors preserved) so the
// receipt-split category logic is identical to the Dashboard's.
// ---------------------------------------------------------------------------
async function fetchExpensesForPeriod(gteMonth, lteMonth) {
    const { data, error } = await supabase
        .from('expense_entries')
        .select('amount, date, month, merchant, expense_categories(name), expense_receipt_items(category, price)')
        .eq('user_id', currentUser.id)
        .gte('month', gteMonth)
        .lte('month', lteMonth);

    if (error) return { error: `Query failed: ${error.message}` };
    return { rows: Array.isArray(data) ? data : [] };
}

async function fetchIncomeForPeriod(gteMonth, lteMonth) {
    const { data, error } = await supabase
        .from('income_entries')
        .select('amount, date_credited, month, income_sources(name)')
        .eq('user_id', currentUser.id)
        .gte('month', gteMonth)
        .lte('month', lteMonth);

    if (error) return { error: `Query failed: ${error.message}` };
    return { rows: Array.isArray(data) ? data : [] };
}

// ---------------------------------------------------------------------------
// category_breakdown: reproduces the Dashboard's "Expense by Category" numbers
// exactly via categoryTotalsForExpenses (assistantStats.js).
// ---------------------------------------------------------------------------
async function executeCategoryBreakdown(args) {
    const month = validMonth(args.month) || today.yearMonth;
    const res = await fetchExpensesForPeriod(month, month);
    if (res.error) return res;

    const rows = Object.entries(categoryTotalsForExpenses(res.rows))
        .map(([category, amount]) => ({ month, category, amount }))
        .sort((a, b) => b.amount - a.amount);
    return { rows };
}

// ---------------------------------------------------------------------------
// category_count: per-category ITEM counts for a month, computed by
// countExpenseItems — the exact same figures as the Expenses page counters.
// ---------------------------------------------------------------------------
async function executeCategoryCount(args) {
    const month = validMonth(args.month) || today.yearMonth;
    const category = typeof args.category === "string" ? args.category.trim() : "";

    const res = await fetchExpensesForPeriod(month, month);
    if (res.error) return res;

    let rows = Object.entries(countExpenseItems(res.rows))
        .map(([categoryName, count]) => ({ month, category: categoryName, count }))
        .sort((a, b) => b.count - a.count);
    if (category) {
        rows = rows.filter((r) => r.category.toLowerCase() === category.toLowerCase());
    }
    return { rows };
}

// ---------------------------------------------------------------------------
// category_mapping: maps a granular label to its broad canonical category via
// resolveCanonicalCategory (same classification logic as receipt scanning).
// ---------------------------------------------------------------------------
async function executeCategoryMapping(args) {
    const label = typeof args.label === "string" ? args.label.trim() : "";
    if (!label) return { error: "label is required, e.g. 'milk' or 'clothes'." };
    return { rows: [{ label, category: resolveCanonicalCategory(label) || 'Miscellaneous' }] };
}

// ---------------------------------------------------------------------------
// financial_summary: income, expenses, savings and savings rate for a month,
// computed by buildMonthlySummary (same figures as the Net Savings card).
// ---------------------------------------------------------------------------
async function executeFinancialSummary(args) {
    const month = validMonth(args.month) || today.yearMonth;

    const incomeRes = await fetchIncomeForPeriod(month, month);
    if (incomeRes.error) return incomeRes;
    const expRes = await fetchExpensesForPeriod(month, month);
    if (expRes.error) return expRes;

    const summary = buildMonthlySummary(incomeRes.rows, expRes.rows);
    return { rows: [{
        month,
        income: summary.income,
        expenses: summary.expenses,
        savings: summary.savings,
        savingsRate: summary.savingsRate,
    }] };
}

// ---------------------------------------------------------------------------
// month_over_month: compareMonthSnapshots across two months. Defaults primary
// month to the app's selected month (then this month) and compareTo to the
// calendar month before it — mirroring the Reports MoM matrix.
// ---------------------------------------------------------------------------
async function executeMonthOverMonth(args) {
    let month = validMonth(args.month) || today.yearMonth;

    let compareTo = validMonth(args.compareTo);
    if (!compareTo) {
        const [y, m] = month.split("-").map(Number);
        const prev = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
        compareTo = `${prev.y}-${String(prev.m).padStart(2, "0")}`;
    }

    const curExp = await fetchExpensesForPeriod(month, month);
    if (curExp.error) return curExp;
    const curInc = await fetchIncomeForPeriod(month, month);
    if (curInc.error) return curInc;
    const prevExp = await fetchExpensesForPeriod(compareTo, compareTo);
    if (prevExp.error) return prevExp;
    const prevInc = await fetchIncomeForPeriod(compareTo, compareTo);
    if (prevInc.error) return prevInc;

    const comparison = compareMonthSnapshots(
        { month, incomeRows: curInc.rows, expenseRows: curExp.rows },
        { month: compareTo, incomeRows: prevInc.rows, expenseRows: prevExp.rows }
    );

    const rows = [{
        month,
        compareTo,
        income: `${comparison.deltas.income.current} (previous ${comparison.deltas.income.previous}, change ${comparison.deltas.income.absolute}${comparison.deltas.income.percent === null ? "" : `, ${comparison.deltas.income.percent}%`})`,
        expenses: `${comparison.deltas.expenses.current} (previous ${comparison.deltas.expenses.previous}, change ${comparison.deltas.expenses.absolute}${comparison.deltas.expenses.percent === null ? "" : `, ${comparison.deltas.expenses.percent}%`})`,
        savings: `${comparison.deltas.savings.current} (previous ${comparison.deltas.savings.previous}, change ${comparison.deltas.savings.absolute}${comparison.deltas.savings.percent === null ? "" : `, ${comparison.deltas.savings.percent}%`})`,
        savingsRate: `${comparison.deltas.savingsRate.current}% (previous ${comparison.deltas.savingsRate.previous}%, change ${comparison.deltas.savingsRate.absolute} percentage points)`,
        categoryChanges: Object.entries(comparison.categoryDeltas)
            .map(([category, d]) => `${category}: ${d.current} (previous ${d.previous}, change ${d.absolute}${d.percent === null ? "" : `, ${d.percent}%`})`)
            .join("; "),
    }];
    return { rows };
}

// ---------------------------------------------------------------------------
// yearly_stats: buildYearlyStats rollup for a year (default current year).
// ---------------------------------------------------------------------------
async function executeYearlyStats(args) {
    const year = validYear(args.year) || today.year;
    const gte = `${year}-01`;
    const lte = `${year}-12`;

    const incomeRes = await fetchIncomeForPeriod(gte, lte);
    if (incomeRes.error) return incomeRes;
    const expRes = await fetchExpensesForPeriod(gte, lte);
    if (expRes.error) return expRes;

    const stats = buildYearlyStats(year, incomeRes.rows, expRes.rows);

    const rows = [{
        year,
        income: stats.income,
        expenses: stats.expenses,
        savings: stats.savings,
        savingsRate: `${stats.savingsRate}%`,
        categoryTotals: Object.entries(stats.categoryTotals)
            .map(([category, amount]) => `${category}: ${amount}`)
            .join("; "),
        highestSpendMonth: stats.highestSpendMonth
            ? `${stats.highestSpendMonth.month} (${stats.highestSpendMonth.amount})`
            : "none",
        lowestSpendMonth: stats.lowestSpendMonth
            ? `${stats.lowestSpendMonth.month} (${stats.lowestSpendMonth.amount})`
            : "none",
        months: stats.months.map((m) =>
            `${m.month}: income ${m.income}, expenses ${m.expenses}, savings ${m.savings} (${m.savingsRate}%)`
        ),
    }];
    return { rows };
}

// ---------------------------------------------------------------------------
// category_trends: per-category monthly series for a period.
// ---------------------------------------------------------------------------
async function executeCategoryTrends(args) {
    const year = validYear(args.year) || today.year;
    const category = typeof args.category === "string" ? args.category.trim() : "";

    const expRes = await fetchExpensesForPeriod(`${year}-01`, `${year}-12`);
    if (expRes.error) return expRes;

    let trends = categoryTrends(expRes.rows);
    if (category) {
        trends = trends.filter((t) => t.category.toLowerCase() === category.toLowerCase());
    }

    const rows = trends.map((t) => ({
        category: t.category,
        total: t.total,
        months: t.months.map((m) => `${m.month}: ${m.amount}`).join(", "),
    }));
    return { rows };
}

// ---------------------------------------------------------------------------
// query_expenses: generic raw query, plus a deterministic groupBy path.
// ---------------------------------------------------------------------------
async function executeQueryExpenses(args) {
    const table = args.table;

    if (!ALLOWED_TABLES.has(table)) {
        return { error: `Unknown table: ${table}. Allowed: ${[...ALLOWED_TABLES].join(", ")}` };
    }

    if (typeof args.groupBy === "string" && args.groupBy) {
        return executeGroupedQuery(table, args);
    }

    const columns = Array.isArray(args.columns)
        ? args.columns.filter((c) => typeof c === "string" && c.trim().length > 0)
        : [];
    if (columns.length === 0) {
        return { error: "columns must be a non-empty array of column names." };
    }

    let query = supabase.from(table).select(columns.join(","));

    if (Array.isArray(args.filters)) {
        query = applyFilters(query, args.filters);
    }

    if (args.orderBy && typeof args.orderBy.field === "string" && args.orderBy.field) {
        query = query.order(args.orderBy.field, { ascending: (args.orderBy.direction || "asc") !== "desc" });
    }

    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 50);
    query = query.limit(limit);

    try {
        const { data, error } = await query;
        if (error) return { error: `Query failed: ${error.message}` };
        return { rows: (data || []).map(flattenRow) };
    } catch (err) {
        return { error: `Query failed: ${err.message}` };
    }
}

// Deterministic aggregation: fetches the full period rows, applies the model's
// filters at the database level, then aggregates in JS with the exact same
// rules as the Dashboard/Reports views. No math is left to the model.
async function executeGroupedQuery(table, args) {
    const groupBy = args.groupBy;

    if (table === "income_entries") {
        if (!["source", "month"].includes(groupBy)) {
            return { error: `groupBy '${groupBy}' is only valid for expense_entries. Use 'source' or 'month' for income_entries.` };
        }
    } else if (table === "expense_entries") {
        if (!["month", "category", "merchant", "month+category"].includes(groupBy)) {
            return { error: `groupBy '${groupBy}' is not supported for expense_entries. Allowed: month, category, merchant, month+category.` };
        }
    } else {
        return { error: `groupBy is only supported on expense_entries or income_entries.` };
    }

    const select = table === "income_entries"
        ? 'amount, date_credited, month, income_sources(name)'
        : 'amount, date, month, merchant, expense_categories(name), expense_receipt_items(category, price)';

    let query = supabase
        .from(table)
        .select(select)
        .eq('user_id', currentUser.id);

    if (Array.isArray(args.filters)) {
        query = applyFilters(query, args.filters);
    }

    query = query.order('month', { ascending: false }).limit(5000);

    try {
        const { data, error } = await query;
        if (error) return { error: `Query failed: ${error.message}` };
        if (!Array.isArray(data) || data.length === 0) return { rows: [] };

        const rows = table === "income_entries"
            ? aggregateIncome(data, groupBy)
            : aggregateExpenses(data, groupBy);
        return { rows };
    } catch (err) {
        return { error: `Query failed: ${err.message}` };
    }
}

function applyFilters(query, filters) {
    for (const f of filters) {
        if (!f || typeof f.field !== "string") continue;
        const op = ALLOWED_OPERATORS.has(f.operator || "eq") ? (f.operator || "eq") : "eq";
        const value = f.value;
        if (op === "is" && (value === null || value === undefined || value === "null")) {
            query = query.is(f.field, null);
        } else {
            query = query[op](f.field, value);
        }
    }
    return query;
}

// ---------------------------------------------------------------------------
// Row normalization: collapses nested selector objects (e.g.
// expense_categories: { name: "Groceries" }) into plain scalar values so the
// app and the model never see "[object Object]".
// ---------------------------------------------------------------------------
function flattenRow(row) {
    if (!row || typeof row !== "object") return row;
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        out[key] = normalizeValue(value);
    }
    return out;
}

function normalizeValue(value) {
    if (value === null || value === undefined) return null;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) {
        if (value.length === 0) return null;
        return normalizeValue(value[0]);
    }
    for (const key of ["name", "username", "title", "label", "category"]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            return normalizeValue(value[key]);
        }
    }
    const scalars = Object.values(value).map(normalizeValue).filter((v) => v !== null && v !== "");
    return scalars.length > 0 ? scalars.join(" / ") : "";
}