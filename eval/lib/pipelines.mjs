// eval/lib/pipelines.mjs
// Extraction pipelines shared by the evaluation CLI and the dataset builder.
//
//   direct : receipt image + system prompt -> vision model -> JSON
//   ocr    : stage 1 transcribe image -> raw text (free vision model),
//            stage 2 structure text -> JSON (flash-lite class model)
//
// Stage 1 of `ocr` is cached per (transcribe model, receipt) so multiple
// structurings reuse one transcription.

import { callChatCompletion, estimateCostUsd } from './openrouter.mjs';
import { RECEIPT_SCHEMA_PROMPT, TRANSCRIBE_PROMPT } from './prompts.mjs';
import { extractJSON, normalizeParsedOutput } from './normalize.mjs';

const STRUCTURE_MODEL = 'google/gemini-3.1-flash-lite';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function buildSystemContent(systemPrompt) {
    return `${systemPrompt}\n\n${RECEIPT_SCHEMA_PROMPT}`;
}

/**
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.mode - "direct" | "ocr"
 * @param {string} opts.model - model for direct vision parsing (or transcribe stage in ocr mode)
 * @param {string} [opts.structureModel=STRUCTURE_MODEL] - text-structuring model for ocr mode
 * @param {string} opts.promptId - id of the system prompt to use
 * @param {object} opts.image - { name, base64, mime }
 * @param {Array} [opts.prompts] - prompt lists available to the caller
 * @param {number} [opts.temperature=0.1]
 * @param {number} [opts.delayMs] - pacing between calls (free tiers)
 * @param {object} [opts.pricing] - model pricing map {modelId: {prompt, completion}} for cost estimates
 * @param {object} [opts.transcribeCache] - Map to cache stage-1 transcriptions by `${model}|${name}`
 * @returns {Promise<{result: object, usage: object, costUsd, latencyMs, calls: Array}>}
 */
export async function runPipeline({
    apiKey,
    mode,
    model,
    structureModel = STRUCTURE_MODEL,
    promptId,
    image,
    temperature = 0.1,
    delayMs = 0,
    pricing = {},
    transcribeCache = null,
}) {
    const calls = [];
    const startTotal = Date.now();
    let usage = { prompt_tokens: 0, completion_tokens: 0 };
    let costUsd = 0;

    const charged = (stageCall, stageModel) => {
        usage.prompt_tokens += stageCall.usage.prompt_tokens;
        usage.completion_tokens += stageCall.usage.completion_tokens;
        const stageCost = estimateCostUsd(stageCall.usage, pricing[stageModel] || null);
        if (stageCost !== null) costUsd += stageCost;
        calls.push({
            stage: stageCall.stage,
            model: stageModel,
            latencyMs: stageCall.latencyMs,
            usage: stageCall.usage,
        });
    };

    if (mode === 'ocr') {
        // ---- Stage 1: verbatim transcription, cached per model+receipt ----
        const cacheKey = `${model}|${image.name}`;
        let transcript = transcribeCache ? transcribeCache.get(cacheKey) : undefined;

        if (transcript === undefined) {
            const photo = {
                type: 'image_url',
                image_url: { url: `data:${image.mime};base64,${image.base64}` },
            };
            const t0 = await callChatCompletion({
                apiKey,
                model,
                temperature: 0,
                jsonMode: false,
                messages: [
                    { role: 'system', content: TRANSCRIBE_PROMPT },
                    { role: 'user', content: [{ type: 'text', text: 'Transcribe this receipt.' }, photo] },
                ],
            });
            transcript = String(t0.content || '').trim();
            calls.push({
                stage: 'transcribe',
                model,
                latencyMs: t0.latencyMs,
                usage: t0.usage,
            });
            usage.prompt_tokens += t0.usage.prompt_tokens;
            usage.completion_tokens += t0.usage.completion_tokens;
            const stageCost = estimateCostUsd(t0.usage, pricing[model] || null);
            if (stageCost !== null) costUsd += stageCost;

            if (transcribeCache) transcribeCache.set(cacheKey, transcript);
            if (delayMs > 0) await sleep(delayMs);
        } else {
            calls.push({ stage: 'transcribe', model, latencyMs: 0, usage: { prompt_tokens: 0, completion_tokens: 0 }, cached: true });
        }

        // ---- Stage 2: structure the transcript ----
        const t1 = await callChatCompletion({
            apiKey,
            model: structureModel,
            temperature,
            jsonMode: true,
            messages: [
                { role: 'system', content: buildSystemContent(promptId) },
                { role: 'user', content: transcript },
            ],
        });
        charged({ ...t1, stage: 'structure' }, structureModel);
        if (delayMs > 0) await sleep(delayMs);

        const parsed = extractJSON(t1.content);
        const result = normalizeParsedOutput(parsed);
        return { result, usage, costUsd, latencyMs: Date.now() - startTotal, calls };
    }

    // ---- direct: vision model sees the image ----
    const t0 = await callChatCompletion({
        apiKey,
        model,
        temperature,
        jsonMode: true,
        messages: [
            { role: 'system', content: buildSystemContent(promptId) },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
                    { type: 'text', text: 'Parse this receipt image into the JSON schema described above.' },
                ],
            },
        ],
    });
    charged({ ...t0, stage: 'direct' }, model);
    if (delayMs > 0) await sleep(delayMs);

    const parsed = extractJSON(t0.content);
    const result = normalizeParsedOutput(parsed);
    return { result, usage, costUsd, latencyMs: Date.now() - startTotal, calls };
}