// js/eval/eval.js
// Evaluation harness: benchmarks multiple models × system prompts on receipt
// images against ground-truth JSON and reports accuracy metrics.

import { parseReceiptWithModel, DEFAULT_SYSTEM_PROMPT, RECEIPT_SCHEMA_PROMPT, DEFAULT_OPENROUTER_MODELS, DEFAULT_GEMINI_MODEL } from '../parserEngine.js';
import { scoreReceipt, summarizeScores, overallScore } from './metrics.js';
import { setupThemeToggle } from '../theme.mjs';
import { FREE_DELAY_MS, PAID_DELAY_MS } from '../../eval/config.mjs';

const refreshIcons = () => { if (window.lucide) window.lucide.createIcons(); };

const GEMINI_MODELS = [DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash', 'gemini-2.5-flash'];

const DEFAULT_PROMPTS = [
    DEFAULT_SYSTEM_PROMPT,
    "Extract every field from this receipt image into structured JSON. Be extremely careful with the total: prefer the explicit TOTAL/SUM line over summing items. Return empty string for a missing date. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories."
];

const state = {
    images: [],          // [{ file, name, stem }]
    groundTruth: {},     // stem/name -> truth receipt JSON
    truthCount: 0,
    provider: 'openrouter',
    models: [],
    prompts: [],
    temperature: 0.1,
    results: []
};

document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle();

    // Provider toggle
    document.querySelectorAll('input[name="provider"]').forEach(radio => {
        radio.addEventListener('change', () => {
            state.provider = radio.value;
            renderModelCheckboxes();
        });
    });

    // Dataset reload (data always comes from eval/Dataset)
    document.getElementById('eval-dataset-reload').addEventListener('click', loadDataset);

    // Prompt presets
    document.getElementById('prompt-preset-simple').addEventListener('click', () => {
        document.getElementById('eval-prompts').value = DEFAULT_PROMPTS[0];
    });
    document.getElementById('prompt-preset-careful').addEventListener('click', () => {
        document.getElementById('eval-prompts').value = DEFAULT_PROMPTS[1];
    });

    // Run
    document.getElementById('btn-run-eval').addEventListener('click', runEvaluation);

    // Export
    document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
    document.getElementById('btn-export-json').addEventListener('click', exportJSON);

    renderModelCheckboxes();
    updateRunGate();
    loadDataset();
});

// ---------------------------------------------------------------- dataset

/**
 * Loads receipt images + ground truth from eval/Dataset (dev server / build
 * output). Images come from eval/Dataset/Images/N.jpeg and each paired truth
 * from eval/Dataset/ground_truth/<stem>.json — matched by numeric basename.
 */
async function loadDataset() {
    const statusEl = document.getElementById('eval-dataset-status');
    const summaryEl = document.getElementById('eval-dataset-summary');

    statusEl.innerHTML = `<span class="inline-flex items-center gap-1.5">
        <span class="w-3 h-3 rounded-full border-2 border-brand-500/30 border-t-brand-600 dark:border-t-brand-400 animate-spin"></span>
        Loading dataset from eval/Dataset…</span>`;
    summaryEl.classList.add('hidden');

    const images = [];
    for (let n = 1; n <= 200; n++) {
        const name = `${n}.jpeg`;
        try {
            const res = await fetch(`/eval/Dataset/Images/${name}`);
            if (!res.ok) break;
            const type = res.headers.get('content-type') || '';
            if (!type.startsWith('image/')) break; // Vite SPA fallback returns index.html
            const blob = await res.blob();
            const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
            images.push({ file, name, stem: String(n) });
        } catch {
            break;
        }
    }

    const groundTruth = {};
    let truthCount = 0;
    for (const img of images) {
        try {
            const res = await fetch(`/eval/Dataset/ground_truth/${img.stem}.json`);
            if (!res.ok) continue;
            const type = res.headers.get('content-type') || '';
            if (!type.includes('json')) continue; // Vite SPA fallback returns index.html
            const receipt = await res.json();
            groundTruth[img.stem] = receipt;
            groundTruth[img.name] = receipt;
            truthCount++;
        } catch { /* no truth for this receipt */ }
    }

    state.images = images;
    state.groundTruth = groundTruth;
    state.truthCount = truthCount;
    renderDatasetSummary();
    updateRunGate();

    if (images.length === 0) {
        statusEl.innerHTML = `<span class="inline-flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
            <i data-lucide="alert-circle" class="w-3.5 h-3.5 shrink-0"></i> eval/Dataset not reachable — run with \`npm run dev\` so the dev server serves the folder.</span>`;
        refreshIcons();
        updateStatus('Could not reach eval/Dataset — run with `npm run dev` so the dev server serves the folder.', 'err');
        return;
    }

    statusEl.innerHTML = `<span class="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
        <i data-lucide="check-circle-2" class="w-3.5 h-3.5 shrink-0"></i> Dataset ready — eval/Dataset</span>`;
    refreshIcons();
    updateStatus(`Dataset loaded: ${images.length} image(s), ${truthCount} ground-truth file(s).`, 'ok');
}

