# SnapSpend Receipt Dataset Pipeline

Generates two parallel receipt-parsing datasets from the same set of receipt images:

| Folder | Pipeline | Model |
| --- | --- | --- |
| `Dataset/ocr_gemini_3.1_flash_lite/` | PaddleOCR extracts text, then Gemini tags/categorizes items | `gemini-3.1-flash-lite` |
| `Dataset/gemini_3.6/` | Gemini parses the receipt image directly | `gemini-3.6-flash` |

Both pipelines follow the updated parser engine: items are tagged with one of the five canonical categories
(`Groceries`, `Pharmacy`, `Travel`, `Households`, `Miscellaneous`) via the `mapToCanonical` mapping.

---

## Project Structure

```text
SnapSpend_eval/
├── Dataset/
│   ├── Images/                     # Receipt images (1.jpeg … 40.jpeg)
│   ├── ocr_gemini_3.1_flash_lite/  # Generated annotations (JSON)
│   └── gemini_3.6/                 # Generated annotations (JSON)
├── build_ocr_gemini_dataset.py     # OCR + Gemini builder
├── build_gemini_only_dataset.py    # Gemini-only builder
├── parser_engine_v2.py             # Shared parser logic (schema, prompts, normalization)
├── categories.py                   # Canonical category mapping
├── ocr_engine.py                   # PaddleOCR wrapper
├── requirements.txt
└── .env                            # Gemini API key
```

Each JSON output uses the shape:

```json
{
  "vendor": "ALDI SÜD",
  "date": "01.08.2026",
  "total_amount": 6.43,
  "purchased_items": [
    ["Sandwiches 185g", 1, 1.99, "EUR", "Groceries"]
  ]
}
```

The numeric filename of each annotation matches the receipt image it came from
(e.g. `Dataset/Images/13.jpeg` → `Dataset/ocr_gemini_3.1_flash_lite/13.json`).

---

## Installation

Requires Python 3.10+.

```bash
python3 -m venv venv
source venv/bin/activate            # macOS/Linux   (Windows: venv\Scripts\activate)
pip install -r requirements.txt
```

## Configuration

Copy your Gemini API key into `.env`:

```env
GEMINI_API_KEY=your_google_gemini_api_key_here
```

Note: `gemini-3.6-flash` has a free-tier limit of ~20 requests/day per Google Cloud
project. If the run hits quota/latency errors, re-running the same builder resumes
automatically — it skips already-generated JSON files and retries transient failures.

---

## Usage

### Build the OCR + Gemini dataset

```bash
python build_ocr_gemini_dataset.py
```

Writes to `Dataset/ocr_gemini_3.1_flash_lite/`.

### Build the Gemini-only dataset

```bash
python build_gemini_only_dataset.py
```

Writes to `Dataset/gemini_3.6/`.

Both builders print a per-file success/failure summary and are safe to re-run
(completed files are skipped, failed files are retried).