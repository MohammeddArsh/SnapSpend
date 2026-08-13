import { supabase } from './supabase.js';
import { currentUser, navigateTo } from './app.js';
import { formatCurrency, getPrevMonth, getMonthName, escapeHTML } from './utils.js';
import { mapToCanonical, getCategoryColor } from './categories.js';

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        const prevMonth = getPrevMonth(selectedMonth);

        const [
            { data: incomeEntries, error: incErr },
            { data: expenseEntries, error: expErr },
            { data: prevIncomes },
            { data: prevExpenses }
        ] = await Promise.all([
            // Income for current month
            supabase.from('income_entries').select('amount')
                .eq('user_id', currentUser.id).eq('month', selectedMonth),
            // Expenses (with category) for current month
            supabase.from('expense_entries').select('amount, category_id, expense_categories (name), expense_receipt_items (category, price)')
                .eq('user_id', currentUser.id).eq('month', selectedMonth),
            // Prev month income (for MoM comparison)
            supabase.from('income_entries').select('amount')
                .eq('user_id', currentUser.id).eq('month', prevMonth),
            // Prev month expenses (for MoM comparison)
            supabase.from('expense_entries').select('amount')
                .eq('user_id', currentUser.id).eq('month', prevMonth)
        ]);

        if (incErr) throw incErr;
        if (expErr) throw expErr;

        const totalIncome = (incomeEntries || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);
        const totalExpenses = (expenseEntries || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);
        const prevTotalIncome = (prevIncomes || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);
        const prevTotalExpenses = (prevExpenses || []).reduce((sum, item) => sum + parseFloat(item.amount), 0);

        // Net Savings = Income − Expenses
        const savings = totalIncome - totalExpenses;
        const savingsRate = totalIncome > 0 ? ((savings / totalIncome) * 100) : 0;

        // Month over Month percentages
        const incomePercentChange = prevTotalIncome > 0 ? ((totalIncome - prevTotalIncome) / prevTotalIncome) * 100 : 0;
        const expensePercentChange = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;

        // Aggregate expenses by category.
        // Scanned receipts are broken down per line item (expense_receipt_items.category),
        // since the parent category_id may be null or diverge from the item tags.
        // Manual entries fall back to the parent category name.
        const categoryTotals = {};
        (expenseEntries || []).forEach(item => {
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

        // Render Dashboard UI
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Welcome Title and Net Savings Banner -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                    <div class="md:col-span-2 flex flex-col justify-center space-y-1.5 py-2">
<span class="eyebrow text-brand-600 dark:text-brand-400 block">Monthly Ledger Digest</span>
                        <h2 class="font-display text-3xl sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white leading-none">Financial Overview</h2>
                        <p class="text-sm text-slate-500 dark:text-slate-400">Real-time income, expenses, and cash flow for ${getMonthName(selectedMonth)}.</p>
                    </div>
                    <!-- Net Savings Card -->
                    <div class="panel-ink p-6 flex flex-col justify-between">
                        <div class="flex justify-between items-start select-none">
                            <span class="eyebrow text-white/50">Monthly Net Savings</span>
                            <svg class="logo-mark" width="30" height="18" viewBox="0 0 40 24" fill="none" aria-hidden="true">
                                <rect x="3" y="12" width="5" height="9" rx="1.5" fill="#10b981"/>
                                <rect x="10" y="7" width="5" height="14" rx="1.5" fill="#0ea5e9"/>
                                <rect x="17" y="10" width="5" height="11" rx="1.5" fill="#8b5cf6"/>
                                <rect x="24" y="3" width="5" height="18" rx="1.5" fill="#f59e0b"/>
                                <rect x="31" y="6" width="5" height="15" rx="1.5" fill="#64748b"/>
                            </svg>
                        </div>
                        <div class="mt-4 select-none">
                            <div class="text-3xl font-mono font-bold text-white tracking-tight tabular">${formatCurrency(savings)}</div>
<p class="text-[11px] text-white/50 mt-1.5">Unallocated cash remaining after expenses</p>
                        </div>
                    </div>
                </div>

                ${(totalIncome === 0 && totalExpenses === 0) ? `
                    <div class="bento-card p-6 space-y-4 animate-fade-in select-none">
                        <div class="flex items-center gap-3">
                            <div class="bg-brand-gradient-soft p-2.5 rounded-xl text-brand-600 dark:text-brand-400">
                                <i data-lucide="compass" class="w-5 h-5"></i>
                            </div>
                            <div>
                                <h3 class="text-sm font-bold text-slate-900 dark:text-white">Welcome to SnapSpend</h3>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Get started by adding your income or recording your expenses:</p>
                            </div>
                        </div>
                        <ul class="space-y-2.5 text-[13px] text-slate-700 dark:text-slate-300 font-medium">
                            <li class="flex items-center gap-2.5 bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl p-3">
                                <i data-lucide="check-square" class="w-4 h-4 text-emerald-500 shrink-0"></i>
                                <span>Log monthly salary or credits in <button id="welcome-btn-income" class="text-brand-600 dark:text-brand-400 font-semibold hover:underline cursor-pointer">Income</button>.</span>
                            </li>
                            <li class="flex items-center gap-2.5 bg-white dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl p-3">
                                <i data-lucide="check-square" class="w-4 h-4 text-emerald-500 shrink-0"></i>
                                <span>Record or scan receipts in <button id="welcome-btn-expenses" class="text-brand-600 dark:text-brand-400 font-semibold hover:underline cursor-pointer">Expenses</button>.</span>
                            </li>
                        </ul>
                    </div>
                ` : ''}

                <!-- Primary Metric Bento Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">

                    <!-- 1. Monthly Income -->
                    <div id="card-monthly-income" class="bento-card bento-card-hover p-5 cursor-pointer">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Monthly Income</span>
                            <div class="bg-emerald-50 dark:bg-emerald-950/60 p-2 rounded-xl text-emerald-600 dark:text-emerald-400">
                                <i data-lucide="trending-up" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Credits for ${getMonthName(selectedMonth)}</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${formatCurrency(totalIncome)}</div>
                            <div class="text-[11px] ${incomePercentChange >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-semibold flex items-center gap-1 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <i data-lucide="${incomePercentChange >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                <span>${incomePercentChange.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Monthly Expenses -->
                    <div id="card-monthly-expenses" class="bento-card bento-card-hover p-5 cursor-pointer">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Monthly Expenses</span>
                            <div class="bg-rose-50 dark:bg-rose-950/60 p-2 rounded-xl text-rose-600 dark:text-rose-400">
                                <i data-lucide="trending-down" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Spent in ${getMonthName(selectedMonth)}</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${formatCurrency(totalExpenses)}</div>
                            <div class="text-[11px] ${expensePercentChange <= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'} font-semibold flex items-center gap-1 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <i data-lucide="${expensePercentChange <= 0 ? 'arrow-down-right' : 'arrow-up-left'}" class="w-3 h-3"></i>
                                <span>${expensePercentChange.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Net Savings -->
                    <div id="card-monthly-savings" class="bento-card bento-card-hover p-5 cursor-pointer">
                        <div class="flex justify-between items-start mb-3">
                            <span class="text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-widest">Net Savings</span>
                            <div class="bg-amber-50 dark:bg-amber-950/60 p-2 rounded-xl text-amber-600 dark:text-amber-400">
                                <i data-lucide="shield" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1.5">
                            <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase tracking-wider block font-semibold">Cash left after expenses</span>
                            <div class="text-2xl font-mono font-bold text-slate-900 dark:text-white leading-tight tabular">${formatCurrency(savings)}</div>
                            <div class="text-[11px] text-amber-700 dark:text-amber-400 font-semibold flex items-center gap-1.5 mt-2 pt-2.5 border-t border-slate-100 dark:border-slate-800">
                                <span class="px-1.5 py-0.5 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-md font-bold">${savingsRate.toFixed(0)}%</span>
                                <span>Savings Rate</span>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Spending by Category Pie Chart -->
                <div class="bento-card p-6 space-y-5">
                    <div class="flex justify-between items-center gap-2 flex-wrap pb-3 border-b border-slate-100 dark:border-slate-800">
                        <div class="min-w-0">
                            <h3 class="font-display font-bold text-slate-900 dark:text-white text-base tracking-tight">Spending by Category</h3>
                            <p class="text-xs text-slate-400 dark:text-slate-500 mt-0.5">Expense distribution for ${getMonthName(selectedMonth)}</p>
                        </div>
                        <span class="text-xs font-semibold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 px-3 py-1 rounded-full tabular shrink-0">
                            Total: ${formatCurrency(totalExpenses)}
                        </span>
                    </div>

                    ${categories.length === 0 ? `
                        <div class="text-center py-10">
                            <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                                <i data-lucide="pie-chart" class="w-6 h-6"></i>
                            </div>
                            <p class="text-sm font-medium text-slate-500 dark:text-slate-400">No expenses recorded for ${getMonthName(selectedMonth)} yet.</p>
                            <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Record expenses to see your spending breakdown here.</p>
                        </div>
                    ` : `
                        <div class="flex flex-col sm:flex-row items-center justify-center p-3 gap-6 sm:gap-12">
                            <!-- SVG Pie Chart -->
                            <div class="relative w-44 h-44 sm:w-56 sm:h-56 md:w-72 md:h-72 shrink-0 max-w-full flex items-center justify-center">
                                <div id="pie-center-legend" class="absolute inset-0 flex flex-col items-center justify-center text-center p-4 rounded-full select-none">
                                    <span class="text-[11px] text-slate-400 dark:text-slate-500 uppercase font-semibold tracking-wider" id="pie-lbl">Total Spent</span>
                                    <span class="text-xl font-mono font-bold text-slate-900 dark:text-white tabular animate-fade-in" id="pie-val" style="animation-delay: 500ms">${formatCurrency(totalExpenses)}</span>
                                </div>
                                <svg class="w-full h-full -rotate-90" viewBox="-9 -9 118 118">
                                    ${renderPieSlices(categories)}
                                </svg>
                            </div>

                            <!-- Category Legend -->
                            <div class="space-y-2.5 w-full sm:w-64 shrink-0">
${categories.map(cat => `
                                    <div class="legend-row p-2.5 rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/40 flex items-center justify-between hover:border-brand-500/30 cursor-pointer transition-colors group" data-category="${escapeAttr(cat.name)}">
                                        <div class="flex items-center gap-2.5 min-w-0">
                                            <div class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${cat.color}"></div>
                                            <div class="min-w-0">
                                                <span class="text-[13px] font-semibold text-slate-800 dark:text-slate-200 group-hover:text-slate-900 dark:group-hover:text-white block truncate">${escapeHTML(cat.name)}</span>
                                                <div class="w-20 h-1 bg-slate-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                                                    <div class="h-full rounded-full transition-all duration-500" style="width: ${Math.max(cat.percent, 2)}%; background-color: ${cat.color}"></div>
                                                </div>
                                            </div>
                                        </div>
                                        <div class="text-right shrink-0">
                                            <div class="text-[13px] font-mono font-bold text-slate-900 dark:text-white tabular">${formatCurrency(cat.amount)}</div>
                                            <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500 tabular">${cat.percent.toFixed(1)}%</span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `}
                </div>
            </div>
        `;

        setupDashboardListeners(categories, totalIncome, totalExpenses);

    } catch (e) {
        console.error("Dashboard error:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render dashboard: ${escapeHTML(e.message)}</p>`;
    }
}

function setupDashboardListeners(categories, totalIncome, totalExpenses) {
    document.getElementById('card-monthly-income')?.addEventListener('click', () => navigateTo('income'));
    document.getElementById('card-monthly-savings')?.addEventListener('click', () => navigateTo('income'));
    document.getElementById('card-monthly-expenses')?.addEventListener('click', () => navigateTo('expenses'));

    const welcomeIncome = document.getElementById('welcome-btn-income');
    if (welcomeIncome) {
        welcomeIncome.addEventListener('click', () => navigateTo('income'));
    }
    const welcomeExpenses = document.getElementById('welcome-btn-expenses');
    if (welcomeExpenses) {
        welcomeExpenses.addEventListener('click', () => navigateTo('expenses'));
    }

    const updatePieText = (label, value) => {
        const lbl = document.getElementById('pie-lbl');
        const val = document.getElementById('pie-val');
        if (lbl) lbl.textContent = label;
        if (val) val.textContent = formatCurrency(value);
    };

    // Cross-highlight between donut slices and legend rows
    const highlightCategory = (name) => {
        document.querySelectorAll('.pie-slice').forEach(slice => {
            if (slice.getAttribute('data-category-slice') === name) {
                slice.classList.remove('pie-dim');
            } else {
                slice.classList.add('pie-dim');
            }
        });
        document.querySelectorAll('[data-category]').forEach(row => {
            if (row.getAttribute('data-category') === name) {
                row.classList.remove('opacity-50');
            } else {
                row.classList.add('opacity-50');
            }
        });
    };

    const clearHighlight = () => {
        document.querySelectorAll('.pie-slice').forEach(slice => {
            slice.classList.remove('pie-dim');
        });
        document.querySelectorAll('[data-category]').forEach(row => {
            row.classList.remove('opacity-50');
        });
        updatePieText("Total Spent", totalExpenses);
    };

    // Hover binding for slices and legend rows (shared by name)
    const bindPieHover = (el, name) => {
        el.addEventListener('mouseenter', () => {
            const cat = categories.find(c => c.name === name);
            if (cat) updatePieText(cat.name, cat.amount);
            highlightCategory(name);
        });
        el.addEventListener('mouseleave', clearHighlight);
    };

    document.querySelectorAll('[data-category]').forEach(el => bindPieHover(el, el.getAttribute('data-category')));
    document.querySelectorAll('[data-category-slice]').forEach(el => bindPieHover(el, el.getAttribute('data-category-slice')));

    // Click → navigate to Expenses with that category pre-filtered
    const openCategoryExpenses = (name) => {
        window.pendingCategoryFilter = name;
        navigateTo('expenses');
    };

    document.querySelectorAll('[data-category]').forEach(el => {
        el.addEventListener('click', () => openCategoryExpenses(el.getAttribute('data-category')));
    });
    document.querySelectorAll('[data-category-slice]').forEach(el => {
        el.addEventListener('click', () => openCategoryExpenses(el.getAttribute('data-category-slice')));
    });
}

function renderPieSlices(categories) {
    const total = categories.reduce((sum, c) => sum + c.amount, 0);
    if (total <= 0) {
        return `<circle cx="50" cy="50" r="35" fill="none" stroke="#e2e8f0" stroke-width="10" class="dark:stroke-slate-800" />`;
    }

    let accumulatedPercentage = 0;
    const slices = categories
        .filter(cat => cat.amount > 0)
        .map((cat, idx) => {
            const percentage = (cat.amount / total) * 100;
            const strokeDash = `${percentage} ${100 - percentage}`;
            const strokeOffset = 100 - accumulatedPercentage;
            accumulatedPercentage += percentage;
            return `
                <circle cx="50" cy="50" r="35" fill="none"
                        pathLength="100"
                        stroke="${cat.color}"
                        stroke-width="10"
                        stroke-dasharray="${strokeDash}"
                        stroke-dashoffset="${strokeOffset}"
                        style="--slice-dash: ${strokeDash}; animation-delay: ${idx * 130}ms"
                        class="pie-slice animate-pie-sweep transition-opacity duration-200 cursor-pointer"
                        data-category-slice="${escapeAttr(cat.name)}" />
            `;
        });

    return slices.join('');
}

function escapeAttr(str) {
    return escapeHTML(str);
}