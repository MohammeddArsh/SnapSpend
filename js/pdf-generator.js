import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, getMonthName } from './utils.js';

const MARGIN = 16;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RIGHT = PAGE_WIDTH - MARGIN;

// Minimal clean palette. Colours are passed as hex strings only — jsPDF v4
// rejects array colour arguments (throws "Invalid argument passed to jsPDF.f2").
const INK = '#1a1c20';
const MUTED = '#5f6470';
const FAINT = '#8a90a0';
const HAIRLINE = '#e8e8e4';
const PANEL = '#fafaf8';
const GOOD = '#0e9f6e';
const BAD = '#e11d48';

const FONT = 'helvetica';
const LEDGER_CAP = 8;
const LEGEND_CAP = 10;
const LEGEND_ROW_H = 4.5;

/**
 * Formats a currency figure with a space between the symbol and the number
 * so the euro sign doesn't butt against the digits in the PDF fonts.
 */
function money(amount) {
    return formatCurrency(amount).replace(/^€/, '€ ');
}

/**
 * Generates and downloads a clean, single-page vector PDF monthly report from
 * the shared monthly report data (same aggregation as the Reports UI page).
 * @param {object} data Result of getMonthlyReportData()
 */
export function generatePDFReport(data) {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const {
        selectedMonth,
        prevMonth,
        incomes,
        totalIncome,
        totalExpenses,
        savings,
        savingsRate,
        incPct,
        expPct,
        savPct,
        categories
    } = data;

    const monthLabel = getMonthName(selectedMonth);
    const prevLabel = getMonthName(prevMonth);
    const generatedAt = new Date().toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' });

    // ===== Header =====
    drawHeader(doc, monthLabel, generatedAt);

    // ===== Net position panel =====
    drawNetPanel(doc, savings, savingsRate, monthLabel);

    // ===== Key figures + month-over-month deltas =====
    drawStats(doc, { totalIncome, totalExpenses, savingsRate, incPct, expPct, savPct }, prevLabel);

    // ===== Ledgers (income / expenses, side by side) =====
    const tableY = drawLedgers(doc, incomes, categories);

    // ===== Spending donut + legend =====
    drawSpending(doc, categories, tableY);

    // ===== Footer =====
    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, 284, RIGHT, 284);
    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(FAINT);
    doc.text('SnapSpend — Confidential', MARGIN, 289);
    doc.text(`Generated ${generatedAt}`, RIGHT, 289, { align: 'right' });

    doc.save(`SnapSpend-Report-${selectedMonth}.pdf`);
}

function drawHeader(doc, monthLabel, generatedAt) {
    // Line-mark logo: five thin bars in the category colours, like the app mark.
    const bars = [
        { c: '#10b981', h: 2.2 },
        { c: '#0ea5e9', h: 3.6 },
        { c: '#8b5cf6', h: 2.9 },
        { c: '#f59e0b', h: 4.6 },
        { c: '#64748b', h: 3.8 }
    ];
    const barW = 0.9;
    const gap = 0.45;
    let bx = MARGIN;
    bars.forEach((bar) => {
        doc.setFillColor(bar.c);
        doc.rect(bx, 20.5 - bar.h, barW, bar.h, 'F');
        bx += barW + gap;
    });

    doc.setTextColor(INK);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(12);
    doc.text('SnapSpend', bx + 1.2, 20);

    doc.setTextColor(INK);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(11);
    doc.text(monthLabel, RIGHT, 20, { align: 'right' });

    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`Generated ${generatedAt}`, RIGHT, 25.5, { align: 'right' });

    doc.setDrawColor(HAIRLINE);
    doc.setLineWidth(0.4);
    doc.line(MARGIN, 32, RIGHT, 32);
}

function drawNetPanel(doc, savings, savingsRate, monthLabel) {
    const y0 = 46;
    const h = 24;

    doc.setDrawColor(HAIRLINE);
    doc.setFillColor(PANEL);
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, y0, CONTENT_WIDTH, h, 'FD');

    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`Net Savings · ${monthLabel}`.toUpperCase(), MARGIN + 6, y0 + 6);

    doc.setFontSize(20);
    doc.setTextColor(INK);
    doc.text(money(savings), MARGIN + 6, y0 + 16);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('SAVINGS RATE', RIGHT - 6, y0 + 6, { align: 'right' });

    doc.setFontSize(15);
    doc.setTextColor(INK);
    doc.text(`${savingsRate.toFixed(0)}%`, RIGHT - 6, y0 + 16, { align: 'right' });

    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('Share of income kept', RIGHT - 6, y0 + 20, { align: 'right' });
}

