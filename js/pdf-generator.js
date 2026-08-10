import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatCurrency, getMonthName } from './utils.js';

/**
 * Generates and downloads a clean, multi-page vector PDF report for the selected month.
 * @param {Object} data - Shared report data object containing incomes, expenses, metrics, insights, and MoM variances.
 */
export function generatePDFReport(data) {
    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
    });

    const monthLabel = getMonthName(data.selectedMonth) || data.selectedMonth;
    const prevMonthLabel = getMonthName(data.prevMonth) || data.prevMonth;

    // Design System Color Palette
    const primaryColor = [15, 23, 42];     // Slate 900 #0f172a
    const accentColor = [5, 150, 105];     // Emerald 600 #059669
    const roseColor = [225, 29, 72];       // Rose 600 #e11d48
    const textColor = [51, 65, 85];        // Slate 700 #334155
    const lightBg = [248, 250, 252];       // Slate 50 #f8fafc
    const borderColor = [226, 232, 240];   // Slate 200 #e2e8f0

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 14;
    let yPos = margin;

    // --- Header Section ---
    // Top accent bar
    doc.setFillColor(...accentColor);
    doc.rect(0, 0, pageWidth, 4, 'F');

    // Title & Tagline
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor(...primaryColor);
    doc.text('SnapSpend', margin, yPos + 10);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('AI Personal Wealth & Financial Management', margin, yPos + 15);

    // Document Banner (Right)
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...accentColor);
    doc.text('MONTHLY FINANCIAL REPORT', pageWidth - margin, yPos + 9, { align: 'right' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...primaryColor);
    doc.text(monthLabel, pageWidth - margin, yPos + 15, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    const nowStr = new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    doc.text(`Generated: ${nowStr}`, pageWidth - margin, yPos + 20, { align: 'right' });

    // Divider
    yPos += 24;
    doc.setDrawColor(...borderColor);
    doc.setLineWidth(0.4);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 6;

    // --- 1. Executive Summary Metrics Cards ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('EXECUTIVE FINANCIAL SUMMARY', margin, yPos);
    yPos += 4;

    const cardGap = 4;
    const cardWidth = (pageWidth - (margin * 2) - (cardGap * 3)) / 4;
    const cardHeight = 18;

    const summaryCards = [
        { label: 'TOTAL INCOME', value: formatCurrency(data.totalIncome), color: primaryColor },
        { label: 'TOTAL EXPENSES', value: formatCurrency(data.totalExpenses), color: roseColor },
        { label: 'NET SAVINGS', value: formatCurrency(data.savings), color: primaryColor },
        { label: 'SAVINGS RATE', value: `${data.savingsRate.toFixed(0)}%`, color: accentColor }
    ];

    summaryCards.forEach((card, idx) => {
        const x = margin + idx * (cardWidth + cardGap);

        doc.setFillColor(...lightBg);
        doc.setDrawColor(...borderColor);
        doc.roundedRect(x, yPos, cardWidth, cardHeight, 2, 2, 'FD');

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(card.label, x + 3, yPos + 5);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10.5);
        doc.setTextColor(...card.color);
        doc.text(card.value, x + 3, yPos + 13);
    });

    yPos += cardHeight + 8;

    // --- 2. Audit Insights Section ---
    if (data.insights && data.insights.length > 0) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9.5);
        doc.setTextColor(...primaryColor);
        doc.text('AUDIT INSIGHTS & REMARKS', margin, yPos);
        yPos += 4;

        data.insights.forEach(insight => {
            const cleanText = (insight.text || '').replace(/<[^>]*>/g, '');
            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(...borderColor);
            doc.roundedRect(margin, yPos, pageWidth - (margin * 2), 9, 1.5, 1.5, 'FD');

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(...textColor);
            doc.text(`• ${cleanText}`, margin + 4, yPos + 6);
            yPos += 11;
        });
        yPos += 2;
    }

    // --- 3. Income Ledger Table ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('INCOMES LEDGER', margin, yPos);
    yPos += 4;

    const incomeRows = (data.incomes || []).map(inc => [
        inc.income_sources?.name || 'Unassigned',
        inc.date_credited || '',
        formatCurrency(inc.amount)
    ]);

    autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [['Source Name', 'Date', 'Amount']],
        body: incomeRows.length > 0 ? incomeRows : [['No income transactions logged this month.', '', '']],
        theme: 'striped',
        headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: textColor },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 35 },
            2: { cellWidth: 35, halign: 'right', fontStyle: 'bold' }
        }
    });

    yPos = doc.lastAutoTable.finalY + 8;

    if (yPos > pageHeight - 50) {
        doc.addPage();
        yPos = margin;
    }

    // --- 4. Expense Classes Breakdown Table ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('EXPENSE CLASSES BREAKDOWN', margin, yPos);
    yPos += 4;

    const categoryEntries = Object.entries(data.expenseCategoryAgg || {});
    const categoryRows = categoryEntries.map(([catName, sum]) => {
        const weightPct = data.totalExpenses > 0 ? ((sum / data.totalExpenses) * 100).toFixed(0) : '0';
        return [catName, `${weightPct}%`, formatCurrency(sum)];
    });

    autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [['Category Class', 'Relative Weight %', 'Amount Outlay']],
        body: categoryRows.length > 0 ? categoryRows : [['No expense entries logged this month.', '', '']],
        theme: 'striped',
        headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: textColor },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 40, halign: 'center' },
            2: { cellWidth: 40, halign: 'right', fontStyle: 'bold' }
        }
    });

    yPos = doc.lastAutoTable.finalY + 8;

    if (yPos > pageHeight - 50) {
        doc.addPage();
        yPos = margin;
    }

    // --- 5. Detailed Expense Transactions Ledger ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('EXPENSE TRANSACTIONS LEDGER', margin, yPos);
    yPos += 4;

    const expenseRows = (data.expenses || []).map(exp => {
        const catName = exp.expense_categories?.name || 'Uncategorized';
        let noteText = exp.note || '';
        if (noteText.includes('[ITEMIZED:')) {
            noteText = noteText.split('[ITEMIZED:')[0].trim();
        }
        return [
            exp.date || '',
            catName,
            noteText || 'Expense',
            formatCurrency(exp.amount)
        ];
    });

    autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [['Date', 'Category', 'Merchant / Memo', 'Amount']],
        body: expenseRows.length > 0 ? expenseRows : [['', 'No expense transactions recorded this month.', '', '']],
        theme: 'grid',
        showHead: 'everyPage',
        headStyles: { fillColor: primaryColor, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: textColor },
        columnStyles: {
            0: { cellWidth: 28 },
            1: { cellWidth: 38 },
            2: { cellWidth: 'auto' },
            3: { cellWidth: 32, halign: 'right', fontStyle: 'bold' }
        }
    });

    yPos = doc.lastAutoTable.finalY + 8;

    if (yPos > pageHeight - 45) {
        doc.addPage();
        yPos = margin;
    }

    // --- 6. Month-over-Month Comparison Matrix ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...primaryColor);
    doc.text('MONTH-OVER-MONTH (MoM) COMPARISON MATRIX', margin, yPos);
    yPos += 4;

    const formatPct = (val) => `${val >= 0 ? '+' : ''}${val.toFixed(0)}%`;

    const momRows = [
        ['MoM Incomes Change', formatCurrency(data.totalIncome), formatPct(data.incPct)],
        ['MoM Outflows Change', formatCurrency(data.totalExpenses), formatPct(data.expPct)],
        ['MoM Net Savings Change', formatCurrency(data.savings), formatPct(data.savPct)]
    ];

    autoTable(doc, {
        startY: yPos,
        margin: { left: margin, right: margin },
        head: [['Metric Variance', `${monthLabel} Total`, `Vs. ${prevMonthLabel}`]],
        body: momRows,
        theme: 'plain',
        headStyles: { fillColor: [241, 245, 249], textColor: primaryColor, fontStyle: 'bold', fontSize: 8 },
        bodyStyles: { fontSize: 8, textColor: textColor },
        columnStyles: {
            0: { cellWidth: 'auto', fontStyle: 'bold' },
            1: { cellWidth: 45, halign: 'right' },
            2: { cellWidth: 45, halign: 'right', fontStyle: 'bold' }
        }
    });

    // --- 7. Page Numbers & Confidentiality Footer ---
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);

        // Footer border
        doc.setDrawColor(...borderColor);
        doc.setLineWidth(0.3);
        doc.line(margin, pageHeight - 12, pageWidth - margin, pageHeight - 12);

        // Footer labels
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(148, 163, 184);
        doc.text('SnapSpend Personal Finance Report — Privacy-First On-Device Ledger', margin, pageHeight - 7);
        doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 7, { align: 'right' });
    }

    // Filename generation (e.g. SnapSpend_Monthly_Report_August_2026.pdf)
    const cleanMonthStr = monthLabel.replace(/\s+/g, '_');
    const fileName = `SnapSpend_Monthly_Report_${cleanMonthStr}.pdf`;
    doc.save(fileName);
}
