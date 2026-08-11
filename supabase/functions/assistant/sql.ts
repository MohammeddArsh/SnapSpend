// =========================================================================
// SnapSpend AI Assistant — SQL validation & read-only execution
//
// The tool-calling LLM produces SQL; this module is the safety gate:
//   - validateSQL: strict allow-listing (SELECT-only, single statement,
//     no mutating keywords, no OR/UNION/subqueries, whitelisted tables)
//   - runReadOnlyQuery: executes inside a READ ONLY transaction under the
//     caller's authenticated role + JWT claims, so RLS scopes every row to
//     the current user even if the model omits a user_id filter.
// =========================================================================

import { postgres } from "npm:postgres@3.4.5";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") || "";

const ALLOWED_TABLES = new Set([
    "expense_entries", "expense_categories", "expense_receipt_items",
    "income_entries", "income_sources",
]);

/**
 * Replaces the contents of single-quoted string literals with an empty
 * literal so keyword scanning never trips on user/note text.
 */
function stripStringLiterals(sql) {
    return sql.replace(/'([^']|'')*'/g, "''");
}

/**
 * Splits on semicolons that appear OUTSIDE string literals.
 */
function splitStatements(sql) {
    const parts = [];
    let current = "";
    let inString = false;
    for (let i = 0; i < sql.length; i++) {
        const ch = sql[i];
        if (ch === "'") {
            inString = !inString;
            current += ch;
            continue;
        }
        if (ch === ";" && !inString) {
            parts.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (current.trim().length > 0) parts.push(current);
    return parts;
}

/**
 * Validates a model-generated query. Scoping is enforced by RLS at execution
 * time (runReadOnlyQuery), so a user_id WHERE clause is no longer required.
 */
export function validateSQL(sql, userId) {
    const cleaned = sql
        .replace(/--[^\n]*/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();

    if (!cleaned) return { ok: false, reason: "empty query" };

    // Single statement only (quote-aware: a ";" inside a string is fine)
    const statements = splitStatements(cleaned).filter((s) => s.trim().length > 0);
    if (statements.length !== 1) return { ok: false, reason: "multi-statement queries are not allowed" };

    // Must be a plain SELECT
    if (!/^\s*select\b/i.test(cleaned)) return { ok: false, reason: "only SELECT queries are allowed" };

    // Keyword checks run on the SQL with string contents blanked out, so
    // "note LIKE '%delete%'" cannot false-positive.
    const scrubbed = stripStringLiterals(cleaned);

    // Reject any mutating / dangerous keywords
    const forbidden = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|execute|call|do|vacuum|reindex|analyze|cluster|comment|prepare|pg_|lo_import|lo_export)\b/i;
    if (forbidden.test(scrubbed)) return { ok: false, reason: "query contains forbidden operations" };

    // Reject OR / UNION / subqueries that could bypass the user scope.
    if (/\bor\b/i.test(scrubbed)) return { ok: false, reason: "query contains OR conditions that could bypass user scoping" };
    if (/\bunion\b/i.test(scrubbed)) return { ok: false, reason: "query contains UNION" };
    if (/\bwhere\s*\(/i.test(scrubbed)) return { ok: false, reason: "query contains a parenthesized WHERE clause" };
    if ((scrubbed.match(/\bselect\b/gi) || []).length > 1) {
        return { ok: false, reason: "query contains subqueries" };
    }

    // Every FROM/JOIN must reference an allowed table
    const tableRefs = [...scrubbed.matchAll(/\b(?:from|join)\s+(?:public\.)?([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
    if (tableRefs.some((t) => !ALLOWED_TABLES.has(t))) {
        return { ok: false, reason: "query references a non-whitelisted table" };
    }

    // Sanity-check the caller id (comes from the verified JWT)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
        return { ok: false, reason: "invalid user id" };
    }

    let finalSql = cleaned
        .replace(/:\s*user_id/gi, `'${userId}'`)   // replace placeholder if the model still uses it
        .replace(/;\s*$/, "");

    // Normalize the row cap: drop any model-supplied LIMIT/OFFSET, then append ours
    finalSql = finalSql
        .replace(/\s*limit\s+\d+(?:\s*offset\s+\d+)?\s*$/i, "")
        .replace(/\s*offset\s+\d+\s*$/i, "")
        .trim();

    return { ok: true, sql: `${finalSql} LIMIT 100` };
}

/**
 * Executes a validated query inside a read-only transaction under the
 * caller's authenticated role + JWT claims so RLS enforces row-level scoping.
 */
export async function runReadOnlyQuery(sql, userId) {
    if (!DB_URL) {
        throw new Error("SUPABASE_DB_URL secret is not set. Run: supabase secrets set SUPABASE_DB_URL=...");
    }
    const client = postgres(DB_URL, { max: 1, idle_timeout: 10 });
    try {
        await client.unsafe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        try {
            // Execute under the caller's identity so RLS policies enforce
            // row-level scoping even if the model-generated WHERE is weak.
            await client.unsafe("SET LOCAL ROLE authenticated");
            await client.unsafe(
                `SET LOCAL request.jwt.claims = '${JSON.stringify({ sub: userId, role: "authenticated" }).replace(/'/g, "''")}'`
            );
            await client.unsafe(`SET LOCAL request.jwt.claim.sub = '${userId}'`);
            return await client.unsafe(sql);
        } catch (innerErr) {
            try {
                await client.unsafe("ROLLBACK");
            } catch (rollbackErr) {
                console.error("rollback failed:", rollbackErr);
            }
            throw innerErr;
        }
    } finally {
        await client.end();
    }
}
