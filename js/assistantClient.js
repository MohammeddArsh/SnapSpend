import { supabase } from './supabase.js';
import { currentUser } from './app.js';

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
1. Call the \`query_expenses\` tool with structured parameters.
2. Wait for the returned rows.
3. Answer ONLY from those rows. Never invent or estimate numbers.
4. If the tool returns no rows, say there is no matching data.

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
tool: { table: "expense_entries", columns: ["amount.sum()"],
        filters: [{ field: "month", operator: "eq", value: "${yearMonth}" },
                  { field: "expense_categories.name", operator: "eq", value: "Groceries" }] }

Q: "What was my biggest single expense this year?"
tool: { table: "expense_entries", columns: ["amount", "date", "merchant", "expense_categories(name)"],
        filters: [{ field: "date", operator: "gte", value: "${year}-01-01" }],
        orderBy: { field: "amount", direction: "desc" }, limit: 1 }

Q: "Show my spending per category this month"
tool: { table: "expense_entries", columns: ["expense_categories(name)", "amount.sum()"],
        filters: [{ field: "month", operator: "eq", value: "${yearMonth}" }],
        orderBy: { field: "amount.sum()", direction: "desc" } }

Q: "What is my average daily spending this month?"
tool: { table: "expense_entries", columns: ["amount.sum()", "date.count()"],
        filters: [{ field: "month", operator: "eq", value: "${yearMonth}" }] }

Q: "Which pharmacy purchases were the most expensive?"
tool: { table: "expense_entries", columns: ["amount", "date", "merchant", "note"],
        filters: [{ field: "expense_categories.name", operator: "eq", value: "Pharmacy" }],
        orderBy: { field: "amount", direction: "desc" }, limit: 10 }

ANSWER STYLE:
- Be concise: state the numbers, dates and category names from the rows.
- 1–3 short sentences is ideal; a short list is fine when it helps.
- Never mention the tool or the query. Answer directly.
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

export async function askAssistantClient(question) {
    if (!GEMINI_API_KEY) {
        return { error: "VITE_GEMINI_API_KEY is missing in your .env file. Add it and restart the dev server." };
    }
    if (!supabase || !currentUser) {
        return { error: "You are not signed in." };
    }

    const contents = [{ role: "user", parts: [{ text: question }] }];
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
            return { answer, rows, outOfScope: answer === OUT_OF_SCOPE_PHRASE };
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
        tools: [{ functionDeclarations: [QUERY_EXPENSES_TOOL] }],
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
    const args = call.args || {};
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
        return { rows: data || [] };
    } catch (err) {
        return { error: `Query failed: ${err.message}` };
    }
}
