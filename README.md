# SnapSpend — AI Personal Wealth & Expense Tracker

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Vite](https://img.shields.io/badge/Vite-6.x-646CFF.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4.x-38B2AC.svg)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-JS_v2-3ECF8E.svg)](https://supabase.com/)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB.svg)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100+-009688.svg)](https://fastapi.tiangolo.com/)

**SnapSpend** is a privacy-first, full-stack personal finance and wealth management platform built using **Vanilla JavaScript (ES6+)**, **Tailwind CSS**, **Vite**, **Supabase**, and a **Python FastAPI / Google Gemini AI** receipt parsing engine.

Unlike generic expense trackers, SnapSpend combines client-side zero-latency AI classification with a complete **personal balance sheet engine**—supporting multi-asset investment tracking, anomaly detection, dynamic bank reconciliations, and exact compound growth projections.

---

## 🌟 Key Features

### 🧠 1. On-Device Naive Bayes AI Classifier (100% Private)
* **Zero Latency & Total Privacy**: Runs entirely in the client browser using a custom Naive Bayes probabilistic model.
* **Auto-Categorization**: Learns from transaction note text and merchant names to automatically recommend expense categories in real-time.

### ⚠️ 2. Real-Time Typo Anomaly Scanner
* Evaluates standard deviation bounds across category spending history.
* Warns users before saving transactions if an entered amount deviates by $>2.5\times$ from category historical averages (e.g. accidentally logging ₹10,000 instead of ₹1,000).

### 📈 3. Multi-Asset Sovereign Ledger
Adapts calculation and form logic dynamically across distinct asset classes:
* **Fixed Deposits (FD)**: Models quarterly compounding maturity value:
  $$A = P \times \left(1 + \frac{r}{400}\right)^{4t}$$
* **Sovereign Gold Bonds (SGB)**: Tracks simple annual coupon yield ($2.5\%$).
* **Stocks & Portfolios**: Calculates CAGR returns, average buy pricing, and net market valuation.
* **Mutual Funds**: Tracks recurring Systematic Investment Plans (SIPs).

### 🧮 4. Mathematically Rigorous Savings Engine
Standard trackers treat investment contributions as lost "expenses," miscalculating real savings. SnapSpend isolates **Unallocated Cash** and calculates true **Savings Rate**:
$$\text{Savings Rate} = \frac{\text{Total Income} - \text{Total Expenses}}{\text{Total Income}} \times 100$$

### 🧾 5. AI Receipt Parser (FastAPI + Gemini Multimodal)
* Upload receipt images or PDFs via the python backend endpoint to extract itemized purchases, line-item quantities, tax, and vendor metadata using **Google Gemini 2.0 Flash**.

### 🔒 6. Security & Dual-Identity Auth
* Dual lookup authentication using **Email** or **Unique Username**.
* **PostgreSQL Row Level Security (RLS)**: Enforces strict data isolation (`auth.uid() = user_id`).
* All user input text and logs pass through an HTML entity escaping matrix to eliminate XSS risks.

---

## 🛠️ Tech Stack

| Layer | Technologies Used |
| :--- | :--- |
| **Frontend Framework** | Vanilla JavaScript (ES6+ Modules), HTML5 |
| **Styling & Design System** | Tailwind CSS v4, Lucide Icons, Google Fonts (Inter, JetBrains Mono) |
| **Build Tooling** | Vite 6 |
| **Backend & Database** | Supabase (PostgreSQL, Row Level Security, Supabase Auth) |
| **OCR Backend Service** | Python 3.10+, FastAPI, Google GenAI SDK (Gemini 2.0 Flash), Pydantic |
| **PDF Generation** | jsPDF, jsPDF-AutoTable |
| **Testing** | Node.js Test Runner (`node:test`) |

---

## 📁 Project Structure

```text
SnapSpend/
├── backend/                 # Python FastAPI Receipt OCR Service
│   ├── app.py               # FastAPI server endpoints & CORS middleware
│   ├── ocr_engine.py        # Computer vision OCR extraction helpers
│   ├── parser_engine.py     # Gemini multimodal receipt parsing engine
│   ├── requirements.txt     # Python dependencies
│   └── .env.example         # Backend environment configuration template
├── css/
│   └── main.css             # Base styles & fluid typography rules
├── js/
│   ├── app.js               # Application router & Auth UI controller
│   ├── banks.js             # Banking ledger workspace
│   ├── classifier.js        # On-device Naive Bayes ML classifier
│   ├── dashboard.js         # Financial Digest dashboard & SVG charts
│   ├── expenses.js          # Expense registers, CSV imports, anomaly checks
│   ├── future-wealth.js     # Wealth growth compounding simulators
│   ├── income.js            # Income log management
│   ├── investments.js       # Multi-asset investment ledger
│   ├── pdf-generator.js     # PDF report export generator
│   ├── reports.js           # Rule-based financial health reports
│   ├── supabase.js          # Supabase client setup & session handlers
│   └── utils.js             # Currency formatting, XSS protection, date utils
├── tests/
│   └── classifier.test.js   # Automated unit tests for AI classifier
├── .env.example             # Frontend environment configuration template
├── .gitignore               # Excludes secrets, dependencies, & build artifacts
├── CONTRIBUTING.md          # Open-source contribution guidelines
├── index.html               # Main application DOM shell
├── LICENSE                  # MIT License
├── package.json             # Node dependencies & npm scripts
├── schema.sql               # Production PostgreSQL database schema with RLS
├── SECURITY.md              # Vulnerability reporting disclosure policy
├── tsconfig.json            # TypeScript type-checking configuration
└── vite.config.ts           # Vite build resolution rules
```

---

## 📸 Screenshots

> *Placeholder: Add screenshots of your deployed app interface here.*

| Financial Digest Dashboard | Income & Expenses Workspace |
| :---: | :---: |
| ![Dashboard Placeholder](https://via.placeholder.com/600x350/0f172a/ffffff?text=SnapSpend+Dashboard+Preview) | ![Expenses Placeholder](https://via.placeholder.com/600x350/0f172a/ffffff?text=SnapSpend+Expenses+Workspace) |

| Wealth Compounding Simulator | Multi-Asset Ledger |
| :---: | :---: |
| ![Simulators Placeholder](https://via.placeholder.com/600x350/0f172a/ffffff?text=Wealth+Compounding+Simulators) | ![Ledger Placeholder](https://via.placeholder.com/600x350/0f172a/ffffff?text=Multi-Asset+Investment+Ledger) |

---

## 🚀 Getting Started

### Prerequisites

Ensure you have the following installed locally:
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher
* **Python**: 3.10+ (Optional, for running OCR backend service)
* **Supabase Account**: Free project instance at [supabase.com](https://supabase.com)

---

### 1. Repository Setup

```bash
git clone https://github.com/your-username/SnapSpend.git
cd SnapSpend
```

---

### 2. Database Setup (Supabase)

1. Create a new project in your [Supabase Dashboard](https://database.new).
2. Open the **SQL Editor** tab in Supabase.
3. Copy the full SQL script from [`schema.sql`](file:///c:/Users/pramu/Downloads/SnapSpend/SnapSpend/schema.sql) and run it. This creates tables for profiles, income, banks, expenses, categories, investments, and configures Row Level Security (RLS) policies.

---

### 3. Frontend Setup (Vite + Vanilla JS)

1. Install Node.js dependencies:
   ```bash
   npm install
   ```

2. Copy `.env.example` to create your local `.env` file:
   ```bash
   cp .env.example .env
   ```

3. Configure your `.env` credentials:
   ```env
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=your-supabase-anon-key-here
   VITE_OCR_API_URL=http://localhost:8000
   ```

4. Start the frontend development server:
   ```bash
   npm run dev
   ```

5. Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

### 4. Receipt OCR Backend Setup (Python + FastAPI)

*(Optional: Required if using automated AI receipt image parsing)*

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a Python virtual environment:
   ```bash
   # macOS/Linux
   python3 -m venv venv
   source venv/bin/activate

   # Windows
   python -m venv venv
   venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Copy `backend/.env.example` to `backend/.env` and set your Gemini API key:
   ```env
   GEMINI_API_KEY=your-google-gemini-api-key-here
   ```

5. Launch the FastAPI backend server:
   ```bash
   uvicorn app:app --reload --port 8000
   ```

---

## 💻 Development & Build Commands

| Command | Action |
| :--- | :--- |
| `npm run dev` | Starts Vite local development server on port 3000 |
| `npm run build` | Compiles production assets into `dist/` |
| `npm run preview` | Previews production build locally |
| `npm run lint` | Runs TypeScript compiler type-check (`tsc --noEmit`) |
| `npm run test` | Runs unit test suite using Node native test runner |
| `npm run clean` | Removes build outputs (`dist/`) |

---

## 📖 Usage Guide

1. **Sign Up / Log In**: Register a new user account with a unique username, email, and password.
2. **Dashboard**: View your overall net worth, monthly income vs expenses, savings rate, and interactive SVG breakdown charts.
3. **Log Income & Expenses**: Record monthly earnings and expenditures. Note descriptions trigger the Naive Bayes AI classifier for category suggestions.
4. **Bank Reconciliations**: Maintain account ledger balances across financial institutions.
5. **Investment Ledger**: Track portfolio allocations in FDs, SGBs, Mutual Funds, and Equities.
6. **Simulators**: Project long-term compound growth for retirement and savings goals.
7. **PDF Exports**: Export clean financial digest statements for auditing.

---

## 🔌 API Documentation

The optional FastAPI receipt parsing backend exposes the following endpoint:

### `POST /parse-receipt`

Parses receipt image files and returns itemized json records.

* **Request**: `multipart/form-data`
* **Body**: `files`: List of receipt image files (`.jpg`, `.png`, `.webp`)
* **Response**: `200 OK`

#### Response Example:
```json
{
  "total_files": 1,
  "processed": [
    {
      "filename": "receipt_grocery.jpg",
      "status": "success",
      "data": {
        "merchant": "Whole Foods Market",
        "receipt_date": "2026-05-15",
        "currency": "EUR",
        "subtotal": 24.50,
        "tax": 1.96,
        "total_amount": 26.46,
        "items": [
          {
            "item_name": "Organic Almond Milk",
            "quantity": 2,
            "unit_price": 3.25,
            "price": 6.50,
            "category": "Dairy"
          }
        ]
      }
    }
  ]
}
```

---

## 🧪 Testing

SnapSpend uses the native Node.js test runner (`node:test`) for unit testing zero-dependency browser modules.

To execute tests:
```bash
npm test
```

Test coverage includes:
* Naive Bayes classifier training & prediction bounds
* Merchant name normalization & OCR noise stripping
* Category confidence fallback algorithms

---

## 🛡️ Security & Privacy

* **Zero Tracking**: SnapSpend does not send user ledger data to third-party tracking services.
* **Session Storage Credentials**: API credentials can optionally be stored in temporary `sessionStorage` (automatically destroyed when browser tab closes).
* **Row Level Security**: Database rows are strictly constrained via Postgres policies (`auth.uid() = user_id`).

---

## 🔮 Future Improvements

- [ ] Multi-currency auto-conversion engine with live exchange rates
- [ ] Export transactions directly to standard OFX / QIF accounting formats
- [ ] Dark Mode UI theme toggle
- [ ] Offline PWA capability with IndexedDB local caching

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on code standards and submitting pull requests.

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.
