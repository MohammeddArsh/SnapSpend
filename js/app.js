import { supabase, isSupabaseConfigured, saveSupabaseConfig, isConfiguredViaEnv } from './supabase.js';
import { getMonthName, getPrevMonth, getNextMonth, escapeHTML, formatCurrency } from './utils.js';

// App state
export let currentUser = null;
export let selectedMonth = ''; // Format: YYYY-MM
export let currentView = 'dashboard';

// Dynamic modules dictionary to load content
const views = {};

// On startup setup
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Month to Current Month
    const now = new Date();
    selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    // 2. Setup database overlay if not established
    setupCredentialsOverlay();

    // 3. Connect UI Controls
    setupUIControls();

    // 3.5. Initialize Theme Toggle
    setupThemeToggle();

    // 4. Listen to Auth Session
    if (isSupabaseConfigured()) {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            handleAuthChange(session?.user || null);

            // Listen to live auth changes
            supabase.auth.onAuthStateChange((_event, session) => {
                handleAuthChange(session?.user || null);
            });
        } catch (err) {
            console.error("Supabase Auth error:", err);
            renderAuthScreen("Invalid database setup or client error. Check details.");
        }
    } else {
        showSetupOverlay(true);
    }
});

/**
 * Renders the state once Auth is updated
 */
async function handleAuthChange(user) {
    currentUser = user;
    if (user) {
        showSetupOverlay(false);
        document.getElementById('month-navigation-ribbon').classList.remove('hidden');
        document.getElementById('btn-logout').classList.remove('hidden');
        
        const userEmailSpan = document.getElementById('user-display-email');
        if (userEmailSpan) {
            // Instant fallback placeholder
            const emailPart = user.email ? String(user.email).split('@')[0] : '';
            let displayName = user.user_metadata?.username || emailPart || 'User';
            userEmailSpan.textContent = displayName;
            userEmailSpan.classList.remove('hidden');

            // Asynchronously resolve true DB username
            supabase
                .from('profiles')
                .select('username')
                .eq('id', user.id)
                .maybeSingle()
                .then(({ data }) => {
                    if (data && data.username) {
                        userEmailSpan.textContent = data.username;
                    }
                });
        }

        document.getElementById('bottom-navigation-bar').classList.remove('hidden');
        
        // Update selection banner month
        updateMonthRibbon();

        // Check and seed fallback client-side if DB triggers are not run
        await ensureSeedData(user.id);

        // Render current view
        await navigateTo(currentView);
    } else {
        document.getElementById('month-navigation-ribbon').classList.add('hidden');
        document.getElementById('btn-logout').classList.add('hidden');
        
        const userEmailSpan = document.getElementById('user-display-email');
        if (userEmailSpan) {
            userEmailSpan.textContent = '';
            userEmailSpan.classList.add('hidden');
        }

        document.getElementById('bottom-navigation-bar').classList.add('hidden');
        document.getElementById('global-banners').classList.add('hidden');
        
        renderAuthScreen();
    }
    
    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 100);
}

/**
 * Checks if seeded rows exist in table, otherwise triggers client side seed
 */
async function ensureSeedData(userId) {
    try {
        // Quick check on income sources
        const { data: sources, error } = await supabase
            .from('income_sources')
            .select('id')
            .eq('user_id', userId)
            .limit(1);
        
        if (error) throw error;

        if (!sources || sources.length === 0) {
            // Seed database client side as a robust fallback
            await supabase.from('income_sources').insert([
                { user_id: userId, name: 'Salary' },
                { user_id: userId, name: 'Bonus' },
                { user_id: userId, name: 'Other' }
            ]);

            await supabase.from('expense_categories').insert([
                { user_id: userId, name: 'Groceries' },
                { user_id: userId, name: 'Pharmacy' },
                { user_id: userId, name: 'Travel' },
                { user_id: userId, name: 'Households' },
                { user_id: userId, name: 'Miscellaneous' }
            ]);
        }
    } catch (e) {
        console.warn("Seeding verify message (ignoring if loaded):", e);
    }
}

/**
 * Month Ribbon controls
 */
export function updateMonthRibbon() {
    const el = document.getElementById('display-current-month');
    if (el) {
        el.textContent = getMonthName(selectedMonth);
    }
}

export function setSelectedMonth(value) {
    selectedMonth = value;
    updateMonthRibbon();
}

/**
 * Navigation Router
 */
