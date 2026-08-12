import { supabase } from './supabase.js';
import { currentUser } from './app.js';
import { mapToCanonical } from './categories.js';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const MODEL = 'gemini-3.1-flash-lite';
const MAX_TOOL_ROUNDS = 3;
const OUT_OF_SCOPE_PHRASE = "I can't answer questions outside of my scope";

const ALLOWED_TABLES = new Set([
    "expense_entries", "expense_categories", "expense_receipt_items",
    "income_entries", "income_sources",
]);

const ALLOWED_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);

function todayParts() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return { yearMonth: `${yyyy}-${mm}`, isoDate: `${yyyy}-${mm}-${dd}`, year: String(yyyy) };
}

const { yearMonth, isoDate, year } = todayParts();

// Conversation memory: persists across page switches (module scope). Keyed to
// the signed-in user so a different account starts with a clean context.
let conversationUserId = null;
let conversationContents = [];

const SYSTEM_PROMPT = `
You are the SnapSpend expense assistant: a friendly, precise assistant that answers
questions about the CURRENT USER'S personal finance data stored in the database.

SCOPE — read this carefully:
- You may ONLY answer questions about the user's own expenses, income, categories,
  merchants and receipt line items. Everything else is OUT OF SCOPE.
- For ANY out-of-scope question, respond with EXACTLY this phrase and nothing else:
  "${OUT_OF_SCOPE_PHRASE}"
- Never call the tool for out-of-scope questions.

TOOL USAGE — for in-scope questions you MUST:
1. For ANY question about money totals, "how much did I spend...", or spending
   per/by category, call the \`category_breakdown\` tool FIRST. It returns the
   exact per-category totals the app's Dashboard shows — always trust its numbers.
2. For questions about savings, savings rate, net income/expenses, "how much of
   my income is being saved", or income earned, call the \`financial_summary\`
   tool FIRST. It returns income, expenses, savings and savings rate in one row
   and matches the Dashboard's Net Savings card.
3. For detail questions (biggest expense, lists of purchases, merchants, dates,
   receipt items) call the \`query_expenses\` tool with structured parameters.
4. Always wait for the returned rows.
5. Answer ONLY from those rows. Never invent or estimate numbers.
6. If a tool returns no rows, say there is no matching data.

TABLES AND COLUMNS:
- expense_entries: id, amount, date, month ('YYYY-MM'), merchant, note, currency, entry_type, created_at
- expense_categories: id, name (Groceries, Pharmacy, Travel, Households, Miscellaneous)
- expense_receipt_items: expense_id, item_name, quantity, unit_price, price, category
- income_sources: id, name
- income_entries: source_id, amount, date_credited, note, month ('YYYY-MM')

RELATIONSHIPS:
- expense_entries.category_id -> expense_categories.id
- expense_receipt_items.expense_id -> expense_entries.id
- income_entries.source_id -> income_sources.id

NESTED SELECTORS (put inside columns):
- expense_categories(name) to include the category name.
- expense_receipt_items(item_name, price, category) to include receipt line items.
- Filter on nested data with expense_categories.name, income_sources.name, etc.

AGGREGATES (put inside columns):
- amount.sum(), amount.avg(), id.count(). To group, include a plain column
  (e.g. expense_categories(name)) next to the aggregate.
- Order by aggregates with orderBy.field = "amount.sum()".

FILTERS:
- operators: eq, neq, gt, gte, lt, lte, like, ilike, in, is (for null).
- Never filter on user_id — scoping is automatic.
- Use month = '${yearMonth}' for this month and date >= '${isoDate}' for "today".
- Today is ${isoDate}. This year is ${year}.

FEW-SHOT EXAMPLES:
Q: "How much did I spend on Groceries this month?"
tool: { toolName: "category_breakdown", month: "${yearMonth}" }
Then sum up the returned Groceries row.

Q: "Show my spending per category this month"
tool: { toolName: "category_breakdown", month: "${yearMonth}" }

Q: "How much of my income is being saved this month?"
tool: { toolName: "financial_summary", month: "${yearMonth}" }

Q: "How much income did I earn this month?"
tool: { toolName: "financial_summary", month: "${yearMonth}" }

Q: "What was my biggest single expense this year?"
tool: { toolName: "query_expenses", table: "expense_entries",
        columns: ["amount", "date", "merchant", "expense_categories(name)"],
        filters: [{ field: "date", operator: "gte", value: "${year}-01-01" }],
        orderBy: { field: "amount", direction: "desc" }, limit: 1 }

Q: "How much money did I spend in total this month?"
tool: { toolName: "category_breakdown", month: "${yearMonth}" }
Then sum up all returned amounts.

Q: "Which pharmacy purchases were the most expensive?"
tool: { toolName: "query_expenses", table: "expense_entries",
        columns: ["amount", "date", "merchant", "note"],
        filters: [{ field: "expense_categories.name", operator: "eq", value: "Pharmacy" }],
        orderBy: { field: "amount", direction: "desc" }, limit: 10 }

ANSWER STYLE — PLAIN TEXT, no Markdown:
- Write in plain conversational text. Never use Markdown symbols such as
  asterisks (*), double asterisks (**), hashes (#), backticks, or bullet dashes.
- For lists, use one item per line, e.g.:
  Groceries: 58.98 EUR
  Households: 7.65 EUR
- Be concise: state the numbers, dates and category names from the rows.
- 1–3 short sentences is ideal; a short line list is fine when it helps.
- Never mention the tool or the query. Answer directly.
- Do NOT print or copy the raw result rows back into your answer. Only ever
  summarize the figures they contain.
- Currencies are in EUR unless the user says otherwise.
`;

