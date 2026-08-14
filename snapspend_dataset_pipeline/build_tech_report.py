#!/usr/bin/env python3
"""
SnapSpend — Technical Documentation Report Generator

Builds a comprehensive PDF report describing every technology, technique and
algorithm used in the SnapSpend app, with a deep dive into the receipt OCR
engine and the design decision to move from PaddleOCR to the Gemini API.

Output: reports/SnapSpend_Technical_Report.pdf
"""

import os
from datetime import date

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    KeepTogether, Preformatted,
)

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, "reports")
OUT_PDF = os.path.join(OUT_DIR, "SnapSpend_Technical_Report.pdf")

# ---------------------------------------------------------------------------
# Palette (mirrors the app's clean ink/paper design)
# ---------------------------------------------------------------------------
INK = colors.HexColor("#1a1c20")
MUTED = colors.HexColor("#5f6470")
FAINT = colors.HexColor("#8a90a0")
HAIRLINE = colors.HexColor("#e8e8e4")
PANEL = colors.HexColor("#fafaf8")
GOOD = colors.HexColor("#0e9f6e")
BRAND = colors.HexColor("#4f46e5")
CODE_BG = colors.HexColor("#f4f5f7")

CAT_COLORS = {
    "Groceries": colors.HexColor("#10b981"),
    "Pharmacy": colors.HexColor("#0ea5e9"),
    "Travel": colors.HexColor("#8b5cf6"),
    "Households": colors.HexColor("#f59e0b"),
    "Miscellaneous": colors.HexColor("#64748b"),
}

# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------
styles = getSampleStyleSheet()

styles.add(ParagraphStyle(
    name="SS_Title", fontName="Helvetica-Bold", fontSize=30, leading=34,
    textColor=INK, alignment=TA_LEFT, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="SS_Subtitle", fontName="Helvetica", fontSize=14, leading=18,
    textColor=MUTED, spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="SS_Meta", fontName="Helvetica", fontSize=9, leading=13,
    textColor=FAINT,
))
styles.add(ParagraphStyle(
    name="SS_H1", fontName="Helvetica-Bold", fontSize=17, leading=20,
    textColor=INK, spaceBefore=16, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="SS_H2", fontName="Helvetica-Bold", fontSize=12.5, leading=15,
    textColor=BRAND, spaceBefore=12, spaceAfter=5,
))
styles.add(ParagraphStyle(
    name="SS_H3", fontName="Helvetica-Bold", fontSize=10.5, leading=13,
    textColor=INK, spaceBefore=8, spaceAfter=4,
))
styles.add(ParagraphStyle(
    name="SS_Body", fontName="Helvetica", fontSize=9.5, leading=13.5,
    textColor=INK, spaceAfter=6, alignment=TA_LEFT,
))
styles.add(ParagraphStyle(
    name="SS_Bullet", parent=styles["SS_Body"], leftIndent=12, bulletIndent=2,
    spaceAfter=3,
))
styles.add(ParagraphStyle(
    name="SS_Note", fontName="Helvetica-Oblique", fontSize=8.5, leading=12,
    textColor=MUTED, spaceAfter=6,
))
styles.add(ParagraphStyle(
    name="SS_Caption", fontName="Helvetica-Oblique", fontSize=8, leading=11,
    textColor=FAINT, spaceBefore=2, spaceAfter=8,
))
styles.add(ParagraphStyle(
    name="SS_TOC1", fontName="Helvetica-Bold", fontSize=10, leading=14,
    textColor=INK, spaceAfter=2,
))
styles.add(ParagraphStyle(
    name="SS_TOC2", fontName="Helvetica", fontSize=9, leading=12.5,
    textColor=MUTED, leftIndent=14, spaceAfter=1,
))


def H1(text):
    return Paragraph(text, styles["SS_H1"])


def H2(text):
    return Paragraph(text, styles["SS_H2"])


def H3(text):
    return Paragraph(text, styles["SS_H3"])


def P(text):
    return Paragraph(text, styles["SS_Body"])


def B(text):
    return Paragraph(f"&#8226;&nbsp;&nbsp;{text}", styles["SS_Bullet"])


def N(text):
    return Paragraph(text, styles["SS_Note"])


def CAP(text):
    return Paragraph(text, styles["SS_Caption"])


def CODE(text):
    return Preformatted(text, ParagraphStyle(
        name="Code", fontName="Courier", fontSize=7.3, leading=9,
        backColor=CODE_BG, borderColor=HAIRLINE, borderWidth=0.5,
        borderPadding=6, textColor=INK, spaceBefore=4, spaceAfter=8,
    ))


def spacer(h=6):
    return Spacer(1, h)


def rule():
    t = Table([[""]], colWidths=[180 * mm])
    t.setStyle(TableStyle([
        ("LINEBELOW", (0, 0), (-1, -1), 0.6, HAIRLINE),
    ]))
    return t


