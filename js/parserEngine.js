// js/parserEngine.js
// Model-agnostic receipt parser: takes a receipt image and returns structured JSON.
//
// Two providers:
//   - "gemini"    -> direct Google Generative Language API (structured response_schema)
//   - "openrouter" -> OpenRouter API (any vision-capable model, JSON mode)
//
// The returned shape is consumed by the Expenses module and the evaluation harness.

import { mapToCanonical } from './categories.js';

// Structured output schema (Gemini `response_schema` format)
export const RECEIPT_SCHEMA = {
    type: "OBJECT",
    properties: {
        vendor: { type: "STRING", description: "Store or business name" },
        date: {
            type: "STRING",
            description: "Date of purchase in DD.MM.YYYY format, e.g., 21.05.2026. Use empty string if missing."
        },
        total_amount: { type: "NUMBER", description: "Total receipt amount paid" },
        purchased_items: {
            type: "ARRAY",
            description: "List of itemized purchases",
            items: {
                type: "OBJECT",
                properties: {
                    name: { type: "STRING", description: "Name or description of product as listed on the receipt" },
                    quantity: { type: "INTEGER", description: "Quantity purchased, default to 1 if unspecified" },
                    price: { type: "NUMBER", description: "Total price paid for this line item" },
                    currency: { type: "STRING", description: "3-letter currency code, e.g. EUR, USD" },
                    category: {
                        type: "STRING",
                        description: "Category tag for the item. MUST be one of: Groceries, Pharmacy, Travel, Households, Miscellaneous"
                    },
                },
                required: ["name", "quantity", "price", "currency", "category"],
            },
        },
    },
    required: ["vendor", "date", "total_amount", "purchased_items"],
};

// Plain-text schema description injected into system prompts for JSON-mode providers
export const RECEIPT_SCHEMA_PROMPT = `Return ONLY a JSON object matching this schema:
{
  "vendor": "string, store or business name",
  "date": "string, purchase date in DD.MM.YYYY format, empty string if missing",
  "total_amount": "number, total receipt amount paid",
  "purchased_items": [
    {
      "name": "string, product name/description as listed on the receipt",
      "quantity": "integer, quantity purchased, default 1",
      "price": "number, total price paid for this line item",
      "currency": "string, 3-letter currency code e.g. EUR, USD",
      "category": "string, MUST be one of: Groceries, Pharmacy, Travel, Households, Miscellaneous"
    }
  ]
}`;

export const DEFAULT_SYSTEM_PROMPT = "Extract structured receipt data including vendor, date, total amount, and itemized purchase details from this receipt image. Assign a clear category tag to each item.";

// Curated vision-capable models for the evaluation module (OpenRouter slugs).
// Any OpenRouter model id can also be typed in manually.
export const DEFAULT_OPENROUTER_MODELS = [
    "google/gemini-3.1-flash",
    "google/gemini-3.1-flash-lite",
    "openai/gpt-4o-mini",
    "anthropic/claude-3-5-haiku-20241022",
    "meta-llama/llama-3.2-11b-vision-instruct",
];

export const DEFAULT_GEMINI_MODEL = "gemini-3.1-flash-lite";

// Convert File to Base64
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * Parses a receipt image into structured JSON.
 *
 * @param {object} options
 * @param {File} options.file - The receipt image file
 * @param {"gemini"|"openrouter"} [options.provider="gemini"]
 * @param {string} [options.model] - Model id for the selected provider
 * @param {string} [options.systemPrompt] - System prompt describing the extraction task
 * @param {number} [options.temperature=0.1]
 * @returns {Promise<{vendor: string, date: string, total_amount: number, purchased_items: Array}>}
 */
export async function parseReceiptWithModel({ file, provider = 'gemini', model, systemPrompt = DEFAULT_SYSTEM_PROMPT, temperature = 0.1 }) {
    const base64Data = await fileToBase64(file);
    const mimeType = file.type || 'image/jpeg';

    const raw =
        provider === 'openrouter'
            ? await parseViaOpenRouter(base64Data, mimeType, model, systemPrompt, temperature)
            : await parseViaGemini(base64Data, mimeType, model, systemPrompt, temperature);

    return normalizeParsedOutput(raw);
}

