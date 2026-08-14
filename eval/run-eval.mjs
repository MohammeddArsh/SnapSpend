#!/usr/bin/env node
// eval/run-eval.mjs
// CLI evaluation harness: benchmarks multiple pipelines (direct / OCR+LLM) x
// models x system prompts on receipt images against ground-truth JSON, using
// OpenRouter (free-first). Reports console table + summary.csv/json + report.md.

import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

import {
    DEFAULT_PROMPT_IDS,
    DEFAULT_TEMPERATURE,
    DEFAULT_CONCURRENCY,
    DEFAULT_DELAY_MS,
    FREE_DELAY_MS,
    PAID_DELAY_MS,
    DEFAULT_IMAGES_DIR,
    DEFAULT_TRUTH_DIR,
    DEFAULT_OUTPUT_DIR,
    EVAL_MODELS,
} from './config.mjs';
import { DIRECT_PROMPTS, OCR_PROMPTS, findPrompt } from './lib/prompts.mjs';
import { runPipeline } from './lib/pipelines.mjs';
import { fetchCatalog, findModel, isFreeModel, listFreeVisionModels, printFreeVisionModels } from './lib/models.mjs';
import { scoreReceipt, summarizeScores, overallScore } from '../js/eval/metrics.js';
import { printTable, writeReports } from './lib/report.mjs';

// ---------------------------------------------------------------- helpers

import { readFileSync } from 'node:fs';
const readFileSyncSafe = (p) => {
    try { return readFileSync(p, 'utf8'); } catch { return null; }
};

function loadEnvFile(filePath) {
    const text = readFileSyncSafe(filePath);
    if (!text) return {};
    const out = {};
    for (const line of text.split('\n')) {
        const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
}

function resolveApiKey() {
    const fromRoot = loadEnvFile(path.resolve('.env'));
    return (
        process.env.OPENROUTER_API_KEY ||
        process.env.VITE_OPENROUTER_API_KEY ||
        fromRoot.VITE_OPENROUTER_API_KEY ||
        fromRoot.OPENROUTER_API_KEY ||
        null
    );
}

// ---------------------------------------------------------------- args

function parseArgs(argv) {
    const args = { models: null, prompts: null, pipeline: 'all',
        limit: null, temperature: DEFAULT_TEMPERATURE, concurrency: DEFAULT_CONCURRENCY,
        delayMs: null, noCache: false, dryRun: false, listModels: false, output: DEFAULT_OUTPUT_DIR,
        images: DEFAULT_IMAGES_DIR, truth: DEFAULT_TRUTH_DIR, dataset: null,
        transcribeModel: 'google/gemma-4-26b-a4b-it:free', structureModel: 'google/gemini-3.1-flash-lite',
        quiet: false };
    const take = (i) => argv[i + 1];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--models': args.models = take(i)?.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
            case '--prompts': args.prompts = take(i)?.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
            case '--pipeline': args.pipeline = take(i); i++; break;
            case '--limit': args.limit = parseInt(take(i), 10); i++; break;
            case '--temperature': args.temperature = parseFloat(take(i)); i++; break;
            case '--concurrency': args.concurrency = parseInt(take(i), 10); i++; break;
            case '--delay-ms': args.delayMs = parseInt(take(i), 10); i++; break;
            case '--no-cache': args.noCache = true; break;
            case '--dry-run': args.dryRun = true; break;
            case '--list-models': args.listModels = true; break;
            case '--output': args.output = take(i); i++; break;
            case '--images': args.images = take(i); i++; break;
            case '--truth': args.truth = take(i); i++; break;
            case '--dataset': args.dataset = take(i); i++; break;
            case '--transcribe-model': args.transcribeModel = take(i); i++; break;
            case '--structure-model': args.structureModel = take(i); i++; break;
            case '--quiet': case '-q': args.quiet = true; break;
            case '-h': case '--help':
                console.log(`Usage: node eval/run-eval.mjs [options]

  Evaluation harness: pipelines x models x prompts on receipt images vs
  ground-truth JSON via OpenRouter (free-first).

  Options:
    --models a,b,c          Override direct-pipeline models (id or :free variant)
    --prompts ids           Prompt ids, comma-separated [default,careful,terse,german-aware]
    --pipeline direct|ocr|all
    --transcribe-model id   OCR-stage transcription model [google/gemma-4-26b-a4b-it:free]
    --structure-model id    OCR-stage structuring model [google/gemini-3.1-flash-lite]
    --dataset name          Truth from eval/Dataset/<name> (images stay in Images/)
    --images DIR            Receipt images dir [eval/Dataset/Images]
    --truth DIR             Ground-truth JSON dir [eval/Dataset/ground_truth]
    --limit N               Cap receipts per combination (quick runs)
    --temperature T         [0.1]  --concurrency N  [2]
    --delay-ms MS           Extra pacing between calls (free tiers: auto ~3.1s)
    --output DIR            Reports dir [eval/results]
    --no-cache              Disable resume cache  --dry-run  --list-models
    -q                      Quiet (no per-receipt progress lines)`);
                process.exit(0);
            default: break;
        }
    }
    return args;
}

