import { supabase, isSupabaseConfigured, saveSupabaseConfig, isConfiguredViaEnv } from './supabase.js';
import { getMonthName, getPrevMonth, getNextMonth, escapeHTML } from './utils.js';

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
            let displayName = user.user_metadata?.username || user.email.split('@')[0];
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

            await supabase.from('bank_accounts').insert([
                { user_id: userId, bank_name: 'HDFC' },
                { user_id: userId, bank_name: 'IDFC' },
                { user_id: userId, bank_name: 'SBI' }
            ]);

            await supabase.from('expense_categories').insert([
                { user_id: userId, name: 'Travel' },
                { user_id: userId, name: 'Trips / Outings' },
                { user_id: userId, name: 'Shopping' },
                { user_id: userId, name: 'Miscellaneous' }
            ]);

            await supabase.from('investment_categories').insert([
                { user_id: userId, name: 'Mutual Funds', is_recurring: true },
                { user_id: userId, name: 'US Funds', is_recurring: true },
                { user_id: userId, name: 'Liquid Funds', is_recurring: true },
                { user_id: userId, name: 'PF', is_recurring: true },
                { user_id: userId, name: 'Gold (SGB)', is_recurring: false },
                { user_id: userId, name: 'Fixed Deposits', is_recurring: false },
                { user_id: userId, name: 'Stocks', is_recurring: false },
                { user_id: userId, name: 'Other Assets', is_recurring: false }
            ]);
        }
    } catch (e) {
        console.warn("Seeding verify message (ignoring if loaded):", e);
    }
}

/**
 * Month Ribbon controls
 */
