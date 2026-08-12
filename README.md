# SnapSpend — AI-Powered Expense Tracker

**SnapSpend** is a privacy-first, client-side expense tracker built with **Vanilla JavaScript (ES6+), Tailwind CSS, Vite, and Supabase**.

It combines a clean expense dashboard with an **AI receipt parser** (image → structured JSON), an **AI assistant** that answers questions about your spending (natural language → SQL → grounded answer), and a separate **evaluation module** that benchmarks how accurately different models & system prompts parse receipts.

---

## Features

- **Login / Sign-up** — username + email + password via Supabase Auth, guarded by Cloudflare Turnstile bot detection; profiles, income sources and the five canonical categories are seeded automatically.
- **Dashboard** — monthly income, expenses and net savings, plus a **spending-by-category pie chart** across exactly five categories: **Groceries, Pharmacy, Travel, Households, Miscellaneous**.
- **Income** — log salary/bonus credits per month, with a one-click "copy last month's salary" draft.
- **Expenses** — manual entry (with on-device Naive Bayes category suggestions), CSV import, and **AI receipt scanning** (upload a photo → structured JSON review → save).
- **Reports** — a month snapshot with income & expense ledgers, net-savings and savings-rate cards, month-over-month deltas, a spending donut, and one-click **PDF export**.
- **AI Assistant** — ask questions in plain English and get grounded, plain-text answers sourced only from your data (via a Supabase Edge Function or a client-side Gemini fallback), always scoped to the signed-in user.
- **Evaluation module** — standalone page that benchmarks any number of models × system prompts on receipt images against ground-truth JSON and scores accuracy.

---

## Tech Stack

| Layer              | Technologies                             |
| ------------------ | ---------------------------------------- |
| **Frontend**       | Vanilla JavaScript (ES6+), HTML5         |
| **Styling**        | Tailwind CSS v4                          |
| **Fonts**          | Inter, JetBrains Mono                    |
| **Build Tool**     | Vite 6                                   |
| **Database**       | PostgreSQL via Supabase                  |
| **Authentication** | Supabase Auth + Cloudflare Turnstile     |
| **Security**       | PostgreSQL Row Level Security (RLS)      |
| **Receipt Parser** | Gemini API / OpenRouter (model-agnostic) |
| **Reports / PDF**  | jsPDF + jspdf-autotable                  |
| **AI Assistant**   | Supabase Edge Function (text-to-SQL) + client-side Gemini fallback |
| **Testing**        | Node.js Native Test Runner (`node:test`) |

---

## Project Structure

