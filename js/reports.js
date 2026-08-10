import { supabase } from './supabase.js';
import { currentUser } from './app.js';
import { formatCurrency, getPrevMonth, getMonthName, escapeHTML } from './utils.js';

/**
 * Fetches and calculates shared financial report data for a given user and selected month.
 * Reused by both Reports UI and PDF document generator for 100% data consistency.
 */
export async function getMonthlyReportData(userId, selectedMonth) {
    const prevMonth = getPrevMonth(selectedMonth);

    const [
        { data: incomes, error: incErr },
        { data: expenses, error: expErr },
        { data: prevIncomes },
        { data: prevExpenses }
    ] = await Promise.all([
        supabase.from('income_entries').select('id, amount, date_credited, note, income_sources (name)')
            .eq('user_id', userId).eq('month', selectedMonth)
            .order('date_credited', { ascending: false }),
        supabase.from('expense_entries').select('id, amount, category_id, date, note, expense_categories (name)')
            .eq('user_id', userId).eq('month', selectedMonth)
            .order('date', { ascending: false }),
        supabase.from('income_entries').select('amount')
            .eq('user_id', userId).eq('month', prevMonth),
        supabase.from('expense_entries').select('amount')
            .eq('user_id', userId).eq('month', prevMonth)
    ]);

    if (incErr) throw incErr;
    if (expErr) throw expErr;

    const totalIncome = (incomes || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);
    const totalExpenses = (expenses || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);

    const prevTotalIncome = (prevIncomes || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);
    const prevTotalExpenses = (prevExpenses || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);

    const savings = totalIncome - totalExpenses;
    const savingsRate = totalIncome > 0 ? ((savings / totalIncome) * 100) : 0;
    const prevSavings = prevTotalIncome - prevTotalExpenses;

    const incPct = prevTotalIncome > 0 ? ((totalIncome - prevTotalIncome) / prevTotalIncome) * 100 : 0;
    const expPct = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;
    const savPct = prevSavings !== 0 ? ((savings - prevSavings) / Math.abs(prevSavings)) * 100 : 0;

    const expenseCategoryAgg = {};
    (expenses || []).forEach(e => {
        const name = e.expense_categories?.name || 'Uncategorized';
        expenseCategoryAgg[name] = (expenseCategoryAgg[name] || 0) + parseFloat(e.amount);
    });

    const insights = [];
    if (totalExpenses > totalIncome && totalIncome > 0) {
        insights.push({
            type: 'warning',
            text: "Expenses exceeded income this month. Keep track of discretionary credit lines.",
            icon: 'alert-triangle'
        });
    }

    if (savingsRate > 30) {
        insights.push({
            type: 'success',
            text: `Strong savings rate of <b>${savingsRate.toFixed(0)}%</b>! You are outperforming standard models.`,
            icon: 'thumbs-up'
        });
    } else if (totalIncome > 0 && savingsRate < 10) {
        insights.push({
            type: 'neutral',
            text: "Savings rate is below 10% this month. Try tracking discretionary expenditure items.",
            icon: 'activity'
        });
    }

    let topCatName = '';
    let topCatAmt = 0;
    Object.entries(expenseCategoryAgg).forEach(([name, amt]) => {
        if (amt > topCatAmt) {
            topCatAmt = amt;
            topCatName = name;
        }
    });

    if (topCatAmt > 0) {
        insights.push({
            type: 'neutral',
            text: `Highest expense category: <b>${escapeHTML(topCatName)}</b> with a total spend of <b>${formatCurrency(topCatAmt)}</b>.`,
            icon: 'arrow-right-circle'
        });
    }

    return {
        selectedMonth,
        prevMonth,
        incomes: incomes || [],
        expenses: expenses || [],
        totalIncome,
        totalExpenses,
        prevTotalIncome,
        prevTotalExpenses,
        savings,
        savingsRate,
        incPct,
        expPct,
        savPct,
        expenseCategoryAgg,
        insights
    };
}

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        const data = await getMonthlyReportData(currentUser.id, selectedMonth);

        const {
            prevMonth,
            incomes,
            expenses,
            totalIncome,
            totalExpenses,
            savings,
            savingsRate,
            incPct,
            expPct,
            savPct,
            expenseCategoryAgg,
            insights
        } = data;

        // Render Reports layout
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Header Titles & Download PDF Action -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                        <span class="text-xs uppercase font-semibold text-emerald-600 tracking-wider">MONTHLY LEDGER STATS</span>
                        <h2 class="text-2xl font-bold tracking-tight text-slate-900">Reports Analysis</h2>
                        <p class="text-[10px] text-slate-400 mt-0.5">Aggregated finance snapshot scoped to ${getMonthName(selectedMonth)} in EUR (€)</p>
                    </div>
                    <button type="button" id="btn-download-pdf-report" class="self-start sm:self-auto px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer">
                        <i data-lucide="download" class="w-3.5 h-3.5 text-emerald-400" id="pdf-download-icon"></i>
                        <span id="pdf-download-btn-text">Download PDF</span>
                    </button>
                </div>

                <!-- Reports Month Summary Metrics List -->
                <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="bento-card p-4">
                        <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider block mb-0.5">Total Income</span>
                        <span class="font-mono font-bold text-slate-805 text-base">${formatCurrency(totalIncome)}</span>
                    </div>
                    <div class="bento-card p-4">
                        <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider block mb-0.5">Total Expenses</span>
                        <span class="font-mono font-bold text-rose-500 text-base">${formatCurrency(totalExpenses)}</span>
                    </div>
                    <div class="bento-card p-4 bg-emerald-500/[0.03]">
                        <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider block mb-0.5">Net Savings</span>
                        <span class="font-mono font-bold text-slate-900 text-base">${formatCurrency(savings)}</span>
                    </div>
                    <div class="bento-card p-4 bg-emerald-500/[0.03]">
                        <span class="text-[9px] uppercase font-bold text-slate-400 tracking-wider block mb-0.5">Savings Rate</span>
                        <span class="font-mono font-bold text-emerald-600 text-base">${savingsRate.toFixed(0)}%</span>
                    </div>
                </div>

                <!-- Rule-Based Insights Box -->
                ${insights.length === 0 ? '' : `
                    <div class="bento-card p-5 space-y-3.5 border-l-4 border-l-emerald-500 bg-white select-none">
                        <h4 class="font-bold text-slate-900 text-xs flex items-center gap-1.5 uppercase tracking-wider">
                            <i data-lucide="sparkles" class="w-4 h-4 text-emerald-600"></i> Audit Insights
                        </h4>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
                            ${insights.map(item => {
                                const isWarning = item.type === 'warning';
                                const isSuccess = item.type === 'success';
                                const badgeColor = isWarning ? 'bg-rose-50 text-rose-700' : isSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700';

                                return `
                                    <div class="flex items-start gap-2.5 p-3 rounded-xl border border-dotted border-slate-100">
                                        <div class="p-1 px-1.5 rounded-lg ${badgeColor} shrink-0">
                                            <i data-lucide="${item.icon}" class="w-3.5 h-3.5"></i>
                                        </div>
                                        <p class="text-[11px] text-slate-650 leading-relaxed font-sans">${item.text}</p>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `}

                <!-- Table grids: Income & Expenses side-by-side -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    
                    <!-- Month Income Breakdowns Table -->
                    <div class="bento-card overflow-hidden">
                        <div class="p-4 border-b border-slate-50 bg-slate-50/50">
                            <h4 class="font-bold text-slate-900 text-xs uppercase tracking-wider">Incomes Ledger</h4>
                        </div>
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-slate-50/20 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th class="p-3">Source Name</th>
                                    <th class="p-3">Date</th>
                                    <th class="p-3 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-150">
                                 ${incomes.length === 0 ? `
                                     <tr>
                                         <td colspan="3" class="p-6 text-center text-slate-400">
                                             <p class="font-medium text-slate-500 text-xs">No income entries logged this month.</p>
                                             <p class="text-[10px] text-slate-400 mt-1">Log credits in the Income workspace to view reports here.</p>
                                         </td>
                                     </tr>
                                ` : incomes.map(item => `
                                    <tr class="hover:bg-slate-50/30 transition-all">
                                        <td class="p-3 font-semibold text-slate-800">${escapeHTML(item.income_sources?.name || 'Unassigned')}</td>
                                        <td class="p-3 font-mono text-slate-450">${item.date_credited}</td>
                                        <td class="p-3 font-mono text-right font-bold text-emerald-600">${formatCurrency(item.amount)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>

                    <!-- Month Expenses Breakdowns Percentage Table -->
                    <div class="bento-card overflow-hidden">
                        <div class="p-4 border-b border-slate-50 bg-slate-50/50">
                            <h4 class="font-bold text-slate-900 text-xs uppercase tracking-wider">Expense Classes Breakdown</h4>
                        </div>
                        <table class="w-full text-left border-collapse text-xs">
                            <thead>
                                <tr class="bg-slate-50/20 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th class="p-3">Category Class</th>
                                    <th class="p-3">Relative Weight %</th>
                                    <th class="p-3 text-right">Amount Outlay</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-150">
                                 ${Object.keys(expenseCategoryAgg).length === 0 ? `
                                     <tr>
                                         <td colspan="3" class="p-6 text-center text-slate-400">
                                             <p class="font-medium text-slate-500 text-xs">No expense entries logged this month.</p>
                                             <p class="text-[10px] text-slate-400 mt-1">Record outflows in the Expenses workspace to view breakdowns.</p>
                                         </td>
                                     </tr>
                                ` : Object.entries(expenseCategoryAgg).map(([name, sum]) => {
                                    const percentageVal = totalExpenses > 0 ? (sum / totalExpenses) * 100 : 0;
                                    return `
                                        <tr class="hover:bg-slate-50/30 transition-all font-mono">
                                            <td class="p-3 font-sans font-semibold text-slate-800">${escapeHTML(name)}</td>
                                            <td class="p-3 text-slate-500 font-bold">${percentageVal.toFixed(0)}%</td>
                                            <td class="p-3 text-right font-bold text-rose-500">${formatCurrency(sum)}</td>
                                        </tr>
                                    `;
                                }).join('')}
                            </tbody>
                        </table>
                    </div>

                </div>

                <!-- MoM Comparison Matrix -->
                <div class="bento-card p-5 space-y-4 bg-gradient-to-br from-white to-slate-25 hover:border-slate-350 transition-all select-none">
                    <div>
                        <h4 class="font-bold text-slate-900 text-sm flex items-center gap-1.5 uppercase tracking-wider">
                            <i data-lucide="bar-chart-3" class="w-4 h-4 text-emerald-600"></i> MoM Comparison Matrix
                        </h4>
                        <p class="text-[10px] text-slate-400 leading-tight">Variance review comparing ${getMonthName(selectedMonth)} against ${getMonthName(prevMonth)}</p>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                        
                        <div class="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between">
                            <div>
                                <span class="text-[10px] text-slate-405 uppercase font-bold tracking-wider">MoM Incomes change</span>
                                <div class="font-mono font-bold text-slate-800 text-sm mt-0.5">${formatCurrency(totalIncome)}</div>
                            </div>
                            <span class="font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${incPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                ${incPct >= 0 ? '▲ +' : '▼ '}${incPct.toFixed(0)}%
                            </span>
                        </div>

                        <div class="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between">
                            <div>
                                <span class="text-[10px] text-slate-405 uppercase font-bold tracking-wider">MoM Outflows change</span>
                                <div class="font-mono font-bold text-slate-800 text-sm mt-0.5">${formatCurrency(totalExpenses)}</div>
                            </div>
                            <span class="font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${expPct <= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                ${expPct >= 0 ? '▲ +' : '▼ '}${expPct.toFixed(0)}%
                            </span>
                        </div>

                        <div class="p-3 bg-white border border-slate-100 rounded-xl flex items-center justify-between">
                            <div>
                                <span class="text-[10px] text-slate-405 uppercase font-bold tracking-wider">MoM Net Savings</span>
                                <div class="font-mono font-bold text-slate-800 text-sm mt-0.5">${formatCurrency(savings)}</div>
                            </div>
                            <span class="font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${savPct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                ${savPct >= 0 ? '▲ +' : '▼ '}${savPct.toFixed(0)}%
                            </span>
                        </div>

                    </div>
                </div>

            </div>
        `;

        if (window.lucide) window.lucide.createIcons();

        // Download PDF Event Listener
        const btnPdf = document.getElementById('btn-download-pdf-report');
        if (btnPdf) {
            btnPdf.addEventListener('click', async () => {
                const btnText = document.getElementById('pdf-download-btn-text');

                try {
                    btnPdf.disabled = true;
                    btnPdf.classList.add('opacity-70', 'cursor-not-allowed');
                    if (btnText) btnText.textContent = 'Generating PDF...';

                    // Dynamically import PDF generator module
                    const { generatePDFReport } = await import('./pdf-generator.js');
                    generatePDFReport(data);

                } catch (err) {
                    console.error("PDF generation error:", err);
                    alert("Failed to generate PDF report: " + err.message);
                } finally {
                    btnPdf.disabled = false;
                    btnPdf.classList.remove('opacity-70', 'cursor-not-allowed');
                    if (btnText) btnText.textContent = 'Download PDF';
                }
            });
        }

    } catch (e) {
        console.error("Reports compile failure:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render financial reports: ${e.message}</p>`;
    }
}