export async function navigateTo(viewName) {
    if (!currentUser) return;
    
    currentView = viewName;

    // Toggle Month Ribbon visibility based on tab scoping
    const monthRibbon = document.getElementById('month-navigation-ribbon');
    if (monthRibbon) {
        if (viewName === 'assistant') {
            monthRibbon.classList.add('hidden');
        } else {
            monthRibbon.classList.remove('hidden');
        }
    }
    
    // Highlight Active Bottom Nav Button
    document.querySelectorAll('#bottom-navigation-bar button').forEach(btn => {
        if (btn.getAttribute('data-target') === viewName) {
            btn.classList.add('bottom-nav-active');
            btn.classList.remove('text-slate-400');
        } else {
            btn.classList.remove('bottom-nav-active');
            btn.classList.add('text-slate-400');
        }
    });

    const appContent = document.getElementById('app-content');
    appContent.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20">
            <div class="w-8 h-8 rounded-full bg-conic-brand animate-spin"></div>
            <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-3 font-mono">Syncing records...</p>
        </div>
    `;

    // Dynamic import to cache modular renders
    try {
            let module;
            switch (viewName) {
                case 'dashboard':
                    module = await import('./dashboard.js');
                    break;
                case 'income':
                    module = await import('./income.js');
                    break;
                case 'expenses':
                    module = await import('./expenses.js');
                    break;
                case 'reports':
                    module = await import('./reports.js');
                    break;
                case 'assistant':
                    module = await import('./assistant.js');
                    break;
                default:
                    throw new Error(`Unknown view: ${viewName}`);
            }
            views[viewName] = module;
        
        await views[viewName].render(appContent, selectedMonth);
        
        // Post render: check for salary banner ONLY on dashboard tab
        if (viewName === 'dashboard') {
            await checkSalaryBanner();
        }
        
    } catch (e) {
        console.error("Navigation routing failure:", e);
        appContent.innerHTML = `
            <div class="bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/60 rounded-3xl p-8 text-center max-w-md mx-auto my-10 animate-fade-in">
                <div class="bg-rose-100 dark:bg-rose-900/50 w-14 h-14 rounded-2xl text-rose-500 flex items-center justify-center mx-auto mb-4">
                    <i data-lucide="alert-octagon" class="w-7 h-7"></i>
                </div>
                <h3 class="font-bold text-rose-800 dark:text-rose-200 text-base">Module Failed to Load</h3>
                <p class="text-xs text-rose-700/70 dark:text-rose-300/70 mt-1">${escapeHTML(e.message)}</p>
                <button onclick="window.location.reload()" class="mt-5 px-5 py-2.5 bg-brand-gradient text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-500/25 cursor-pointer">Retry Refresh</button>
            </div>
        `;
    }

    setTimeout(() => { if (window.lucide) window.lucide.createIcons(); }, 50);
}

/**
 * Triggers re-render for current active view
 */
export async function reFetchAndRenderCurrentView() {
    await navigateTo(currentView);
}

/**
 * Credentials Setup Panel triggers
 */
function setupCredentialsOverlay() {
    const isConfig = isSupabaseConfigured();
    showSetupOverlay(!isConfig);

    if (isConfiguredViaEnv) {
        const reconnectBtn = document.getElementById('btn-reconnect-db');
        if (reconnectBtn) {
            reconnectBtn.classList.add('hidden');
        }
    }

    document.getElementById('setup-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const url = document.getElementById('setup-url').value;
        const key = document.getElementById('setup-key').value;
        
        if (saveSupabaseConfig(url, key)) {
            window.location.reload();
        }
    });

    document.getElementById('btn-reconnect-db').addEventListener('click', () => {
        showSetupOverlay(true);
        // Pre-fill from sessionStorage
        document.getElementById('setup-url').value = sessionStorage.getItem('FIN_SUPABASE_URL') || '';
        document.getElementById('setup-key').value = sessionStorage.getItem('FIN_SUPABASE_ANON_KEY') || '';
    });
}

function showSetupOverlay(show) {
    const el = document.getElementById('setup-overlay');
    if (show) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}

/**
 * Configure standard bindings
 */
function setupUIControls() {
    // Month navigation
    document.getElementById('btn-prev-month').addEventListener('click', () => {
        selectedMonth = getPrevMonth(selectedMonth);
        updateMonthRibbon();
        reFetchAndRenderCurrentView();
    });

    document.getElementById('btn-next-month').addEventListener('click', () => {
        selectedMonth = getNextMonth(selectedMonth);
        updateMonthRibbon();
        reFetchAndRenderCurrentView();
    });

    // Logging out
    document.getElementById('btn-logout').addEventListener('click', async () => {
        if (supabase) {
            await supabase.auth.signOut();
            window.location.reload();
        }
    });

    // Bottom Navigation Module Switchers
    document.querySelectorAll('#bottom-navigation-bar button').forEach(button => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-target');
            if (target) navigateTo(target);
        });
    });
}

/**
 * Dark / Light theme toggle with localStorage persistence
 */
function setupThemeToggle() {
    const btn = document.getElementById('btn-theme-toggle');
    if (!btn) return;

    const applyTheme = (dark) => {
        document.documentElement.classList.toggle('dark', dark);
        const icon = btn.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', dark ? 'sun' : 'moon');
        if (window.lucide) window.lucide.createIcons();
        const meta = document.getElementById('meta-theme-color');
        if (meta) meta.setAttribute('content', dark ? '#080a12' : '#f6f7fb');
        try { localStorage.setItem('snapspend-theme', dark ? 'dark' : 'light'); } catch (e) {}
    };

    btn.addEventListener('click', () => {
        applyTheme(!document.documentElement.classList.contains('dark'));
    });

    applyTheme(document.documentElement.classList.contains('dark'));
}

/**
 * Check if salary isn't logged, offer the banner autofill prompt
 */
async function checkSalaryBanner() {
    const bannerContainer = document.getElementById('global-banners');
    bannerContainer.innerHTML = '';
    bannerContainer.classList.add('hidden');

    if (!currentUser) return;

    try {
        // 1. Check if the current month has salary logged
        // Fetch User Salary records
        const { data: salaryEntries, error } = await supabase
            .from('income_entries')
            .select(`
                id,
                amount,
                date_credited,
                note,
                source_id,
                income_sources (name)
            `)
            .eq('user_id', currentUser.id)
            .eq('month', selectedMonth);

        if (error) throw error;

        // Is there any entry logged under 'Salary' source (case-insensitive)?
        const hasSalary = salaryEntries.some(entry => entry.income_sources?.name?.toLowerCase().includes('salary'));

        if (!hasSalary) {
            // Find last month's salary entry
            const prevMonth = getPrevMonth(selectedMonth);
            const { data: prevSalaryEntries } = await supabase
                .from('income_entries')
                .select(`
                    id,
                    amount,
                    note,
                    source_id,
                    income_sources (name)
                `)
                .eq('user_id', currentUser.id)
                .eq('month', prevMonth);

            const lastMonthSalary = prevSalaryEntries?.find(entry => entry.income_sources?.name?.toLowerCase().includes('salary'));

            if (lastMonthSalary) {
                // Precompile draft click action
                const banner = document.createElement('div');
                banner.className = "bg-amber-50 dark:bg-amber-950/40 border border-amber-200/60 dark:border-amber-900/60 rounded-2xl p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in mb-4";
                banner.innerHTML = `
                    <div class="flex items-start gap-2.5">
                        <div class="bg-amber-100 dark:bg-amber-900/60 p-1.5 rounded-lg text-amber-700 dark:text-amber-300 mt-0.5">
                            <i data-lucide="info" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <p class="text-xs font-semibold text-amber-900 dark:text-amber-200">Salary Entry Missing</p>
                            <p class="text-[11px] text-amber-700/80 dark:text-amber-300/80">Salary is not logged for ${getMonthName(selectedMonth)}. Would you like to copy last month's salary input of <b>${formatCurrency(lastMonthSalary.amount)}</b> as a draft?</p>
                        </div>
                    </div>
                    <button id="btn-copy-salary-banner" class="shrink-0 bg-amber-600 hover:bg-amber-700 text-white rounded-xl px-3.5 py-2 text-[11px] font-semibold transition-all shadow-md shadow-amber-600/20 cursor-pointer">
                        Copy Draft Salary
                    </button>
                `;
                bannerContainer.appendChild(banner);
                bannerContainer.classList.remove('hidden');

                document.getElementById('btn-copy-salary-banner').addEventListener('click', () => {
                    // Trigger dynamic drawer
                    triggerSalaryDraftCreator(lastMonthSalary);
                });

                if (window.lucide) window.lucide.createIcons();
            }
        }
    } catch (e) {
        console.error("Salary auto fill check warning:", e);
    }
}

/**
 * Creates dynamic Salary Draft Entry modal
 */
function triggerSalaryDraftCreator(lastMonthSalary) {
    // Target credited date (e.g., 1st day of current selectedMonth)
    const targetDateStr = `${selectedMonth}-01`;
       // Open dynamic Add Modal prefilled
    const modalContent = `
        <div class="p-1">
            <div class="flex items-center gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="wallet" class="w-4 h-4"></i>
                </span>
                <div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">Review Draft Salary</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Review last month's salary parameters before posting to database.</p>
                </div>
            </div>
            
            <form id="draft-salary-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Income Source</label>
                    <input type="text" value="Salary" disabled class="w-full px-3.5 py-2.5 bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-600 dark:text-slate-400 outline-none font-medium text-xs cursor-not-allowed" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Credited Date</label>
                    <input type="date" id="draft-salary-date" required value="${targetDateStr}" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Amount (€)</label>
                    <input type="number" id="draft-salary-amount" required value="${lastMonthSalary.amount}" min="0.01" step="0.01" placeholder="Enter amount" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Note (Optional)</label>
                    <input type="text" id="draft-salary-note" placeholder="Write observation notes here" value="${escapeHTML(lastMonthSalary.note || '')}" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-draft-modal" class="py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">Cancel</button>
                    <button type="submit" class="py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> Save Salary Record
                    </button>
                </div>
            </form>
        </div>
    `;
    
    showModal(modalContent);
    
    document.getElementById('btn-cancel-draft-modal').addEventListener('click', closeModal);
    
    document.getElementById('draft-salary-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const date = document.getElementById('draft-salary-date').value;
        const amount = parseFloat(document.getElementById('draft-salary-amount').value);
        const note = document.getElementById('draft-salary-note').value;
        
        showActionSpinner(true);
        try {
            const { error } = await supabase
                .from('income_entries')
                .insert({
                    user_id: currentUser.id,
                    source_id: lastMonthSalary.source_id,
                    amount,
                    date_credited: date,
                    note,
                    month: selectedMonth
                });
            if (error) throw error;
            
            closeModal();
            // Refetch and render
            await reFetchAndRenderCurrentView();
        } catch (err) {
            alert("Failed to write salary: " + err.message);
        } finally {
            showActionSpinner(false);
        }
    });
}

/**
 * Auth controller
 */
function renderAuthScreen(customErrorMsg = "") {
    const el = document.getElementById('app-content');
    el.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-10 max-w-4xl mx-auto my-6 md:my-14 items-stretch animate-fade-in">
            <!-- Brand Panel -->
            <div class="hidden md:flex flex-col justify-between relative overflow-hidden rounded-3xl bg-brand-gradient p-8 text-white shadow-2xl shadow-indigo-500/30">
                <div class="glow-orb w-64 h-64 bg-white/15 -top-20 -right-20"></div>
                <div class="glow-orb w-48 h-48 bg-fuchsia-400/30 -bottom-16 -left-16"></div>
                <div class="relative z-10">
                    <div class="bg-white/15 backdrop-blur-sm w-14 h-14 rounded-2xl flex items-center justify-center mb-6 shadow-lg">
                        <i data-lucide="wallet" class="w-7 h-7"></i>
                    </div>
                    <h2 class="text-3xl font-black tracking-tight leading-tight">Your money,\nbeautifully managed.</h2>
                    <p class="text-white/80 text-sm mt-3 leading-relaxed max-w-xs">Track income, scan receipts, and let AI answer anything about your spending.</p>
                </div>
                <ul class="relative z-10 space-y-3 text-sm text-white/90">
                    <li class="flex items-center gap-2.5">
                        <span class="bg-white/15 rounded-lg p-1.5"><i data-lucide="scan-line" class="w-4 h-4"></i></span>
                        Smart receipt scanning
                    </li>
                    <li class="flex items-center gap-2.5">
                        <span class="bg-white/15 rounded-lg p-1.5"><i data-lucide="bot" class="w-4 h-4"></i></span>
                        AI spending assistant
                    </li>
                    <li class="flex items-center gap-2.5">
                        <span class="bg-white/15 rounded-lg p-1.5"><i data-lucide="pie-chart" class="w-4 h-4"></i></span>
                        Insightful monthly analytics
                    </li>
                </ul>
            </div>

            <!-- Form Card -->
            <div class="glass-surface rounded-3xl p-6 sm:p-8 shadow-2xl shadow-slate-900/10 dark:shadow-black/40 border border-slate-200/60 dark:border-slate-700/50">
                <div class="text-center mb-6 md:hidden">
                    <div class="bg-brand-gradient w-14 h-14 rounded-2xl text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/30">
                        <i data-lucide="wallet" class="w-7 h-7"></i>
                    </div>
                </div>
                <div class="mb-6">
                    <h2 class="text-2xl font-black tracking-tight text-slate-900 dark:text-white">Welcome back</h2>
                    <p class="text-slate-500 dark:text-slate-400 text-sm mt-1">Sign in to your SnapSpend account to continue.</p>
                </div>

                ${customErrorMsg ? `
                    <div class="bg-rose-50 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-900/60 rounded-xl p-3 text-center mb-4">
                        <p class="text-xs text-rose-600 dark:text-rose-300 font-semibold">${escapeHTML(customErrorMsg)}</p>
                    </div>
                ` : ''}

                <form id="auth-main-form" class="space-y-4">
                    <div id="username-field-container" class="hidden">
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Username</label>
                        <input type="text" id="auth-username" placeholder="Choose a username" class="w-full px-3.5 py-2.5 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white dark:focus:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 transition-all" />
                    </div>
                    <div>
                        <label id="auth-identity-label" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Email address or Username</label>
                        <input type="text" id="auth-email" required placeholder="Username or email" class="w-full px-3.5 py-2.5 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white dark:focus:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 transition-all" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Password</label>
                        <input type="password" id="auth-password" required placeholder="Choose a password" minlength="6" class="w-full px-3.5 py-2.5 bg-white/80 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:bg-white dark:focus:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 transition-all z-20" />
                    </div>

                    <div class="pt-2">
                        <button type="submit" id="btn-auth-submit" class="w-full py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl font-semibold shadow-lg shadow-indigo-500/25 transition-all text-sm flex items-center justify-center gap-1.5 cursor-pointer">
                            <i data-lucide="log-in" class="w-4 h-4"></i> Sign In to Account
                        </button>
                    </div>
                </form>

                <div class="text-center mt-6 pt-5 border-t border-slate-200/70 dark:border-slate-800 flex flex-col gap-2">
                    <p class="text-xs text-slate-500 dark:text-slate-400">
                        Don't have an account?
                        <button id="btn-auth-toggle" class="text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 font-bold transition-all ml-1 cursor-pointer">Create Account</button>
                    </p>
                </div>
            </div>
        </div>
    `;

    // Connect event interactions
    let mode = 'signin';
    const form = document.getElementById('auth-main-form');
    const authToggle = document.getElementById('btn-auth-toggle');
    const btnSubmit = document.getElementById('btn-auth-submit');
    const usernameContainer = document.getElementById('username-field-container');
    const authUsernameInput = document.getElementById('auth-username');
    const identityLabel = document.getElementById('auth-identity-label');
    const identityInput = document.getElementById('auth-email');

    authToggle.addEventListener('click', () => {
        if (mode === 'signin') {
            mode = 'signup';
            btnSubmit.innerHTML = `<i data-lucide="user-plus" class="w-3.5 h-3.5"></i> Register Account`;
            authToggle.textContent = 'Sign In';
            form.closest('div').querySelector('p').firstChild.textContent = 'Already have an account? ';
            
            usernameContainer.classList.remove('hidden');
            authUsernameInput.required = true;
            identityLabel.textContent = "Email address";
            identityInput.type = "email";
            identityInput.placeholder = "name@example.com";
        } else {
            mode = 'signin';
            btnSubmit.innerHTML = `<i data-lucide="log-in" class="w-3.5 h-3.5"></i> Sign In to Account`;
            authToggle.textContent = 'Create Account';
            form.closest('div').querySelector('p').firstChild.textContent = `Don't have an account? `;
            
            usernameContainer.classList.add('hidden');
            authUsernameInput.required = false;
            authUsernameInput.value = "";
            identityLabel.textContent = "Email address or Username";
            identityInput.type = "text";
            identityInput.placeholder = "Username or email";
        }
        if (window.lucide) window.lucide.createIcons();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const identity = identityInput.value.trim();
        const password = document.getElementById('auth-password').value;

        showActionSpinner(true);
        try {
            if (mode === 'signin') {
                let targetEmail = identity;
                
                // If it doesn't contain '@', treat it as username lookup
                if (!identity.includes('@')) {
                    const { data: profile, error: profileErr } = await supabase
                        .from('profiles')
                        .select('email')
                        .eq('username', identity.toLowerCase())
                        .maybeSingle();
                    
                    if (profileErr || !profile) {
                        throw new Error("Invalid email or username.");
                    }
                    targetEmail = profile.email;
                }

                const { error } = await supabase.auth.signInWithPassword({ email: targetEmail, password });
                if (error) throw error;
            } else {
                const username = authUsernameInput.value.trim().toLowerCase();
                const email = identity;

                // Username validations
                if (!username) {
                    throw new Error("Username is required.");
                }
                if (username.length < 3 || username.length > 25) {
                    throw new Error("Username must be 3–25 characters.");
                }
                if (username.includes(" ")) {
                    throw new Error("Username must not contain spaces.");
                }
                const usernameRegex = /^[a-zA-Z0-9_\.]+$/;
                if (!usernameRegex.test(username)) {
                    throw new Error('Username may only contain letters, numbers, "_" and ".".');
                }

                // Check username uniqueness before auth sign up
                const { data: existingProf, error: checkErr } = await supabase
                    .from('profiles')
                    .select('username')
                    .eq('username', username)
                    .maybeSingle();
                if (checkErr) throw checkErr;
                if (existingProf) {
                    throw new Error("Username already exists.");
                }

                const { error: signUpError, data } = await supabase.auth.signUp({
                    email,
                    password,
                    options: {
                        data: {
                            username: username
                        }
                    }
                });
                if (signUpError) throw signUpError;

                if (data && !data.session) {
                    alert("Registration successful! Check your email inbox to confirm registration.");
                }
            }
        } catch (err) {
            renderAuthScreen(err.message);
        } finally {
            showActionSpinner(false);
        }
    });

    if (window.lucide) window.lucide.createIcons();
}

