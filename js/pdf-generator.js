import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, getMonthName } from './utils.js';

const PADDING = 14;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - PADDING * 2;

const BRAND = '#6d47ff';
const ROSE = '#f43f5e';
const EMERALD = '#10b981';
const SLATE_DARK = '#1e293b';
const SLATE = '#64748b';
const SLATE_LIGHT = '#94a3b8';
const BORDER = '#e2e8f0';

const FONT = 'helvetica';

/**
 * Generates and downloads a vector PDF financial report from the shared
 * monthly report data (same aggregation as the Reports UI page).
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
        categories,
        insights
    } = data;

    const monthLabel = getMonthName(selectedMonth);
    const prevMonthLabel = getMonthName(prevMonth);
    const generatedAt = new Date().toLocaleString('en-IE', { dateStyle: 'medium', timeStyle: 'short' });

    // ===== Header =====
    doc.setFillColor(139, 92, 246); // brand violet
    doc.rect(0, 0, PAGE_WIDTH, 30, 'F');
    doc.setFillColor(99, 102, 241);
    doc.rect(0, 28, PAGE_WIDTH, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(20);
    doc.text('SnapSpend', PADDING, 15);
    doc.setFontSize(10);
    doc.setFont(FONT, 'normal');
    doc.text('Monthly Financial Report', PADDING, 23);
    doc.text(monthLabel, PAGE_WIDTH - PADDING, 15, { align: 'right' });
    doc.setFontSize(8);
    doc.text(`Generated ${generatedAt}`, PAGE_WIDTH - PADDING, 22, { align: 'right' });

    let y = 46;

    // ===== Summary metrics =====
    y = sectionTitle(doc, y, 'Summary Snapshot');
    const metrics = [
        { label: 'Total Income', value: formatCurrency(totalIncome), color: EMERALD },
        { label: 'Total Expenses', value: formatCurrency(totalExpenses), color: ROSE },
        { label: 'Net Savings', value: formatCurrency(savings), color: SLATE_DARK },
        { label: 'Savings Rate', value: `${savingsRate.toFixed(0)}%`, color: EMERALD }
    ];

    const boxW = (CONTENT_WIDTH - 3 * 4) / 4;
    const boxH = 18;
    metrics.forEach((m, i) => {
        const x = PADDING + i * (boxW + 4);
        doc.setDrawColor(BORDER);
        doc.setFillColor(250, 250, 252);
        doc.roundedRect(x, y, boxW, boxH, 2, 2, 'FD');
        doc.setTextColor(SLATE);
        doc.setFontSize(7);
        doc.setFont(FONT, 'bold');
        doc.text(m.label.toUpperCase(), x + 3, y + 6);
        doc.setTextColor(...hexToRgb(m.color));
        doc.setFontSize(12);
        doc.setFont(FONT, 'bold');
        doc.text(m.value, x + 3, y + 14);
    });
    y += boxH + 8;

    // ===== Audit Insights =====
    if (insights && insights.length > 0) {
        y = sectionTitle(doc, y, 'Audit Insights');
        const strip = insights.map(ins => ins.text.replace(/<[^>]+>/g, ''));
        strip.forEach((text, i) => {
            doc.setTextColor(SLATE_DARK);
            doc.setFontSize(9);
            const lines = doc.splitTextToSize(text, CONTENT_WIDTH - 6);
            doc.text(lines, PADDING + 6, y + 4);
            y += lines.length * 4 + 5;
        });
        y += 4;
    }

    // ===== Income ledger table =====
    y = sectionTitle(doc, y, 'Incomes Ledger');
    autoTable(doc, {
        startY: y,
        margin: { left: PADDING, right: PADDING },
        head: [['Source Name', 'Date', 'Amount']],
        body: incomes.length === 0
            ? [['No income entries this month.', '', '']]
            : incomes.map(item => [
                item.income_sources?.name || 'Unassigned',
                item.date_credited,
                formatCurrency(item.amount)
            ]),
        theme: 'grid',
        styles: { font: FONT, fontSize: 8, cellPadding: 2.5, textColor: SLATE_DARK, lineColor: BORDER, lineWidth: 0.2 },
        headStyles: { fillColor: hexToRgb(SLATE_DARK), textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 2: { halign: 'right', fontStyle: 'bold', textColor: hexToRgb(EMERALD) } }
    });
    y = doc.lastAutoTable.finalY + 8;

    // ===== Expense category table =====
    y = sectionTitle(doc, y, 'Expense Classes Breakdown');
    const catBody = categories.length === 0
        ? [['No expense entries this month.', '', '']]
        : categories.map(cat => [cat.name, `${cat.percent.toFixed(1)}%`, formatCurrency(cat.amount)]);

    autoTable(doc, {
        startY: y,
        margin: { left: PADDING, right: PADDING },
        head: [['Category Class', 'Relative Weight %', 'Amount Outlay']],
        body: catBody,
        theme: 'grid',
        styles: { font: FONT, fontSize: 8, cellPadding: 2.5, textColor: SLATE_DARK, lineColor: BORDER, lineWidth: 0.2 },
        headStyles: { fillColor: hexToRgb(SLATE_DARK), textColor: [255, 255, 255], fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'center' }, 2: { halign: 'right', fontStyle: 'bold', textColor: hexToRgb(ROSE) } }
    });
    y = doc.lastAutoTable.finalY + 8;

    // ===== MoM Comparison Matrix =====
    y = ensureSpace(doc, y, 40);
    y = sectionTitle(doc, y, 'MoM Comparison Matrix');
    y += 2;
    const rows = [
        { label: 'Income', cur: totalIncome, prev: data.prevTotalIncome, pct: incPct, up: incPct >= 0 },
        { label: 'Expenses', cur: totalExpenses, prev: data.prevTotalExpenses, pct: expPct, up: expPct <= 0 },
        { label: 'Net Savings', cur: savings, prev: data.prevTotalIncome - data.prevTotalExpenses, pct: savPct, up: savPct >= 0 }
    ];
    rows.forEach(row => {
        const x = PADDING;
        const w = CONTENT_WIDTH;
        doc.setDrawColor(BORDER);
        doc.setFillColor(250, 250, 252);
        doc.roundedRect(x, y, w, 12, 2, 2, 'FD');
        doc.setTextColor(SLATE_DARK);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(9);
        doc.text(row.label, x + 4, y + 7.5);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(10);
        doc.text(formatCurrency(row.cur), x + w / 2 - 12, y + 7.5);
        doc.setDrawColor(...hexToRgb(row.up ? EMERALD : ROSE));
        doc.setFontSize(9);
        doc.text(`${row.up ? '\u25B2 +' : '\u25BC '}${row.pct.toFixed(0)}%`, x + w - 4, y + 7.5, { align: 'right' });
        y += 15;
    });
    y += 6;

    // ===== Pie chart =====
    y = ensureSpace(doc, y, 92);
    y = sectionTitle(doc, y, 'Spending by Category');
    y += 2;

    if (categories.length === 0) {
        doc.setTextColor(SLATE);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(9);
        doc.text('No expense categories to visualize.', PADDING, y + 20);
    } else {
        drawDonut(doc, categories, PADDING + 34, y + 34, 26);
        drawDonutLegend(doc, categories, PADDING + 76, y + 8);
    }

    // ===== Footer =====
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i += 1) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setFont(FONT, 'normal');
        doc.setTextColor(SLATE_LIGHT);
        doc.text(`SnapSpend — ${monthLabel} — Confidential`, PADDING, 290);
        doc.text(`Page ${i} of ${totalPages}`, PAGE_WIDTH - PADDING, 290, { align: 'right' });
    }

    doc.save(`SnapSpend-Report-${selectedMonth}.pdf`);
}

function sectionTitle(doc, y, title) {
    doc.setTextColor(BRAND);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(10);
    doc.setTextColor(99, 102, 241);
    doc.text(title.toUpperCase(), PADDING, y);
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.3);
    doc.line(PADDING, y + 2, PAGE_WIDTH - PADDING, y + 2);
    return y + 7;
}

function ensureSpace(doc, y, needed) {
    if (y + needed > 275) {
        doc.addPage();
        return 32;
    }
    return y;
}

/**
 * Draws the dashboard donut as vector circles using dashed strokes so the PDF
 * chart is visually identical (same strokeWidth thickness relative to radius).
 */
