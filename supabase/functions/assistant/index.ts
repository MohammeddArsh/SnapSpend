// =========================================================================
// SnapSpend AI Expense Assistant — Supabase Edge Function
//
// Tool-calling architecture:
//   1. Verify the caller's JWT (against SUPABASE_JWKS, auto-provisioned by
//      the platform — no manual secret needed) -> user_id
//   2. The LLM receives the question with a best-practice system prompt
//      (scope boundary, few-shot Q->SQL examples, schema context) and a
//      `query_expenses` tool declaration.
//   3. For in-scope questions the LLM calls the tool with the SQL to run;
//      the SQL is strictly validated (read-only, whitelisted tables) and
//      executed under the caller's RLS identity. Errors and rows are fed
//      back so the model can self-correct (max 3 tool rounds).
//   4. The LLM answers concisely with the grounded results.
//   5. Out-of-scope questions return the exact phrase
//      "I can't answer questions outside of my scope".
//
// Providers: "gemini" (default) or "openrouter" — see ASSISTANT_PROVIDER.
//
// Deploy:
//   supabase secrets set GEMINI_API_KEY=your-key        # gemini provider
//   supabase secrets set OPENROUTER_API_KEY=your-key    # openrouter provider
//   supabase functions deploy assistant
// =========================================================================

import { jwtVerify, createRemoteJWKSet } from "https://deno.land/x/jose@v5.9.6/index.ts";
import { SYSTEM_PROMPT, QUERY_EXPENSES_TOOL, OUT_OF_SCOPE_PHRASE } from "./prompts.ts";
import { validateSQL, runReadOnlyQuery } from "./sql.ts";
import { AssistantLLM, DEFAULT_PROVIDER, DEFAULT_GEMINI_MODEL, DEFAULT_OPENROUTER_MODEL } from "./llm.ts";

const JWKS_ENV = Deno.env.get("SUPABASE_JWKS") || "";
const PROVIDER = (Deno.env.get("ASSISTANT_PROVIDER") || DEFAULT_PROVIDER).toLowerCase() === "openrouter"
    ? "openrouter"
    : "gemini";
const GEMINI_MODEL = Deno.env.get("SQL_MODEL") || DEFAULT_GEMINI_MODEL;
const OPENROUTER_MODEL = Deno.env.get("OPENROUTER_MODEL") || DEFAULT_OPENROUTER_MODEL;

const MAX_TOOL_ROUNDS = 3;

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        // 1. Authenticate
        const authHeader = req.headers.get("Authorization") || "";
        const token = authHeader.replace(/^Bearer\s+/i, "");
        if (!token) {
            return json({ error: "Unauthorized: missing session token." }, 401);
        }
        const { payload } = await verifyAccessToken(token);
        const userId = payload.sub;
        if (!userId) {
            return json({ error: "Unauthorized: invalid token." }, 401);
        }

        // 2. Parse request
        const body = await req.json().catch(() => ({}));
        const question = typeof body.question === "string" ? body.question.trim() : "";
        if (!question) {
            return json({ error: "Please provide a question." }, 400);
        }

        // 3. Tool-calling loop
        const llm = new AssistantLLM({
            provider: body.provider === "openrouter" ? "openrouter" : PROVIDER,
            model: body.model || (body.provider === "openrouter" ? OPENROUTER_MODEL : GEMINI_MODEL),
            systemPrompt: SYSTEM_PROMPT,
            tool: QUERY_EXPENSES_TOOL,
        });

        let turn = await llm.start(question);
        let sqlUsed = null;
        let rows = [];
        let rounds = 0;

        while (turn.toolCall && rounds < MAX_TOOL_ROUNDS) {
            rounds++;
            const call = turn.toolCall;

            if (call.name !== QUERY_EXPENSES_TOOL.name) {
                turn = await llm.continue(turn, { error: `Unknown tool: ${call.name}` });
                continue;
            }

            const rawSql = String(call.args?.sql ?? "").trim();
            if (!rawSql) {
                turn = await llm.continue(turn, { error: "The tool call is missing a sql argument." });
                continue;
            }

            const validated = validateSQL(rawSql, userId);
            if (!validated.ok) {
                turn = await llm.continue(turn, { error: `The query was rejected: ${validated.reason}` });
                continue;
            }

            try {
                rows = await runReadOnlyQuery(validated.sql, userId);
                sqlUsed = validated.sql;
                turn = await llm.continue(turn, { rows });
            } catch (err) {
                console.error("query execution failed:", err.message);
                turn = await llm.continue(turn, { error: `The query failed to execute: ${err.message}` });
            }
        }

        // If the model still wants to call a tool after the cap, force a
        // final text answer from whatever it has.
        if (turn.toolCall) {
            turn = await llm.continue(turn, {
                error: "No more tool calls are allowed. Answer using the results already provided, or state that there is no matching data.",
            });
        }

        const answer = (turn.text || "").trim();
        if (!answer) {
            throw new Error("The assistant returned an empty response.");
        }

        return json({
            answer,
            sql: sqlUsed,
            rows: rows.slice(0, 50),
            outOfScope: answer === OUT_OF_SCOPE_PHRASE,
        });
    } catch (err) {
        console.error("assistant error:", err);
        return json({ error: `Assistant error: ${err.message}` }, 500);
    }
});

// ---------------------------------------------------------------------------
// JWT verification (SUPABASE_JWKS is auto-provisioned in hosted Edge Functions)
// ---------------------------------------------------------------------------

/**
 * Verifies the caller's access token against the project JWKS.
 * SUPABASE_JWKS is provided by the platform as either a remote JWKS URL or an
 * inline JSON Web Key Set — both are supported here.
 */
async function verifyAccessToken(token) {
    const jwksEnv = JWKS_ENV.trim();
    if (!jwksEnv) {
        throw new Error("SUPABASE_JWKS is not configured in the function environment.");
    }

    let jwks;
    if (/^https?:\/\//i.test(jwksEnv)) {
        jwks = createRemoteJWKSet(new URL(jwksEnv));
    } else {
        const parsed = JSON.parse(jwksEnv);
        jwks = Array.isArray(parsed) ? { keys: parsed } : parsed;
        if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) {
            throw new Error("SUPABASE_JWKS contains no usable keys.");
        }
    }

    const { payload } = await jwtVerify(token, jwks, { audience: "authenticated" });
    return payload;
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
}