```text
SnapSpend/
│
├── css/
│   └── main.css                    # Base styles & fluid typography
│
├── js/
│   ├── app.js                      # Application router & authentication UI
│   ├── assistant.js                # AI assistant chat view + answer rendering
│   ├── assistantClient.js          # Client-side assistant (Gemini) for edge-free deployments
│   ├── categories.js               # Canonical categories + granular tag mapping
│   ├── classifier.js               # On-device Naive Bayes category classifier
│   ├── dashboard.js                # Dashboard & spending-by-category pie chart
│   ├── datepicker.js               # Custom month/date picker
│   ├── dropdown.js                 # Reusable dropdown component
│   ├── expenses.js                 # Expense management & receipt scanning
│   ├── income.js                   # Income management
│   ├── parserEngine.js             # Model-agnostic receipt → JSON parser
│   ├── pdf-generator.js            # Monthly report → PDF export
│   ├── reports.js                  # Monthly reports view & shared aggregation
│   ├── supabase.js                 # Supabase client & session management
│   ├── theme.mjs                   # Shared theme toggle (evaluation page)
│   ├── utils.js                    # Utilities, formatting & security helpers
│   ├── dataset/
│   │   └── core.mjs                # Dataset-building engine (CLI)
│   └── eval/
│       ├── eval.js                 # Evaluation harness UI
│       └── metrics.js              # Accuracy scoring functions
│
├── eval/
│   ├── build-dataset.mjs           # Dataset builder CLI
│   ├── run-eval.mjs                # Evaluation CLI
│   ├── config.mjs                  # Shared eval/dataset configuration
│   ├── lib/                        # Shared eval libraries (OpenRouter client, prompts, …)
│   └── Dataset/                    # Receipt images + ground-truth JSON
│
├── eval.html                       # Standalone evaluation module page
│
├── supabase/
│   ├── config.toml                 # Edge function config
│   ├── functions/assistant/
│   │   ├── index.ts                # Assistant edge function entry (Deno)
│   │   ├── llm.ts                  # Provider abstraction (Gemini / OpenRouter)
│   │   ├── prompts.ts              # System prompt, schema DDL & tool definitions
│   │   └── sql.ts                  # SQL validation & user scoping
│   └── migrations/
│       ├── 0001_canonical_categories.sql   # Upgrade scripts for existing databases
│       ├── 0002_add_households_category.sql
│       └── 0003_rename_outings_to_travel.sql
│
├── tests/
│   ├── classifier.test.js          # Naive Bayes classifier tests
│   ├── metrics.test.js             # Evaluation metrics tests
│   └── openrouter.test.js          # OpenRouter client tests
│
├── .env.example                    # Environment variable template
├── index.html                      # Main application shell
├── package.json                    # Dependencies & npm scripts
├── schema.sql                      # Fresh PostgreSQL schema & RLS policies
└── vite.config.ts                  # Vite configuration
```

---

## Getting Started

### Prerequisites

- **Node.js:** v18.0.0 or higher
- **npm:** v9.0.0 or higher
- **Supabase Account:** a free Supabase project
- **Supabase CLI** (only for deploying the AI Assistant edge function)

### 1. Configure Supabase

1. Create a new project from your Supabase dashboard.
2. Open the **SQL Editor**.
3. Execute `schema.sql` from this repository against the `snapspend_db` database (fresh database).
   - **Upgrading an existing SnapSpend database?** Run the migration scripts under `supabase/migrations/` in order (`0001` → `0002` → `0003`) — they preserve your expense data and remap old categories onto the canonical five. **Back up your database first.**
4. Copy `.env.example` to `.env` and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. *(Optional)* **Cloudflare Turnstile** for bot protection: create a widget at `dash.cloudflare.com → Turnstile`, put its **Site Key** in `.env` as `VITE_TURNSTILE_SITE_KEY`, and paste its **Secret Key** in Supabase → *Authentication → Bot and Abuse Protection*.

### 2. Install & Run

```bash
npm install
cp .env.example .env   # then fill in your keys
npm run dev            # http://localhost:3000
```

### Development Commands

| Command           | Description                                       |
| ----------------- | ------------------------------------------------- |
| `npm run dev`     | Starts the Vite development server on port 3000   |
| `npm run build`   | Builds the application for production             |
| `npm run preview` | Previews the production build locally             |
| `npm run lint`    | Type checking with `tsc --noEmit`                 |
| `npm run test`    | Runs the native Node.js test suite                |
| `npm run clean`   | Removes production build output                   |

### Environment Variables

All variables live in `.env` (see `.env.example`). `VITE_` variables are baked into the client bundle — never put server-side secrets in them.

