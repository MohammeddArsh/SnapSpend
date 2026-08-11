# SnapSpend — AI-Powered Expense Tracker

**SnapSpend** is a privacy-first, client-side expense tracker built with **Vanilla JavaScript (ES6+), Tailwind CSS, Vite, and Supabase**.

It combines a clean expense dashboard with an **AI receipt parser** (image → structured JSON), an **AI assistant** that answers questions about your spending (natural language → SQL → grounded answer), and a separate **evaluation module** that benchmarks how accurately different models & system prompts parse receipts.

---

## Features

- **Login / Sign-up** — username + email + password via Supabase Auth; profiles, income sources and categories are seeded automatically.
- **Dashboard** — monthly income, expenses and net savings, plus a **spending-by-category pie chart** across exactly five categories: **Groceries, Pharmacy, Travel, Households, Miscellaneous**.
- **Income** — log salary/bonus credits per month, with a one-click "copy last month's salary" draft.
- **Expenses** — manual entry (with on-device Naive Bayes category suggestions), CSV import, and **AI receipt scanning** (upload a photo → structured JSON review → save).
- **AI Assistant** — ask questions in plain English; a Supabase Edge Function translates them to safe, user-scoped SQL and returns a grounded answer with the query used.
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
| **Authentication** | Supabase Auth                            |
| **Security**       | PostgreSQL Row Level Security (RLS)      |
| **Receipt Parser** | Gemini API / OpenRouter (model-agnostic) |
| **AI Assistant**   | Supabase Edge Function (text-to-SQL)     |
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
│   ├── assistant.js                # AI assistant chat view (text-to-SQL)
│   ├── categories.js               # Canonical categories + granular tag mapping
│   ├── classifier.js               # On-device Naive Bayes category classifier
│   ├── dashboard.js                # Dashboard & spending-by-category pie chart
│   ├── expenses.js                 # Expense management & receipt scanning
│   ├── income.js                   # Income management
│   ├── parserEngine.js             # Model-agnostic receipt → JSON parser
│   ├── supabase.js                 # Supabase client & session management
│   ├── utils.js                    # Utilities, formatting & security helpers
│   └── eval/
│       ├── eval.js                 # Evaluation harness UI
│       └── metrics.js              # Accuracy scoring functions
│
├── eval/
│   ├── dataset/
│   │   ├── README.md               # Dataset guide & ground-truth format
│   │   └── ground-truth.json       # Ground-truth template
│
├── eval.html                       # Standalone evaluation module page
│
├── supabase/
│   ├── config.toml                 # Edge function config
│   ├── functions/assistant/
│   │   └── index.ts                # AI assistant edge function (Deno)
│   └── migrations/
│       └── 0001_canonical_categories.sql   # Upgrade script for existing databases
│
├── tests/
│   ├── classifier.test.js          # Naive Bayes classifier tests
│   └── metrics.test.js             # Evaluation metrics tests
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
   - **Upgrading an existing SnapSpend database?** Run `supabase/migrations/0001_canonical_categories.sql` instead — it preserves your expense data, remaps old categories onto the canonical four, and drops the removed bank/investment tables. **Back up your database first.**
4. Copy `.env.example` to `.env` and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

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

The AI Assistant edge function uses server-side secrets set with the Supabase CLI (see below), **not** `.env`.

---

## Database

`schema.sql` defines the following tables (all RLS-protected by `auth.uid() = user_id`):

| Table                     | Purpose                                          |
| ------------------------- | ------------------------------------------------ |
| `profiles`                | Username + email per user                        |
| `income_sources`          | Income categories (Salary, Bonus, Other)         |
| `income_entries`          | Monthly income records                           |
| `expense_categories`      | The 4 canonical categories per user              |
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

### 5. AI Assistant

Ask questions in plain English, e.g. *"How much did I spend on Groceries this month?"* or *"What was my biggest expense this year?"*

The assistant uses **tool calling**: the LLM receives your question plus a system prompt with the database schema and few-shot SQL examples, decides whether to call a `query_expenses` tool, executes the (validated, read-only, user-scoped) SQL, and answers concisely from the grounded results. Questions outside its scope (anything not about your expense/income data) are answered with *"I can't answer questions outside of my scope"*.

1. Deploy the edge function (once):
   ```bash
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set GEMINI_API_KEY=your-gemini-key    # required for the gemini provider
   supabase secrets set OPENROUTER_API_KEY=your-key       # only for the openrouter provider
   supabase functions deploy assistant
   ```
   (`SUPABASE_DB_URL` and `SUPABASE_JWKS` are auto-provisioned by the platform — no manual secrets needed.)
2. In the app, open the **AI Assistant** tab and type your question.

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

Both normalize item categories onto the canonical four and return the same shape: `{ vendor, date, total_amount, purchased_items: [[name, quantity, price, currency, category], …] }`.

---

## Evaluation Module

The separate **evaluation module** (`eval.html`, built at `/eval.html`) benchmarks how accurately multiple models × system prompts parse receipts:

1. Drop receipt images into `eval/dataset/` and fill in `ground-truth.json` (see `eval/dataset/README.md`).
2. Open `/eval.html` (requires `VITE_OPENROUTER_API_KEY` and/or `VITE_GEMINI_API_KEY`).
3. Pick models (or add custom model IDs) and system prompts, then **Run Evaluation**.

Metrics per (model × prompt) combination:

- JSON validity, vendor match (exact & normalized), date match, total amount (exact + relative error), item count, item-name token F1, quantity match, price relative error, and canonical category match.
- An **overall score** ranks the combinations; per-receipt details are inspectable and results can be exported as CSV or JSON.

---

## Security & Privacy

- **No third-party tracking** — user ledger data is never sent to analytics services.
- **Row Level Security** — every financial record is protected by `auth.uid() = user_id`.
- **Assistant SQL safety** — the edge function only permits single `SELECT` statements, always forces `WHERE user_id = <authenticated user>`, rejects mutating keywords, and runs inside a read-only transaction.
- **Input sanitization** — user text is HTML-escaped before rendering.

> **Security Notice:** No software can guarantee absolute security. Please report suspected vulnerabilities according to the project's security disclosure policy.

---

## License

SnapSpend is distributed under the **MIT License** (see `LICENSE`).
