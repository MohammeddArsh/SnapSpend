import { supabase } from './supabase.js';
import { currentUser } from './app.js';
import { formatCurrency, getPrevMonth, getMonthName } from './utils.js';
import { navigateTo } from './app.js';

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
            // Expenses for current month
            supabase.from('expense_entries').select('amount')
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
        const prevSavings = prevTotalIncome - prevTotalExpenses;
        const savingsRate = totalIncome > 0 ? ((savings / totalIncome) * 100) : 0;

        // Month over Month percentages
        const incomePercentChange = prevTotalIncome > 0 ? ((totalIncome - prevTotalIncome) / prevTotalIncome) * 100 : 0;
        const expensePercentChange = prevTotalExpenses > 0 ? ((totalExpenses - prevTotalExpenses) / prevTotalExpenses) * 100 : 0;
        const savingsPercentChange = prevSavings !== 0 ? ((savings - prevSavings) / Math.abs(prevSavings)) * 100 : 0;

        // Render Dashboard UI
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Welcome Title and Net Savings Banner -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
                    <div class="md:col-span-2 flex flex-col justify-center space-y-1.5 py-2">
                        <span class="text-[10px] uppercase font-black text-emerald-600 tracking-widest block">MONTHLY LEDGER DIGEST</span>
                        <h2 class="text-3xl font-black tracking-tight text-slate-900 leading-none">Financial Overview</h2>
                        <p class="text-xs text-slate-500">Real-time income, expenses, and cash flow for ${getMonthName(selectedMonth)}.</p>
                    </div>
                    <!-- Net Savings Card -->
                    <div class="bg-slate-900 rounded-2xl p-6 text-white shadow-xl relative overflow-hidden flex flex-col justify-between">
                        <div class="absolute -right-8 -top-8 w-24 h-24 bg-emerald-500/10 rounded-full blur-xl"></div>
                        <div class="flex justify-between items-start z-10 select-none">
                            <span class="text-[9px] uppercase font-bold text-slate-400 tracking-widest">Monthly Net Savings</span>
                            <div class="bg-white/10 p-1.5 rounded-lg text-emerald-400">
                                <i data-lucide="wallet" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="mt-4 z-10 select-none">
                            <div class="text-2xl font-mono font-bold text-white tracking-tight">${formatCurrency(savings)}</div>
                            <p class="text-[9px] text-slate-450 mt-1">Unallocated cash remaining after expenses</p>
                        </div>
                    </div>
                </div>

                ${(totalIncome === 0 && totalExpenses === 0) ? `
                    <div class="bg-emerald-50 border border-emerald-200/60 rounded-2xl p-5 space-y-3.5 animate-fade-in select-none">
                        <div class="flex items-center gap-2">
                            <div class="bg-emerald-100 p-1.5 rounded-lg text-emerald-600">
                                <i data-lucide="compass" class="w-4 h-4"></i>
                            </div>
                            <h3 class="text-sm font-bold text-emerald-900">Welcome to SnapSpend Personal Expense Tracker!</h3>
                        </div>
                        <p class="text-xs text-slate-600 leading-relaxed">Get started by logging your income credits or recording your monthly expenses:</p>
                        <ul class="space-y-2 text-[11px] text-slate-700 font-semibold">
                            <li class="flex items-center gap-2">
                                <i data-lucide="check-square" class="w-3.5 h-3.5 text-emerald-600"></i>
                                <span>Log monthly salary or credits in <button id="welcome-btn-income" class="text-emerald-700 font-bold hover:underline cursor-pointer">Income</button>.</span>
                            </li>
                            <li class="flex items-center gap-2">
                                <i data-lucide="check-square" class="w-3.5 h-3.5 text-emerald-600"></i>
                                <span>Record or scan receipts in <button id="welcome-btn-expenses" class="text-emerald-700 font-bold hover:underline cursor-pointer">Expenses</button>.</span>
                            </li>
                        </ul>
                    </div>
                ` : ''}

                <!-- Primary Metric Bento Cards -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    
                    <!-- 1. Monthly Income -->
                    <div id="card-monthly-income" class="bento-card p-5 cursor-pointer border-l-4 border-l-emerald-500 hover:shadow-lg transition-all">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Income</span>
                            <div class="bg-emerald-50 p-1.5 rounded-lg text-emerald-600">
                                <i data-lucide="trending-up" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1">
                            <span class="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">${getMonthName(selectedMonth)} credits:</span>
                            <div class="text-lg font-mono font-bold text-slate-900 leading-tight">${formatCurrency(totalIncome)}</div>
                            <div class="text-[10px] text-emerald-600 font-medium flex items-center gap-0.5 mt-2 pt-1.5 border-t border-slate-100">
                                <i data-lucide="${incomePercentChange >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                <span>${incomePercentChange.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Monthly Expenses -->
                    <div id="card-monthly-expenses" class="bento-card p-5 cursor-pointer border-l-4 border-l-rose-500 hover:shadow-lg transition-all">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Expenses</span>
                            <div class="bg-rose-50 p-1.5 rounded-lg text-rose-600">
                                <i data-lucide="trending-down" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1">
                            <span class="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Outflows for ${getMonthName(selectedMonth)}:</span>
                            <div class="text-lg font-mono font-bold text-slate-900 leading-tight">${formatCurrency(totalExpenses)}</div>
                            <div class="text-[10px] text-rose-600 font-medium flex items-center gap-0.5 mt-2 pt-1.5 border-t border-slate-100">
                                <i data-lucide="${expensePercentChange <= 0 ? 'arrow-down-right' : 'arrow-up-left'}" class="w-3 h-3"></i>
                                <span>${expensePercentChange.toFixed(0)}% vs last month</span>
                            </div>
                        </div>
                    </div>

                    <!-- 3. Net Savings -->
                    <div id="card-monthly-savings" class="bento-card p-5 cursor-pointer border-l-4 border-l-amber-500 hover:shadow-lg transition-all">
                        <div class="flex justify-between items-start mb-2">
                            <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net Savings</span>
                            <div class="bg-amber-50 p-1.5 rounded-lg text-amber-600">
                                <i data-lucide="shield" class="w-4 h-4"></i>
                            </div>
                        </div>
                        <div class="space-y-1">
                            <span class="text-[9px] text-slate-400 uppercase tracking-wider block font-semibold">Cash left after expenses:</span>
                            <div class="text-lg font-mono font-bold text-slate-900 leading-tight">${formatCurrency(savings)}</div>
                            <div class="text-[10px] text-amber-700 font-medium flex items-center gap-0.5 mt-2 pt-1.5 border-t border-slate-100">
                                <span>Savings Rate:</span>
                                <span>${savingsRate.toFixed(0)}%</span>
                            </div>
                        </div>
                    </div>

                </div>

                <!-- Donut Chart & Month Comparison Grid -->
                <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    
                    <!-- Donut Card -->
                    <div class="bento-card p-6 lg:col-span-2 space-y-4">
                        <div class="flex justify-between items-center pb-2 border-b border-slate-100">
                            <div>
                                <h3 class="font-bold text-slate-900 text-sm">Income & Expense Allocation</h3>
                                <p class="text-[10px] text-slate-400">Overview of income distribution for ${getMonthName(selectedMonth)}</p>
                            </div>
                            <span class="text-xs font-semibold bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full font-mono">
                                Total Income: ${formatCurrency(totalIncome)}
                            </span>
                        </div>

                        <div class="flex flex-col sm:flex-row items-center justify-center p-3 gap-6">
                            <!-- SVG Donut Chart -->
                            <div class="relative w-44 h-44 shrink-0 flex items-center justify-center">
                                <div id="donut-center-legend" class="absolute inset-0 flex flex-col items-center justify-center text-center p-4 rounded-full select-none">
                                    <span class="text-[9px] text-slate-450 uppercase font-bold tracking-wider" id="donut-lbl">Net Savings</span>
                                    <span class="text-xs font-mono font-bold text-slate-800" id="donut-val">${formatCurrency(savings)}</span>
                                </div>
                                <svg class="w-full h-full -rotate-90" viewBox="0 0 100 100">
                                    ${renderDonutSlices(totalIncome, totalExpenses, savings)}
                                </svg>
                            </div>

                            <!-- Legend/Details -->
                            <div class="grow space-y-3 w-full">
                                <div class="p-2.5 rounded-xl border border-slate-50 bg-slate-50 flex items-center justify-between hover:bg-slate-100/50 cursor-pointer transition-all border-l-4 border-l-emerald-500 group" data-slice="Income">
                                    <div class="flex items-center gap-2">
                                        <div class="w-2.5 h-2.5 bg-emerald-500 rounded-full"></div>
                                        <span class="text-xs font-semibold text-slate-650 group-hover:text-emerald-700">Total Income</span>
                                    </div>
                                    <div class="text-right">
                                        <div class="text-xs font-mono font-bold text-slate-800 group-hover:text-emerald-700">${formatCurrency(totalIncome)}</div>
                                        <span class="text-[9px] font-mono text-slate-405">${totalIncome > 0 ? '100%' : '0%'}</span>
                                    </div>
                                </div>

                                <div class="p-2.5 rounded-xl border border-slate-50 bg-slate-50 flex items-center justify-between hover:bg-slate-100/50 cursor-pointer transition-all border-l-4 border-l-rose-500 group" data-slice="Expenses">
                                    <div class="flex items-center gap-2">
                                        <div class="w-2.5 h-2.5 bg-rose-500 rounded-full"></div>
                                        <span class="text-xs font-semibold text-slate-650 group-hover:text-rose-700">Expenses Outflow</span>
                                    </div>
                                    <div class="text-right">
                                        <div class="text-xs font-mono font-bold text-slate-800 group-hover:text-rose-700">${formatCurrency(totalExpenses)}</div>
                                        <span class="text-[9px] font-mono text-slate-405">${totalIncome > 0 ? ((totalExpenses / totalIncome) * 100).toFixed(0) : '0'}%</span>
                                    </div>
                                </div>

                                <div class="p-2.5 rounded-xl border border-slate-50 bg-slate-50 flex items-center justify-between hover:bg-slate-100/50 cursor-pointer transition-all border-l-4 border-l-amber-500 group" data-slice="Savings">
                                    <div class="flex items-center gap-2">
                                        <div class="w-2.5 h-2.5 bg-amber-500 rounded-full"></div>
                                        <span class="text-xs font-semibold text-slate-650 group-hover:text-amber-750">Net Cash Savings</span>
                                    </div>
                                    <div class="text-right">
                                        <div class="text-xs font-mono font-bold text-slate-800 group-hover:text-amber-750">${formatCurrency(savings)}</div>
                                        <span class="text-[9px] font-mono text-slate-405">${totalIncome > 0 ? ((savings / totalIncome) * 100).toFixed(0) : '0'}% of Income</span>
                                    </div>
                                </div>

                            </div>
                        </div>
                    </div>

                    <!-- MoM Trend Analysis Card -->
                    <div class="bento-card p-6 space-y-4">
                        <div>
                            <h3 class="font-bold text-slate-900 text-sm">Trend Tracker</h3>
                            <p class="text-[10px] text-slate-400">Comparing current month vs ${getMonthName(prevMonth)}</p>
                        </div>
                        
                        <div class="space-y-4">
                            <!-- Income Comparison -->
                            <div class="space-y-1.5 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                                <span class="text-xs font-semibold text-slate-500">MoM Income</span>
                                <div class="flex items-center gap-2 justify-between">
                                    <div class="text-xs font-mono font-bold text-slate-800">${formatCurrency(totalIncome)}</div>
                                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono flex items-center gap-0.5 ${incomePercentChange >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                        <i data-lucide="${incomePercentChange >= 0 ? 'trending-up' : 'trending-down'}" class="w-3 h-3"></i>
                                        ${incomePercentChange >= 0 ? '+' : ''}${incomePercentChange.toFixed(0)}%
                                    </span>
                                </div>
                            </div>

                            <!-- Expenses Comparison -->
                            <div class="space-y-1.5 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                                <span class="text-xs font-semibold text-slate-500">MoM Expenses</span>
                                <div class="flex items-center gap-2 justify-between">
                                    <div class="text-xs font-mono font-bold text-slate-800">${formatCurrency(totalExpenses)}</div>
                                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono flex items-center gap-0.5 ${expensePercentChange <= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                        <i data-lucide="${expensePercentChange >= 0 ? 'arrow-up-right' : 'arrow-down-left'}" class="w-3 h-3"></i>
                                        ${expensePercentChange >= 0 ? '+' : ''}${expensePercentChange.toFixed(0)}%
                                    </span>
                                </div>
                            </div>

                            <!-- Savings Comparison -->
                            <div class="space-y-1.5 p-3 rounded-xl border border-slate-100 flex flex-col justify-between">
                                <span class="text-xs font-semibold text-slate-500">MoM Net Savings</span>
                                <div class="flex items-center gap-2 justify-between">
                                    <div class="text-xs font-mono font-bold text-slate-800">${formatCurrency(savings)}</div>
                                    <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full font-mono flex items-center gap-0.5 ${savingsPercentChange >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}">
                                        <i data-lucide="${savingsPercentChange >= 0 ? 'trending-up' : 'trending-down'}" class="w-3 h-3"></i>
                                        ${savingsPercentChange >= 0 ? '+' : ''}${savingsPercentChange.toFixed(0)}%
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>
        `;

        setupDashboardListeners(totalIncome, totalExpenses, savings);

    } catch (e) {
        console.error("Dashboard error:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render dashboard: ${e.message}</p>`;
    }
}