| Variable                   | Purpose                                                        |
| -------------------------- | -------------------------------------------------------------- |
| `VITE_SUPABASE_URL`        | Supabase project URL (e.g. `https://your-project.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY`   | Supabase anon (public) API key                                 |
| `VITE_GEMINI_API_KEY`      | Gemini API key — used by the receipt ParserEngine (app + eval) |
| `VITE_OPENROUTER_API_KEY`  | OpenRouter API key — used by the evaluation module             |
| `VITE_TURNSTILE_SITE_KEY`  | Cloudflare Turnstile site key — bot protection on auth (optional) |

The AI Assistant edge function uses server-side secrets set with the Supabase CLI (see below), **not** `.env`.

---

## Database

`schema.sql` defines the following tables (all RLS-protected by `auth.uid() = user_id`):

| Table                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `profiles`                | Username + email per user                        |
| `income_sources`          | Income categories (Salary, Bonus, Other)         |
| `income_entries`          | Monthly income records                           |
| `expense_categories`      | The 5 canonical categories per user        |
| `expense_entries`         | One row per expense (manual or scanned receipt)  |
| `expense_receipt_items`   | Itemized line items for scanned receipts         |

Triggers auto-derive the `month` column (`YYYY-MM`) from entry dates, and a `handle_new_user()` trigger seeds profiles, income sources, and the five categories on sign-up.

---

## Usage

### 1. Sign Up / Sign In

Register with a unique username, email, and password. A profile, income sources, and the five canonical expense categories are seeded automatically.

### 2. Dashboard

The dashboard shows your monthly income, expenses, and net savings, plus a **spending-by-category pie chart** broken into exactly five categories:

- **Groceries**
- **Pharmacy**
- **Travel**
- **Households**
- **Miscellaneous**

Click any metric card to jump to Income or Expenses. The month can be changed with the ribbon in the header.

### 3. Income

Log salary/bonus credits per month. SnapSpend remembers last month's salary and offers to copy it as a draft.

### 4. Expenses

Record expenses manually or **scan a receipt**: upload a photo and the ParserEngine (Gemini by default) returns structured JSON (vendor, date, total, itemized lines with canonical categories) for review before saving. CSV import is also supported. Item-level categories are always normalized onto the canonical five.

### 5. Reports

The Reports tab renders a month snapshot of your finances and lets you download a clean, single-page **PDF**:

- **Net Savings panel** — savings and savings rate for the month.
- **Key figures + deltas** — total income, expenses and savings rate with month-over-month changes vs. the previous month.
- **Ledgers** — income sources and expense categories side by side.
- **Spending by category** — a donut chart beside its category list (colour dot, weight %, amount) aligned to the page's right half.

The PDF is generated client-side with jsPDF and reuses the exact same aggregation as the UI (`getMonthlyReportData`), so the export always matches what you see on screen.

### 6. AI Assistant

Ask questions in plain English, e.g. *"How much did I spend on Groceries this month?"* or *"What was my biggest expense this year?"*. The assistant answers **only** from your own expense/income data — never inventing numbers — and replies in clean plain text (no Markdown). Questions outside its scope (anything not about your data) are answered verbatim with *"I can't answer questions outside of my scope"*.

There are two execution paths:

1. **Supabase Edge Function (text-to-SQL)** — the LLM receives the schema and few-shot SQL examples, calls a validated `query_expenses` tool when a data question needs answering, and the edge function runs the (read-only, always user-scoped) statement and returns the grounded results. This is the recommended production setup — deploy it once as described below.
2. **Client-side fallback (Vercel builds)** — when running without the edge function, `js/assistantClient.js` talks to the Gemini API directly from the browser. It uses three tools that mirror the Dashboard exactly — `category_breakdown`, `financial_summary`, and `query_expenses` — with up to three tool rounds and per-user conversation memory. The app attaches a raw result table to a reply only when a single query produced it (multi-round answers are summaries only).

To configure the edge function:

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase secrets set GEMINI_API_KEY=your-gemini-key    # required for the gemini provider
supabase secrets set OPENROUTER_API_KEY=your-key       # only for the openrouter provider
supabase functions deploy assistant
```

(`SUPABASE_DB_URL` and `SUPABASE_JWKS` are auto-provisioned by the platform — no manual secrets needed.) Then open the **AI Assistant** tab in the app and type your question.

Provider and models can be configured via edge function secrets:

| Secret | Default | Description |
| --- | --- | --- |
| `ASSISTANT_PROVIDER` | `gemini` | `gemini` (Google API) or `openrouter` |
| `SQL_MODEL` | `gemini-3.1-flash-lite` | Gemini model used for question → SQL → answer |
| `OPENROUTER_MODEL` | `google/gemini-3.1-flash-lite` | OpenRouter model slug when provider is `openrouter` |

---

## ParserEngine

`js/parserEngine.js` turns receipt images into structured JSON:

- **Gemini provider** (default): direct Google API with `response_schema` structured output.
- **OpenRouter provider**: any vision-capable model via OpenRouter's unified API (JSON mode + schema in the prompt).

Both normalize item categories onto the canonical five and return the same shape: `{ vendor, date, total_amount, purchased_items: [[name, quantity, price, currency, category], …] }`.

---

## Evaluation Module

The evaluation tooling lives under `eval/` and runs standalone. Two pipelines:

- **Dataset Builder** — annotates the receipt images in `eval/Dataset/Images` with multiple model setups (direct vision parsing and OCR-transcribe → LLM structuring, mirroring the Python `snapspend_dataset_pipeline/`). Each setup writes `eval/Dataset/<setup-name>/<stem>.json`.
- **Evaluation CLI** — benchmarks pipelines × models × system prompts against ground-truth JSON and writes ranked reports.

### Dataset Builder

```bash
node eval/build-dataset.mjs --list-setups     # default setups (free-first)
node eval/build-dataset.mjs --dry-run          # plan without calling the API
node eval/build-dataset.mjs                    # build all setups (resumable)
node eval/build-dataset.mjs --setups gemma_4_31b_direct --limit 5
```

### Evaluation CLI

```bash
node eval/run-eval.mjs --list-models           # live free vision models
node eval/run-eval.mjs --dry-run               # matrix + call budget
node eval/run-eval.mjs                         # free-only default run
node eval/run-eval.mjs --dataset <setup-name>  # score a built dataset vs ground truth
node eval/run-eval.mjs --models anthropic/claude-haiku-4.5 --include-paid  # frontier comparison
```

Outputs land in `eval/results/` (gitignored): `summary.csv`, `summary.json`, `report.md`, per-combo `details/` and a resume `cache/`. Metrics per combination: JSON validity, vendor match (exact & normalized), date match, total amount (exact + relative error), item count, item-name token F1, quantity match, price relative error, canonical category match, estimated cost and latency — plus an **overall score** ranking.

The browser harness at `/eval.html` uses the same hardened OpenRouter client as the CLI: free-tier models are paced (~20 req/min), transient 429/5xx errors are retried with backoff (`Retry-After` honored), and if the daily free quota is exhausted the run stops early with partial results marked instead of writing zeroed scores. Failed extractions are reported per receipt and never counted as valid parses.

Notes: `VITE_OPENROUTER_API_KEY` is read from `.env`. Free `:free` tiers are paced (~20 req/min, ~200 req/day default cap); add ≥ $10 credits for ~1000 free calls/day, or shrink runs with `--limit`, `--prompts`, `--setups`. The browser page `/eval.html` still works for quick interactive runs.

---

## Security & Privacy

- **No third-party tracking** — user ledger data is never sent to analytics services.
- **Row Level Security** — every financial record is protected by `auth.uid() = user_id`.
- **Bot protection** — Cloudflare Turnstile guards every sign-in and sign-up; the site key lives in the client while the secret stays server-side in Supabase.
- **Assistant data safety** — the assistant only ever issues read-only, per-user queries: the edge function permits only a single validated `SELECT` and forces `WHERE user_id = <authenticated user>`, while the client fallback restricts access to an allow-list of tables and operators.
- **Input sanitization** — user text is HTML-escaped before rendering.

> **Security Notice:** No software can guarantee absolute security. Please report suspected vulnerabilities according to the project's security disclosure policy.

---

## License

SnapSpend is distributed under the **MIT License** (see `LICENSE`).
