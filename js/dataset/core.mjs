// js/dataset/core.mjs
// Dataset-builder engine used by the headless CLI (eval/build-dataset.mjs).
//
// Mirrors the Python reference pipeline (snapspend_dataset_pipeline/):
//   - source receipt images in, per-setup JSON annotation folders out
//   - resume: files already written are skipped
//   - transient API errors retried with backoff
//
// I/O is injected so the exact same code runs in Node and in the browser.

import { callChatCompletion } from '../../eval/lib/openrouter.mjs';
import { RECEIPT_SCHEMA_PROMPT, TRANSCRIBE_PROMPT } from '../../eval/lib/prompts.mjs';
import { extractJSON, normalizeParsedOutput } from '../../eval/lib/normalize.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs every setup over every image.
 *
 * @param {object} opts
 * @param {Array} opts.images - [{name, stem, base64, mime}]
 * @param {Array} opts.setups - [{name, pipeline, model, structureModel, promptText, temperature}]
 * @param {string} opts.apiKey
 * @param {object} opts.output - { has(stem, setupName), write(stem, setupName, receiptJson) }
 * @param {object} [opts.pricing] - modelId -> {prompt, completion} for cost estimates
 * @param {number} [opts.delayMs=0]
 * @param {number} [opts.concurrency=2]
 * @param {boolean} [opts.noCache=false]
 * @param {Function} [opts.onProgress]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<Array<{setup, file, status, error, savedTo}>>}
 */
export async function buildDataset({
    images,
    setups,
    apiKey,
    output,
    pricing = {},
    delayMs = 0,
    concurrency = 2,
    noCache = false,
    onProgress = () => {},
    signal = null,
}) {
    const transcribeCache = new Map();
    const stats = new Map(); // setupName -> {ok, skip, error}
    const failures = new Map(); // setupName -> consecutive failures in this run
    const deadSetups = new Set(); // setups whose remaining files are skipped

    const tasks = [];
    for (const setup of setups) {
        stats.set(setup.name, { ok: 0, skip: 0, error: 0 });
        for (const image of images) {
            tasks.push(() =>
                processOne({ setup, image, apiKey, output, pricing, delayMs, noCache, transcribeCache, onProgress, stats, signal, failures, deadSetups })
            );
        }
    }

    await pool(tasks, concurrency);
    return {
        perFile: [...stats.values()].reduce((a, s) => ({ ok: a.ok + s.ok, skip: a.skip + s.skip, error: a.error + s.error }), { ok: 0, skip: 0, error: 0 }),
        bySetup: [...stats.entries()].map(([name, s]) => ({ setup: name, ...s })),
    };
}

async function processOne({ setup, image, apiKey, output, pricing, delayMs, noCache, transcribeCache, onProgress, stats, signal, failures, deadSetups }) {
    if (signal?.aborted) return;

    if (!noCache && output.has(image.stem, setup.name)) {
        stats.get(setup.name).skip++;
        onProgress({ setup: setup.name, file: image.name, status: 'skip' });
        return;
    }

    // Circuit breaker: stop grinding through a setup whose model is down.
    if (deadSetups.has(setup.name)) {
        stats.get(setup.name).error++;
        onProgress({
            setup: setup.name,
            file: image.name,
            status: 'error',
            error: 'Skipped: previous extractions failed (model rate-limited or congested)',
        });
        return;
    }

    try {
        const { result, costUsd, latencyMs } = await runSetup({
            setup, image, apiKey, pricing, delayMs, transcribeCache, signal,
        });
        if (signal?.aborted) return;
        await output.write(image.stem, setup.name, result);
        stats.get(setup.name).ok++;
        failures.set(setup.name, 0);
        onProgress({ setup: setup.name, file: image.name, status: 'ok', costUsd, latencyMs });
    } catch (err) {
        if (signal?.aborted) return;
        const count = (failures.get(setup.name) || 0) + 1;
        failures.set(setup.name, count);
        stats.get(setup.name).error++;
        if (count >= 3) {
            deadSetups.add(setup.name);
            onProgress({
                setup: setup.name,
                file: image.name,
                status: 'error',
                error: `Circuit breaker: 3 consecutive failures (${err.message.slice(0, 120)}) — skipping the remaining files; re-run later to retry.`,
            });
        } else {
            onProgress({ setup: setup.name, file: image.name, status: 'error', error: err.message });
        }
    }
}

const CANONICAL_EXTRACT = (parsed) => {
    try {
        return normalizeParsedOutput(parsed);
    } catch (err) {
        throw new Error(`Output normalization failed: ${err.message}`);
    }
};

async function runSetup({ setup, image, apiKey, pricing, delayMs, transcribeCache, signal }) {
    if (signal?.aborted) { throw new Error('aborted'); }

    if (setup.pipeline === 'ocr') {
        const cacheKey = `${setup.model}|${image.name}`;
        let transcript = transcribeCache.get(cacheKey);

        if (transcript === undefined) {
            const t0 = await callChatCompletion({
                apiKey,
                model: setup.model,
                temperature: 0,
                jsonMode: false,
                messages: [
                    { role: 'system', content: TRANSCRIBE_PROMPT },
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: 'Transcribe this receipt.' },
                            { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
                        ],
                    },
                ],
            });
            transcript = String(t0.content || '').trim();
            if (!transcript) throw new Error('Transcription returned empty text.');
            transcribeCache.set(cacheKey, transcript);
            if (delayMs > 0) await sleep(delayMs);
        }

        const t1 = await callChatCompletion({
            apiKey,
            model: setup.structureModel,
            temperature: setup.temperature ?? 0.1,
            jsonMode: true,
            messages: [
                { role: 'system', content: `${setup.promptText}\n\n${RECEIPT_SCHEMA_PROMPT}` },
                { role: 'user', content: transcript },
            ],
        });
        if (delayMs > 0) await sleep(delayMs);
        return { result: CANONICAL_EXTRACT(extractJSON(t1.content)), latencyMs: t1.latencyMs };
    }

    const t0 = await callChatCompletion({
        apiKey,
        model: setup.model,
        temperature: setup.temperature ?? 0.1,
        jsonMode: true,
        messages: [
            { role: 'system', content: `${setup.promptText}\n\n${RECEIPT_SCHEMA_PROMPT}` },
            {
                role: 'user',
                content: [
                    { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.base64}` } },
                    { type: 'text', text: 'Parse this receipt image into the JSON schema described above.' },
                ],
            },
        ],
    });
    if (delayMs > 0) await sleep(delayMs);
    return { result: CANONICAL_EXTRACT(extractJSON(t0.content)), latencyMs: t0.latencyMs };
}

function pool(tasks, concurrency) {
    if (tasks.length === 0) return Promise.resolve();
    let idx = 0;
    const workers = Array(Math.min(concurrency, tasks.length)).fill(0).map(async () => {
        while (idx < tasks.length) {
            const task = tasks[idx++];
            await task();
        }
    });
    return Promise.all(workers);
}