// ---------------------------------------------------------------- loading

async function loadImages(dir, limit) {
    const entries = await readdir(dir).catch(() => []);
    const exts = new Set(['.jpeg', '.jpg', '.png', '.webp']);
    const files = entries
        .filter((f) => exts.has(path.extname(f).toLowerCase()))
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const selected = limit ? files.slice(0, limit) : files;
    return Promise.all(selected.map(async (name) => ({
        name,
        stem: path.basename(name, path.extname(name)),
        base64: (await readFile(path.join(dir, name))).toString('base64'),
        mime: `image/${path.extname(name).toLowerCase().slice(1) === 'jpg' ? 'jpeg' : path.extname(name).toLowerCase().slice(1)}`,
    })));
}

async function loadGroundTruth(dir) {
    const entries = await readdir(dir).catch(() => []);
    const truth = {};
    const looksLikeReceipt = (v) => v && typeof v === 'object' && !Array.isArray(v) && 'vendor' in v;
    for (const f of entries.filter((f) => f.endsWith('.json'))) {
        try {
            const parsed = JSON.parse(await readFile(path.join(dir, f), 'utf8'));
            if (looksLikeReceipt(parsed)) {
                truth[path.basename(f, '.json')] = parsed;
            } else if (parsed && typeof parsed === 'object') {
                // Bundled map keyed by stem or filename (e.g. from export tools).
                for (const [k, v] of Object.entries(parsed)) {
                    if (looksLikeReceipt(v)) truth[k.replace(/\.(jpeg|jpg|png|webp)$/i, '')] = v;
                }
            }
        } catch { /* skip malformed */ }
    }
    return truth;
}

function truthForImage(truthByStem, image) {
    return truthByStem[image.stem] || truthByStem[image.name] || null;
}

// ---------------------------------------------------------------- matrix

function buildMatrix(args) {
    const promptSets = { direct: DIRECT_PROMPTS, ocr: OCR_PROMPTS };
    let models = args.models
        ? args.models
        : EVAL_MODELS.free;
    const promptIds = args.prompts || DEFAULT_PROMPT_IDS;

    const combos = [];
    const pipelines = args.pipeline === 'all' ? ['direct', 'ocr'] : [args.pipeline];

    for (const p of pipelines) {
        if (p === 'ocr') {
            for (const promptId of promptIds) {
                const prompt = findPrompt(OCR_PROMPTS, promptId);
                if (!prompt) continue;
                combos.push({ pipeline: 'ocr', model: args.transcribeModel, structureModel: args.structureModel, promptId, promptText: prompt.text });
            }
        } else {
            for (const model of models) {
                for (const promptId of promptIds) {
                    const prompt = findPrompt(DIRECT_PROMPTS, promptId);
                    if (!prompt) continue;
                    combos.push({ pipeline: 'direct', model, promptId, promptText: prompt.text });
                }
            }
        }
    }
    return combos;
}

const cacheKeyOf = (combo, imageName) =>
    createHash('sha1').update(`${combo.pipeline}|${combo.model}|${combo.structureModel || ''}|${combo.promptId}|${imageName}`).digest('hex');

// ---------------------------------------------------------------- runner

async function runOne(combo, image, opts) {
    const { apiKey, pricing, cacheDir, noCache, delayMs } = opts;
    const cacheKey = cacheKeyOf(combo, image.name);
    const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

    if (!noCache) {
        try {
            const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
            if (cached && cached.result) {
                return { ...cached, cached: true };
            }
        } catch { /* miss */ }
    }

    const out = await runPipeline({
        apiKey,
        mode: combo.pipeline,
        model: combo.model,
        structureModel: combo.structureModel,
        promptId: combo.promptText,
        image,
        temperature: combo.temperature ?? DEFAULT_TEMPERATURE,
        delayMs,
        pricing,
        transcribeCache: opts.transcribeCache,
    });

    const record = {
        result: out.result,
        costUsd: out.costUsd,
        latencyMs: out.latencyMs,
        usage: out.usage,
        error: null,
        calls: out.calls,
    };
    if (!noCache) {
        await mkdir(cacheDir, { recursive: true }).catch(() => {});
        await writeFile(cacheFile, JSON.stringify(record)).catch(() => {});
    }
    return record;
}