def kv_table(rows, col0=42 * mm, col1=138 * mm):
    data = [[Paragraph(k, ParagraphStyle("k", fontName="Helvetica-Bold", fontSize=8.5,
                                         textColor=MUTED, leading=11)),
             Paragraph(v, ParagraphStyle("v", fontName="Helvetica", fontSize=8.5,
                                         textColor=INK, leading=11))]
            for k, v in rows]
    t = Table(data, colWidths=[col0, col1], hAlign="LEFT")
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("GRID", (0, 0), (-1, -1), 0.4, HAIRLINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def header_table(data, widths):
    t = Table(data, colWidths=widths, hAlign="LEFT", repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#111827")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("GRID", (0, 0), (-1, -1), 0.4, HAIRLINE),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 7.5),
        ("FONTSIZE", (0, 0), (-1, 0), 7.8),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


story = []

# ===========================================================================
# COVER PAGE
# ===========================================================================
story.append(Spacer(1, 60 * mm))
story.append(Paragraph("SnapSpend", styles["SS_Title"]))
story.append(Paragraph("AI-Powered Expense Tracker", styles["SS_Subtitle"]))
story.append(Spacer(1, 4 * mm))
story.append(Paragraph(
    "Technical Documentation Report", ParagraphStyle(
        name="CoverTag", fontName="Helvetica-Bold", fontSize=11, leading=14,
        textColor=BRAND, spaceAfter=10)))
story.append(Paragraph(
    "Every technology, technique and algorithm behind the app — including the "
    "receipt OCR engine, its evaluation harness, and the design decision that "
    "led from PaddleOCR to the Gemini API.", styles["SS_Meta"]))
story.append(Spacer(1, 12 * mm))
story.append(Paragraph(f"Document date: {date.today().strftime('%d %B %Y')}", styles["SS_Meta"]))
story.append(Paragraph("Status: Production", styles["SS_Meta"]))
story.append(Paragraph("License: MIT", styles["SS_Meta"]))
story.append(PageBreak())

# ===========================================================================
# TABLE OF CONTENTS
# ===========================================================================
story.append(H1("Table of Contents"))
toc = [
    ("1", "Executive Summary"),
    ("2", "Technology Stack"),
    ("3", "System Architecture"),
    ("4", "Frontend Engineering"),
    ("5", "Database & Backend"),
    ("6", "Authentication & Security"),
    ("7", "The Receipt OCR Engine"),
    ("", "7.1  Design history: PaddleOCR vs. the Gemini API"),
    ("", "7.2  The PaddleOCR engine (ocr_engine.py)"),
    ("", "7.3  Pipeline A — OCR text then Gemini structuring"),
    ("", "7.4  Pipeline B — Gemini direct vision parsing"),
    ("", "7.5  The browser ParserEngine (parserEngine.js)"),
    ("", "7.6  Client-side scanning flow (expenses.js)"),
    ("", "7.7  Category normalization"),
    ("8", "The Naive Bayes Category Classifier"),
    ("9", "The AI Assistant"),
    ("", "9.1  Edge Function path (text-to-SQL)"),
    ("", "9.2  Client-side fallback path"),
    ("10", "Reports & PDF Export"),
    ("11", "Evaluation Module"),
    ("12", "Algorithms & Techniques Summary"),
    ("13", "Testing"),
    ("14", "Security & Privacy"),
    ("15", "Development Workflow"),
    ("16", "Appendix — Code Excerpts"),
    ("17", "Glossary"),
]
for num, title in toc:
    if num:
        story.append(Paragraph(f"{num}.&nbsp;&nbsp;{title}", styles["SS_TOC1"]))
    else:
        story.append(Paragraph(title, styles["SS_TOC2"]))
story.append(PageBreak())

# ===========================================================================
# 1. EXECUTIVE SUMMARY
# ===========================================================================
story.append(H1("1. Executive Summary"))
story.append(P(
    "SnapSpend is a <b>privacy-first, client-side expense tracker</b> built with "
    "Vanilla JavaScript (ES6+), Tailwind CSS v4, Vite 6 and Supabase. Every financial "
    "record is stored in the user's own PostgreSQL database and protected by Row Level "
    "Security, so no third party ever sees the user's ledger. The application has four "
    "pillars:"))
B("<b>Dashboard</b> — monthly income, expenses and net savings with a spending-by-category pie chart over exactly five canonical categories: Groceries, Pharmacy, Travel, Households, Miscellaneous.")
B("<b>Expenses</b> — manual entry with on-device Naive Bayes category suggestions, CSV import, and <b>AI receipt scanning</b>: upload a photo, get structured JSON back for review, then save.")
B("<b>Reports</b> — a month snapshot with ledgers, net-savings and savings-rate cards, month-over-month deltas, a spending donut and one-click PDF export (generated client-side).")
B("<b>AI Assistant &amp; Evaluation</b> — a natural-language assistant that answers questions only from the user's own data, plus a standalone module that benchmarks how accurately different models and system prompts parse receipts.")
story.append(P(
    "This report documents the full technical surface of the application: every "
    "library, every algorithm, every data structure, and the specific engineering "
    "steps taken — from database schema design to the multi-stage receipt OCR "
    "pipeline that was experimentally built first with <b>PaddleOCR</b> and then "
    "re-architected around the <b>Gemini API</b> when it became clear that local OCR "
    "speed could not match the accuracy of a vision-capable large language model."))

# ===========================================================================
# 2. TECHNOLOGY STACK
# ===========================================================================
story.append(H1("2. Technology Stack"))
story.append(P("The following table lists every technology used in the project and its exact role."))
tech_rows = [
    ["Layer", "Technology", "Role in SnapSpend"],
    ["Frontend", "Vanilla JavaScript (ES6+)", "Zero-framework app logic: router, views, engines. ECMAScript modules throughout."],
    ["Styling", "Tailwind CSS v4", "Utility-first styling compiled by the @tailwindcss/vite plugin."],
    ["Fonts", "Archivo / Inter / JetBrains Mono", "Display, body and mono typefaces (Google Fonts)."],
    ["Build tool", "Vite 6", "Dev server (port 3000), production bundling, two HTML entry points, dataset copy plugin."],
    ["Database", "PostgreSQL (Supabase)", "All persistent data: profiles, income, expenses, receipt items."],
    ["Client DB access", "@supabase/supabase-js", "Typed PostgREST client used by every view."],
    ["Auth", "Supabase Auth", "Email + password sign-in/sign-up; session tokens (JWT)."],
    ["Bot protection", "Cloudflare Turnstile", "Invisible CAPTCHA guarding every auth submit."],
    ["Security", "PostgreSQL RLS", "Row Level Security policies scope every row to auth.uid()."],
    ["Receipt parser", "Gemini API (generateContent)", "Structured JSON extraction from receipt images via response_schema."],
    ["Alternative parser", "OpenRouter API", "Model-agnostic vision parsing (JSON mode) for the eval module."],
    ["PDF export", "jsPDF + jspdf-autotable", "Client-side vector PDF generation of monthly reports."],
    ["AI Assistant", "Supabase Edge Function (Deno)", "Text-to-SQL with validated read-only execution under the caller's RLS identity."],
    ["Assistant fallback", "Gemini API (client-side)", "Deterministic tool-calling assistant for edge-free (Vercel) builds."],
    ["Testing", "node:test", "Node.js native test runner (no extra framework)."],
    ["Language-check", "TypeScript (tsc --noEmit)", "Type-checking only; the app ships plain JS."],
    ["OCR experiment", "PaddleOCR + PaddlePaddle", "Local, fast OCR engine evaluated and then replaced by the Gemini API."],
    ["OCR experiment", "OpenCV + NumPy", "Image byte decoding and bounding-box math in the Python pipeline."],
    ["Data structuring", "pydantic + google-genai", "Typed output schema and async client in the Python dataset builders."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in tech_rows[0]]]
                          + [[Paragraph(c, ParagraphStyle("td", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in tech_rows[1:]],
                         [26 * mm, 42 * mm, 112 * mm]))
story.append(CAP("Table 2.1 — Full technology inventory with responsibilities."))

# ===========================================================================
# 3. SYSTEM ARCHITECTURE
# ===========================================================================
story.append(H1("3. System Architecture"))
story.append(P(
    "SnapSpend is a classic <b>three-tier architecture</b>, but with the application "
    "logic deliberately pushed to the client for privacy and cost reasons:"))
B("The browser (SPA) — all UI, routing, aggregation, the receipt parser, the assistant fallback, and PDF generation run in the user's browser.")
B("Supabase — PostgreSQL with RLS, Supabase Auth, and a single Deno Edge Function (optional, recommended for production).")
B("Model providers — Google's Gemini API for structured receipt extraction and, optionally, OpenRouter as a model-agnostic alternative.")
story.append(H2("3.1 Data flow at a glance"))
flow = [
    ["From", "To", "What travels"],
    ["Browser", "Supabase (PostgREST)", "RLS-scoped SELECT/INSERT/UPDATE/DELETE on ledger tables; auth tokens."],
    ["Browser", "Gemini generateContent", "Receipt image bytes (base64) + system prompt; returns schema-constrained JSON."],
    ["Browser", "Edge Function (optional)", "User's question + JWT; returns grounded text answer + rows."],
    ["Edge Function", "Gemini / OpenRouter", "Question with tool declaration; LLM returns SQL to execute."],
    ["Edge Function", "PostgreSQL", "Validated read-only SQL executed under the caller's authenticated role."],
    ["Browser", "jsPDF", "Local vector rendering — nothing leaves the machine."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th2", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in flow[0]]]
                          + [[Paragraph(c, ParagraphStyle("td2", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in flow[1:]],
                         [40 * mm, 55 * mm, 85 * mm]))
story.append(CAP("Table 3.1 — Principal data flows. All user data stays inside the browser, Supabase, and the chosen model API."))
story.append(P(
    "The application is a <b>hash-router SPA</b>: <font face='Courier' size='8'>js/app.js</font> "
    "listens for hash changes and dispatches to one of the view modules (dashboard, "
    "income, expenses, reports, assistant). Each view module exports a "
    "<font face='Courier' size='8'>render(container, selectedMonth)</font> function that "
    "fetches data through the shared Supabase client, computes aggregates locally, and "
    "injects sanitized HTML into the DOM."))
story.append(P(
    "Two standalone entry points exist: <font face='Courier' size='8'>index.html</font> "
    "(the app) and <font face='Courier' size='8'>eval.html</font> (the evaluation harness). "
    "The Vite config declares both as rollup inputs and registers a custom "
    "<font face='Courier' size='8'>closeBundle</font> plugin that copies "
    "<font face='Courier' size='8'>eval/Dataset</font> (receipt images + ground truth) into "
    "<font face='Courier' size='8'>dist/</font> so the evaluation page works from the "
    "production build as well as in development."))

# ===========================================================================
# 4. FRONTEND ENGINEERING
# ===========================================================================
story.append(H1("4. Frontend Engineering"))
story.append(H2("4.1 Module organization"))
story.append(P(
    "The codebase is organized as one ES module per concern. The most important modules "
    "and their responsibilities are:"))
mods = [
    ["Module", "Responsibility"],
    ["js/app.js", "Hash router, auth UI, modal system, shared navigation, Cloudflare Turnstile mount."],
    ["js/dashboard.js", "Monthly metrics + SVG spending pie (donut) chart."],
    ["js/expenses.js", "Expense CRUD, receipt scanning flow, CSV importer, itemized receipt review."],
    ["js/income.js", "Income CRUD with 'copy last month's salary' draft."],
    ["js/reports.js", "Shared monthly report aggregation (getMonthlyReportData) + Reports view."],
    ["js/pdf-generator.js", "jsPDF single-page vector report export."],
    ["js/parserEngine.js", "Model-agnostic receipt → structured JSON (Gemini / OpenRouter)."],
    ["js/classifier.js", "On-device Naive Bayes classifier + merchant/rule classification cascade."],
    ["js/categories.js", "Canonical categories, granular→canonical map, stable category colors."],
    ["js/categoryMapping.js", "resolveCanonicalCategory — label → canonical category via map + classifier."],
    ["js/assistant*.js", "Assistant prompt, deterministic stats engine, client-side tool executor."],
    ["js/supabase.js", "Supabase client lifecycle + sessionStorage-based configuration."],
    ["js/utils.js", "Currency formatting, month math, HTML escaping."],
    ["js/datepicker.js / dropdown.js", "Reusable month picker and themed dropdown components."],
    ["js/eval/metrics.js", "Pure receipt-scoring functions (shared by app and CLI)."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th3", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in mods[0]]]
                          + [[Paragraph(c, ParagraphStyle("td3", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in mods[1:]],
                         [52 * mm, 128 * mm]))
story.append(CAP("Table 4.1 — Frontend module map."))
story.append(H2("4.2 Key frontend techniques"))
B("<b>Template literals + innerHTML</b> — every view renders markup as a template literal. All interpolated values are passed through <font face='Courier' size='8'>escapeHTML()</font> (utils.js) which encodes &amp; &lt; &gt; &quot; &#39; to prevent stored XSS.")
B("<b>Deferred module import</b> — the PDF generator is imported dynamically (<font face='Courier' size='8'>import('./pdf-generator.js')</font>) only when the user clicks Download, keeping the initial bundle lean.")
B("<b>Native Intl formatting</b> — currency uses <font face='Courier' size='8'>Intl.NumberFormat('en-IE', {style:'currency'})</font>; month labels use <font face='Courier' size='8'>toLocaleDateString</font>.")
B("<b>SVG donut chart</b> — no chart library. Slices are <font face='Courier' size='8'>&lt;circle&gt;</font> elements with <font face='Courier' size='8'>pathLength=&quot;100&quot;</font>, a <font face='Courier' size='8'>stroke-dasharray=&quot;pct 100-pct&quot;</font> and a <font face='Courier' size='8'>stroke-dashoffset</font> that accumulates per slice. Hover cross-highlights slices and legend rows; clicking navigates to a pre-filtered Expenses view.")
B("<b>Reusable components</b> — a themed dropdown (click-outside closing, scroll containment) and a custom month/date picker keep interactions consistent across modals and CSV grids.")
story.append(H2("4.3 State & configuration"))
story.append(P(
    "Supabase credentials are read from Vite environment variables and can be "
    "re-configured at runtime through a setup overlay. That configuration is stored in "
    "<b>sessionStorage</b> (not localStorage) so credentials auto-clear when the tab "
    "closes — a deliberate security choice. The auth state (current user, session) is "
    "managed centrally in app.js and passed down to view modules."))

# ===========================================================================
# 5. DATABASE & BACKEND
# ===========================================================================
story.append(H1("5. Database & Backend"))
story.append(P(
    "The schema (<font face='Courier' size='8'>schema.sql</font>) targets a fresh "
    "Supabase-hosted PostgreSQL database and defines six tables. Every financial table "
    "carries a <font face='Courier' size='8'>user_id</font> and is protected by an RLS "
    "policy of the form <font face='Courier' size='8'>auth.uid() = user_id</font>."))
db_rows = [
    ["Table", "Purpose", "Key columns"],
    ["profiles", "Username + email per user.", "id (PK→auth.users), username (unique), email (unique)"],
    ["income_sources", "Income categories per user.", "user_id, name (unique per user): Salary, Bonus, Other"],
    ["income_entries", "Monthly income records.", "user_id, source_id (FK), amount, date_credited, month (YYYY-MM)"],
    ["expense_categories", "The five canonical categories.", "user_id, name (unique per user)"],
    ["expense_entries", "One row per expense (manual or scanned).", "user_id, category_id (FK), amount numeric(12,2), date, month, merchant, note, currency, entry_type ('manual'|'scanned'), raw_json JSONB"],
    ["expense_receipt_items", "Itemized line items for scanned receipts.", "user_id, expense_id (FK, cascade), item_name, quantity, unit_price, price, category, confidence"],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th4", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in db_rows[0]]]
                          + [[Paragraph(c, ParagraphStyle("td4", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in db_rows[1:]],
                         [30 * mm, 52 * mm, 98 * mm]))
story.append(CAP("Table 5.1 — Database tables. All tables except profiles are RLS-restricted to their owner."))

story.append(H2("5.1 Triggers for data integrity"))
story.append(P(
    "Two BEFORE INSERT/UPDATE triggers auto-derive the denormalized "
    "<font face='Courier' size='8'>month</font> column (format YYYY-MM) from the real "
    "date column so that reporting queries never drift from the entry dates:"))
CODE("""CREATE OR REPLACE FUNCTION set_expense_month() RETURNS TRIGGER AS $$
BEGIN
  NEW.month := to_char(NEW.date, 'YYYY-MM');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_expense_month
  BEFORE INSERT OR UPDATE ON public.expense_entries
  FOR EACH ROW EXECUTE FUNCTION set_expense_month();""")
story.append(N("The same pattern exists for income_entries (set_income_month / trg_income_month). Denormalizing YYYY-MM into its own indexed column makes month-scoped aggregation a simple indexed range scan."))

story.append(H2("5.2 Automatic onboarding (handle_new_user)"))
story.append(P(
    "A SECURITY DEFINER trigger on auth.users seeds every new account on sign-up: "
    "the profile row (username from metadata, falling back to the email prefix, with a "
    "random-digit suffix to avoid collisions), the three income sources, and the five "
    "canonical expense categories. All inserts use <font face='Courier' size='8'>ON "
    "CONFLICT DO NOTHING</font> so the trigger is idempotent."))

story.append(H2("5.3 Indexing strategy"))
idx = [
    ["Index", "Why"],
    ["idx_profiles_username", "Unique-username lookups."],
    ["idx_income_entries_user_month", "Monthly income aggregation."],
    ["idx_expense_entries_user_month", "Monthly expense aggregation (dashboard/reports)."],
    ["idx_expense_entries_user_category", "Category-joined reports."],
    ["idx_expense_entries_user_type", "Filtering manual vs scanned."],
    ["idx_expense_entries_raw_json (GIN)", "JSONB queries over raw receipt payloads."],
    ["idx_receipt_items_expense_id", "Line-item fetch per expense."],
    ["idx_receipt_items_user_category", "Per-category item counting."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th5", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in idx[0]]]
                          + [[Paragraph(c, ParagraphStyle("td5", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in idx[1:]],
                         [72 * mm, 108 * mm]))
story.append(CAP("Table 5.2 — Indexes defined in the schema."))

story.append(H2("5.4 Migrations"))
story.append(P(
    "Databases created from the older schema are upgraded in place with three ordered "
    "migration scripts under <font face='Courier' size='8'>supabase/migrations/</font>:"))
B("<b>0001_canonical_categories.sql</b> — adds category_id/note columns, remaps legacy categories onto the canonical set, rewrites granular receipt-item tags, and drops the removed bank & investment tables.")
B("<b>0002_add_households_category.sql</b> — inserts a Households row for every existing user (idempotent).")
B("<b>0003_rename_outings_to_travel.sql</b> — merges 'Outings' / 'Trips / Outings' rows into 'Travel' and rewrites granular tags onto Travel.")

story.append(H2("5.5 Shared aggregation contract"))
story.append(P(
    "A single function, <font face='Courier' size='8'>getMonthlyReportData()</font> in "
    "js/reports.js, is the one source of truth for monthly figures. Both the Reports "
    "view and the PDF generator call it, guaranteeing the export always matches the "
    "screen. The category aggregation implements the receipt-split rule: scanned "
    "entries (those with <font face='Courier' size='8'>expense_receipt_items</font>) "
    "contribute each line-item price under its own item category; manual entries "
    "contribute their full amount under the parent category. Every granular tag is "
    "pushed through <font face='Courier' size='8'>mapToCanonical()</font> before it is "
    "accumulated."))

# ===========================================================================
# 6. AUTHENTICATION & SECURITY
# ===========================================================================
story.append(H1("6. Authentication & Security"))
story.append(H2("6.1 Supabase Auth + Cloudflare Turnstile"))
story.append(P(
    "Sign-up and sign-in use email + password through Supabase Auth. Before a request "
    "is submitted, a <b>Cloudflare Turnstile</b> widget is rendered in the auth panel "
    "(app.js <font face='Courier' size='8'>mountTurnstile()</font>). The resulting "
    "<font face='Courier' size='8'>captchaToken</font> is passed as the "
    "<font face='Courier' size='8'>captchaToken</font> option of "
    "<font face='Courier' size='8'>signInWithPassword</font>/<font face='Courier' size='8'>signUp</font>. "
    "The site key lives in the client (VITE_TURNSTILE_SITE_KEY) while the secret key "
    "stays server-side in Supabase Auth's bot-protection settings — a classic "
    "public/private key split."))
story.append(H2("6.2 Row Level Security"))
story.append(P(
    "RLS is enabled on every table. Policies use "
    "<font face='Courier' size='8'>USING (auth.uid() = user_id)</font> (and the matching "
    "WITH CHECK) so a user can only ever see and modify their own rows — even a "
    "malformed client query cannot leak another user's data. The profiles table has a "
    "public read policy plus an owner-only update policy."))
story.append(H2("6.3 Input sanitization"))
story.append(P(
    "All user text (merchants, notes, category names) is HTML-escaped before being "
    "injected into the DOM. Assistant replies are rendered as plain text, never as "
    "raw HTML."))

# ===========================================================================
# 7. THE RECEIPT OCR ENGINE  (the centerpiece)
# ===========================================================================
story.append(H1("7. The Receipt OCR Engine"))
story.append(P(
    "The OCR engine is the most technically interesting part of SnapSpend. It turns a "
    "photo of a paper receipt into structured JSON: vendor, date, total amount, and an "
    "itemized list where every line item is tagged with one of the five canonical "
    "categories. This section documents the complete journey — the original local-OCR "
    "approach, why it was replaced, and the final production engine."))

story.append(H2("7.1 Design history: PaddleOCR vs. the Gemini API"))
story.append(P(
    "<b>The first attempt used PaddleOCR</b> — a fast, open-source, locally run OCR "
    "engine from Baidu. The Python reference pipeline "
    "(<font face='Courier' size='8'>snapspend_dataset_pipeline/</font>) was built around "
    "it. The appeal was obvious: it is <b>free, runs offline, and is extremely fast</b> "
    "— a small image can be OCR'd in tens of milliseconds on a laptop, with no API "
    "latency and no per-call cost."))
story.append(P(
    "However, structured testing on the receipt dataset showed that PaddleOCR's speed "
    "could <b>not be traded against accuracy</b>:"))
B("Receipts are noisy: rotated, crumpled, low-contrast, with thermal-print bleed, stamps, barcodes and overlapping text. Classic OCR frequently mangles digits, prices and vendor names.")
B("Column alignment (item name | quantity | price) is lost when OCR emits a flat stream of text lines, so reconstructing which price belongs to which item becomes guesswork.")
B("OCR errors cascade: a mistranscribed '1.99' as '1,99' or '19.9' silently corrupts totals and category totals downstream.")
B("Receipts are language- and layout-diverse (German, English, mixed, multi-column) which classical OCR handles poorly.")
story.append(P(
    "The <b>Gemini API</b>, by contrast, is a vision-capable large language model: it "
    "sees the image as a whole, understands spatial layout, performs implicit OCR and "
    "semantic understanding together, and can emit <b>structured JSON constrained by a "
    "schema</b> in a single call. Its accuracy on receipts was dramatically higher in "
    "head-to-head evaluation — at the cost of network latency and per-call pricing. "
    "<b>The decision was therefore: use PaddleOCR-style local OCR for fast, cheap "
    "experiments and dataset building, but ship the Gemini API as the production "
    "parser.</b> The two approaches were even benchmarked against each other as two "
    "distinct pipelines (see Section 11)."))
story.append(P(
    "The repository preserves both worlds: the Python pipeline (PaddleOCR + Gemini "
    "structuring, and Gemini-only direct parsing) generates annotated datasets, while "
    "the browser ships the Gemini parser directly."))

story.append(H2("7.2 The PaddleOCR engine (ocr_engine.py)"))
story.append(P(
    "The wrapper initializes PaddleOCR with text-angle classification enabled and "
    "<font face='Courier' size='8'>use_doc_unwarping=False</font> — document unwarping "
    "was deliberately disabled because it is slow and receipts are usually flat "
    "enough to skip it. The pipeline then:"))
B("<b>Decodes image bytes</b> — raw bytes → NumPy uint8 array → OpenCV BGR matrix via <font face='Courier' size='8'>cv2.imdecode</font>. A failed decode raises a ValueError (protects against corrupt uploads).")
B("<b>Runs OCR</b> — <font face='Courier' size='8'>ocr.ocr(img)</font> returns detection + recognition results.")
B("<b>Normalizes two output formats</b> — because PaddleOCR changed its result structure across versions, the wrapper accepts both the newer PaddleX dictionary format (parallel arrays rec_texts / rec_scores / rec_polys) and the classic list-of-lines format <font face='Courier' size='8'>[box, (text, score)]</font>.")
B("<b>Computes bounding-box geometry</b> — for every line it derives x_min/x_max/y_min/y_max and the vertical center y_center, exposing both the text and its spatial position for later column reconstruction.")
B("<b>Returns per-line records</b> — {text, confidence, bounding_box} so downstream code can use confidence thresholds or geometry.")
CODE("""import cv2
import numpy as np
from paddleocr import PaddleOCR

ocr = PaddleOCR(use_angle_cls=True, lang='en', use_doc_unwarping=False)

def extract_ocr_data(image_bytes):
    nparr = np.frombuffer(image_bytes, np.uint8)
    img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image bytes.")
    results = ocr.ocr(img)
    if not results or results == [None]:
        return []
    parsed_results = []
    first_res = results[0]

    # Case 1: PaddleX dictionary output (parallel arrays)
    if isinstance(first_res, dict) and "rec_texts" in first_res:
        texts = first_res.get("rec_texts", [])
        scores = first_res.get("rec_scores", [])
        polys = first_res.get("rec_polys", []) or first_res.get("dt_polys", [])
        for i in range(len(texts)):
            box = polys[i] if i < len(polys) else None
            if box is not None and len(box) > 0:
                x = [p[0] for p in box]; y = [p[1] for p in box]
                parsed_results.append({
                    "text": str(texts[i]),
                    "confidence": float(scores[i] if i < len(scores) else 1.0),
                    "bounding_box": {"x_min": min(x), "y_min": min(y),
                                     "x_max": max(x), "y_max": max(y),
                                     "y_center": (min(y) + max(y)) / 2.0},
                })

    # Case 2: classic [box, (text, score)] tuple format
    elif isinstance(first_res, list):
        for line in first_res:
            if not line: continue
            box, text, score = None, "", 0.0
            if len(line) == 2:
                box, info = line
                text, score = info[0], info[1] if isinstance(info, (list, tuple)) else (info, 0.0)
            elif len(line) >= 3:
                box, text, score = line[0], line[1], line[2]
            if box is not None:
                x = [p[0] for p in box]; y = [p[1] for p in box]
                parsed_results.append({
                    "text": str(text), "confidence": float(score),
                    "bounding_box": {"x_min": min(x), "y_min": min(y),
                                     "x_max": max(x), "y_max": max(y),
                                     "y_center": (min(y) + max(y)) / 2.0},
                })
    return parsed_results""")

story.append(H2("7.3 Pipeline A — OCR text then Gemini structuring"))
story.append(P(
    "<font face='Courier' size='8'>build_ocr_gemini_dataset.py</font> implements the "
    "two-stage approach. Stage one converts the image to plain text with the PaddleOCR "
    "engine above (joining each line's text with newlines). Stage two sends that text "
    "to Gemini with a text-only system prompt and asks it to structure the data into "
    "the canonical JSON shape."))
story.append(P(
    "Resilience is built in: transient 429/500/503 responses are retried up to five "
    "times with exponential backoff plus a small random jitter "
    "(<font face='Courier' size='8'>min(60, 2**retries) + uniform(0,1)</font> seconds). "
    "Completed files are skipped on re-runs, so the builder is <b>resumable</b> — "
    "re-running the same command finishes only the leftovers. Failures are summarized "
    "at the end and retried on the next invocation."))
CODE("""async def process_one(image_path, retries=0):
    try:
        ocr_text = ocr_text_from_image(image_path)          # PaddleOCR stage
        result = await parse_receipt_ocr_text_async(ocr_text, model=MODEL)  # Gemini stage
    except google.genai.errors.ClientError as e:
        status = getattr(getattr(e, "response", None), "status_code", None) or getattr(e, "code", None)
        if status in RETRYABLE_STATUSES and retries < MAX_RETRIES:
            wait = min(60, 2 ** retries) + random.uniform(0, 1)
            print(f"  RETRY {image_path.name} (status={status}, try {retries+1}) in {wait:.1f}s")
            await asyncio.sleep(wait)
            return await process_one(image_path, retries + 1)
        return {"filename": image_path.name, "status": "failed", "error": str(e)}
    output_path = OUTPUT_DIR / f"{image_path.stem}.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    return {"filename": image_path.name, "status": "success"}""")

story.append(H2("7.4 Pipeline B — Gemini direct vision parsing"))
story.append(P(
    "<font face='Courier' size='8'>build_gemini_only_dataset.py</font> skips local OCR "
    "entirely: the image bytes are attached as an inline part "
    "(<font face='Courier' size='8'>Part.from_bytes</font>) and Gemini performs the OCR "
    "and structuring in one call. The shared parser "
    "(<font face='Courier' size='8'>parser_engine_v2.py</font>) configures the request "
    "with <font face='Courier' size='8'>response_mime_type=&quot;application/json&quot;</font> "
    "and a <b>pydantic model as the response schema</b>, so the API must return a "
    "conformant object rather than free text. A low temperature (0.1) keeps the output "
    "deterministic. This is the pipeline that feeds the production parser's design."))
CODE("""class InternalItem(BaseModel):
    name: str = Field(description="Name or description of product as listed on the receipt")
    quantity: int = Field(description="Quantity purchased, default to 1 if unspecified")
    price: float = Field(description="Total price paid for this line item")
    currency: str = Field(description="3-letter currency code, e.g. EUR, USD")
    category: str = Field(description="MUST be one of: Groceries, Pharmacy, Travel, Households, Miscellaneous")

class InternalReceiptData(BaseModel):
    vendor: str = Field(description="Store or business name")
    date: str = Field(description="Date in DD.MM.YYYY, empty string if missing")
    total_amount: float = Field(description="Total receipt amount paid")
    purchased_items: list[InternalItem]

async def parse_receipt_image_async(image_bytes, mime_type="image/jpeg",
                                    model=DEFAULT_GEMINI_MODEL, temperature=0.1):
    client = _get_client()
    response = await client.aio.models.generate_content(
        model=model,
        contents=[types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                  system_prompt],
        config=types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=InternalReceiptData,
            temperature=temperature,
        ),
    )
    return normalize_receipt_output(json.loads(response.text))""")

story.append(H2("7.5 The browser ParserEngine (parserEngine.js)"))
story.append(P(
    "The production engine runs entirely in the browser and is provider-agnostic. It "
    "returns a normalized shape consumed by the Expenses module and the evaluation "
    "harness:"))
CODE("""{
  "vendor": "ALDI SUED",
  "date": "01.08.2026",
  "total_amount": 6.43,
  "purchased_items": [
    ["Sandwiches 185g", 1, 1.99, "EUR", "Groceries"],
    ["Streuselkuchen",  1, 1.99, "EUR", "Groceries"]
  ]
}""")
story.append(H3("Gemini provider (default)"))
story.append(P(
    "The image is converted to base64 via FileReader and POSTed to "
    "<font face='Courier' size='8'>generativelanguage.googleapis.com/v1beta/models/"
    "{model}:generateContent</font>. The request body includes the inline image part, "
    "the system prompt, and a generationConfig declaring "
    "<font face='Courier' size='8'>response_mime_type</font> and the full JSON "
    "<font face='Courier' size='8'>response_schema</font> — the same structured-output "
    "technique as the Python pipeline, expressed in the raw REST format."))
story.append(H3("OpenRouter provider"))
story.append(P(
    "For model-agnostic parsing the engine calls the shared hardened OpenRouter client "
    "(Section 11). Because OpenRouter models cannot be constrained by a schema the same "
    "way, the JSON schema is instead injected as plain text "
    "(<font face='Courier' size='8'>RECEIPT_SCHEMA_PROMPT</font>) and JSON mode is "
    "requested via <font face='Courier' size='8'>response_format: {type:&quot;json_object&quot;}</font>."))
story.append(H3("Robustness techniques"))
B("<b>Retry with backoff</b> — Gemini calls retry on 429/500/502/503/504 up to four times, honoring a 'retry in Ns' hint from the error body when present (cap 60s).")
B("<b>Daily-quota fail-fast</b> — a 429 whose message mentions 'perday/per day/daily' is not retried; it raises a typed error (<font face='Courier' size='8'>dailyQuota</font>) so the UI can tell the user to wait rather than spin.")
B("<b>JSON salvage (extractJSON)</b> — model output often arrives wrapped in markdown code fences or with stray prose. extractJSON first tries a plain parse, then strips fences, then attempts the first balanced {...} slice. Only if all three fail does it raise.")
B("<b>Normalization</b> — numeric fields are coerced with parseFloat (+ fallbacks: quantity → 1, price/total → 0), missing vendor → 'Unknown', and every item category is passed through <font face='Courier' size='8'>mapToCanonical()</font>.")
CODE("""async function parseViaGemini(base64Data, mimeType, model, systemPrompt, temperature) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const payload = {
        contents: [{ parts: [
            { inline_data: { mime_type: mimeType, data: base64Data } },
            { text: systemPrompt }
        ]}],
        generationConfig: { response_mime_type: "application/json",
                            response_schema: RECEIPT_SCHEMA, temperature }
    };
    while (true) {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (response.ok) {
            const result = await response.json();
            const rawText = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText) throw new Error("Gemini returned an empty response.");
            return extractJSON(rawText);
        }
        const errorText = await response.text().catch(() => "");
        if (status === 429 && /perday|per[- ]?day|daily/i.test(errorText)) {
            const err = new Error(`Gemini daily quota exhausted (HTTP 429)`);
            err.dailyQuota = true; throw err;   // hard cap: fail fast
        }
        if (GEMINI_RETRYABLE.has(status) && attempt < GEMINI_MAX_RETRIES) {
            const hint = errorText.match(/retry (?:in|after) ([\\d.]+) ?s/i);
            attempt++;
            await sleep(Math.min(60, hint ? parseFloat(hint[1]) : 2 ** attempt) * 1000);
            continue;
        }
        throw new Error(`Gemini API Error (HTTP ${status})`);
    }
}""")

story.append(H2("7.6 Client-side scanning flow (expenses.js)"))
story.append(P(
    "The user journey for scanning a receipt is a carefully staged client-side "
    "workflow:"))
steps = [
    ["Step", "Action", "Detail"],
    ["1", "Pick an image", "File input accepts PNG/JPEG/WEBP; type is validated against a whitelist and the user is warned on mismatch."],
    ["2", "Base64 encode", "FileReader.readAsDataURL produces the base64 payload for the API; MIME type defaults to image/jpeg."],
    ["3", "Parse", "parseReceiptDirectly(file) → ParserEngine (Gemini) → normalized receipt JSON."],
    ["4", "Review", "openItemizedReceiptModal renders vendor/date/total and every line item as editable fields — the user confirms before anything is saved (no silent writes)."],
    ["5", "Save", "On confirm: an expense_entries row (entry_type='scanned', raw_json stored for audit) plus one expense_receipt_items row per line item; the DB trigger derives month."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th6", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in steps[0]]]
                          + [[Paragraph(c, ParagraphStyle("td6", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in steps[1:]],
                         [12 * mm, 34 * mm, 134 * mm]))
story.append(CAP("Table 7.1 — The receipt scanning workflow."))
story.append(P(
    "Date normalization (<font face='Courier' size='8'>normalizeOcrDate</font>) accepts "
    "ISO, DD.MM.YYYY, DD/MM/YYYY, DD-MM-YYYY, YYYY.MM.DD and native Date parsing, "
    "falling back to the first of the active month. Display code "
    "(<font face='Courier' size='8'>flattenExpenseEntries</font> / "
    "<font face='Courier' size='8'>getReceiptItemsForEntry</font>) resolves line items "
    "with a two-tier priority: real <font face='Courier' size='8'>expense_receipt_items</font> "
    "rows first, then items parsed from the stored <font face='Courier' size='8'>raw_json</font> "
    "(handling JSON that arrives as a stringified column value)."))

story.append(H2("7.7 Category normalization"))
story.append(P(
    "Models can return free-form categories (Pantry, Beverages, Outings, …). A "
    "hand-curated lookup table (<font face='Courier' size='8'>GRANULAR_TO_CANONICAL</font> "
    "in js/categories.js, mirrored in categories.py) maps ~80 granular tags onto the "
    "canonical five, with an 'unknown' default of Miscellaneous. "
    "<font face='Courier' size='8'>resolveCanonicalCategory()</font> (categoryMapping.js) "
    "goes further: when the granular map does not know a label (e.g. 'milk', 'jeans'), "
    "it falls back to the app's own receipt classifier so the mapping always agrees "
    "with how the app would categorize the purchase."))

# ===========================================================================
# 8. NAIVE BAYES CLASSIFIER
# ===========================================================================
story.append(H1("8. The Naive Bayes Category Classifier"))
story.append(P(
    "SnapSpend suggests a category as the user types an expense note, entirely "
    "on-device (no network). <font face='Courier' size='8'>js/classifier.js</font> "
    "implements a dependency-free <b>multinomial Naive Bayes</b> classifier and a "
    "rule-based cascade."))
story.append(H2("8.1 The Naive Bayes model"))
B("<b>Training data</b> — every expense the user saves with its category trains the classifier (categoryCount, tokenCount per category, totalDocs). It is a lifelong-learning model that adapts to the user's own spending vocabulary.")
B("<b>Tokenization</b> — lowercase, replace non-word chars with spaces, split on whitespace, drop single-character tokens.")
B("<b>Log-space scoring</b> — for each category, score = log P(category) + Σ log P(token|category), avoiding floating-point underflow on long texts.")
B("<b>Laplace smoothing</b> — P(token|category) = (count + 1) / (totalTokens + vocabSize), with vocabSize computed as the union vocabulary across all categories.")
B("<b>Prediction</b> — argmax over categories; returns null when there is no training data or no tokens.")
CODE("""predict(text) {
    if (this.totalDocs === 0 || this.categories.size === 0) return null;
    const tokens = this.tokenize(text);
    if (tokens.length === 0) return null;

    const vocab = new Set();
    Object.values(this.tokenCount).forEach(cat => Object.keys(cat).forEach(t => vocab.add(t)));
    const vocabSize = vocab.size || 1;

    let bestCategory = null, maxScore = -Infinity;
    this.categories.forEach(categoryId => {
        let score = Math.log(this.categoryCount[categoryId] / this.totalDocs);  // prior
        const catTokens = this.tokenCount[categoryId];
        const catTotal = Object.values(catTokens).reduce((s, v) => s + v, 0);
        tokens.forEach(token => {
            const count = catTokens[token] || 0;
            score += Math.log((count + 1) / (catTotal + vocabSize));            // Laplace
        });
        if (score > maxScore) { maxScore = score; bestCategory = categoryId; }
    });
    return bestCategory;
}""")
story.append(H2("8.2 Merchant-name normalization"))
story.append(P(
    "<font face='Courier' size='8'>normalizeMerchantName()</font> canonicalizes vendor "
    "strings so rule matching is robust to OCR/store variations: strips URLs and "
    "domains, removes legal suffixes (GmbH, Ltd, Inc, SE, …) and location words, "
    "collapses delimiters, and special-cases H&amp;M variants into a single canonical "
    "'h&amp;m'."))
story.append(H2("8.3 The classification cascade"))
story.append(P(
    "The real classifier (<font face='Courier' size='8'>classifyExpense()</font>) is a "
    "deterministic priority cascade. Each stage has a confidence score; the first stage "
    "that produces a match wins:"))
cascade = [
    ["Priority", "Stage", "Confidence", "Example"],
    ["A", "Explicit user selection", "1.00", "User picks a category from the dropdown."],
    ["—", "Online-retailer item keywords", "0.88", "Amazon order: 'vitamins' → Pharmacy."],
    ["B", "Known merchant rules", "0.95", "'ALDI' → Groceries; 'BOOTS' → Pharmacy; 'IKEA' → Households."],
    ["C", "Product/item keyword rules", "0.85", "note contains 'coffee' → Travel; 'detergent' → Households."],
    ["D", "Receipt sub-category evidence", "0.80", "Most frequent item category from a scanned receipt."],
    ["E", "Naive Bayes historical model", "0.70", "Merchant+note classified by trained model."],
    ["F", "Miscellaneous fallback", "0.10", "Nothing matched."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th7", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in cascade[0]]]
                          + [[Paragraph(c, ParagraphStyle("td7", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in cascade[1:]],
                         [20 * mm, 52 * mm, 20 * mm, 88 * mm]))
story.append(CAP("Table 8.1 — The classification priority cascade. Keyword matching is whole-token and phrase-aware so 'macy' never matches 'pharmacy' and 'cab' never matches 'cabbage'."))

# ===========================================================================
# 9. AI ASSISTANT
# ===========================================================================
story.append(H1("9. The AI Assistant"))
story.append(P(
    "The assistant answers natural-language questions about the user's own finances — "
    "e.g. 'How much did I spend on Groceries this month?' — using grounded data, never "
    "invented numbers. There are two execution paths."))

story.append(H2("9.1 Edge Function path (text-to-SQL)"))
story.append(P(
    "The recommended production path runs a Deno Edge Function in Supabase. The flow: "
    "JWT verification → LLM turn with tool declaration → LLM emits SQL → strict "
    "validation → read-only execution under the caller's RLS identity → grounded "
    "answer. At most three tool rounds are allowed."))
story.append(H3("JWT verification (index.ts)"))
story.append(P(
    "The caller's access token is verified against the project's JWKS. "
    "<font face='Courier' size='8'>SUPABASE_JWKS</font> is auto-provisioned by the "
    "platform and may be a remote JWKS URL or an inline JSON Web Key Set — both are "
    "handled. The verified <font face='Courier' size='8'>sub</font> claim becomes the "
    "user identity for the session."))
story.append(H3("SQL validation (sql.ts)"))
story.append(P(
    "Model-generated SQL is dangerous by default, so a defense-in-depth gate "
    "validates it before execution:"))
B("<b>Single statement</b> — a quote-aware scanner splits on semicolons that appear outside string literals; anything other than exactly one statement is rejected.")
B("<b>SELECT-only</b> — the statement must start with SELECT.")
B("<b>String-literal scrubbing</b> — keyword checks run on SQL with the contents of single-quoted strings blanked out, so a note containing the word 'delete' cannot false-positive.")
B("<b>Forbidden keywords</b> — insert/update/delete/drop/alter/create/truncate/grant/revoke/copy/execute/pg_/lo_import/lo_export and more are rejected.")
B("<b>No OR / UNION / subqueries</b> — these constructs could bypass user scoping and are explicitly rejected.")
B("<b>Table whitelist</b> — every FROM/JOIN must reference one of the five allowed tables.")
B("<b>Row-cap normalization</b> — any model-supplied LIMIT/OFFSET is stripped and a hard <font face='Courier' size='8'>LIMIT 100</font> appended.")
story.append(H3("Read-only, user-scoped execution"))
story.append(P(
    "The query runs inside <font face='Courier' size='8'>BEGIN TRANSACTION ISOLATION "
    "LEVEL REPEATABLE READ READ ONLY</font>, then <font face='Courier' size='8'>SET "
    "LOCAL ROLE authenticated</font> and <font face='Courier' size='8'>SET LOCAL "
    "request.jwt.claims</font> impersonate the caller so RLS policies enforce "
    "row-level scoping even if the model's WHERE clause is weak. A ROLLBACK on error "
    "keeps the transaction clean."))
CODE("""export async function runReadOnlyQuery(sql, userId) {
    const client = postgres(DB_URL, { max: 1, idle_timeout: 10 });
    try {
        await client.unsafe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        await client.unsafe("SET LOCAL ROLE authenticated");
        await client.unsafe(`SET LOCAL request.jwt.claims = '${JSON.stringify(
            { sub: userId, role: "authenticated" }).replace(/'/g, "''")}'`);
        await client.unsafe(`SET LOCAL request.jwt.claim.sub = '${userId}'`);
        return await client.unsafe(sql);
    } finally {
        await client.end();
    }
}""")
story.append(H3("Tool-calling loop"))
story.append(P(
    "The LLM client (llm.ts) abstracts Gemini (generateContent + functionDeclarations) "
    "and OpenRouter (chat/completions + tools) behind one stateful class. The system "
    "prompt (prompts.ts) embeds the schema DDL and few-shot question→SQL pairs; "
    "out-of-scope questions must be answered with the exact phrase "
    "<font face='Courier' size='8'>\"I can't answer questions outside of my scope\"</font>."))

story.append(H2("9.2 Client-side fallback path"))
story.append(P(
    "For deployments without the Edge Function (e.g. Vercel static builds), "
    "<font face='Courier' size='8'>assistantClient.js</font> talks to Gemini directly "
    "from the browser. Instead of raw SQL, the model drives <b>eight deterministic "
    "tools</b> whose executors compute statistics client-side in "
    "<font face='Courier' size='8'>assistantStats.js</font> — the exact same pure "
    "functions the Dashboard and Reports use, so numbers always match the UI:"))
tools = [
    ["Tool", "Computed by", "Purpose"],
    ["query_expenses", "aggregateExpenses / aggregateIncome", "Generic detail queries + deterministic groupBy (month/category/merchant/source)."],
    ["category_breakdown", "categoryTotalsForExpenses", "'How much did I spend on X' — matches the pie chart."],
    ["financial_summary", "buildMonthlySummary", "Income, expenses, savings, savings rate — matches the Net Savings card."],
    ["month_over_month", "compareMonthSnapshots", "Two-month comparison with absolute + % deltas."],
    ["yearly_stats", "buildYearlyStats", "Annual rollup, best/worst months."],
    ["category_trends", "categoryTrends", "Per-category monthly series."],
    ["category_count", "countExpenseItems", "'How many items' — matches Expenses page counters."],
    ["category_mapping", "resolveCanonicalCategory", "Maps a label like 'milk' to its canonical category."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th8", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in tools[0]]]
                          + [[Paragraph(c, ParagraphStyle("td8", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in tools[1:]],
                         [40 * mm, 48 * mm, 92 * mm]))
story.append(CAP("Table 9.1 — The eight deterministic assistant tools."))
story.append(P(
    "Safety constraints mirror the Edge Function: table names and filter operators are "
    "allow-listed, grouped queries only aggregate through the deterministic engines, "
    "at most four tool rounds are permitted, and conversation memory is per-user "
    "(cleared when the signed-in user changes). A raw result table is attached to the "
    "reply only when a single query produced it."))

# ===========================================================================
# 10. REPORTS & PDF EXPORT
# ===========================================================================
story.append(H1("10. Reports & PDF Export"))
story.append(P(
    "The Reports view and its PDF export share one aggregation function "
    "(<font face='Courier' size='8'>getMonthlyReportData</font>), so the download is "
    "always identical to the screen. The PDF is generated <b>client-side as a vector "
    "document</b> with jsPDF v4 + jspdf-autotable — no server round-trip, no privacy "
    "leak."))
story.append(H2("10.1 Document structure"))
B("Header — a line-mark logo (five thin bars in the category colors, echoing the app mark), month label, generation timestamp.")
B("Net savings panel — savings amount and savings rate in a tinted panel.")
B("Key figures — income, expenses, savings rate, each with a month-over-month delta arrow colored by direction (green good / red bad).")
B("Ledgers — income sources and expense categories side by side as auto-tables (capped at 8 rows with a '+ N more' note).")
B("Spending donut + legend — a donut chart drawn with dashed circle strokes (each category renders one arc via setLineDashPattern with offset accumulation) beside a right-aligned legend with color dot, weight % and amount.")
B("Footer — hairline rule, 'SnapSpend — Confidential', generation time.")
story.append(H2("10.2 Technical notes"))
B("<b>Hex colors only</b> — jsPDF v4 rejects array color arguments, so all colors are hex strings (documented in a comment in the source).")
B("<b>Courier for figures</b> — amounts use the courier font for tabular alignment; the euro symbol gets a space via formatCurrency().replace(...) so it doesn't butt against digits.")
B("<b>Text truncation</b> — long category names are truncated with an ellipsis measured against the available column width.")
B("<b>Single page</b> — layout is tuned to keep the whole report on one A4 page, with the spending section anchored at or below the vertical midpoint.")

# ===========================================================================
# 11. EVALUATION MODULE
# ===========================================================================
story.append(H1("11. Evaluation Module"))
story.append(P(
    "SnapSpend ships a standalone evaluation system that <b>benchmarks how accurately "
    "different models, pipelines and system prompts parse receipts</b>. It exists both "
    "as a headless CLI (eval/) and a browser page (eval.html)."))
story.append(H2("11.1 Dataset builder"))
story.append(P(
    "<font face='Courier' size='8'>eval/build-dataset.mjs</font> is a direct JavaScript "
    "port of the Python pipeline. Each 'setup' annotates every receipt image in "
    "<font face='Courier' size='8'>eval/Dataset/Images</font> and writes "
    "<font face='Courier' size='8'>eval/Dataset/&lt;setup&gt;/&lt;stem&gt;.json</font>. "
    "It is resumable (existing files skipped), retries transient errors with backoff, "
    "and implements a <b>circuit breaker</b>: three consecutive failures mark a setup "
    "'dead' and skip the remaining files so a congested model doesn't grind the run to "
    "a halt. Both the OCR-transcribe→structure pipeline and the direct-vision pipeline "
    "are represented."))
story.append(H2("11.2 Evaluation CLI matrix"))
story.append(P(
    "<font face='Courier' size='8'>eval/run-eval.mjs</font> builds a matrix of "
    "<b>pipelines × models × prompts</b> and scores every combination against "
    "ground-truth JSON. Default models are free-tier (gemma-4, nemotron, openrouter/free) "
    "with opt-in workhorse (gemini-3.1-flash-lite, gemini-3.7-flash, gpt-4o-mini) and "
    "frontier (claude-haiku-4.5, gpt-5.5) tiers. A dry-run mode prints the matrix and "
    "call budget without spending anything."))
story.append(H2("11.3 Scoring metrics (js/eval/metrics.js)"))
story.append(P(
    "Per-receipt scores are computed and averaged per combination. The weighted "
    "<b>overallScore</b> ranks combinations:"))
metrics = [
    ["Metric", "Definition", "Weight in overall"],
    ["validRate", "Output is an object with vendor, date, total_amount and purchased_items array.", "15%"],
    ["vendorNormRate", "Vendor matches after normalizing legal suffixes & punctuation.", "15%"],
    ["dateExactRate", "Dates match after normalizeDate() (many formats → YYYY-MM-DD).", "20%"],
    ["totalExactRate", "|pred − truth| &lt; 0.005.", "20%"],
    ["itemNameF1Avg", "Token-set F1 between predicted and actual item names (line-by-line).", "15%"],
    ["categoryMatchRate", "Canonical item-category equality per compared line.", "15%"],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("th9", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in metrics[0]]]
                          + [[Paragraph(c, ParagraphStyle("td9", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in metrics[1:]],
                         [42 * mm, 108 * mm, 30 * mm]))
story.append(CAP("Table 11.1 — Overall-score weights. Additional reported metrics: total relative error, item-count match, quantity match rate, price relative error, cost and latency."))
story.append(H2("11.4 The hardened OpenRouter client"))
story.append(P(
    "<font face='Courier' size='8'>eval/lib/openrouter.mjs</font> is shared by the CLI, "
    "the dataset builder, the browser eval page and the parser engine. It implements: "
    "retry/backoff on transient 429/500/502/503/504 (honoring the Retry-After header "
    "or exponential backoff capped at 60s), fail-fast on the free-tier daily quota "
    "('free-models-per-day'), explicit upstream-congestion detection (metadata "
    "limit_source), a graceful JSON-mode downgrade when a model rejects "
    "<font face='Courier' size='8'>response_format</font>, and USD cost estimation from "
    "the live model catalog. Free tiers are paced (~20 req/min ≈ 3.1s between calls)."))
story.append(H2("11.5 Reports"))
story.append(P(
    "The CLI writes <font face='Courier' size='8'>summary.csv</font>, "
    "<font face='Courier' size='8'>summary.json</font>, a ranked "
    "<font face='Courier' size='8'>report.md</font> and per-combination detail JSONs, "
    "plus a resume cache so interrupted runs continue where they stopped. Failed "
    "extractions are tracked and never counted as valid parses."))

# ===========================================================================
# 12. ALGORITHMS & TECHNIQUES SUMMARY
# ===========================================================================
story.append(H1("12. Algorithms & Techniques Summary"))
algo = [
    ["Algorithm / technique", "Where", "What it does"],
    ["Multinomial Naive Bayes (log-space, Laplace-smoothed)", "classifier.js", "On-device category prediction from the user's expense history."],
    ["Priority classification cascade (A–F)", "classifier.js", "Deterministic rule chain: user choice → merchant → keywords → sub-category → NB → fallback."],
    ["Granular→canonical lookup", "categories.js / categories.py", "~80 granular tags normalized onto five canonical categories."],
    ["Structured output (response_schema / pydantic)", "parserEngine.js / parser_engine_v2.py", "Schema-constrained JSON from Gemini to eliminate free-form drift."],
    ["Two-stage OCR→LLM pipeline", "build_ocr_gemini_dataset.py", "PaddleOCR transcription then Gemini structuring (evaluated, not shipped)."],
    ["Exponential backoff + jitter retry", "all API clients", "Transient 429/5xx resilience."],
    ["Daily-quota fail-fast", "parserEngine.js / openrouter.mjs", "Detects hard per-day caps and stops retrying immediately."],
    ["JSON salvage extraction", "extractJSON", "Fence stripping + first-balanced-object recovery for model output."],
    ["SQL allow-listing & validation", "sql.ts", "Single SELECT, keyword blacklist, OR/UNION/subquery rejection, table whitelist."],
    ["Read-only RLS-impersonated transactions", "sql.ts", "REPEATABLE READ READ ONLY + SET LOCAL role/claims for per-user scoping."],
    ["JWT verification via JWKS", "index.ts", "Verifies caller identity before any LLM turn."],
    ["Deterministic client aggregation", "assistantStats.js", "Pure functions reuse dashboard/report math so answers match the UI."],
    ["SVG donut / dashed-stroke arcs", "dashboard.js, pdf-generator.js", "Library-free data visualization."],
    ["jsPDF vector layout", "pdf-generator.js", "Single-page A4 report with auto-tables and truncation."],
    ["RLS policies", "schema.sql", "Row-level tenant isolation per auth.uid()."],
    ["Trigger-derived month column", "schema.sql", "Denormalized YYYY-MM kept in sync by BEFORE triggers."],
    ["Circuit breaker in batch jobs", "core.mjs / run-eval.mjs", "Skips a dead model after 3 consecutive failures."],
    ["Token-F1 item-name scoring", "metrics.js", "Set-overlap F1 for fuzzy product-name matching."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("thA", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in algo[0]]]
                          + [[Paragraph(c, ParagraphStyle("tdA", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in algo[1:]],
                         [62 * mm, 34 * mm, 84 * mm]))
story.append(CAP("Table 12.1 — Every algorithm and technique used in the project."))

# ===========================================================================
# 13. TESTING
# ===========================================================================
story.append(H1("13. Testing"))
story.append(P(
    "The project uses the Node.js native test runner (<font face='Courier' size='8'>node --test tests/*.test.js</font>). Pure, dependency-free modules are deliberately designed so they can be unit-tested in Node without a DOM."))
tests = [
    ["Suite", "Covers"],
    ["classifier.test.js", "Tokenization, Laplace smoothing, merchant normalization, cascade priorities."],
    ["categoryMapping.test.js", "Granular labels resolve to canonical categories via map + classifier fallback."],
    ["assistantStats.test.js", "Category totals, monthly summary, MoM comparison, yearly stats, aggregation with the receipt-split rule."],
    ["metrics.test.js", "Receipt scoring: validity, vendor/date/total matches, name token-F1, weighted overall score."],
    ["openrouter.test.js", "Retry/backoff, daily-quota detection, JSON-mode downgrade, cost estimation."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("thB", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in tests[0]]]
                          + [[Paragraph(c, ParagraphStyle("tdB", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in tests[1:]],
                         [52 * mm, 128 * mm]))
story.append(CAP("Table 13.1 — Test suites. Type-checking runs via tsc --noEmit (npm run lint)."))

# ===========================================================================
# 14. SECURITY & PRIVACY
# ===========================================================================
story.append(H1("14. Security & Privacy"))
B("No third-party tracking — user ledger data is never sent to analytics services.")
B("Row Level Security — every financial record is scoped to auth.uid().")
B("Bot protection — Cloudflare Turnstile on every auth submit; secret stays server-side.")
B("Assistant data safety — read-only, per-user queries only (validated SELECT + forced RLS identity, or deterministic client-side tools).")
B("Input sanitization — all user text HTML-escaped before rendering.")
B("sessionStorage credentials — Supabase credentials auto-clear when the tab closes.")
B("Schema-constrained model output — the receipt parser cannot emit arbitrary text; Gemini is bound by response_schema.")

# ===========================================================================
# 15. DEVELOPMENT WORKFLOW
# ===========================================================================
story.append(H1("15. Development Workflow"))
story.append(kv_table([
    ("npm run dev", "Vite dev server on http://localhost:3000 (host 0.0.0.0)."),
    ("npm run build", "Production bundle for index.html and eval.html; copies eval/Dataset into dist/."),
    ("npm run preview", "Serves the production build locally."),
    ("npm run lint", "TypeScript type-check (tsc --noEmit)."),
    ("npm run test", "Runs the native Node test suite."),
    ("npm run clean", "Removes dist/."),
    ("node eval/build-dataset.mjs", "Builds receipt datasets for evaluation."),
    ("node eval/run-eval.mjs", "Runs the model×prompt×pipeline benchmark."),
    ("python build_ocr_gemini_dataset.py", "Python reference: PaddleOCR + Gemini structuring dataset."),
    ("python build_gemini_only_dataset.py", "Python reference: Gemini direct-vision dataset."),
]))
story.append(H2("15.1 Environment variables"))
story.append(kv_table([
    ("VITE_SUPABASE_URL", "Supabase project URL."),
    ("VITE_SUPABASE_ANON_KEY", "Supabase anon (public) key."),
    ("VITE_GEMINI_API_KEY", "Gemini key — used by the ParserEngine (app + eval)."),
    ("VITE_OPENROUTER_API_KEY", "OpenRouter key — used by the evaluation module."),
    ("VITE_TURNSTILE_SITE_KEY", "Cloudflare Turnstile site key (optional)."),
    ("GEMINI_API_KEY / OPENROUTER_API_KEY", "Server-side secrets for the Edge Function (set via supabase secrets)."),
    ("SUPABASE_DB_URL / SUPABASE_JWKS", "Auto-provisioned platform secrets for the Edge Function."),
]))

# ===========================================================================
# 16. APPENDIX — CODE EXCERPTS
# ===========================================================================
story.append(H1("16. Appendix — Code Excerpts"))
story.append(H2("A. Gemini structured-output schema (browser)"))
CODE("""export const RECEIPT_SCHEMA = {
    type: "OBJECT",
    properties: {
        vendor:        { type: "STRING", description: "Store or business name" },
        date:          { type: "STRING", description: "Date in DD.MM.YYYY, empty if missing" },
        total_amount:  { type: "NUMBER", description: "Total receipt amount paid" },
        purchased_items: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    name:     { type: "STRING", description: "Product name as listed" },
                    quantity: { type: "INTEGER", description: "Quantity, default 1" },
                    price:    { type: "NUMBER", description: "Total price for this line" },
                    currency: { type: "STRING", description: "3-letter code, e.g. EUR" },
                    category: { type: "STRING",
                        description: "MUST be one of: Groceries, Pharmacy, Travel, Households, Miscellaneous" },
                },
                required: ["name", "quantity", "price", "currency", "category"],
            },
        },
    },
    required: ["vendor", "date", "total_amount", "purchased_items"],
};""")
story.append(H2("B. SQL validation gate (edge function)"))
CODE("""export function validateSQL(sql, userId) {
    const cleaned = sql
        .replace(/--[^\\n]*/g, "")
        .replace(/\\/\\*[\\s\\S]*?\\*\\//g, "")
        .trim();
    if (!cleaned) return { ok: false, reason: "empty query" };

    const statements = splitStatements(cleaned).filter(s => s.trim().length > 0);
    if (statements.length !== 1)
        return { ok: false, reason: "multi-statement queries are not allowed" };
    if (!/^\\s*select\\b/i.test(cleaned))
        return { ok: false, reason: "only SELECT queries are allowed" };

    const scrubbed = stripStringLiterals(cleaned);   // blank out '...' contents
    const forbidden = /\\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|
        copy|execute|call|do|vacuum|reindex|analyze|cluster|comment|prepare|pg_|lo_import|lo_export)\\b/i;
    if (forbidden.test(scrubbed))
        return { ok: false, reason: "query contains forbidden operations" };
    if (/\\bor\\b/i.test(scrubbed))
        return { ok: false, reason: "query contains OR conditions" };
    if (/\\bunion\\b/i.test(scrubbed))
        return { ok: false, reason: "query contains UNION" };
    if (/\\bwhere\\s*\\(/i.test(scrubbed))
        return { ok: false, reason: "query contains a parenthesized WHERE clause" };
    if ((scrubbed.match(/\\bselect\\b/gi) || []).length > 1)
        return { ok: false, reason: "query contains subqueries" };

    const tableRefs = [...scrubbed.matchAll(/\\b(?:from|join)\\s+(?:public\\.)?([a-z_]+)/gi)]
        .map(m => m[1].toLowerCase());
    if (tableRefs.some(t => !ALLOWED_TABLES.has(t)))
        return { ok: false, reason: "query references a non-whitelisted table" };

    let finalSql = cleaned.replace(/;\\s*$/, "")
        .replace(/\\s*limit\\s+\\d+(?:\\s*offset\\s+\\d+)?\\s*$/i, "")
        .trim();
    return { ok: true, sql: `${finalSql} LIMIT 100` };
}""")
story.append(H2("C. Receipt scoring core"))
CODE("""export function nameTokenF1(predicted, actual) {
    const p = new Set(tokenizeName(predicted));
    const a = new Set(tokenizeName(actual));
    if (p.size === 0 && a.size === 0) return 1;
    if (p.size === 0 || a.size === 0) return 0;
    let overlap = 0;
    p.forEach(t => { if (a.has(t)) overlap++; });
    const precision = overlap / p.size;
    const recall = overlap / a.size;
    return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

export function overallScore(summary) {
    return (
        (summary.validRate || 0) * 0.15 +
        (summary.vendorNormRate || 0) * 0.15 +
        (summary.dateExactRate || 0) * 0.20 +
        (summary.totalExactRate || 0) * 0.20 +
        (summary.itemNameF1Avg || 0) * 100 * 0.15 +
        (summary.categoryMatchRate || 0) * 0.15
    );
}""")
story.append(H2("D. Deterministic category totals (receipt-split rule)"))
CODE("""export function categoryTotalsForExpenses(expenseRows) {
    const totals = {};
    (expenseRows || []).forEach((item) => {
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach((ri) => {
                const catName = mapToCanonical(ri.category || "Miscellaneous");
                totals[catName] = (totals[catName] || 0) + (parseFloat(ri.price) || 0);
            });
        } else {
            const catName = mapToCanonical(item.expense_categories?.name || "Miscellaneous");
            totals[catName] = (totals[catName] || 0) + parseFloat(item.amount);
        }
    });
    return totals;
}""")
story.append(H2("E. PaddleOCR result normalization (dual format)"))
CODE("""# Case 1: PaddleX Pipeline Dictionary Output (Parallel Arrays)
if isinstance(first_res, dict) and "rec_texts" in first_res:
    texts = first_res.get("rec_texts", [])
    scores = first_res.get("rec_scores", [])
    polys = first_res.get("rec_polys", []) or first_res.get("dt_polys", [])
    for i in range(len(texts)):
        box = polys[i] if i < len(polys) else None
        ...

# Case 2: Classic Tuple/List Format [box, (text, score)]
elif isinstance(first_res, list):
    for line in first_res:
        box, text, score = None, "", 0.0
        if isinstance(line, (list, tuple)):
            if len(line) == 2:
                box, text_info = line
                text, score = text_info[0], text_info[1]
            elif len(line) >= 3:
                box, text, score = line[0], line[1], line[2]
        ...""")

# ===========================================================================
# 17. GLOSSARY
# ===========================================================================
story.append(H1("17. Glossary"))
gloss = [
    ["Term", "Definition"],
    ["Canonical categories", "The five fixed categories (Groceries, Pharmacy, Travel, Households, Miscellaneous) every expense maps onto."],
    ["response_schema", "Gemini's structured-output mechanism: a JSON schema the model must conform to."],
    ["Structured output", "Model responses constrained to a schema rather than free text."],
    ["RLS", "Row Level Security — PostgreSQL policies that scope queries to the authenticated user."],
    ["PostgREST", "Supabase's auto-generated REST API over PostgreSQL."],
    ["JWT / JWKS", "JSON Web Token / JSON Web Key Set used for stateless auth and key verification."],
    ["Naive Bayes", "Probabilistic classifier assuming token independence, with Laplace smoothing."],
    ["Token-F1", "F1 score over token sets, used for fuzzy product-name matching."],
    ["OCR", "Optical Character Recognition — converting images of text into machine text."],
    ["PaddleOCR", "Baidu's open-source OCR toolkit (evaluated, then replaced by Gemini)."],
    ["Gemini API", "Google's multimodal LLM API; used for direct receipt parsing and the assistant."],
    ["OpenRouter", "Unified API gateway to many LLMs; used for model-agnostic evaluation."],
    ["Edge Function", "A Deno serverless function hosted in Supabase (text-to-SQL assistant)."],
    ["jsPDF / autotable", "Client-side PDF generation library and its table plugin."],
    ["Spa", "Single-page application."],
    ["Bento card", "A rounded, bordered dashboard card used throughout the UI."],
]
story.append(header_table([[Paragraph(c, ParagraphStyle("thC", fontName="Helvetica-Bold", fontSize=7.8,
                                                        textColor=colors.white, leading=10))
                            for c in gloss[0]]]
                          + [[Paragraph(c, ParagraphStyle("tdC", fontName="Helvetica", fontSize=7.5,
                                                           textColor=INK, leading=10))
                              for c in row] for row in gloss[1:]],
                         [40 * mm, 140 * mm]))

story.append(Spacer(1, 10 * mm))
story.append(rule())
story.append(Spacer(1, 3 * mm))
story.append(Paragraph(
    "End of report — generated automatically from the SnapSpend source tree.",
    styles["SS_Caption"]))


def on_first_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(PANEL)
    canvas.rect(0, 0, A4[0], A4[1], fill=1, stroke=0)
    # Five-bar logo, like the app mark
    bars = [(colors.HexColor("#10b981"), 5), (colors.HexColor("#0ea5e9"), 8),
            (colors.HexColor("#8b5cf6"), 6.5), (colors.HexColor("#f59e0b"), 10),
            (colors.HexColor("#64748b"), 8.5)]
    x = 18 * mm
    y = A4[1] - 24 * mm
    for color, h in bars:
        canvas.setFillColor(color)
        canvas.rect(x, y, 2.2 * mm, h * mm, fill=1, stroke=0)
        x += 3.4 * mm
    canvas.restoreState()


def on_later_pages(canvas, doc):
    canvas.saveState()
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(FAINT)
    canvas.drawString(16 * mm, 12 * mm, "SnapSpend — Technical Documentation Report")
    canvas.drawRightString(A4[0] - 16 * mm, 12 * mm, f"Page {doc.page - 1}")
    canvas.restoreState()


doc = SimpleDocTemplate(
    OUT_PDF, pagesize=A4,
    leftMargin=16 * mm, rightMargin=16 * mm,
    topMargin=18 * mm, bottomMargin=18 * mm,
    title="SnapSpend Technical Documentation Report",
    author="SnapSpend",
    subject="Technical documentation of the SnapSpend expense tracker",
)

doc.build(story, onFirstPage=on_first_page, onLaterPages=on_later_pages)
print(f"Report written to {OUT_PDF}")