const QUERY_EXPENSES_TOOL = {
    name: "query_expenses",
    description:
        "Executes a read-only query against the current user's SnapSpend finance data " +
        "(expense_entries, expense_categories, expense_receipt_items, income_entries, " +
        "income_sources) and returns the result rows. Call this tool for ANY question " +
        "about the user's spending, income, totals, merchants, or categories. Queries " +
        "are automatically scoped to the current user — never filter by user_id.",
    parameters: {
        type: "object",
        properties: {
            table: {
                type: "string",
                enum: ["expense_entries", "expense_categories", "expense_receipt_items", "income_entries", "income_sources"],
                description: "The table to query.",
            },
            columns: {
                type: "array",
                items: { type: "string" },
                description:
                    "Columns to select. Nested selectors allowed, e.g. expense_categories(name), " +
                    "expense_receipt_items(item_name, price, category). Aggregate selectors allowed, " +
                    "e.g. amount.sum(), amount.avg(), id.count().",
            },
            filters: {
                type: "array",
                description: "Conditions combined with AND.",
                items: {
                    type: "object",
                    properties: {
                        field: { type: "string" },
                        operator: {
                            type: "string",
                            enum: ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"],
                        },
                        value: { description: "Comparison value." },
                    },
                    required: ["field", "operator", "value"],
                },
            },
            orderBy: {
                type: "object",
                properties: {
                    field: { type: "string" },
                    direction: { type: "string", enum: ["asc", "desc"] },
                },
            },
            limit: {
                type: "number",
                description: "Maximum number of rows to return (1-50).",
            },
        },
        required: ["table", "columns"],
    },
};

const CATEGORY_BREAKDOWN_TOOL = {
    name: "category_breakdown",
    description:
        "Returns the user's spending per category for a given month (or this month by " +
        "default) as rows of { category, amount }. The numbers match the app's Dashboard " +
        "'Expense by Category' view exactly: scanned receipts are split across their " +
        "line-item categories and manual entries use their assigned category. Use this " +
        "tool for ANY question about totals, 'how much did I spend', or spending per/by " +
        "category. The query is automatically scoped to the current user.",
    parameters: {
        type: "object",
        properties: {
            month: {
                type: "string",
                description: "Optional month in YYYY-MM format. Defaults to the current month.",
            },
        },
    },
};

const FINANCIAL_SUMMARY_TOOL = {
    name: "financial_summary",
    description:
        "Returns a single row { month, income, expenses, savings, savingsRate } for a given " +
        "month (or this month by default). Income is the sum of manual income entries, expenses " +
        "is the per-category spending total (scanned receipts split per line item), savings = " +
        "income - expenses, and savingsRate is savings as a percentage of income. These figures " +
        "match the app's Dashboard 'Net Savings' card exactly. Use this tool for ANY question " +
        "about savings, savings rate, net income/expenses, how much of income is saved, or how " +
        "much income was earned. Automatically scoped to the current user.",
    parameters: {
        type: "object",
        properties: {
            month: {
                type: "string",
                description: "Optional month in YYYY-MM format. Defaults to the current month.",
            },
        },
    },
};