function pool(tasks, concurrency) {
    let idx = 0;
    const workers = Array(Math.min(concurrency, tasks.length)).fill(0).map(async () => {
        while (idx < tasks.length) {
            const task = tasks[idx++];
            await task();
        }
    });
    return Promise.all(workers);
}

// ---------------------------------------------------------------- main

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const apiKey = resolveApiKey();

    const catalog = await fetchCatalog(apiKey).catch(() => null);
    if (args.listModels) {
        if (!catalog) { console.error('Could not fetch the model catalog.'); process.exit(1); }
        printFreeVisionModels(listFreeVisionModels(catalog));
        process.exit(0);
    }
    if (!apiKey) {
        console.error('Missing OpenRouter API key. Set OPENROUTER_API_KEY or VITE_OPENROUTER_API_KEY in .env.');
        process.exit(1);
    }

    const imagesDir = args.dataset ? DEFAULT_IMAGES_DIR : args.images;
    const truthDir = args.dataset ? path.join(path.dirname(DEFAULT_TRUTH_DIR), args.dataset) : args.truth;
    if (args.dataset && args.dataset.includes('/')) {
        console.error('--dataset takes a bare setup name (e.g. ocr_gemini_3.1_flash_lite).');
        process.exit(1);
    }
    if (args.dataset) {
        await stat(truthDir).catch(() => {
            console.error(`Dataset folder not found: ${truthDir}. Build it first with eval/build-dataset.mjs.`);
            process.exit(1);
        });
    }

    const images = await loadImages(imagesDir, args.limit);
    const truthByStem = await loadGroundTruth(truthDir);
    if (images.length === 0) {
        console.error(`No receipt images found in ${imagesDir}`);
        process.exit(1);
    }
    if (Object.keys(truthByStem).length === 0) {
        console.log(`Warning: no ground truth JSON found in ${truthDir} — outputs will be parsed but not graded.`);
    }

    const combos = buildMatrix(args);
    if (combos.length === 0) {
        console.error('No combinations to run. Check --pipeline / --prompts / --models.');
        process.exit(1);
    }

    const delayMs = args.delayMs ?? (comboIsFree(args, combos[0]) ? FREE_DELAY_MS : PAID_DELAY_MS);
    const pricing = {};
    if (catalog) {
        for (const id of new Set(combos.flatMap((c) => [c.model, c.structureModel]).filter(Boolean))) {
            const m = findModel(catalog, id);
            if (m) pricing[id] = m.pricing;
        }
    }

    const cacheDir = path.join(args.output, 'cache');
    const transcribeCache = new Map();
    const totalCalls = combos.length * images.length;

    if (args.dryRun) {
        console.log(`DRY RUN — ${combos.length} combination(s) x ${images.length} receipt(s) = ${totalCalls} extraction calls\n`);
        const isFreeModelId = (id) => (catalog ? isFreeModel(findModel(catalog, id) || { pricing: { prompt: '0.1', completion: '0.1' } }) : /:free$/.test(id));
        for (const c of combos) {
            const free = isFreeModelId(c.pipeline === 'direct' ? c.model : c.structureModel);
            const pricingStr = c.pipeline === 'direct' ? (catalog ? (findModel(catalog, c.model)?.pricing ?? '?') : '?') : '?';
            const f = (v) => (v === null || v === undefined ? '?' : `$${parseFloat(v) * 1e6 >= 1 ? (parseFloat(v) * 1e6).toFixed(2) + '/1M' : '<$0.01/1M'}`);
            const price = pricingStr === '?' ? '?' : f(pricingStr.prompt);
            console.log(`  ${c.pipeline.padEnd(6)} ${c.model.padEnd(52)} prompt=${c.promptId.padEnd(14)} ${free ? 'FREE' : 'paid'}  ${price}`);
            if (c.pipeline === 'ocr') console.log(`        structure=${c.structureModel}`);
        }
        console.log(`\nReceipts: ${imagesDir} (${images.length}) | truth: ${truthDir} (${Object.keys(truthByStem).length})`);
        console.log(`Concurrency: ${args.concurrency} | pacing: ${delayMs}ms/call`);
        if (totalCalls > 200) {
            console.log(`\nNOTE: ~${totalCalls} calls exceeds the default free-tier daily cap (200).`);
            console.log(`      Add credits (>= $10) for 1000 free calls/day, or use --limit / --prompts to shrink the run.`);
        }
        process.exit(0);
    }

    if (!args.quiet) {
        console.log(`Evaluating ${combos.length} combination(s) x ${images.length} receipt(s) = ${totalCalls} calls` +
            `\nReceipts: ${imagesDir}\nTruth: ${truthDir}\nPacing: ${delayMs}ms\n`);
    }

    // ------------------------------------------------------------- run
    const recordsByCombo = new Map(); // combo -> Map(imageName -> record)
    let done = 0;

    for (const combo of combos) {
        recordsByCombo.set(combo, new Map());
    }

    const tasks = [];
    const comboFailures = new Map(); // combo -> consecutive failures in this run
    const comboDead = new Set();     // combos whose remaining receipts are skipped

    for (let ci = 0; ci < combos.length; ci++) {
        const combo = combos[ci];
        for (const image of images) {
            tasks.push(async () => {
                const label = `${combo.pipeline}/${combo.model}/${combo.promptId} ${image.name}`;
                if (comboDead.has(combo)) {
                    recordsByCombo.get(combo).set(image.name, {
                        result: null, error: 'Skipped: previous extractions failed (model rate-limited or congested)', costUsd: null, latencyMs: null,
                    });
                    done++;
                    return;
                }
                try {
                    const rec = await runOne(combo, image, {
                        apiKey, pricing, cacheDir,
                        noCache: args.noCache,
                        delayMs,
                        transcribeCache,
                    });
                    recordsByCombo.get(combo).set(image.name, rec);
                    comboFailures.set(combo, 0);
                    if (!args.quiet) console.log(`  OK ${label}${rec.cached ? ' (cached)' : ''}`);
                } catch (err) {
                    const failures = (comboFailures.get(combo) || 0) + 1;
                    comboFailures.set(combo, failures);
                    recordsByCombo.get(combo).set(image.name, {
                        result: null, error: err.message, costUsd: null, latencyMs: null,
                    });
                    if (!args.quiet) console.log(`  ERR ${label}: ${err.message.slice(0, 120)}`);
                    if (failures >= 3) {
                        comboDead.add(combo);
                        if (!args.quiet) {
                            console.log(`  STOP ${combo.pipeline}/${combo.model}/${combo.promptId}: 3 consecutive failures — skipping the remaining receipts.`);
                            if (err.upstreamCongestion) {
                                console.log(`       Model is temporarily congested upstream — try another model or re-run later.`);
                            } else if (err.dailyQuota) {
                                console.log(`       Daily free quota exhausted — add credits or wait for the daily reset.`);
                            }
                        }
                    }
                }
                done++;
            });
        }
    }
    await pool(tasks, args.concurrency);

    // ------------------------------------------------------------- score
    const results = [];
    for (const combo of combos) {
        const perReceipt = [];
        const scores = [];
        const records = recordsByCombo.get(combo);
        for (const image of images) {
            const record = records.get(image.name);
            const truth = truthForImage(truthByStem, image);
            let score = null;
            if (record && record.result) {
                score = truth ? scoreReceipt(truth, record.result) : null;
                if (score) scores.push(score);
            }
            perReceipt.push({
                file: image.name,
                truth: truth || null,
                predicted: record?.result ?? null,
                score,
                error: record?.error ?? null,
                costUsd: record?.costUsd ?? null,
                latencyMs: record?.latencyMs ?? null,
            });
        }
        let summary = summarizeScores(scores);
        if (summary) {
            summary.overallScore = overallScore(summary);
            summary.errors = perReceipt.filter((p) => p.error).length;
            summary.avgLatencyMs = perReceipt.length
                ? Math.round(perReceipt.reduce((a, p) => a + (p.latencyMs || 0), 0) / perReceipt.filter((p) => p.latencyMs).length || 0)
                : null;
            summary.totalCostUsd = perReceipt.reduce((a, p) => a + (p.costUsd || 0), 0);
        }
        results[combos.indexOf(combo)] = {
            ...combo,
            temperature: combo.temperature ?? args.temperature,
            summary,
            perReceipt,
        };
    }

    console.log('\n=== RESULTS ===\n');
    printTable(results);

    const meta = {
        generated_at: new Date().toISOString(),
        provider: 'openrouter',
        temperature: args.temperature,
        images_dir: imagesDir,
        truth_dir: truthDir,
        dataset: args.dataset || null,
        receipts: images.length,
        dry_run: false,
    };
    await writeReports(results, meta, args.output);
    console.log(`\nReports written to ${path.resolve(args.output)}/ (summary.csv, summary.json, report.md, details/)`);

    const failed = results.filter((r) => r.summary && r.summary.errors > 0);
    if (failed.length) {
        console.log(`\n${failed.length} combination(s) had failed extractions — re-run later to retry them (errors are not cached), or check details/.`);
    }
    process.exit(results.some((r) => r.summary) ? 0 : 2);
}

function comboIsFree(args, combo) {
    const id = combo.pipeline === 'ocr' ? combo.structureModel : combo.model;
    return /:free$/.test(id) || id === 'openrouter/free';
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});