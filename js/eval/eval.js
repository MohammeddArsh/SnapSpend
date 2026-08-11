// js/eval/eval.js
// Evaluation harness: benchmarks multiple models × system prompts on receipt
// images against ground-truth JSON and reports accuracy metrics.

import { parseReceiptWithModel, DEFAULT_SYSTEM_PROMPT, RECEIPT_SCHEMA_PROMPT, DEFAULT_OPENROUTER_MODELS, DEFAULT_GEMINI_MODEL } from '../parserEngine.js';
import { scoreReceipt, summarizeScores, overallScore } from './metrics.js';

const GEMINI_MODELS = [DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash', 'gemini-2.5-flash'];

const DEFAULT_PROMPTS = [
    DEFAULT_SYSTEM_PROMPT,
    "Extract every field from this receipt image into structured JSON. Be extremely careful with the total: prefer the explicit TOTAL/SUM line over summing items. Return empty string for a missing date. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories."
];

const state = {
    images: [],          // [{ file, name }]
    groundTruth: {},     // filename -> truth receipt JSON
    provider: 'openrouter',
    models: [],
    prompts: [],
    temperature: 0.1,
    results: []
};

document.addEventListener('DOMContentLoaded', () => {
    // Provider toggle
    document.querySelectorAll('input[name="provider"]').forEach(radio => {
        radio.addEventListener('change', () => {
            state.provider = radio.value;
            renderModelCheckboxes();
        });
    });

    // Images
    const imageInput = document.getElementById('eval-images');
    imageInput.addEventListener('change', (e) => {
        state.images = Array.from(e.target.files).map(f => ({ file: f, name: f.name }));
        updateStatus(`${state.images.length} receipt image(s) loaded.`, 'ok');
    });

    // Ground truth
    const truthInput = document.getElementById('eval-ground-truth');
    truthInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            state.groundTruth = JSON.parse(text);
            updateStatus(`Ground truth loaded (${Object.keys(state.groundTruth).length} receipts).`, 'ok');
        } catch (err) {
            updateStatus(`Invalid ground truth JSON: ${err.message}`, 'err');
        }
    });

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
});