/**
 * Central Modal controls
 */
let modalEscapeHandler = null;
let modalBackdropHandler = null;
let modalGeneration = 0;

const MODAL_WIDTH_CLASSES = ['sm:max-w-lg', 'sm:max-w-xl', 'sm:max-w-2xl', 'sm:max-w-3xl'];

export function showModal(htmlContent, onOpenCallback = null, options = {}) {
    const overlay = document.getElementById('global-modal');
    const container = document.getElementById('global-modal-container');

    modalGeneration += 1;
    
    const widthClass = options.widthClass || 'sm:max-w-lg';
    container.classList.remove(...MODAL_WIDTH_CLASSES);
    container.classList.add(widthClass);

    container.innerHTML = htmlContent;
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    if (!modalEscapeHandler) {
        modalEscapeHandler = (e) => {
            if (e.key === 'Escape') closeModal();
        };
        document.addEventListener('keydown', modalEscapeHandler);
    }

    if (!modalBackdropHandler) {
        modalBackdropHandler = (e) => {
            if (e.target === overlay) closeModal();
        };
        overlay.addEventListener('click', modalBackdropHandler);
    }

    setTimeout(() => {
        container.classList.remove('opacity-0', 'translate-y-8');
        container.classList.add('opacity-100', 'translate-y-0');
        if (window.lucide) window.lucide.createIcons();
        if (onOpenCallback) onOpenCallback();
    }, 20);
}

export function closeModal() {
    const overlay = document.getElementById('global-modal');
    const container = document.getElementById('global-modal-container');
    const generationAtClose = modalGeneration;
    
    container.classList.remove('opacity-100', 'translate-y-0');
    container.classList.add('opacity-0', 'translate-y-8');
    
    if (modalEscapeHandler) {
        document.removeEventListener('keydown', modalEscapeHandler);
        modalEscapeHandler = null;
    }
    if (modalBackdropHandler) {
        overlay.removeEventListener('click', modalBackdropHandler);
        modalBackdropHandler = null;
    }
    
    setTimeout(() => {
        // Guard against a stale hide clobbering a modal that was re-opened
        // while this close animation was pending.
        if (modalGeneration !== generationAtClose) return;
        overlay.classList.add('hidden');
        document.body.style.overflow = '';
    }, 200);
}

/**
 * Manage syncing overlays
 */
export function showActionSpinner(show) {
    const el = document.getElementById('action-spinner');
    if (show) {
        el.classList.remove('hidden');
    } else {
        el.classList.add('hidden');
    }
}