export async function askAssistantClient(question) {
    if (!GEMINI_API_KEY) {
        return { error: "VITE_GEMINI_API_KEY is missing in your .env file. Add it and restart the dev server." };
    }
    if (!supabase || !currentUser) {
        return { error: "You are not signed in." };
    }

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
            turn = await geminiTurn(contents);
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

async function geminiTurn(contents) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const payload = {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents,
        tools: [{ functionDeclarations: [QUERY_EXPENSES_TOOL, CATEGORY_BREAKDOWN_TOOL, FINANCIAL_SUMMARY_TOOL] }],
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
    if (call.name === CATEGORY_BREAKDOWN_TOOL.name) {
        return executeCategoryBreakdown(call.args || {});
    }
    if (call.name === FINANCIAL_SUMMARY_TOOL.name) {
        return executeFinancialSummary(call.args || {});
    }
    return executeQueryExpenses(call.args || {});
}

async function executeQueryExpenses(args) {
    const table = args.table;

    if (!ALLOWED_TABLES.has(table)) {
        return { error: `Unknown table: ${table}. Allowed: ${[...ALLOWED_TABLES].join(", ")}` };
    }

    const columns = Array.isArray(args.columns)
        ? args.columns.filter((c) => typeof c === "string" && c.trim().length > 0)
        : [];
    if (columns.length === 0) {
        return { error: "columns must be a non-empty array of column names." };
    }

    let query = supabase.from(table).select(columns.join(","));

    if (Array.isArray(args.filters)) {
        for (const f of args.filters) {
            if (!f || typeof f.field !== "string") continue;
            const op = ALLOWED_OPERATORS.has(f.operator || "eq") ? (f.operator || "eq") : "eq";
            const value = f.value;
            if (op === "is" && (value === null || value === undefined || value === "null")) {
                query = query.is(f.field, null);
            } else {
                query = query[op](f.field, value);
            }
        }
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

// ---------------------------------------------------------------------------
// category_breakdown: reproduces the Dashboard's "Expense by Category" numbers
// exactly (dashboard.js). Scanned receipts are split per line-item `price` and
// canonical-mapped; manual entries fall back to their parent category amount.
// ---------------------------------------------------------------------------
async function executeCategoryBreakdown(args) {
    const rawMonth = typeof args.month === "string" ? args.month.trim() : "";
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : yearMonth;

    const { data, error } = await supabase
        .from('expense_entries')
        .select('amount, expense_categories(name), expense_receipt_items(category, price)')
        .eq('user_id', currentUser.id)
        .eq('month', month);

    if (error) return { error: `Query failed: ${error.message}` };
    if (!Array.isArray(data) || data.length === 0) return { rows: [] };

    const totals = {};
    data.forEach((item) => {
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach((ri) => {
                const catName = mapToCanonical(ri.category || 'Miscellaneous');
                totals[catName] = (totals[catName] || 0) + (parseFloat(ri.price) || 0);
            });
        } else {
            const catName = mapToCanonical(item.expense_categories?.name || 'Miscellaneous');
            totals[catName] = (totals[catName] || 0) + (parseFloat(item.amount) || 0);
        }
    });

    const rows = Object.entries(totals)
        .map(([category, amount]) => ({ category, amount: Math.round(amount * 100) / 100 }))
        .sort((a, b) => b.amount - a.amount);
    return { rows };
}

// ---------------------------------------------------------------------------
// financial_summary: income, expenses, savings and savings rate for a month.
// Mirrors the Dashboard's Net Savings card (dashboard.js) so the assistant's
// figures always match what the user sees on screen.
// ---------------------------------------------------------------------------
async function executeFinancialSummary(args) {
    const rawMonth = typeof args.month === "string" ? args.month.trim() : "";
    const month = /^\d{4}-\d{2}$/.test(rawMonth) ? rawMonth : yearMonth;

    const incomeRes = await supabase
        .from('income_entries')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('month', month);
    if (incomeRes.error) return { error: `Query failed: ${incomeRes.error.message}` };
    const income = (incomeRes.data || []).reduce((sum, item) => sum + (parseFloat(item.amount) || 0), 0);

    const expRes = await executeCategoryBreakdown({ month });
    if (expRes.error) return expRes;
    const expenses = (expRes.rows || []).reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0);

    const savings = income - expenses;
    const savingsRate = income > 0 ? (savings / income) * 100 : 0;
    const round2 = (n) => Math.round(n * 100) / 100;

    return { rows: [{
        month,
        income: round2(income),
        expenses: round2(expenses),
        savings: round2(savings),
        savingsRate: round2(savingsRate),
    }] };
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
