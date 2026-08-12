// eval/lib/report.mjs
// Report writers for the evaluation CLI: console table, CSV, JSON and a
// markdown report. All summary metrics come from js/eval/metrics.js.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const METRIC_COLUMNS = [
    ['overallScore', 'Overall', 'num'],
    ['validRate', 'Valid', 'pct'],
    ['vendorNormRate', 'Vendor', 'pct'],
    ['dateExactRate', 'Date', 'pct'],
    ['totalExactRate', 'Total Exact', 'pct'],
    ['totalRelErrAvg', 'Total Err', 'ratio'],
    ['itemCountMatchRate', 'Item Count', 'pct'],
    ['itemNameF1Avg', 'Name F1', 'ratio'],
    ['qtyMatchRate', 'Qty', 'pct'],
    ['priceRelErrAvg', 'Price Err', 'ratio'],
    ['categoryMatchRate', 'Category', 'pct'],
];

const fmt = (v, digits = 1) =>
    v === null || v === undefined ? '—' : typeof v === 'number' ? `${(v * 100).toFixed(digits)}%` : String(v);

const cell = (k, kind, v) => {
    if (v === null || v === undefined) return '—';
    if (kind === 'num') return Number(v).toFixed(1);
    if (kind === 'ratio') return (Number(v) * 100).toFixed(1) + '%';
    return Number(v).toFixed(1) + '%'; // summaries are already 0-100
};

/**
 * Prints the sorted result table to stdout.
 * @param {Array} results - from run-eval (combo summaries)
 */
export function printTable(results) {
    const scored = results.filter((r) => r.summary);
    const unscored = results.filter((r) => !r.summary);

    const header = ['pipeline', 'model', 'prompt', ...METRIC_COLUMNS.map(([, label]) => label), 'cost', 'errs'];
    const widths = header.map((h, i) =>
        Math.max(
            h.length,
            ...scored.map((r) => {
                const cells = [
                    r.pipeline,
                    r.model,
                    r.promptId,
                    ...METRIC_COLUMNS.map(([k, , kind]) => cell(k, kind, r.summary[k])),
                ];
                return String(i < cells.length ? cells[i] : '').length;
            })
        )
    );

    const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd();
    console.log(line(header));
    console.log('-'.repeat(widths.reduce((a, b) => a + b + 2, 0)));

    const render = (r) =>
        [
            r.pipeline,
            r.model,
            r.promptId,
            ...METRIC_COLUMNS.map(([k, , kind]) => cell(k, kind, r.summary[k])),
            r.summary.totalCostUsd !== null ? `$${r.summary.totalCostUsd.toFixed(4)}` : '—',
            r.summary.errors || 0,
        ];

    for (const r of [...scored].sort((a, b) => b.summary.overallScore - a.summary.overallScore)) {
        console.log(line(render(r)));
    }
    if (unscored.length) {
        console.log('\nNot scored (no ground truth matched):');
        for (const r of unscored) console.log(`  ${r.pipeline} / ${r.model} / ${r.promptId}`);
    }
}

const truthy = (r) => r.summary;

/**
 * Writes summary.csv, summary.json, report.md and per-combo detail JSONs.
 * @param {Array} results - combo results
 * @param {object} meta - { provider, temperature, dataset, receipts, date }
 */
export async function writeReports(results, meta, outDir) {
    await mkdir(outDir, { recursive: true });
    await mkdir(path.join(outDir, 'details'), { recursive: true });

    // CSV
    const csvHeader = [
        'pipeline', 'model', 'prompt',
        ...METRIC_COLUMNS.map(([k]) => k),
        'overallScore', 'receipts', 'errors', 'avgLatencyMs', 'totalCostUsd',
    ];
    const esc = (v) => {
        if (v === null || v === undefined) return '';
        const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Number(v.toPrecision(6))) : '') : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csvLines = results.filter(truthy).map((r) =>
        [
            r.pipeline, r.model, r.promptId,
            ...METRIC_COLUMNS.map(([k]) => r.summary[k]),
            r.summary.overallScore, r.summary.receipts, r.summary.errors,
            r.summary.avgLatencyMs, r.summary.totalCostUsd,
        ].map(esc).join(',')
    );
    await writeFile(path.join(outDir, 'summary.csv'), csvHeader.join(',') + '\n' + csvLines.join('\n') + '\n');

    // Details (per combo, per receipt)
    for (const r of results) {
        const safeName = `${r.pipeline}__${r.model.replace(/[/:]/g, '_')}__${r.promptId}`;
        await writeFile(
            path.join(outDir, 'details', `${safeName}.json`),
            JSON.stringify(
                {
                    pipeline: r.pipeline,
                    model: r.model,
                    promptId: r.promptId,
                    prompt: r.promptText,
                    temperature: r.temperature,
                    summary: r.summary,
                    perReceipt: r.perReceipt,
                },
                null,
                2
            )
        );
    }

    // summary.json
    await writeFile(
        path.join(outDir, 'summary.json'),
        JSON.stringify({ ...meta, results }, null, 2)
    );

    // report.md
    const scored = results.filter(truthy).sort((a, b) => b.summary.overallScore - a.summary.overallScore);
    const md = [
        `# SnapSpend Evaluation Report`,
        ``,
        `Generated: ${new Date().toISOString()}`,
        `Provider: OpenRouter | Temperature: ${meta.temperature}`,
        `Dataset: ${meta.dataset ?? 'custom'} | Receipts: ${meta.receipts}`,
        ``,
        `## Rankings (by overall score)`,
        ``,
        `| # | Pipeline | Model | Prompt | Overall | Valid | Vendor | Date | Total | Name F1 | Category | Cost |`,
        `|---|----------|-------|--------|---------|-------|--------|------|-------|---------|----------|------|`,
        ...scored.map((r, i) => {
            const s = r.summary;
            const cost = s.totalCostUsd !== null && s.totalCostUsd !== undefined
                ? `$${s.totalCostUsd.toFixed(4)}`
                : '—';
            const pct = (k, kind) => (s[k] === null || s[k] === undefined ? '—' : cell(k, kind, s[k]));
            return `| ${i + 1} | ${r.pipeline} | ${r.model} | ${r.promptId} | ${s.overallScore.toFixed(1)} | ${pct('validRate', 'pct')} | ${pct('vendorNormRate', 'pct')} | ${pct('dateExactRate', 'pct')} | ${pct('totalExactRate', 'pct')} | ${pct('itemNameF1Avg', 'ratio')} | ${pct('categoryMatchRate', 'pct')} | ${cost} |`;
        }),
        ``,
        `## Notes`,
        ``,
        `- Free ':free' tiers are paced (~20 req/min); runs are resumable (cache dir: ${path.join(outDir, 'cache')}).`,
        `- Per-receipt details: ${path.relative(process.cwd(), path.join(outDir, 'details'))}/`,
        ``,
    ].join('\n');
    await writeFile(path.join(outDir, 'report.md'), md);
}