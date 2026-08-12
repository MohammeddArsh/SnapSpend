// eval/lib/models.mjs
// Live OpenRouter model catalog helpers: fetching, free/vision filtering and
// a small display formatter. The catalog changes constantly — free model IDs
// are always verified against the live /models endpoint at runtime.

const CATALOG_URL = "https://openrouter.ai/api/v1/models";

/**
 * Fetches the live OpenRouter model catalog.
 * @param {string} [apiKey] - optional; catalog is public without a key
 * @returns {Promise<Array>} catalog entries as returned by the API
 */
export async function fetchCatalog(apiKey) {
    const response = await fetch(CATALOG_URL, {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    });
    if (!response.ok) {
        throw new Error(`OpenRouter catalog request failed (HTTP ${response.status}).`);
    }
    const result = await response.json();
    return result.data || [];
}

export const isFreeModel = (model) => {
    const p = model.pricing || {};
    return String(p.prompt) === "0" && String(p.completion) === "0";
};

export const supportsImage = (model) =>
    (model.architecture?.input_modalities || []).includes("image");

export const supportsText = (model) =>
    (model.architecture?.input_modalities || []).includes("text");

export const findModel = (catalog, id) => catalog.find((m) => m.id === id) || null;

export const pricePerMillion = (model) => {
    const p = model?.pricing || {};
    const f = (v) => (v === null || v === undefined || v === "" ? NaN : parseFloat(v) * 1e6);
    const in1m = f(p.prompt);
    const out1m = f(p.completion);
    const fmt = (v) => (Number.isFinite(v) ? `$${v.toFixed(2)}/1M` : "n/a");
    return `${fmt(in1m)} in · ${fmt(out1m)} out`;
};

/**
 * Lists free models that accept image input, sorted by context length desc.
 */
export function listFreeVisionModels(catalog) {
    return catalog
        .filter(isFreeModel)
        .filter(supportsImage)
        .sort((a, b) => (b.context_length || 0) - (a.context_length || 0));
}

/**
 * Prints a compact table of free vision models to stdout.
 */
export function printFreeVisionModels(models) {
    if (models.length === 0) {
        console.log("No free vision-capable models found in the live catalog right now.");
        return;
    }
    console.log(`Free vision-capable models on OpenRouter (${models.length}):\n`);
    const row = (m) =>
        `  ${m.id.padEnd(52)} ctx ${String(m.context_length || "?").padStart(7)}  ${pricePerMillion(m)}`;
    console.log(row(models[0]));
    for (const m of models.slice(1)) console.log(row(m));
    console.log("\nFree tiers are paced at ~20 req/min — the pipeline sleeps between calls.");
}