#!/usr/bin/env node
// eval/build-dataset.mjs
// Headless dataset builder — direct JS port of snapspend_dataset_pipeline/.
// Each setup annotates every image in eval/Dataset/Images and writes
//   eval/Dataset/<setup-name>/<stem>.json
// (mirroring ocr_gemini_3.1_flash_lite/ and gemini_3.6/ in the Python repo).
//
// Resumable: existing JSON files are skipped; transient API errors retried
// with backoff; re-running the same command finishes the leftovers.

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { readFileSync } from 'node:fs';

import { DATASET_SETUPS } from './config.mjs';
import { DIRECT_PROMPTS, OCR_PROMPTS, findPrompt } from './lib/prompts.mjs';
import { fetchCatalog, findModel, listFreeVisionModels, printFreeVisionModels } from './lib/models.mjs';
import { buildDataset } from '../js/dataset/core.mjs';

// ---------------------------------------------------------------- env

function loadEnvFile(filePath) {
    try {
        const text = readFileSync(filePath, 'utf8');
        const out = {};
        for (const line of text.split('\n')) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
            if (m && !line.trim().startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
        return out;
    } catch {
        return {};
    }
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

function usage() {
    console.log(`Usage: node eval/build-dataset.mjs [options]

  Annotates every receipt image with one JSON per setup (resumable).

  Options:
    --setups a,b,c          Only run the given setup names (default: all)
    --models a,b,c          Override the vision model for direct setups
    --limit N               Cap images per setup (quick runs)
    --pipeline direct|ocr   Restrict to one pipeline
    --prompts ids           Prompt ids for the structurings
    --transcribe-model id   OCR transcription model [google/gemma-4-26b-a4b-it:free]
    --structure-model id    OCR structuring model [google/gemini-3.1-flash-lite]
    --images DIR            Source image dir [eval/Dataset/Images]
    --output DIR            Datasets root [eval/Dataset]
    --temperature T         [0.1]   --concurrency N  [2]   --delay-ms MS
    --no-cache              Rebuild existing JSONs (default: resume/skip)
    --dry-run               Print the plan without calling any API
    --list-models           Show live free vision models and exit
    --list-setups           Show available setups and exit
    -q, --quiet             No per-file progress lines`);
}

function parseArgs(argv) {
    const args = { setups: null, models: null, limit: null, pipeline: null, prompts: null,
        transcribeModel: 'google/gemma-4-26b-a4b-it:free', structureModel: 'google/gemini-3.1-flash-lite',
        images: 'eval/Dataset/Images', output: 'eval/Dataset',
        temperature: 0.1, concurrency: 2, delayMs: null, noCache: false,
        dryRun: false, listModels: false, listSetups: false, quiet: false };
    const take = (i) => argv[i + 1];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        switch (a) {
            case '--setups': args.setups = take(i)?.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
            case '--models': args.models = take(i)?.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
            case '--limit': args.limit = parseInt(take(i), 10); i++; break;
            case '--pipeline': args.pipeline = take(i); i++; break;
            case '--prompts': args.prompts = take(i)?.split(',').map((s) => s.trim()).filter(Boolean); i++; break;
            case '--transcribe-model': args.transcribeModel = take(i); i++; break;
            case '--structure-model': args.structureModel = take(i); i++; break;
            case '--images': args.images = take(i); i++; break;
            case '--output': args.output = take(i); i++; break;
            case '--temperature': args.temperature = parseFloat(take(i)); i++; break;
            case '--concurrency': args.concurrency = parseInt(take(i), 10); i++; break;
            case '--delay-ms': args.delayMs = parseInt(take(i), 10); i++; break;
            case '--no-cache': args.noCache = true; break;
            case '--dry-run': args.dryRun = true; break;
            case '--list-models': args.listModels = true; break;
            case '--list-setups': args.listSetups = true; break;
            case '-q': case '--quiet': args.quiet = true; break;
            case '-h': case '--help': usage(); process.exit(0); break;
            default: break;
        }
    }
    return args;
}

function resolveSetups(args, catalog) {
    let setups = DATASET_SETUPS.map((s) => ({ ...s }));
    if (args.pipeline) setups = setups.filter((s) => s.pipeline === args.pipeline);
    if (args.setups) {
        const wanted = new Set(args.setups);
        setups = setups.filter((s) => wanted.has(s.name));
    }
    if (args.models) {
        setups = setups.filter((s) => s.pipeline === 'ocr');
        for (const m of args.models) {
            setups.push({ name: `direct_${m.replace(/[/:]/g, '_')}`, pipeline: 'direct', model: m, promptId: 'default', temperature: args.temperature });
        }
    }
    if (args.prompts) {
        for (const s of setups) {
            const list = s.pipeline === 'ocr' ? OCR_PROMPTS : DIRECT_PROMPTS;
            const p = findPrompt(list, args.prompts[0]);
            if (p) s.promptId = p.id;
        }
    }
    if (args.pipeline === 'ocr') {
        for (const s of setups) {
            if (s.pipeline === 'ocr') {
                s.model = args.transcribeModel;
                s.structureModel = args.structureModel;
            }
        }
    }

    for (const s of setups) {
        const list = s.pipeline === 'ocr' ? OCR_PROMPTS : DIRECT_PROMPTS;
        const prompt = findPrompt(list, s.promptId) || list[0];
        s.promptText = prompt.text;
        s.promptLabel = prompt.label;
        s.temperature = s.temperature ?? args.temperature;
    }

    // Warn about setups whose models are unavailable / dangerous.
    if (catalog) {
        for (const s of setups) {
            for (const id of [s.model, s.structureModel]) {
                if (id && !findModel(catalog, id)) {
                    console.warn(`  Model not found in the live catalog (may fail): ${id}`);
                }
            }
        }
    }
    return setups;
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

    const setups = resolveSetups(args, catalog);

    if (args.listSetups) {
        console.log('Available setups:\n');
        for (const s of setups) {
            const p = s.promptLabel;
            console.log(`  ${s.name.padEnd(30)} ${s.pipeline.padEnd(7)} model=${s.model}`);
            if (s.pipeline === 'ocr') console.log(`  ${' '.repeat(30)}      structure=${s.structureModel} prompt=${p}`);
            else console.log(`  ${' '.repeat(30)}      prompt=${p}`);
        }
        process.exit(0);
    }

    if (setups.length === 0) {
        console.error('No setups selected.');
        process.exit(1);
    }

    const images = await loadImages(args.images, args.limit);
    if (images.length === 0) {
        console.error(`No receipt images found in ${args.images}`);
        process.exit(1);
    }

    // Free-tier pacing by default; explicit --delay-ms overrides.
    const delayMs = args.delayMs !== null ? args.delayMs : setups.some((s) => /:free$/.test(s.model)) ? 3100 : 250;

    if (args.dryRun) {
        console.log(`DRY RUN — ${setups.length} setup(s) x ${images.length} image(s)\n`);
        for (const s of setups) {
            console.log(`  ${s.name}`);
            console.log(`      pipeline=${s.pipeline} model=${s.model}${s.structureModel ? ` structure=${s.structureModel}` : ''} prompt=${s.promptLabel} temp=${s.temperature}`);
        }
        console.log(`\nImages: ${args.images} (${images.length}) | output: ${args.output}/<setup>/<stem>.json`);
        console.log(`Concurrency: ${args.concurrency} | pacing: ${delayMs}ms/call`);
        process.exit(0);
    }

    console.log(`Images: ${images.length} | Setups: ${setups.length} | Pacing: ${delayMs}ms\n`);

    const output = {
        has: (stem, setupName) => {
            try { readFileSync(path.join(args.output, setupName, `${stem}.json`), 'utf8'); return true; } catch { return false; }
        },
        write: async (stem, setupName, receipt) => {
            const dir = path.join(args.output, setupName);
            await mkdir(dir, { recursive: true });
            await writeFile(path.join(dir, `${stem}.json`), JSON.stringify(receipt, null, 2));
        },
    };

    let processed = 0;
    const aborter = new AbortController();
    const onSig = () => { console.log('\nAborting (written files are kept for resume)...'); aborter.abort(); };
    process.on('SIGINT', onSig);

    const result = await buildDataset({
        images,
        setups,
        apiKey,
        output,
        pricing: {},
        delayMs,
        concurrency: args.concurrency,
        noCache: args.noCache,
        signal: aborter.signal,
        onProgress: ({ setup, file, status, error }) => {
            processed++;
            const tag = status === 'ok' ? 'OK  ' : status === 'skip' ? 'SKIP' : 'FAIL';
            if (!args.quiet) console.log(`  ${tag} [${setup}] ${file}${error ? ` — ${error.slice(0, 140)}` : ''}`);
            if (processed % 20 === 0 && !args.quiet) console.log(`  ... ${processed}/${images.length * setups.length}`);
        },
    });

    if (result.perFile.error === 0) {
        console.log(`\nDone. ${result.perFile.ok} built, ${result.perFile.skip} skipped, ${result.perFile.error} failed.`);
    } else {
        console.log(`\nFinished: ${result.perFile.ok} built, ${result.perFile.skip} skipped, ${result.perFile.error} FAILED (re-run to retry).`);
    }
    console.log('Output saved under ' + path.resolve(args.output) + '/<setup-name>/<stem>.json');
    console.log('\nBenchmark this annotation set (images always come from eval/Dataset/Images):\n  node eval/run-eval.mjs --dataset <setup-name>');
    process.exit(result.perFile.error > 0 ? 1 : 0);
}

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

main().catch((err) => {
    console.error(err);
    process.exit(1);
});