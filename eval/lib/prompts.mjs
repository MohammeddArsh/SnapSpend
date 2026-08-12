// eval/lib/prompts.mjs
// System prompts used by the evaluation CLI and the dataset builder.
// The plain-text schema (originally from js/parserEngine.js) is appended by
// the parsers for JSON-mode providers.

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

// Structured extraction prompts (applied to the image or to OCR text).
export const DIRECT_PROMPTS = [
    {
        id: "terse",
        label: "Terse",
        text: "Extract the receipt data as JSON.",
    },
    {
        id: "default",
        label: "Default",
        text: "Extract structured receipt data including vendor, date, total amount, and itemized purchase details from this receipt image. Assign a clear category tag to each item.",
    },
    {
        id: "careful",
        label: "Careful",
        text: "Extract every field from this receipt image into structured JSON. Be extremely careful with the total: prefer the explicit TOTAL/SUM line over summing items. Return empty string for a missing date. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories.",
    },
    {
        id: "german-aware",
        label: "German-aware",
        text: "You are parsing a German retail receipt (e.g., ALDI, REWE, LIDL). Extract the vendor, date, total amount and every purchased item. German prices use a comma as the decimal separator — convert them to dot-decimal numbers (e.g. 1,99 -> 1.99). Prefer the explicit SUM/BETRAG/SUMME line as the total instead of summing items. Keep product names as printed, including abbreviations and OCR artifacts. Negative lines (Rabatt, coupons, reimbursed deposits) are items with a negative price, category Miscellaneous. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories.",
    },
];

// Prompts for the text-structuring stage of the `ocr` pipeline. The "default"
// one mirrors parser_engine_v2.py's DEFAULT_OCR_SYSTEM_PROMPT so the
// reference pipeline setup stays reproducible; ids align with DIRECT_PROMPTS
// so the same prompt selection applies to both pipelines.
export const OCR_PROMPTS = [
    {
        id: "default",
        label: "Default (OCR)",
        text: "Extract structured receipt data including vendor, date, total amount, and itemized purchase details from this receipt OCR text. Assign a clear category tag to each item.",
    },
    {
        id: "careful",
        label: "Careful (OCR)",
        text: "Extract every field from this receipt OCR text into structured JSON. Be extremely careful with the total: prefer the explicit TOTAL/SUM line over summing items. Return empty string for a missing date. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories.",
    },
    {
        id: "terse",
        label: "Terse",
        text: "Extract the receipt data as JSON.",
    },
    {
        id: "german-aware",
        label: "German-aware",
        text: "You are structuring the OCR text of a German retail receipt (e.g., ALDI, REWE, LIDL). Extract the vendor, date, total amount and every purchased item. German prices use a comma as the decimal separator — convert them to dot-decimal numbers (e.g. 1,99 -> 1.99). Prefer the explicit SUM/BETRAG/SUMME line as the total instead of summing items. Keep product names as printed, including abbreviations and OCR artifacts. Negative lines (Rabatt, coupons, reimbursed deposits) are items with a negative price, category Miscellaneous. Use only Groceries, Pharmacy, Travel, Households or Miscellaneous as item categories.",
    },
];

// Stage-1 transcription prompt used by the `ocr` pipeline.
export const TRANSCRIBE_PROMPT =
    "Transcribe this receipt image verbatim, line by line, keeping the original reading order from top to bottom. Output plain text only — do not summarize, interpret, or add any commentary.";

export const findPrompt = (list, id) => list.find((p) => p.id === id) || null;