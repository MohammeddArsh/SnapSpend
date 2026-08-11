# SnapSpend — Personal Wealth & Expense Tracker

**SnapSpend** is a privacy-first, client-side personal finance and wealth management platform built with **Vanilla JavaScript (ES6+), Tailwind CSS, Vite, and Supabase**.

Unlike generic expense trackers, SnapSpend combines **client-side AI expense classification** with a **personal balance-sheet engine**, supporting multi-asset investment tracking, anomaly detection, bank reconciliation, and compound-growth projections.

---

## Tech Stack

| Layer              | Technologies                             |
| ------------------ | ---------------------------------------- |
| **Frontend**       | Vanilla JavaScript (ES6+), HTML5         |
| **Styling**        | Tailwind CSS v4                          |
| **Icons**          | Lucide Icons                             |
| **Fonts**          | Inter, JetBrains Mono                    |
| **Build Tool**     | Vite 6                                   |
| **Database**       | PostgreSQL via Supabase                  |
| **Authentication** | Supabase Auth                            |
| **Security**       | PostgreSQL Row Level Security (RLS)      |
| **PDF Generation** | jsPDF, jsPDF-AutoTable                   |
| **Testing**        | Node.js Native Test Runner (`node:test`) |

---

## Project Structure

```text
SnapSpend/
│
├── css/
│   └── main.css                 # Base styles & fluid typography
│
├── js/
│   ├── app.js                   # Application router & authentication UI
│   ├── banks.js                 # Banking ledger workspace
│   ├── classifier.js            # On-device Naive Bayes classifier
│   ├── dashboard.js             # Financial dashboard & SVG charts
│   ├── expenses.js              # Expense management & anomaly detection
│   ├── future-wealth.js         # Wealth growth & compounding simulators
│   ├── income.js                # Income management
│   ├── investments.js           # Multi-asset investment ledger
│   ├── pdf-generator.js         # PDF report generation
│   ├── reports.js               # Financial health reports
│   ├── supabase.js              # Supabase client & session management
│   └── utils.js                 # Utilities, formatting & security helpers
│
├── tests/
│   └── classifier.test.js       # Naive Bayes classifier tests
│
├── .env.example                 # Environment variable template
├── .gitignore                   # Git ignore rules
├── CONTRIBUTING.md              # Contribution guidelines
├── index.html                   # Main application shell
├── LICENSE                      # MIT License
├── package.json                 # Dependencies & npm scripts
├── schema.sql                   # PostgreSQL schema & RLS policies
├── SECURITY.md                  # Security disclosure policy
├── tsconfig.json                # TypeScript configuration
└── vite.config.ts               # Vite configuration
```

---

# Getting Started

## Prerequisites

Make sure you have the following installed:

* **Node.js:** v18.0.0 or higher
* **npm:** v9.0.0 or higher
* **Supabase Account:** A free Supabase project

---

## 1. Clone the Repository

```bash
git clone https://github.com/MohammeddArsh/SnapSpend.git
cd SnapSpend
```

---

## 2. Configure Supabase

Create a new project from your Supabase dashboard.

Then:

1. Open the **SQL Editor**.
2. Open `schema.sql` from this repository.
3. Copy the complete SQL script.
4. Execute it in the Supabase SQL Editor.

This will configure:

* User profiles
* Income records
* Bank accounts
* Expenses
* Categories
* Investments
* Row Level Security policies

---

## 3. Install Dependencies

```bash
npm install
```

---

## 4. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Then add your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key-here
```

> **Note:** Never commit your `.env` file to the repository.

---

## 5. Start the Development Server

```bash
npm run dev
```

The application will be available at:

```text
http://localhost:3000
```

---

# Development Commands

| Command           | Description                                       |
| ----------------- | ------------------------------------------------- |
| `npm run dev`     | Starts the Vite development server on port 3000   |
| `npm run build`   | Builds the application for production             |
| `npm run preview` | Previews the production build locally             |
| `npm run lint`    | Runs TypeScript type checking with `tsc --noEmit` |
| `npm run test`    | Runs the native Node.js test suite                |
| `npm run clean`   | Removes production build output                   |

---

# Usage Guide

### 1. Create an Account

Register using:

* Unique username
* Email address
* Password

### 2. Explore the Dashboard

The dashboard provides an overview of your financial position, including:

* Total net worth
* Monthly income
* Monthly expenses
* Savings rate
* Spending breakdowns
* Interactive SVG charts

### 3. Track Income & Expenses

Record your financial transactions and provide details such as:

* Merchant
* Amount
* Date
* Description
* Category

The Naive Bayes classifier analyzes transaction descriptions and merchant names to recommend appropriate expense categories.

### 4. Manage Bank Accounts

Use the banking workspace to:

* Add bank accounts.
* Track balances.
* Maintain account ledgers.
* Reconcile financial records.

### 5. Track Investments

Manage multiple asset classes from a single investment ledger:

* Fixed Deposits
* Sovereign Gold Bonds
* Mutual Funds
* Stocks & Equity Portfolios

### 6. Simulate Future Wealth

Use the wealth simulators to project potential long-term growth based on:

* Initial investment
* Periodic contributions
* Expected returns
* Investment duration
* Compound growth

This can be used to explore long-term savings and retirement scenarios.

### 7. Export Financial Reports

Generate PDF financial reports containing summarized financial information for personal record keeping.

---

# Testing

SnapSpend uses the native **Node.js test runner (****`node:test`****)** for automated testing.

Run the test suite with:

```bash
npm test
```

Current test coverage includes:

* Naive Bayes classifier training
* Classification prediction bounds
* Merchant-name normalization
* Category confidence thresholds
* Fallback classification logic

---

# Security & Privacy

Privacy is a core design principle of SnapSpend.

### No Third-Party Tracking

SnapSpend does not send user financial ledger data to third-party tracking or analytics services.

### Client-Side AI

Expense classification runs directly in the user's browser rather than sending transaction descriptions to an external AI service.

### Row Level Security

Financial records are protected using PostgreSQL Row Level Security.

The fundamental access policy follows:

```sql
auth.uid() = user_id
```

This prevents users from accessing another user's financial records through the database API.

### Input Sanitization

User-provided text is escaped before being inserted into HTML contexts to reduce XSS risks.

> **Security Notice:** No software can guarantee absolute security. Please report suspected vulnerabilities according to the project's security disclosure policy.

---

# Contributing

Contributions, bug reports, and feature suggestions are welcome.

Before submitting a pull request, please review `CONTRIBUTING.md`.

When contributing, please ensure that:

1. Existing functionality is not unintentionally broken.
2. New functionality includes appropriate tests where applicable.
3. Code follows the existing project structure and conventions.
4. Sensitive credentials are never committed.
5. Security-sensitive changes are clearly documented.

---

# License

SnapSpend is distributed under the **MIT License**.

See `LICENSE` for the full license text.

---

## Project Overview

SnapSpend aims to bridge the gap between **expense tracking, personal accounting, and wealth management**.

Instead of treating investments as expenses or focusing exclusively on monthly spending, SnapSpend provides a unified view of:

```text
Income
   │
   ├── Expenses ──────────► Spending Analysis
   │
   ├── Savings ───────────► Savings Rate
   │
   ├── Investments ───────► Wealth Tracking
   │
   └── Bank Accounts ─────► Balance Reconciliation
                              │
                              ▼
                         Net Worth
                              │
                              ▼
                    Future Wealth Projection
```

**SnapSpend — Track your money. Understand your wealth.**