function updateMonthRibbon() {
    const el = document.getElementById('display-current-month');
    if (el) {
        el.textContent = getMonthName(selectedMonth);
    }
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
        if (viewName === 'investments' || viewName === 'future-wealth') {
            monthRibbon.classList.add('hidden');
        } else {
            monthRibbon.classList.remove('hidden');
        }
    }
    
    // Highlight Active Bottom Nav Button
    document.querySelectorAll('#bottom-navigation-bar button').forEach(btn => {
        if (btn.getAttribute('data-target') === viewName) {
            btn.classList.add('text-blue-600', 'border-t-2', 'border-blue-600');
            btn.classList.remove('text-slate-400');
        } else {
            btn.classList.remove('text-blue-600', 'border-t-2', 'border-blue-600');
            btn.classList.add('text-slate-400');
        }
    });

    const appContent = document.getElementById('app-content');
    appContent.innerHTML = `
        <div class="flex flex-col items-center justify-center py-20">
            <div class="w-8 h-8 border-4 border-blue-500/10 border-t-blue-600 rounded-full animate-spin"></div>
            <p class="text-[11px] text-slate-400 mt-3 font-mono">Syncing records...</p>
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
                case 'banks':
                    module = await import('./banks.js');
                    break;
                case 'investments':
                    module = await import('./investments.js');
                    break;
                case 'expenses':
                    module = await import('./expenses.js');
                    break;
                case 'reports':
                    module = await import('./reports.js');
                    break;
                case 'future-wealth':
                    module = await import('./future-wealth.js');
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
            <div class="bg-red-50 border border-red-100 rounded-2xl p-6 text-center max-w-md mx-auto my-10">
                <i data-lucide="alert-octagon" class="w-10 h-10 text-red-500 mx-auto mb-3"></i>
                <h3 class="font-bold text-red-800 text-base">Module Failed to Load</h3>
                <p class="text-xs text-red-650 mt-1">${e.message}</p>
                <button onclick="window.location.reload()" class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-semibold">Retry Refresh</button>
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
                banner.className = "bg-amber-50 border border-amber-200/60 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 animate-fade-in mb-4";
                banner.innerHTML = `
                    <div class="flex items-start gap-2.5">
                        <div class="bg-amber-100 p-1.5 rounded-lg text-amber-700 mt-0.5">
                            <i data-lucide="info" class="w-4 h-4"></i>
                        </div>
                        <div>
                            <p class="text-xs font-semibold text-amber-900">Salary Entry Missing</p>
                            <p class="text-[10px] text-amber-705">Salary is not logged for ${getMonthName(selectedMonth)}. Would you like to copy last month's salary input of <b>${formatCurrency(lastMonthSalary.amount)}</b> as a draft?</p>
                        </div>
                    </div>
                    <button id="btn-copy-salary-banner" class="shrink-0 bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all shadow-md shadow-amber-600/10 cursor-pointer">
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
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="wallet" class="text-blue-600"></i> Review Draft Salary
            </h3>
            <p class="text-slate-500 text-xs mb-5">Review last month's salary parameters before posting to database.</p>
            
            <form id="draft-salary-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Income Source</label>
                    <input type="text" value="Salary" disabled class="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-slate-600 outline-none font-medium text-xs cursor-not-allowed" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Credited Date</label>
                    <input type="date" id="draft-salary-date" required value="${targetDateStr}" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 text-xs" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount (€)</label>
                    <input type="number" id="draft-salary-amount" required value="${lastMonthSalary.amount}" min="0.01" step="0.01" placeholder="Enter amount" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 font-mono text-xs" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Note (Optional)</label>
                    <input type="text" id="draft-salary-note" placeholder="Write observation notes here" value="${escapeHTML(lastMonthSalary.note || '')}" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 text-xs" />
                </div>
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-draft-modal" class="py-2 border border-slate-200 text-slate-600 font-medium rounded-lg text-xs hover:bg-slate-50 transition-all">Cancel</button>
                    <button type="submit" class="py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-lg shadow-blue-600/10 transition-all flex items-center justify-center gap-1">
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
        <div class="max-w-md mx-auto my-14 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-2xl">
            <div class="text-center mb-6">
                <div class="bg-blue-100 w-12 h-12 rounded-xl text-blue-600 flex items-center justify-center mx-auto mb-3">
                    <i data-lucide="wallet" class="w-8 h-8"></i>
                </div>
                <h2 class="text-2xl font-bold tracking-tight text-slate-900">SnapSpend</h2>
                <p class="text-slate-500 text-xs mt-1">AI Personal Finance. Manage your funds securely.</p>
            </div>

            ${customErrorMsg ? `
                <div class="bg-red-50 border border-red-100 rounded-xl p-3 text-center mb-4">
                    <p class="text-xs text-red-600 font-semibold">${escapeHTML(customErrorMsg)}</p>
                </div>
            ` : ''}

            <form id="auth-main-form" class="space-y-4">
                <div id="username-field-container" class="hidden">
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Username</label>
                    <input type="text" id="auth-username" placeholder="Choose a username" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 outline-none rounded-xl focus:border-blue-500 focus:bg-white text-xs font-medium transition-all" />
                </div>
                <div>
                    <label id="auth-identity-label" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Email address or Username</label>
                    <input type="text" id="auth-email" required placeholder="Username or email" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 outline-none rounded-xl focus:border-blue-500 focus:bg-white text-xs font-medium transition-all" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Password</label>
                    <input type="password" id="auth-password" required placeholder="Choose a password" minlength="6" class="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 outline-none rounded-xl focus:border-blue-500 focus:bg-white text-xs font-medium transition-all z-20" />
                </div>

                <div class="pt-2">
                    <button type="submit" id="btn-auth-submit" class="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold shadow-lg transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer">
                        <i data-lucide="log-in" class="w-3.5 h-3.5"></i> Sign In to Account
                    </button>
                </div>
            </form>

            <div class="text-center mt-6 pt-5 border-t border-slate-100 flex flex-col gap-2">
                <p class="text-xs text-slate-500">
                    Don't have an enterprise account? 
                    <button id="btn-auth-toggle" class="text-blue-600 hover:text-blue-700 font-bold transition-all ml-1 cursor-pointer">Create Account</button>
                </p>
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
            form.closest('div').querySelector('p').firstChild.textContent = `Don't have an enterprise account? `;
            
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
export function showModal(htmlContent, onOpenCallback = null) {
    const overlay = document.getElementById('global-modal');
    const container = document.getElementById('global-modal-container');
    
    container.innerHTML = htmlContent;
    overlay.classList.remove('hidden');
    
    setTimeout(() => {
        container.classList.remove('scale-95', 'opacity-0');
        container.classList.add('scale-100', 'opacity-100');
        if (window.lucide) window.lucide.createIcons();
        if (onOpenCallback) onOpenCallback();
    }, 20);
}

export function closeModal() {
    const overlay = document.getElementById('global-modal');
    const container = document.getElementById('global-modal-container');
    
    container.classList.remove('scale-100', 'opacity-100');
    container.classList.add('scale-95', 'opacity-0');
    
    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 150);
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