function drawDonut(doc, categories, cx, cy, radius) {
    const total = categories.reduce((sum, c) => sum + c.amount, 0);
    if (total <= 0) return;

    let offset = 0;
    categories.forEach(cat => {
        const pct = (cat.amount / total) * 100;
        doc.setDrawColor(...hexToRgb(cat.color));
        doc.setLineWidth(5.4);
        doc.setLineDashPattern([pct, 100 - pct], offset);
        doc.circle(cx, cy, radius, 'S');
        offset -= pct;
    });
    doc.setLineDashPattern([], 0);

    // Center total
    doc.setTextColor(SLATE);
    doc.setFont(FONT, 'bold');
    doc.setFontSize(6);
    doc.text('Total Spent', cx, cy - 2, { align: 'center' });
    doc.setTextColor(SLATE_DARK);
    doc.setFontSize(10);
    doc.text(formatCurrency(total), cx, cy + 4, { align: 'center' });
}

function drawDonutLegend(doc, categories, x, topY) {
    categories.forEach((cat, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const lx = x + col * 58;
        const ly = topY + row * 12;

        doc.setFillColor(...hexToRgb(cat.color));
        doc.circle(lx, ly - 1, 1.4, 'F');
        doc.setTextColor(SLATE_DARK);
        doc.setFont(FONT, 'bold');
        doc.setFontSize(8);
        doc.text(cat.name, lx + 3, ly);

        doc.setTextColor(SLATE);
        doc.setFont(FONT, 'normal');
        doc.setFontSize(7);
        doc.text(`${cat.percent.toFixed(1)}%`, lx + 3, ly + 3.6);
        doc.setFont(FONT, 'bold');
        doc.text(formatCurrency(cat.amount), lx + 40, ly, { align: 'right' });
    });
}

function hexToRgb(hex) {
    const value = String(hex || '#64748b').replace('#', '');
    return [
        parseInt(value.substring(0, 2), 16),
        parseInt(value.substring(2, 4), 16),
        parseInt(value.substring(4, 6), 16)
    ];
}