function drawStats(doc, data, prevLabel) {
    const { totalIncome, totalExpenses, savingsRate, incPct, expPct, savPct } = data;
    const y0 = 82;
    const h = 22;
    const cellW = CONTENT_WIDTH / 3;

    doc.setDrawColor(HAIRLINE);
    doc.setFillColor('#ffffff');
    doc.setLineWidth(0.4);
    doc.rect(MARGIN, y0, CONTENT_WIDTH, h, 'FD');

    doc.setLineWidth(0.15);
    for (let i = 1; i < 3; i += 1) {
        const x = MARGIN + i * cellW;
        doc.line(x, y0 + 3, x, y0 + h - 3);
    }

    const cells = [
        { label: 'Total Income', value: money(totalIncome), pct: incPct, goodOnPlus: true },
        { label: 'Total Expenses', value: money(totalExpenses), pct: expPct, goodOnPlus: false },
        { label: 'Savings Rate', value: `${savingsRate.toFixed(0)}%`, pct: savPct, goodOnPlus: true }
    ];

    cells.forEach((cell, i) => {
        const x = MARGIN + i * cellW + 7;
        doc.setFont(FONT, 'bold');
        doc.setFontSize(7);
        doc.setTextColor(MUTED);
        doc.text(cell.label.toUpperCase(), x, y0 + 6);
        doc.setFontSize(14);
        doc.setTextColor(INK);
        doc.text(cell.value, x, y0 + 13);
        drawDelta(doc, x, y0 + 18, cell.pct, cell.goodOnPlus, prevLabel);
    });
}

function drawDelta(doc, x, y, pct, goodOnPlus, prevLabel) {
    const good = goodOnPlus ? pct >= 0 : pct <= 0;
    const sign = pct >= 0 ? '+' : '-';
    const text = `${sign}${Math.abs(pct).toFixed(0)}%`;

    doc.setFont(FONT, 'bold');
    doc.setFontSize(8);
    doc.setTextColor(good ? GOOD : BAD);
    doc.text(text, x, y);
    const w = doc.getTextWidth(text);

    doc.setFont(FONT, 'normal');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text(`vs ${prevLabel}`, x + w + 1.5, y);
}

const TABLE_STYLES = {
    font: FONT,
    fontSize: 7,
    cellPadding: { top: 2, right: 4, bottom: 2, left: 4 },
    textColor: INK,
    lineColor: HAIRLINE,
    lineWidth: 0.15,
    valign: 'middle'
};

const TABLE_HEAD_STYLES = {
    fillColor: '#ffffff',
    textColor: MUTED,
    fontStyle: 'bold',
    fontSize: 6.5,
    lineColor: '#cbd5e1',
    lineWidth: 0.4
};

function drawLedgers(doc, incomes, categories) {
    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('INCOMES', MARGIN, 112);
    doc.text('EXPENSES', RIGHT, 112, { align: 'right' });

    const colW = (CONTENT_WIDTH - 4) / 2;
    const rightStart = MARGIN + colW + 4;
    const startY = 117;

    // Income ledger
    const incomeRows = (incomes || []).map(item => [
        item.income_sources?.name || 'Unassigned',
        formatShortDate(item.date_credited),
        money(item.amount)
    ]);
    const { shown: incShown, extra: incExtra } = cap(incomeRows, LEDGER_CAP);

    autoTable(doc, {
        startY,
        margin: { left: MARGIN, right: PAGE_WIDTH - MARGIN - colW },
        head: [['Source', 'Date', 'Amount']],
        body: incShown,
        theme: 'grid',
        styles: TABLE_STYLES,
        headStyles: TABLE_HEAD_STYLES,
        alternateRowStyles: { fillColor: '#ffffff' },
        columnStyles: {
            2: { halign: 'right', font: 'courier', fontStyle: 'bold', textColor: GOOD }
        }
    });
    const incEnd = doc.lastAutoTable.finalY;

    // Expense ledger
    const catRows = (categories || []).map(cat => [
        cat.name,
        `${cat.percent.toFixed(1)}%`,
        money(cat.amount)
    ]);
    const { shown: expShown, extra: expExtra } = cap(catRows, LEDGER_CAP);

    autoTable(doc, {
        startY,
        margin: { left: rightStart, right: PAGE_WIDTH - rightStart - colW },
        head: [['Category', 'Wt %', 'Amount']],
        body: expShown,
        theme: 'grid',
        styles: TABLE_STYLES,
        headStyles: TABLE_HEAD_STYLES,
        alternateRowStyles: { fillColor: '#ffffff' },
        columnStyles: {
            1: { halign: 'right', font: 'courier' },
            2: { halign: 'right', font: 'courier', fontStyle: 'bold', textColor: BAD }
        }
    });
    const expEnd = doc.lastAutoTable.finalY;

    if (incExtra > 0) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(MUTED);
        doc.text(`+ ${incExtra} more income entries`, MARGIN, incEnd + 4);
    }
    if (expExtra > 0) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(MUTED);
        doc.text(`+ ${expExtra} more categories`, rightStart, expEnd + 4);
    }

    return Math.max(incEnd, expEnd) + 10;
}

