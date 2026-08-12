// eval/lib/openrouter.mjs
// Minimal OpenRouter chat-completions client shared by the evaluation CLI,
// the dataset builder CLI and the dataset builder UI. Pure ESM — works in
// Node >= 18 (global fetch) and in the browser via Vite.

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// OpenRouter free-tier limits: ~20 req/min (retryable) vs a hard daily cap
// ("free-models-per-day", "Add 10 credits to unlock 1000 free requests/day").
// Retrying a daily-quota 429 is pointless — fail fast with a clear error.
const isDailyQuota = (status, text) =>
    status === 429 && /free-models-per-day|per[- ]?day|daily|add \d+ credits/i.test(text);

const apiError = (status, message) => {
    const err = new Error(`OpenRouter API Error (HTTP ${status}): ${String(message).slice(0, 500)}`);
    err.status = status;
    return err;
};

const dailyQuotaError = (status, message) => {
    const err = apiError(status, message);
    err.dailyQuota = true;
    err.message =
        `OpenRouter daily free quota exhausted (HTTP 429). ` +
        `Add credits (>= $10) for 1000 free requests/day, switch to a paid model, or wait for the daily reset. ` +
        `(${String(message).slice(0, 200)})`;
    return err;
};

// Provider-level congestion of the shared free pool (e.g. Google AI Studio's
// ":free" models). Transient but can last minutes; distinct from the user's
// own account limits. Surfaced as a clear error once retries are exhausted.
const isUpstreamCongestion = (status, text) => {
    if (status !== 429 || !text) return false;
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    const meta = parsed?.error?.metadata ?? null;
    return (
        meta?.limit_source === "upstream_provider_shared_pool" ||
        /temporarily rate-limited upstream/i.test(meta?.raw || text)
    );
};

const congestionError = (model, status, message) => {
    const err = apiError(status, message);
    err.upstreamCongestion = true;
    err.message =
        `Model ${model} is temporarily congested in the upstream shared free pool (HTTP 429). ` +
        `Try another free model or retry later. ` +
        `(${String(message).slice(0, 200)})`;
    return err;
};

// Backoff in ms: honor the Retry-After header when present, else exponential.
const backoffMs = (response, attempt, baseDelayMs) => {
    const retryAfter = response?.headers?.get?.("Retry-After") ?? null;
    if (retryAfter) {
        const secs = /^\d+$/.test(retryAfter)
            ? parseInt(retryAfter, 10)
            : Math.max(0, Math.round((new Date(retryAfter).getTime() - Date.now()) / 1000));
        if (Number.isFinite(secs) && secs > 0) return Math.min(90, secs) * 1000;
    }
    return Math.min(60, 2 ** attempt) * baseDelayMs;
};

/**
 * Single chat-completions call with retry/backoff on transient errors and a
 * graceful JSON-mode downgrade: if a model rejects `response_format:
 * json_object`, the call is retried without it (the caller can still extract
 * JSON from the plain text).
 *
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model          - OpenRouter model id (":free" allowed)
 * @param {Array}  opts.messages       - [{role, content}]
 * @param {number} [opts.temperature=0.1]
 * @param {boolean} [opts.jsonMode=true]
 * @param {number} [opts.maxRetries=4]
 * @param {boolean} [opts.downgradeJson=true] - retry without json_object on rejection
 * @returns {Promise<{content: string, usage: object, latencyMs: number, model: string}>}
 */
export async function callChatCompletion({
    apiKey,
    model,
    messages,
    temperature = 0.1,
    jsonMode = true,
    maxRetries = 4,
    downgradeJson = true,
    baseDelayMs = 1000,
}) {
    let attempt = 0;
    let useJsonMode = jsonMode;

    while (true) {
        const payload = {
            model,
            temperature,
            max_tokens: 2048,
            messages,
        };
        if (useJsonMode) payload.response_format = { type: "json_object" };

        const started = Date.now();
        let response;
        try {
            response = await fetch(ENDPOINT, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            if (attempt < maxRetries) {
                attempt++;
                await sleep(backoffMs(null, attempt, baseDelayMs));
                continue;
            }
            throw new Error(`OpenRouter request failed: ${err.message}`);
        }

        if (response.ok) {
            const result = await response.json();
            // Some provider errors arrive as HTTP 200 with an error body.
            if (result?.error) {
                const status = Number(result.error.code) || 200;
                const errorText = result.error.message || JSON.stringify(result.error);
                if (isDailyQuota(status, errorText)) throw dailyQuotaError(status, errorText);
                if (RETRYABLE_STATUSES.has(status) && attempt < maxRetries) {
                    attempt++;
                    await sleep(backoffMs(null, attempt, baseDelayMs));
                    continue;
                }
                throw isUpstreamCongestion(status, errorText)
                    ? congestionError(model, status, errorText)
                    : apiError(status, errorText);
            }
            const message = result?.choices?.[0]?.message;
            const content = message?.content;
            if (!content && !message?.tool_calls?.length) {
                throw new Error("OpenRouter returned an empty response.");
            }
            const usage = result.usage || {};
            // OpenRouter returns negative usage fields for :free endpoints.
            const usable = (v) => (typeof v === "number" && v >= 0 ? v : 0);
            return {
                content: String(content || ""),
                usage: {
                    prompt_tokens: usable(usage.prompt_tokens),
                    completion_tokens: usable(usage.completion_tokens),
                },
                latencyMs: Date.now() - started,
                model: result.model || model,
            };
        }

        const errorText = await response.text().catch(() => "");
        const status = response.status;

        // JSON mode rejected (400 with a response_format complaint) -> downgrade.
        if (
            status === 400 &&
            useJsonMode &&
            downgradeJson &&
            /response_format|json_object|format/i.test(errorText)
        ) {
            useJsonMode = false;
            continue;
        }

        // A hard daily cap will not clear within a retry window — fail fast.
        if (isDailyQuota(status, errorText)) throw dailyQuotaError(status, errorText);

        if (RETRYABLE_STATUSES.has(status) && attempt < maxRetries) {
            attempt++;
            await sleep(backoffMs(response, attempt, baseDelayMs));
            continue;
        }

        // Retries exhausted — give a clear reason instead of a raw JSON blob.
        throw isUpstreamCongestion(status, errorText)
            ? congestionError(model, status, errorText)
            : apiError(status, errorText);
    }
}

/**
 * Converts cached token usage into an estimated USD cost.
 *
 * @param {{prompt_tokens: number, completion_tokens: number}} usage
 * @param {{prompt: string|number, completion: string|number}|null} pricing - per-token USD from the catalog
 */
export function estimateCostUsd(usage, pricing) {
    if (!pricing) return null;
    const costPerPrompt = parseFloat(pricing.prompt) || 0;
    const costPerCompletion = parseFloat(pricing.completion) || 0;
    return (
        (usage.prompt_tokens || 0) * costPerPrompt +
        (usage.completion_tokens || 0) * costPerCompletion
    );
}