function renderModelCheckboxes() {
    const container = document.getElementById('eval-model-checkboxes');
    const defaults = state.provider === 'openrouter' ? DEFAULT_OPENROUTER_MODELS : GEMINI_MODELS;

    container.innerHTML = defaults.map((m, i) => `
        <label class="flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none">
            <input type="checkbox" class="eval-model-cb accent-blue-600" value="${m}" ${i === 0 ? 'checked' : ''} />
            <span class="font-mono">${m}</span>
        </label>
    `).join('') + `
        <div class="flex items-center gap-2 pt-1">
            <input type="text" id="eval-custom-model" placeholder="custom/model-id (adds a model)" class="flex-1 px-2 py-1 text-xs font-mono border border-slate-200 rounded-lg outline-none focus:border-blue-500 bg-white" />
            <button id="btn-add-custom-model" class="text-[11px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg px-2.5 py-1 transition-all cursor-pointer">+ Add</button>
        </div>
    `;

    document.getElementById('btn-add-custom-model').addEventListener('click', () => {
        const input = document.getElementById('eval-custom-model');
        const model = input.value.trim();
        if (!model) return;
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none';
        label.innerHTML = `<input type="checkbox" class="eval-model-cb accent-blue-600" value="${model}" checked /><span class="font-mono">${model}</span>`;
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
        updateStatus('Add at least one receipt image first.', 'err');
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

    runBtn.disabled = true;
    progress.classList.remove('hidden');
    state.results = [];

    const total = combos.length * state.images.length;
    let done = 0;

    for (const combo of combos) {
        const perReceipt = [];
        const scores = [];
        let error = null;

        for (const img of state.images) {
            try {
                const predicted = await parseReceiptWithModel({
                    file: img.file,
                    provider: combo.provider,
                    model: combo.model,
                    systemPrompt: combo.prompt,
                    temperature: state.temperature
                });

                const truth = state.groundTruth[img.name];
                const score = truth ? scoreReceipt(truth, predicted) : null;
                if (score) scores.push(score);

                perReceipt.push({ file: img.name, truth: truth || null, predicted, score });
            } catch (err) {
                perReceipt.push({ file: img.name, truth: state.groundTruth[img.name] || null, predicted: null, error: err.message });
                scores.push({
                    valid: false, validJson: false,
                    vendorExact: false, vendorNorm: false, dateExact: false,
                    totalExact: false, totalRelErr: null,
                    itemCountMatch: false, itemNameF1: 0, qtyMatch: null, priceRelErr: null, categoryMatch: null,
                    itemsCompared: 0, itemCountPred: null, itemCountTruth: null
                });
            }
            done++;
            progressBar.style.width = `${(done / total) * 100}%`;
            document.getElementById('eval-progress-label').textContent =
                `Running ${combo.model} — ${done}/${total} extractions`;
            await new Promise(r => setTimeout(r, 0));
        }

        const summary = summarizeScores(scores);
        if (summary) summary.overallScore = overallScore(summary);

        state.results.push({ ...combo, summary, perReceipt });
    }

    progressBar.style.width = '100%';
    document.getElementById('eval-progress-label').textContent = 'Done.';
    runBtn.disabled = false;
    updateStatus(`Evaluation complete: ${combos.length} combination(s), ${state.images.length} receipt(s).`, 'ok');
    renderResults();
    setTimeout(() => progress.classList.add('hidden'), 800);
}

function renderResults() {
    const resultsEl = document.getElementById('eval-results');
    const scored = state.results.filter(r => r.summary);
    const unscored = state.results.filter(r => !r.summary);

    if (state.results.length === 0) {
        resultsEl.innerHTML = `<p class="text-xs text-slate-400 py-6 text-center">No results yet.</p>`;
        return;
    }

    const bestScore = scored.length ? Math.max(...scored.map(r => r.summary.overallScore)) : -1;

    const metricRow = (r) => {
        const s = r.summary;
        const best = s && s.overallScore === bestScore;
        const cls = best ? 'bg-emerald-50 font-bold' : '';
        if (!s) return `<tr class="${cls}"><td colspan="100%" class="text-center text-[11px] text-amber-600 py-2">No ground truth scored — outputs parsed but not graded</td></tr>`;

        // Rates are already 0-100 in the summary (pct()); only ratios are 0-1.
        const cells = [
            s.validRate, s.vendorNormRate, s.dateExactRate, s.totalExactRate,
            s.totalRelErrAvg !== null ? s.totalRelErrAvg * 100 : null,
            s.itemCountMatchRate, s.itemNameF1Avg !== null ? s.itemNameF1Avg * 100 : null,
            s.qtyMatchRate, s.priceRelErrAvg !== null ? s.priceRelErrAvg * 100 : null,
            s.categoryMatchRate
        ].map(v => v === null ? '<span class="text-slate-300">—</span>' : typeof v === 'number' ? v.toFixed(1) + '%' : String(v));

        return `
            <tr class="${cls} border-t border-slate-100 hover:bg-slate-50/60 transition-all">
                <td class="px-3 py-2 font-mono text-[11px] text-blue-700">${r.model}</td>
                <td class="px-3 py-2 text-[11px] max-w-[260px] truncate" title="${r.prompt}">${r.prompt}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px] font-bold ${best ? 'text-emerald-700' : 'text-slate-700'}">${s.overallScore.toFixed(1)}</td>
                ${cells.map(c => `<td class="px-3 py-2 text-right font-mono text-[11px]">${c}</td>`).join('')}
                <td class="px-3 py-2 text-center">
                    <button class="combo-detail-btn text-[10px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer" data-idx="${state.results.indexOf(r)}">view</button>
                </td>
            </tr>
        `;
    };

    resultsEl.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div class="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                <h3 class="text-sm font-bold text-slate-900">Benchmark Results</h3>
                <span class="text-[10px] text-slate-400 font-mono">best = highest overall score</span>
            </div>
            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse text-xs">
                    <thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
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

    resultsEl.querySelectorAll('.combo-detail-btn').forEach(btn => {
        btn.addEventListener('click', () => openComboDetail(parseInt(btn.getAttribute('data-idx'), 10)));
    });
}

function openComboDetail(idx) {
    const combo = state.results[idx];
    const rows = combo.perReceipt.map(p => {
        const s = p.score;
        const status = p.error ? 'error' : s ? 'scored' : 'parsed (no truth)';
        const color = p.error ? 'text-rose-600' : s ? 'text-emerald-700' : 'text-amber-600';
        return `
            <tr class="border-t border-slate-100 hover:bg-slate-50/60 transition-all">
                <td class="px-3 py-2 font-mono text-[11px]">${p.file}</td>
                <td class="px-3 py-2 text-[11px] font-bold ${color}">${status}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s ? (s.vendorExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s ? (s.dateExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s ? (s.totalExact ? '✓' : '✗') : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s && s.totalRelErr !== null ? (s.totalRelErr * 100).toFixed(1) + '%' : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s && s.itemNameF1 !== null ? (s.itemNameF1 * 100).toFixed(0) + '%' : ''}</td>
                <td class="px-3 py-2 text-right font-mono text-[11px]">${s && s.categoryMatch !== null ? (s.categoryMatch * 100).toFixed(0) + '%' : ''}</td>
                <td class="px-3 py-2 text-center">
                    <button class="receipt-detail-btn text-[10px] font-bold text-blue-600 hover:text-blue-800 cursor-pointer" data-idx="${combo.perReceipt.indexOf(p)}">JSON</button>
                </td>
            </tr>
        `;
    }).join('');

    const overlay = document.getElementById('eval-modal');
    const container = document.getElementById('eval-modal-container');
    container.innerHTML = `
        <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-bold text-slate-900 font-mono">${combo.model}</h3>
            <button id="eval-modal-close" class="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer">✕</button>
        </div>
        <div class="overflow-x-auto max-h-[50vh] overflow-y-auto">
            <table class="w-full text-left text-xs">
                <thead class="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
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
            <h3 class="text-sm font-bold text-slate-900 font-mono">${p.file} — ${combo.model}</h3>
            <button id="eval-modal-close" class="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer">✕</button>
        </div>
        <div class="space-y-3 text-xs font-mono max-h-[60vh] overflow-y-auto">
            ${p.error ? `<pre class="bg-rose-50 border border-rose-100 rounded-xl p-3 text-rose-700 whitespace-pre-wrap">Error: ${p.error}</pre>` : ''}
            <div>
                <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Predicted</p>
                <pre class="bg-slate-900 text-emerald-300 rounded-xl p-3 text-[10px] overflow-x-auto">${JSON.stringify(p.predicted, null, 2)}</pre>
            </div>
            ${p.truth ? `
                <div>
                    <p class="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1">Ground Truth</p>
                    <pre class="bg-slate-100 border border-slate-200 rounded-xl p-3 text-[10px] text-slate-700 overflow-x-auto">${JSON.stringify(p.truth, null, 2)}</pre>
                </div>
            ` : ''}
        </div>
    `;
    document.getElementById('eval-modal-close').addEventListener('click', () => overlay.classList.add('hidden'));
}

function updateStatus(msg, type) {
    const el = document.getElementById('eval-status');
    el.textContent = msg;
    el.className = 'text-xs font-medium ' + (type === 'err' ? 'text-rose-600' : type === 'ok' ? 'text-emerald-700' : 'text-slate-500');
}

function exportCSV() {
    const header = 'model,system_prompt,overall,valid_rate,vendor_rate,date_rate,total_exact_rate,total_rel_err,item_count_rate,name_f1,qty_rate,price_rel_err,category_rate';
    const lines = state.results.map(r => {
        const s = r.summary;
        if (!s) return null;
        const f = v => (v === null || v === undefined ? '' : (typeof v === 'number' ? v.toFixed(4) : v));
        return [r.model, JSON.stringify(r.prompt.replace(/\n/g, ' ')), f(s.overallScore), f(s.validRate), f(s.vendorNormRate), f(s.dateExactRate), f(s.totalExactRate), f(s.totalRelErrAvg), f(s.itemCountMatchRate), f(s.itemNameF1Avg), f(s.qtyMatchRate), f(s.priceRelErrAvg), f(s.categoryMatchRate)].join(',');
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