function setupDashboardListeners(I, E, S) {
    document.getElementById('card-monthly-income')?.addEventListener('click', () => navigateTo('income'));
    document.getElementById('card-monthly-savings')?.addEventListener('click', () => navigateTo('reports'));
    document.getElementById('card-monthly-expenses')?.addEventListener('click', () => navigateTo('expenses'));

    const welcomeIncome = document.getElementById('welcome-btn-income');
    if (welcomeIncome) {
        welcomeIncome.addEventListener('click', () => navigateTo('income'));
    }
    const welcomeExpenses = document.getElementById('welcome-btn-expenses');
    if (welcomeExpenses) {
        welcomeExpenses.addEventListener('click', () => navigateTo('expenses'));
    }

    const updateDonutText = (label, value) => {
        const lbl = document.getElementById('donut-lbl');
        const val = document.getElementById('donut-val');
        if (lbl) lbl.textContent = label;
        if (val) val.textContent = formatCurrency(value);
    };

    updateDonutText("Net Savings", S);

    document.querySelectorAll('[data-slice]').forEach(item => {
        item.addEventListener('mouseenter', () => {
            const label = item.getAttribute('data-slice');
            let val = 0;
            if (label === 'Income') val = I;
            else if (label === 'Expenses') val = E;
            else if (label === 'Savings') val = S;

            updateDonutText(label === 'Savings' ? 'Net Savings' : label, val);
        });
        item.addEventListener('mouseleave', () => {
            updateDonutText("Net Savings", S);
        });
    });
}

