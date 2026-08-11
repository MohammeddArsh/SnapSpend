// =========================================================================
// SnapSpend AI Assistant — LLM client with tool (function) calling
//
// A stateful helper that runs the tool-call loop against either provider:
//   - "gemini"     -> Google Generative Language API (generateContent)
//   - "openrouter" -> OpenRouter chat completions (OpenAI-compatible)
//
// Both providers are driven through the same minimal interface so the
// orchestrator in index.ts stays provider-agnostic.
// =========================================================================

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY") || "";

export const DEFAULT_PROVIDER = "gemini";
export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";
export const DEFAULT_OPENROUTER_MODEL = "google/gemini-3.1-flash-lite";

const GEMINI_ENDPOINT = (model) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * A parsed model turn: either a plain text reply, a tool call, or both.
 */
export class ModelTurn {
    constructor({ text, toolCall, rawModelContent }) {
        this.text = text || undefined;
        this.toolCall = toolCall || undefined;
        this.rawModelContent = rawModelContent;
    }
}

/**
 * Stateful tool-call conversation with one model.
 */
export class AssistantLLM {
    /**
     * @param {object} opts
     * @param {"gemini"|"openrouter"} [opts.provider]
     * @param {string} [opts.model]
     * @param {string} opts.systemPrompt
     * @param {object} opts.tool - { name, description, parameters }
     */
    constructor({ provider = DEFAULT_PROVIDER, model, systemPrompt, tool }) {
        this.provider = provider === "openrouter" ? "openrouter" : "gemini";
        this.model = model || (this.provider === "openrouter" ? DEFAULT_OPENROUTER_MODEL : DEFAULT_GEMINI_MODEL);
        this.systemPrompt = systemPrompt;
        this.tool = tool;
        this.contents = null;   // Gemini conversation contents
        this.messages = null;   // OpenRouter message list
    }

    /** Starts the conversation with the user's question. */
    async start(question) {
        if (this.provider === "openrouter") {
            this.messages = [{ role: "user", content: question }];
            return this.openrouterTurn();
        }
        this.contents = [{ role: "user", parts: [{ text: question }] }];
        return this.geminiTurn();
    }

    /** Continues the conversation after a tool result (or tool error). */
    async continue(turn, toolResult) {
        if (this.provider === "openrouter") {
            this.messages.push(turn.rawModelContent);
            this.messages.push({
                role: "tool",
                tool_call_id: turn.toolCall.id,
                content: JSON.stringify(toolResult),
            });
            return this.openrouterTurn();
        }
        this.contents.push(turn.rawModelContent);
        this.contents.push({
            role: "user",
            parts: [{
                functionResponse: {
                    name: turn.toolCall.name,
                    id: turn.toolCall.id,
                    response: toolResult,
                },
            }],
        });
        return this.geminiTurn();
    }

    // ------------------------------------------------------------------
    // Gemini (generateContent + functionDeclarations)
    // ------------------------------------------------------------------

    async geminiTurn() {
        if (!GEMINI_API_KEY) {
            throw new Error("GEMINI_API_KEY secret is not set. Run: supabase secrets set GEMINI_API_KEY=...");
        }

        const payload = {
            systemInstruction: { parts: [{ text: this.systemPrompt }] },
            contents: this.contents,
            tools: [{ functionDeclarations: [this.tool] }],
            generationConfig: { temperature: 0.1 },
        };

        const res = await fetch(GEMINI_ENDPOINT(this.model), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Gemini API error (HTTP ${res.status}): ${text.slice(0, 500)}`);
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
                thoughtSignature: fcPart.thoughtSignature || content.thoughtSignature,
            };
        }

        return new ModelTurn({ text: textPart?.text, toolCall, rawModelContent: content });
    }

    // ------------------------------------------------------------------
    // OpenRouter (chat/completions + tools)
    // ------------------------------------------------------------------

    async openrouterTurn() {
        if (!OPENROUTER_API_KEY) {
            throw new Error("OPENROUTER_API_KEY secret is not set. Run: supabase secrets set OPENROUTER_API_KEY=...");
        }

        const payload = {
            model: this.model,
            temperature: 0.1,
            messages: [{ role: "system", content: this.systemPrompt }, ...this.messages],
            tools: [{
                type: "function",
                function: {
                    name: this.tool.name,
                    description: this.tool.description,
                    parameters: this.tool.parameters,
                },
            }],
            tool_choice: "auto",
        };

        const res = await fetch(OPENROUTER_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
            },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`OpenRouter API error (HTTP ${res.status}): ${text.slice(0, 500)}`);
        }

        const data = await res.json();
        const msg = data?.choices?.[0]?.message;
        if (!msg) throw new Error("OpenRouter returned an empty response.");

        let text;
        if (typeof msg.content === "string") {
            text = msg.content || undefined;
        } else if (Array.isArray(msg.content)) {
            text = msg.content.filter((c) => c.type === "text").map((c) => c.text).join("") || undefined;
        }

        let toolCall;
        if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            const call = msg.tool_calls[0];
            let args = {};
            try {
                args = JSON.parse(call.function.arguments || "{}");
            } catch (e) {
                args = { _parseError: String(e.message) };
            }
            toolCall = {
                name: call.function.name,
                id: call.id || `tc_${Date.now()}`,
                args,
            };
        }

        return new ModelTurn({ text, toolCall, rawModelContent: msg });
    }
}
