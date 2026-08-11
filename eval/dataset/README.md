# Evaluation Dataset

Drop receipt images here (PNG / JPG / WEBP) and add one ground-truth entry per
file in `ground-truth.json`, keyed by the exact filename.

Ground truth entries must mirror the parser engine output shape:

```json
{
  "receipt-1.jpg": {
    "vendor": "PENNY-MARKT GMBH",
    "date": "21.05.2026",
    "total_amount": 12.47,
    "purchased_items": [
      ["Bread", 1, 1.99, "EUR", "Groceries"],
      ["Orange Juice", 2, 2.49, "EUR", "Groceries"]
    ]
  }
}
```

- `purchased_items` rows are `[name, quantity, price, currency, category]`.
- Item `category` must be one of the canonical categories:
  Groceries, Pharmacy, Travel, Households, Miscellaneous.
- Receipts without a ground-truth entry are still parsed and shown, but not scored.

## Workflow

1. Drop images into this folder.
2. Fill in `ground-truth.json` (copy from `ground-truth.json`).
3. Open `eval.html` (e.g. `npm run dev` → http://localhost:3000/eval.html).
4. Load the images + ground truth, pick models & prompts, run, export results.