function renderDonutSlices(I, E, S) {
    const totalOut = E + Math.max(0, S);
    if (totalOut === 0) {
        return `<circle cx="50" cy="50" r="35" fill="none" stroke="#e2e8f0" stroke-width="12" />`;
    }

    const items = [
        { label: 'Expenses', value: E, color: '#f43f5e' },
        { label: 'Savings', value: Math.max(0, S), color: '#10b981' }
    ];

    let accumulatedPercentage = 0;
    const slicesHTML = [];

    slicesHTML.push(`<circle cx="50" cy="50" r="35" fill="none" stroke="#34d399" stroke-width="12" class="opacity-15" />`);

    items.forEach(slice => {
        if (slice.value <= 0) return;
        
        const percentage = (slice.value / totalOut) * 100;
        const strokeDash = `${percentage} ${100 - percentage}`;
        const strokeOffset = 100 - accumulatedPercentage;

        slicesHTML.push(`
            <circle cx="50" cy="50" r="35" fill="none" 
                    stroke="${slice.color}" 
                    stroke-width="12" 
                    stroke-dasharray="${strokeDash}" 
                    stroke-dashoffset="${strokeOffset}" 
                    stroke-linecap="round"
                    class="transition-all hover:scale-105 cursor-pointer origin-center"
                    data-slice="${slice.label}" />
        `);
        accumulatedPercentage += percentage;
    });

    return slicesHTML.join('');
}
