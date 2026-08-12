import { supabase } from './supabase.js';
import { currentUser } from './app.js';
import { formatCurrency, getPrevMonth, getMonthName, escapeHTML } from './utils.js';
import { mapToCanonical, getCategoryColor } from './categories.js';

/**
 * Fetches and calculates shared financial report data for a given user and selected month.
 * Reused by both Reports UI and PDF document generator for 100% data consistency.
 * Category aggregation mirrors the dashboard pie chart exactly (receipt-item aware,
 * canonical categories with stable colors).
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
        supabase.from('expense_entries').select('id, amount, category_id, date, note, expense_categories (name), expense_receipt_items (category, price)')
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

    // Aggregate expenses by category exactly like the dashboard pie chart:
    // scanned receipts are broken down per line item, manual entries use the parent category.
    const categoryTotals = {};
    (expenses || []).forEach(item => {
        const items = Array.isArray(item.expense_receipt_items) ? item.expense_receipt_items : [];
        if (items.length > 0) {
            items.forEach(ri => {
                const catName = mapToCanonical(ri.category || 'Miscellaneous');
                categoryTotals[catName] = (categoryTotals[catName] || 0) + (parseFloat(ri.price) || 0);
            });
        } else {
            const catName = mapToCanonical(item.expense_categories?.name || 'Miscellaneous');
            categoryTotals[catName] = (categoryTotals[catName] || 0) + parseFloat(item.amount);
        }
    });
    const categories = Object.entries(categoryTotals)
        .map(([name, amount]) => ({
            name,
            amount,
            percent: totalExpenses > 0 ? (amount / totalExpenses) * 100 : 0,
            color: getCategoryColor(name)
        }))
        .sort((a, b) => b.amount - a.amount);

    // Flat map kept for compatibility with downstream consumers.
    const expenseCategoryAgg = {};
    categories.forEach(cat => { expenseCategoryAgg[cat.name] = cat.amount; });

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

    const topCategory = categories.length > 0 ? categories[0] : null;
    if (topCategory && topCategory.amount > 0) {
        insights.push({
            type: 'neutral',
            text: `Highest expense category: <b>${escapeHTML(topCategory.name)}</b> with a total spend of <b>${formatCurrency(topCategory.amount)}</b>.`,
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
        categories,
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
        const prevLabel = getMonthName(prevMonth);

        // Render Reports layout
        container.innerHTML = `
            <div class="space-y-6 animate-fade-in">
                <!-- Header Titles & Download PDF Action -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                        <span class="text-[11px] uppercase font-black text-brand-600 dark:text-brand-400 tracking-widest">Monthly Ledger Report</span>
                        <h2 class="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">Reports Analysis</h2>
                        <p class="text-xs text-slate-400 dark:text-slate-500 mt-1">Aggregated finance snapshot scoped to ${monthLabel} in EUR (€)</p>
                    </div>
                    <button type="button" id="btn-download-pdf-report" class="self-start sm:self-auto px-4 py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-500/25 cursor-pointer">
                        <i data-lucide="download" class="w-4 h-4" id="pdf-download-icon"></i>
                        <span id="pdf-download-btn-text">Download PDF</span>
                    </button>
                </div>

                <!-- Net Savings Hero Banner -->
                <div class="relative overflow-hidden rounded-3xl bg-brand-gradient text-white shadow-2xl shadow-indigo-500/30 p-6 sm:p-7">
                    <div class="glow-orb w-40 h-40 bg-white/20 -top-16 -right-16"></div>
                    <div class="glow-orb w-24 h-24 bg-fuchsia-400/40 -bottom-10 -left-10"></div>
                    <div class="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-5 select-none">
                        <div>
                            <span class="text-[11px] uppercase font-bold text-white/70 tracking-widest">Monthly Net Savings</span>
                            <div class="text-3xl sm:text-4xl font-mono font-bold text-white tracking-tight tabular mt-1.5">${formatCurrency(savings)}</div>
                            <p class="text-[11px] text-white/70 mt-1.5">Unallocated cash remaining after expenses in ${monthLabel}</p>
                        </div>
                        <div>
                            <span class="text-[11px] text-white/70 uppercase font-semibold tracking-wider block">Savings Rate</span>
                            <div class="text-3xl font-mono font-bold text-white tabular mt-1">${savingsRate.toFixed(0)}%</div>
                        </div>
                    </div>
                </div>

                <!-- Reports Primary Metrics Bento Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div class="bento-card bento-card-hover p-5">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Income</span>
                            <div class="bg-emerald-50 dark:bg-emerald-950/60 p-2 rounded-xl text-emerald-600 dark:text-emerald-400">
                                <i data-lucide="trending-up" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Credits for ${monthLabel}</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${formatCurrency(totalIncome)}</div>
                            <div class="text-[11px] ${incPct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-semibold flex items-center gap-1 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <i data-lucide="${incPct >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                <span>${incPct.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <div class="bento-card bento-card-hover p-5">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Total Expenses</span>
                            <div class="bg-rose-50 dark:bg-rose-950/60 p-2 rounded-xl text-rose-600 dark:text-rose-400">
                                <i data-lucide="trending-down" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Outflows for ${monthLabel}</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${formatCurrency(totalExpenses)}</div>
                            <div class="text-[11px] ${expPct <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-semibold flex items-center gap-1 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <i data-lucide="${expPct <= 0 ? 'arrow-down-right' : 'arrow-up-left'}" class="w-3 h-3"></i>
                                <span>${expPct.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <div class="bento-card bento-card-hover p-5">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Savings Rate</span>
                            <div class="bg-amber-50 dark:bg-amber-950/60 p-2 rounded-xl text-amber-600 dark:text-amber-400">
                                <i data-lucide="shield" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Share of income kept this month</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${savingsRate.toFixed(0)}%</div>
                            <div class="text-[11px] ${savPct >= 0 ? 'text-amber-700 dark:text-amber-400' : 'text-rose-600 dark:text-rose-400'} font-semibold flex items-center gap-1 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <i data-lucide="${savPct >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                <span>${savPct.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Rule-Based Insights Box -->
                ${insights.length === 0 ? '' : `
                    <div class="bento-card p-5 space-y-4">
                        <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                            <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider flex items-center gap-2">
                                <span class="bg-brand-gradient-soft p-1.5 rounded-lg text-brand-600 dark:text-brand-400">
                                    <i data-lucide="sparkles" class="w-3.5 h-3.5"></i>
                                </span>
                                Audit Insights
                            </h4>
                            <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">${insights.length} finding${insights.length === 1 ? '' : 's'}</span>
                        </div>
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                            ${insights.map(item => {
                                const isWarning = item.type === 'warning';
                                const isSuccess = item.type === 'success';
                                const badgeColor = isWarning ? 'bg-rose-50 text-rose-700' : isSuccess ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-700';

                                return `
                                    <div class="flex items-start gap-2.5 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/40">
                                        <div class="p-1 px-1.5 rounded-lg ${badgeColor} shrink-0">
                                            <i data-lucide="${item.icon}" class="w-3.5 h-3.5"></i>
                                        </div>
                                        <p class="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed font-sans">${item.text}</p>
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
                        <div class="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-2">
                            <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Incomes Ledger</h4>
                            <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">${incomes.length} entries</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-[13px]">
                                <thead>
                                    <tr class="bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        <th class="p-3 sm:p-3.5 pl-3 sm:pl-4">Source Name</th>
                                        <th class="p-3 sm:p-3.5">Date</th>
                                        <th class="p-3 sm:p-3.5 pr-3 sm:pr-4 text-right">Amount</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                     ${incomes.length === 0 ? `
                                         <tr>
                                             <td colspan="3" class="p-10 text-center">
                                                 <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                                                     <i data-lucide="banknote" class="w-6 h-6"></i>
                                                 </div>
                                                 <p class="font-medium text-slate-500 dark:text-slate-400 text-sm">No income entries logged this month.</p>
                                                 <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Log credits in the Income workspace to view them here.</p>
                                             </td>
                                         </tr>
                                    ` : incomes.map(item => `
                                        <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                            <td class="p-3 sm:p-3.5 pl-3 sm:pl-4 font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(item.income_sources?.name || 'Unassigned')}</td>
                                            <td class="p-3 sm:p-3.5 font-mono text-xs text-slate-500 dark:text-slate-400">${item.date_credited}</td>
                                            <td class="p-3 sm:p-3.5 pr-3 sm:pr-4 font-mono text-right font-bold text-emerald-600 dark:text-emerald-500 tabular">${formatCurrency(item.amount)}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Month Expenses Breakdowns Percentage Table -->
                    <div class="bento-card overflow-hidden">
                        <div class="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex items-center justify-between gap-2">
                            <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">Expense Classes Breakdown</h4>
                            <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">${categories.length} classes</span>
                        </div>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left border-collapse text-[13px]">
                                <thead>
                                    <tr class="bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                        <th class="p-3 sm:p-3.5 pl-3 sm:pl-4">Category Class</th>
                                        <th class="p-3 sm:p-3.5">Weight %</th>
                                        <th class="p-3 sm:p-3.5 pr-3 sm:pr-4 text-right">Amount Outlay</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                     ${categories.length === 0 ? `
                                         <tr>
                                             <td colspan="3" class="p-10 text-center">
                                                 <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                                                     <i data-lucide="receipt" class="w-6 h-6"></i>
                                                 </div>
                                                 <p class="font-medium text-slate-500 dark:text-slate-400 text-sm">No expense entries logged this month.</p>
                                                 <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Record outflows in the Expenses workspace to view breakdowns.</p>
                                             </td>
                                         </tr>
                                    ` : categories.map(cat => {
                                        return `
                                            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors">
                                                <td class="p-3 sm:p-3.5 pl-3 sm:pl-4 font-sans font-semibold text-slate-800 dark:text-slate-200">${escapeHTML(cat.name)}</td>
                                                <td class="p-3 sm:p-3.5 font-mono text-xs text-slate-500 dark:text-slate-400 font-bold tabular">
                                                    <span class="inline-block w-2 h-2 rounded-full align-middle mr-1.5" style="background-color: ${cat.color}"></span>
                                                    ${cat.percent.toFixed(0)}%
                                                </td>
                                                <td class="p-3 sm:p-3.5 pr-3 sm:pr-4 font-mono text-right font-bold text-rose-500 dark:text-rose-400 tabular">${formatCurrency(cat.amount)}</td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>

                <!-- MoM Comparison Matrix -->
                <div class="bento-card p-5 sm:p-6 space-y-4">
                    <div class="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 gap-2 flex-wrap">
                        <div class="flex items-center gap-2">
                            <span class="bg-brand-gradient-soft p-2 rounded-xl text-brand-600 dark:text-brand-400">
                                <i data-lucide="bar-chart-3" class="w-4 h-4"></i>
                            </span>
                            <div>
                                <h4 class="font-bold text-slate-900 dark:text-white text-xs uppercase tracking-wider">MoM Comparison Matrix</h4>
                                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Variance review comparing ${monthLabel} against ${prevLabel}</p>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-4">

                        <div class="bento-card bento-card-hover p-4 flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Total Income</span>
                                <div class="font-mono font-bold text-slate-900 dark:text-white text-xl mt-1 tabular">${formatCurrency(totalIncome)}</div>
                            </div>
                            <div class="text-right shrink-0">
                                <span class="inline-flex items-center gap-1 font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${incPct >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'}">
                                    <i data-lucide="${incPct >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                    ${incPct >= 0 ? '+' : ''}${incPct.toFixed(0)}%
                                </span>
                                <span class="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">vs ${prevLabel}</span>
                            </div>
                        </div>

                        <div class="bento-card bento-card-hover p-4 flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Total Expenses</span>
                                <div class="font-mono font-bold text-slate-900 dark:text-white text-xl mt-1 tabular">${formatCurrency(totalExpenses)}</div>
                            </div>
                            <div class="text-right shrink-0">
                                <span class="inline-flex items-center gap-1 font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${expPct <= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'}">
                                    <i data-lucide="${expPct <= 0 ? 'arrow-down-right' : 'arrow-up-left'}" class="w-3 h-3"></i>
                                    ${expPct >= 0 ? '+' : ''}${expPct.toFixed(0)}%
                                </span>
                                <span class="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">vs ${prevLabel}</span>
                            </div>
                        </div>

                        <div class="bento-card bento-card-hover p-4 flex items-center justify-between gap-3">
                            <div class="min-w-0">
                                <span class="text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest block">Net Savings</span>
                                <div class="font-mono font-bold text-slate-900 dark:text-white text-xl mt-1 tabular">${formatCurrency(savings)}</div>
                            </div>
                            <div class="text-right shrink-0">
                                <span class="inline-flex items-center gap-1 font-semibold text-xs px-2.5 py-1 rounded-full font-mono ${savPct >= 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'}">
                                    <i data-lucide="${savPct >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                    ${savPct >= 0 ? '+' : ''}${savPct.toFixed(0)}%
                                </span>
                                <span class="text-[10px] text-slate-400 dark:text-slate-500 block mt-1">vs ${prevLabel}</span>
                            </div>
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
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render financial reports: ${escapeHTML(e.message)}</p>`;
    }
}