function renderDatasetSummary() {
    const summaryEl = document.getElementById('eval-dataset-summary');
    if (state.images.length === 0) {
        summaryEl.classList.add('hidden');
        return;
    }
    const missing = state.images.filter(i => !state.groundTruth[i.stem]).length;
    document.getElementById('eval-ds-images').textContent = state.images.length;
    document.getElementById('eval-ds-truths').textContent = state.truthCount || 0;
    document.getElementById('eval-ds-missing').textContent = missing;
    summaryEl.classList.remove('hidden');
}

function updateRunGate() {
    const btn = document.getElementById('btn-run-eval');
    const disabled = state.images.length === 0;
    btn.disabled = disabled;
    btn.classList.toggle('opacity-50', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
    btn.title = disabled ? 'Load the dataset first (eval/Dataset was not found)' : '';
}

function renderModelCheckboxes() {
    const container = document.getElementById('eval-model-checkboxes');
    const defaults = state.provider === 'openrouter' ? DEFAULT_OPENROUTER_MODELS : GEMINI_MODELS;

    container.innerHTML = defaults.map((m, i) => `
        <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" class="eval-model-cb accent-brand-600 dark:accent-brand-400" value="${m}" ${i === 0 ? 'checked' : ''} />
            <span class="font-mono">${m}</span>
        </label>
    `).join('') + `
        <div class="flex items-center gap-2 pt-1">
            <input type="text" id="eval-custom-model" placeholder="custom/model-id (adds a model)" class="flex-1 px-2 py-1 text-xs font-mono border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 rounded-lg outline-none focus:border-brand-400 dark:text-slate-100" />
            <button id="btn-add-custom-model" class="text-[11px] font-bold text-brand-600 dark:text-brand-400 bg-brand-gradient-soft hover:brightness-105 border border-brand-200 dark:border-brand-500/30 rounded-lg px-2.5 py-1 transition-all cursor-pointer">+ Add</button>
        </div>
    `;

    document.getElementById('btn-add-custom-model').addEventListener('click', () => {
        const input = document.getElementById('eval-custom-model');
        const model = input.value.trim();
        if (!model) return;
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none';
        label.innerHTML = `<input type="checkbox" class="eval-model-cb accent-brand-600 dark:accent-brand-400" value="${model}" checked /><span class="font-mono">${model}</span>`;
        container.insertBefore(label, container.querySelector('div.flex.items-center.gap-2.pt-1'));
        input.value = '';
    });
}

function collectConfig() {
    state.models = Array.from(document.querySelectorAll('.eval-model-cb:checked')).map(cb => cb.value);
    state.prompts = document.getElementById('eval-prompts').value.split('\n').map(s => s.trim()).filter(Boolean);
    state.temperature = parseFloat(document.getElementById('eval-temperature').value) || 0.1;
}

async function runEvaluation() {
    collectConfig();
    const runBtn = document.getElementById('btn-run-eval');
    const progress = document.getElementById('eval-progress');
    const progressBar = document.getElementById('eval-progress-bar');
    const resultsEl = document.getElementById('eval-results');

    if (state.images.length === 0) {
        updateStatus('Dataset not loaded — eval/Dataset could not be reached. Run with `npm run dev`.', 'err');
        return;
    }
    if (state.models.length === 0 || state.prompts.length === 0) {
        updateStatus('Select at least one model and one system prompt.', 'err');
        return;
    }

    const combos = [];
    for (const model of state.models) {
        for (const prompt of state.prompts) {
            combos.push({ provider: state.provider, model, prompt });
        }
    }

    // Free tiers are limited to ~20 req/min — pace them; paid tiers only need a light gap.
    const hasFreeModel = state.models.some(m => /:free$/.test(m) || m === 'openrouter/free');
    const delayMs = hasFreeModel ? FREE_DELAY_MS : PAID_DELAY_MS;

    runBtn.disabled = true;
    progress.classList.remove('hidden');
    state.results = [];

    const total = combos.length * state.images.length;
    let done = 0;
    let stoppedEarly = null;
    const congestedModels = new Set();

    for (const combo of combos) {
        const perReceipt = [];
        const scores = [];
        let errors = 0;
        let consecutiveFailures = 0;

        for (const img of state.images) {
            const truth = state.groundTruth[img.name] ?? state.groundTruth[img.stem] ?? null;
            try {
                const predicted = await parseReceiptWithModel({
                    file: img.file,
                    provider: combo.provider,
                    model: combo.model,
                    systemPrompt: combo.prompt,
                    temperature: state.temperature
                });

                const score = truth ? scoreReceipt(truth, predicted) : null;
                if (score) scores.push(score);

                perReceipt.push({ file: img.name, truth: truth || null, predicted, score });
                consecutiveFailures = 0;
            } catch (err) {
                errors++;
                consecutiveFailures++;
                // Failed extractions are recorded as errors, never scored as zeros.
                perReceipt.push({ file: img.name, truth: truth || null, predicted: null, error: err.message });

                if (err.upstreamCongestion) congestedModels.add(combo.model);
                if (err.dailyQuota) {
                    // Hard daily cap — retrying the rest of the run is pointless.
                    stoppedEarly = err.message;
                    break;
                }
                if (consecutiveFailures >= 3) {
                    // No point grinding the rest of this combo through the same rate limit.
                    break;
                }
            }
            done++;
            progressBar.style.width = `${(done / total) * 100}%`;
            document.getElementById('eval-progress-label').textContent =
                `Running ${combo.model} — ${done}/${total} extractions${delayMs ? ` (pacing ${(delayMs / 1000).toFixed(1)}s/call)` : ''}`;
            const pctEl = document.getElementById('eval-progress-pct');
            if (pctEl) pctEl.textContent = `${done}/${total}`;
            if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
        }

        // Summaries only cover extractions that actually succeeded.
        const summary = scores.length ? summarizeScores(scores) : null;
        if (summary) {
            summary.overallScore = overallScore(summary);
            summary.errors = errors;
        }

        state.results.push({ ...combo, summary, perReceipt, errors });

        if (stoppedEarly) break;
    }

    progressBar.style.width = '100%';
    document.getElementById('eval-progress-label').textContent = 'Done.';
    runBtn.disabled = false;

    if (stoppedEarly) {
        updateStatus(`Stopped early — daily quota exhausted. Partial results below. ${stoppedEarly}`, 'err');
    } else if (congestedModels.size) {
        updateStatus(
            `Partial run — ${[...congestedModels].join(', ')} is temporarily congested in the shared free pool (HTTP 429). ` +
            `Results are partial; try another free model or retry later.`,
            'err'
        );
    } else {
        const errTotal = state.results.reduce((a, r) => a + (r.errors || 0), 0);
        updateStatus(
            `Evaluation complete: ${combos.length} combination(s), ${state.images.length} receipt(s)` +
            (errTotal ? `, ${errTotal} failed extraction(s) — results are partial.` : '.'),
            errTotal ? 'err' : 'ok'
        );
    }
    renderResults();
    setTimeout(() => progress.classList.add('hidden'), 800);
}

function renderResults() {
    const resultsEl = document.getElementById('eval-results');
    const scored = state.results.filter(r => r.summary);
    const unscored = state.results.filter(r => !r.summary);

    if (state.results.length === 0) {
        resultsEl.innerHTML = `<p class="text-xs text-slate-400 dark:text-slate-500 py-6 text-center">No results yet.</p>`;
        return;
    }

    const bestScore = scored.length ? Math.max(...scored.map(r => r.summary.overallScore)) : -1;

    const metricRow = (r) => {
        const s = r.summary;
        const best = s && s.overallScore === bestScore;
        const cls = best ? 'bg-brand-gradient-soft font-bold' : '';
        if (!s) {
            const msg = r.errors
                ? `All ${r.errors} extraction(s) failed (rate limit / API error) — see per-receipt details`
                : 'No ground truth scored — outputs parsed but not graded';
            return `<tr class="${cls}"><td colspan="100%" class="text-center text-[11px] text-amber-600 dark:text-amber-400 py-2">${msg}</td></tr>`;
        }

        // Rates are already 0-100 in the summary (pct()); only ratios are 0-1.
        const cells = [
            s.validRate, s.vendorNormRate, s.dateExactRate, s.totalExactRate,
            s.totalRelErrAvg !== null ? s.totalRelErrAvg * 100 : null,
            s.itemCountMatchRate, s.itemNameF1Avg !== null ? s.itemNameF1Avg * 100 : null,
            s.qtyMatchRate, s.priceRelErrAvg !== null ? s.priceRelErrAvg * 100 : null,
            s.categoryMatchRate
        ].map(v => v === null ? '<span class="text-slate-300 dark:text-slate-600">—</span>' : typeof v === 'number' ? v.toFixed(1) + '%' : String(v));

        return `
            <tr class="${cls} border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all">
                <td class="px-3 py-2 font-mono text-[11px] text-brand-600 dark:text-brand-400">${r.model}</td>
                <td class="px-3 py-2 text-[11px] text-slate-600 dark:text-slate-300 max-w-[260px] truncate" title="${r.prompt}">${r.prompt}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] font-bold ${best ? 'text-brand-600 dark:text-brand-400' : 'text-slate-700 dark:text-slate-200'}">${s.overallScore.toFixed(1)}</td>
                ${cells.map(c => `<td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${c}</td>`).join('')}
                <td class="px-3 py-2 text-right font-mono text-[11px] ${(r.errors || 0) ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-400 dark:text-slate-500'}">${r.errors || 0}</td>
                <td class="px-3 py-2 text-center">
                    <button class="combo-detail-btn text-[10px] font-bold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer" data-idx="${state.results.indexOf(r)}">view</button>
                </td>
            </tr>
        `;
    };

    resultsEl.innerHTML = `
        <div class="bento-card overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">Benchmark Results</h3>
                <span class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">best = highest overall score</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        <tr>
                            <th class="px-3 py-2">Model</th>
                            <th class="px-3 py-2">System Prompt</th>
                            <th class="px-3 py-2 text-right">Overall</th>
                            <th class="px-3 py-2 text-right">Valid</th>
                            <th class="px-3 py-2 text-right">Vendor</th>
                            <th class="px-3 py-2 text-right">Date</th>
                            <th class="px-3 py-2 text-right">Total Exact</th>
                            <th class="px-3 py-2 text-right">Total Err</th>
                            <th class="px-3 py-2 text-right">Item Count</th>
                            <th class="px-3 py-2 text-right">Name F1</th>
                            <th class="px-3 py-2 text-right">Qty</th>
                            <th class="px-3 py-2 text-right">Price Err</th>
                            <th class="px-3 py-2 text-right">Category</th>
                            <th class="px-3 py-2 text-right">Err</th>
                            <th class="px-3 py-2 text-center"></th>
                        </tr>
                    </thead>
                    <tbody>
                        ${state.results.map(metricRow).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
    refreshIcons();

    resultsEl.querySelectorAll('.combo-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => openComboDetail(parseInt(btn.getAttribute('data-idx'), 10)));
    });
}

function openComboDetail(idx) {
    const combo = state.results[idx];
    const rows = combo.perReceipt.map(p => {
        const s = p.score;
        const status = p.error ? 'error' : s ? 'scored' : 'parsed (no truth)';
        const color = p.error ? 'text-rose-600 dark:text-rose-400' : s ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400';
        return `
            <tr class="border-t border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-all">
                <td class="px-3 py-2 font-mono text-[11px] text-slate-700 dark:text-slate-200">${p.file}</td>
                <td class="px-3 py-2 text-[11px] font-bold ${color}">${status}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s ? (s.vendorExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s ? (s.dateExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s ? (s.totalExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s && s.totalRelErr !== null ? (s.totalRelErr * 100).toFixed(1) + '%' : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s && s.itemNameF1 !== null ? (s.itemNameF1 * 100).toFixed(0) + '%' : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] text-slate-600 dark:text-slate-300">${s && s.categoryMatch !== null ? (s.categoryMatch * 100).toFixed(0) + '%' : ''}</td>
                <td class="px-3 py-2 text-center">
                    <button class="receipt-detail-btn text-[10px] font-bold text-brand-600 dark:text-brand-400 hover:underline cursor-pointer" data-idx="${combo.perReceipt.indexOf(p)}">JSON</button>
                </td>
            </tr>
        `;
    }).join('');

    const overlay = document.getElementById('eval-modal');
    const container = document.getElementById('eval-modal-container');
    container.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">${combo.model}</h3>
            <button id="eval-modal-close" class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">✕</button>
        </div>
        <div class="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 dark:bg-slate-800/60 text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
                    <tr>
                        <th class="px-3 py-2">Receipt</th>
                        <th class="px-3 py-2">Status</th>
                        <th class="px-3 py-2 text-right">Vendor</th>
                        <th class="px-3 py-2 text-right">Date</th>
                        <th class="px-3 py-2 text-right">Total</th>
                        <th class="px-3 py-2 text-right">Total Err</th>
                        <th class="px-3 py-2 text-right">Name F1</th>
                        <th class="px-3 py-2 text-right">Category</th>
                        <th class="px-3 py-2"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
    refreshIcons();
    overlay.classList.remove('hidden');

    document.getElementById('eval-modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.classList.add('hidden'); });

    container.querySelectorAll('.receipt-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => openReceiptJSON(combo, parseInt(btn.getAttribute('data-idx'), 10)));
    });
}

function openReceiptJSON(combo, idx) {
    const p = combo.perReceipt[idx];
    const overlay = document.getElementById('eval-modal');
    const container = document.getElementById('eval-modal-container');
    container.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100 font-mono">${p.file} — ${combo.model}</h3>
            <button id="eval-modal-close" class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">✕</button>
        </div>
        <div class="space-y-3 text-xs font-mono max-h-[60vh] overflow-y-auto">
            ${p.error ? `<pre class="bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/30 rounded-xl p-3 text-rose-700 dark:text-rose-300 whitespace-pre-wrap">Error: ${p.error}</pre>` : ''}
            <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold mb-1">Predicted</p>
                <pre class="bg-slate-900 text-emerald-300 rounded-xl p-3 text-[10px] overflow-x-auto">${JSON.stringify(p.predicted, null, 2)}</pre>
            </div>
            ${p.truth ? `
                <div>
                    <p class="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500 font-bold mb-1">Ground Truth</p>
                    <pre class="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-[10px] text-slate-700 dark:text-slate-300 overflow-x-auto">${JSON.stringify(p.truth, null, 2)}</pre>
                </div>
            ` : ''}
        </div>
    `;
    refreshIcons();
    document.getElementById('eval-modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
}

function updateStatus(msg, type) {
    const el = document.getElementById('eval-status');
    el.textContent = msg;
    el.className = 'text-xs mb-4 animate-fade-in ' + (type === 'err' ? 'text-rose-600 dark:text-rose-400' : type === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400');
}

function exportCSV() {
    const header = 'model,system_prompt,overall,valid_rate,vendor_rate,date_rate,total_exact_rate,total_rel_err,item_count_rate,name_f1,qty_rate,price_rel_err,category_rate,errors';
    const lines = state.results.map(r => {
        const s = r.summary;
        if (!s) return null;
        const f = v => (v === null || v === undefined ? '' : (typeof v === 'number' ? v.toFixed(4) : v));
        return [r.model, JSON.stringify(r.prompt.replace(/\n/g, ' ')), f(s.overallScore), f(s.validRate), f(s.vendorNormRate), f(s.dateExactRate), f(s.totalExactRate), f(s.totalRelErrAvg), f(s.itemCountMatchRate), f(s.itemNameF1Avg), f(s.qtyMatchRate), f(s.priceRelErrAvg), f(s.categoryMatchRate), r.errors || 0].join(',');
    }).filter(Boolean);

    download(`snapspend-eval-${new Date().toISOString().slice(0, 10)}.csv`, header + '\n' + lines.join('\n'), 'text/csv');
}

function exportJSON() {
    const payload = {
        generated_at: new Date().toISOString(),
        provider: state.provider,
        temperature: state.temperature,
        results: state.results
    };
    download(`snapspend-eval-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
}

function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