function drawSpending(doc, categories, y) {
    // Keep the spending section at or below the page's vertical midpoint so the
    // donut + list sits centred in the lower half instead of floating high.
    y = Math.max(y, 140);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(7);
    doc.setTextColor(MUTED);
    doc.text('SPENDING BY CATEGORY', MARGIN, y);
    y += 6;

    if (!categories || categories.length === 0) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(9);
        doc.setTextColor(FAINT);
        doc.text('No spending recorded for this month.', MARGIN, y + 20);
        return;
    }

    // Donut in the left half, category legend as a right-aligned column in the
    // right half. Both share a vertical centre so they read as one block.
    const panelX = PAGE_WIDTH / 2;
    const cx = MARGIN + 44;
    const cy = y + 30;
    const shown = Math.min(categories.length, LEGEND_CAP);
    const topY = cy - ((shown - 1) * LEGEND_ROW_H) / 2;

    drawDonut(doc, categories, cx, cy, 24);
    drawLegend(doc, categories, panelX, topY);
}

/**
 * Donut chart drawn with dashed strokes (same technique as the dashboard).
 */
function drawDonut(doc, categories, cx, cy, radius) {
    const total = categories.reduce((sum, c) => sum + c.amount, 0);
    if (total <= 0) return;

    let offset = 0;
    categories.forEach(cat => {
        const pct = (cat.amount / total) * 100;
        doc.setDrawColor(cat.color);
        doc.setLineWidth(4.6);
        doc.setLineDashPattern([pct, 100 - pct], offset);
        doc.circle(cx, cy, radius, 'S');
        offset -= pct;
    });
    doc.setLineDashPattern([], 0);

    doc.setFont(FONT, 'bold');
    doc.setFontSize(6);
    doc.setTextColor(MUTED);
    doc.text('Total Spent', cx, cy - 2, { align: 'center' });
    doc.setFont('courier', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(INK);
    doc.text(money(total), cx, cy + 4, { align: 'center' });
}

/**
 * Category legend drawn as a fixed column filling the page's right half: colour
 * dot + name left-aligned to the panel edge, then % and amount right-aligned to
 * fixed columns so every row shares the same tidy spacing.
 */
function drawLegend(doc, categories, x, topY) {
    const shown = categories.slice(0, LEGEND_CAP);
    const amountRight = RIGHT;
    const pctRight = amountRight - 34;

    shown.forEach((cat, i) => {
        const ly = topY + i * LEGEND_ROW_H;

        doc.setFillColor(cat.color);
        doc.circle(x, ly - 1.2, 1.3, 'F');

        doc.setFont(FONT, 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(INK);
        doc.text(truncateToWidth(doc, cat.name, pctRight - (x + 4) - 4), x + 4, ly);

        doc.setFont(FONT, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(MUTED);
        doc.text(`${cat.percent.toFixed(1)}%`, pctRight, ly, { align: 'right' });

        doc.setFont('courier', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(INK);
        doc.text(money(cat.amount), amountRight, ly, { align: 'right' });
    });

    if (categories.length > LEGEND_CAP) {
        doc.setFont(FONT, 'normal');
        doc.setFontSize(6.5);
        doc.setTextColor(MUTED);
        doc.text(`+ ${categories.length - LEGEND_CAP} more`, x, topY + LEGEND_CAP * LEGEND_ROW_H + 3);
    }
}

function cap(rows, n) {
    return rows.length <= n
        ? { shown: rows, extra: 0 }
        : { shown: rows.slice(0, n), extra: rows.length - n };
}

function formatShortDate(iso) {
    if (!iso) return '';
    const date = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function truncateToWidth(doc, text, maxW) {
    const s = String(text || '');
    if (doc.getTextWidth(s) <= maxW) return s;
    let i = s.length;
    while (i > 0 && doc.getTextWidth(`${s.slice(0, i - 1)}…`) > maxW) i -= 1;
    return `${s.slice(0, i - 1)}…`;
}