/**
 * Backward-compatible wrapper used by the Expenses module.
 */
export async function parseReceiptDirectly(file) {
    return parseReceiptWithModel({ file, provider: 'gemini', model: DEFAULT_GEMINI_MODEL, systemPrompt: DEFAULT_SYSTEM_PROMPT });
}

async function parseViaGemini(base64Data, mimeType, model, systemPrompt, temperature) {
    const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (!apiKey) throw new Error("VITE_GEMINI_API_KEY is missing in your .env file!");

    const modelId = model || DEFAULT_GEMINI_MODEL;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

    const payload = {
        contents: [
            {
                parts: [
                    { inline_data: { mime_type: mimeType, data: base64Data } },
                    { text: systemPrompt }
                ]
            }
        ],
        generationConfig: {
            response_mime_type: "application/json",
            response_schema: RECEIPT_SCHEMA,
            temperature
        }
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API Error (HTTP ${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error("Gemini returned an empty response.");

    return extractJSON(rawText);
}

async function parseViaOpenRouter(base64Data, mimeType, model, systemPrompt, temperature) {
    const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("VITE_OPENROUTER_API_KEY is missing in your .env file!");
    if (!model) throw new Error("OpenRouter provider requires an explicit model id.");

    const endpoint = "https://openrouter.ai/api/v1/chat/completions";
    const dataUrl = `data:${mimeType};base64,${base64Data}`;

    const payload = {
        model,
        temperature,
        max_tokens: 2048,
        response_format: { type: "json_object" },
        messages: [
            { role: "system", content: `${systemPrompt}\n\n${RECEIPT_SCHEMA_PROMPT}` },
            {
                role: "user",
                content: [
                    { type: "image_url", image_url: { url: dataUrl } },
                    { type: "text", text: "Parse this receipt image into the JSON schema described above." }
                ]
            }
        ]
    };

    const response = await fetch(endpoint, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API Error (HTTP ${response.status}): ${errorText}`);
    }

    const result = await response.json();
    const content = result?.choices?.[0]?.message?.content;
    if (!content) throw new Error("OpenRouter returned an empty response.");

    return extractJSON(content);
}

/**
 * Extracts a JSON object from model text, tolerating code fences and stray text.
 */
function extractJSON(text) {
    const trimmed = String(text).trim();
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenced ? fenced[1] : trimmed;

    try {
        return JSON.parse(candidate);
    } catch (e) {
        // Try to salvage the first balanced JSON object
        const start = candidate.indexOf('{');
        const end = candidate.lastIndexOf('}');
        if (start !== -1 && end > start) {
            const slice = candidate.slice(start, end + 1);
            try {
                return JSON.parse(slice);
            } catch (e2) {
                /* fall through */
            }
        }
        throw new Error(`Model output was not valid JSON: ${candidate.slice(0, 300)}`);
    }
}

/**
 * Normalizes raw model output into the canonical receipt JSON shape.
 * Item categories are mapped onto the canonical categories and numeric
 * fields are coerced to numbers (some providers return JSON strings).
 */
function normalizeParsedOutput(parsedData) {
    const toNum = (v, fallback = 0) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : fallback;
    };

    const formattedItems = (parsedData.purchased_items || []).map((item) => [
        item.name || "Unknown Item",
        toNum(item.quantity, 1) > 0 ? toNum(item.quantity, 1) : 1,
        toNum(item.price, 0),
        item.currency || "EUR",
        mapToCanonical(item.category),
    ]);

    return {
        vendor: parsedData.vendor || "Unknown",
        date: parsedData.date || "",
        total_amount: toNum(parsedData.total_amount, 0),
        purchased_items: formattedItems,
    };
}
