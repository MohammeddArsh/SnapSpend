import { supabase } from './supabase.js';
import { currentUser, reFetchAndRenderCurrentView, showModal, closeModal, showActionSpinner } from './app.js';
import { formatCurrency, getPrevMonth, getMonthName, escapeHTML } from './utils.js';

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        // --- 1. DATA RE-FETCH PHASE ---
        const [
            { data: accounts, error: aErr },
            { data: monthlyBalances, error: bErr }
        ] = await Promise.all([
            // A. Fetch All Bank Accounts
            supabase.from('bank_accounts').select('*')
                .eq('user_id', currentUser.id).order('bank_name', { ascending: true }),
            // B. Fetch Month Balances for selected month
            supabase.from('bank_balances').select('*')
                .eq('user_id', currentUser.id).eq('month', selectedMonth)
        ]);
        if (aErr) throw aErr;
        if (bErr) throw bErr;

        // Compute Total Cash (sum of all closing balances for selected month)
        const totalCash = monthlyBalances.reduce((sum, b) => sum + parseFloat(b.closing_balance || 0), 0);

        // --- 2. RENDER THE INTERACTIVE BANK GRID ---
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Header Actions -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <span class="text-[10px] uppercase font-black text-blue-650 tracking-widest block">BALANCE LEDGERS</span>
                        <h2 class="text-2xl font-black tracking-tight text-slate-900 leading-none">Banks & Cash</h2>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="btn-manage-bank-accounts" class="px-3.5 py-2 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer">
                            <i data-lucide="piggy-bank" class="w-3.5 h-3.5"></i> Manage Accounts
                        </button>
                    </div>
                </div>

                <!-- Total Cash Aggregator (Sum of all closing balances for selected month) -->
                <div class="bento-card p-5 bg-gradient-to-r from-blue-50/50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-l-4 border-l-blue-600 select-none">
                    <div class="flex items-center gap-3">
                        <div class="bg-blue-100 p-2.5 rounded-xl text-blue-600">
                            <i data-lucide="coins" class="w-5 h-5"></i>
                        </div>
                        <div>
                            <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Cash Reserve</span>
                            <div class="text-xs text-slate-650">Sum of bank closing balances in ${getMonthName(selectedMonth)}</div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right">
                        <span class="text-[10px] text-slate-405 font-medium leading-none block">Aggregate Balance</span>
                        <span class="text-xl font-mono font-bold text-slate-950">${formatCurrency(totalCash)}</span>
                    </div>
                </div>

                <!-- Core Accounts Cards Grid -->
                <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                    ${accounts.length === 0 ? `
                        <div class="bento-card p-8 text-center text-slate-400 md:col-span-3">
                            <i data-lucide="landmark" class="w-8 h-8 opacity-40 mx-auto mb-2"></i>
                            <p class="font-medium text-slate-500 text-xs">No banking accounts structured yet.</p>
                            <p class="text-[10px] text-slate-400 mt-1">Get started by clicking <b>'Manage Accounts'</b> above to set up your bank accounts.</p>
                        </div>
                    ` : accounts.map(acc => {
                        // Find matching balance record for this month
                        const balanceRecord = monthlyBalances.find(b => b.bank_id === acc.id);
                        const hasLogged = !!balanceRecord;
                        
                        return `
                            <div class="bento-card p-5 space-y-4 flex flex-col justify-between hover:shadow-md transition-all">
                                <div class="flex justify-between items-start">
                                    <div class="space-y-0.5">
                                        <h3 class="font-bold text-slate-900 text-base leading-none">${escapeHTML(acc.bank_name)}</h3>
                                        <span class="text-[10px] font-mono text-slate-400 tracking-wider block">
                                            A/C: ${escapeHTML(acc.account_number || 'Not provided')}
                                        </span>
                                    </div>
                                    <div class="p-1 px-2 rounded-full text-[9px] font-bold uppercase tracking-wider font-mono ${hasLogged ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">
                                        ${hasLogged ? 'Active Log' : 'Pending'}
                                    </div>
                                </div>

                                <div class="space-y-2 select-none">
                                    <div class="grid grid-cols-2 gap-2 text-xs border-y border-slate-100 py-3.5">
                                        <div>
                                            <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-0.5">Opening</span>
                                            <span class="font-mono font-bold text-slate-700">${hasLogged ? formatCurrency(balanceRecord.opening_balance) : '—'}</span>
                                        </div>
                                        <div class="border-l border-slate-100 pl-3">
                                            <span class="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-0.5">Closing</span>
                                            <span class="font-mono font-bold ${hasLogged ? 'text-emerald-600' : 'text-slate-400'}">${hasLogged ? formatCurrency(balanceRecord.closing_balance) : '—'}</span>
                                        </div>
                                    </div>

                                    ${hasLogged && balanceRecord.note ? `
                                        <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                                            <span class="text-[8px] uppercase tracking-wider font-bold text-slate-400">Note:</span>
                                            <p class="text-[10px] text-slate-650 font-medium leading-tight mt-0.5">${escapeHTML(balanceRecord.note)}</p>
                                        </div>
                                    ` : ''}
                                </div>

                                <button data-balance-bank-id="${acc.id}" class="w-full py-2 bg-slate-950 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer transition-all flex items-center justify-center gap-1">
                                    <i data-lucide="${hasLogged ? 'edit-2' : 'plus'}" class="w-3.5 h-3.5"></i>
                                    ${hasLogged ? 'Edit Balances' : 'Log Balances'}
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;

        // Bind interactive elements
        setupBanksListeners(accounts, monthlyBalances, selectedMonth);

    } catch (e) {
        console.error("Banks view render error:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render banks: ${e.message}</p>`;
    }
}

/**
 * Banks interactions
 */
function setupBanksListeners(accounts, monthlyBalances, selectedMonth) {
    // 1. MANAGE BANK STRUCTURES
    document.getElementById('btn-manage-bank-accounts').addEventListener('click', () => {
        openAccountsModal(accounts);
    });

    // 2. TRIGGER BALANCE RECORDER
    document.querySelectorAll('[data-balance-bank-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const bankId = btn.getAttribute('data-balance-bank-id');
            const account = accounts.find(a => a.id === bankId);
            const balanceRecord = monthlyBalances.find(b => b.bank_id === bankId);
            
            // Prefill Opening Balance logic!
            let defaultOpening = 0;
            let note = '';
            let defaultClosing = '';
            const prevMonth = getPrevMonth(selectedMonth);

            if (balanceRecord) {
                defaultOpening = balanceRecord.opening_balance;
                defaultClosing = balanceRecord.closing_balance;
                note = balanceRecord.note || '';
            } else {
                // Look for previous month closing balance to prefill
                showActionSpinner(true);
                try {
                    const { data: prevBalance, error } = await supabase
                        .from('bank_balances')
                        .select('closing_balance')
                        .eq('user_id', currentUser.id)
                        .eq('bank_id', bankId)
                        .eq('month', prevMonth)
                        .maybeSingle();

                    if (!error && prevBalance) {
                        defaultOpening = prevBalance.closing_balance;
                    }
                } catch (e) {
                    console.log("No previous month bank records found to prefill opening balance.", e);
                } finally {
                    showActionSpinner(false);
                }
            }

            openBalanceRecordModal(account, balanceRecord, selectedMonth, defaultOpening, defaultClosing, note);
        });
    });
}

/**
 * Balance updates overlay
 */
function openBalanceRecordModal(account, record, selectedMonth, openingVal, closingVal, noteVal) {
    const isEdit = !!record;
    const h = `
        <div>
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="credit-card" class="text-blue-600"></i> ${account.bank_name} Balances
            </h3>
            <p class="text-slate-500 text-xs mb-5">Updating balances for the month of ${getMonthName(selectedMonth)}.</p>

            <form id="bank-balance-form" class="space-y-4">
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Opening Balance (₹)</label>
                        <input type="number" id="bal-opening" required value="${openingVal}" min="0" step="0.01" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 font-mono text-xs" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Closing Balance (₹)</label>
                        <input type="number" id="bal-closing" required value="${closingVal}" min="0" step="0.01" placeholder="End of month" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 font-mono text-xs" />
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Balance Observation / Note</label>
                    <input type="text" id="bal-note" value="${noteVal}" placeholder="E.g., High transaction fees, interest payment credited" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-blue-500 text-xs" />
                </div>
                
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-balance" class="py-2 border border-slate-200 text-slate-600 font-medium rounded-lg text-xs hover:bg-slate-50 transition-all">Cancel</button>
                    <button type="submit" class="py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium shadow-lg shadow-blue-600/10 transition-all flex items-center justify-center gap-1">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> Save Ledger Balance
                    </button>
                </div>
            </form>
        </div>
    `;

    showModal(h, () => {
        document.getElementById('btn-cancel-balance').addEventListener('click', closeModal);

        document.getElementById('bank-balance-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const opening = parseFloat(document.getElementById('bal-opening').value);
            const closing = parseFloat(document.getElementById('bal-closing').value);
            const note = document.getElementById('bal-note').value;

            if (isNaN(opening) || opening < 0 || isNaN(closing) || closing < 0) {
                alert("Balances must be valid non-negative numbers.");
                return;
            }

            showActionSpinner(true);
            try {
                if (isEdit) {
                    const { error } = await supabase
                        .from('bank_balances')
                        .update({ opening_balance: opening, closing_balance: closing, note })
                        .eq('id', record.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase
                        .from('bank_balances')
                        .insert({
                            user_id: currentUser.id,
                            bank_id: account.id,
                            month: selectedMonth,
                            opening_balance: opening,
                            closing_balance: closing,
                            note
                        });
                    if (error) throw error;
                }

                closeModal();
                await reFetchAndRenderCurrentView();
            } catch (err) {
                alert("Operation failed: " + err.message);
            } finally {
                showActionSpinner(false);
            }
        });
    });
}

/**
 * Manage dynamic bank master entities
 */
function openAccountsModal(accounts) {
    const html = `
        <div>
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="landmark" class="text-blue-600"></i> Manage Accounts
            </h3>
            <p class="text-slate-500 text-xs mb-5">Create or configure accounts to track your monthly cash liquid indices.</p>

            <!-- Add new bank account -->
            <form id="add-bank-inline-form" class="space-y-3 mb-5 p-3.5 bg-slate-50 rounded-xl border border-slate-100">
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Bank Name</label>
                        <input type="text" id="new-bank-name" required placeholder="E.g., ICICI" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 outline-none rounded-lg focus:border-blue-500 text-xs" />
                    </div>
                    <div>
                        <label class="block text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Account No. (Optional)</label>
                        <input type="text" id="new-bank-num" placeholder="E.g., xxxx 9102" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 outline-none rounded-lg focus:border-blue-500 text-xs font-mono" />
                    </div>
                </div>
                <button type="submit" class="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer">Register Bank Account</button>
            </form>

            <div class="max-h-[220px] overflow-y-auto mb-5 border border-slate-100 rounded-lg divide-y divide-slate-100">
                ${accounts.length === 0 ? `
                    <p class="p-4 text-center text-slate-450 text-xs">No active banks.</p>
                ` : accounts.map(acc => `
                    <div class="flex items-center justify-between p-3 bg-white hover:bg-slate-50 transition-all text-xs">
                        <div>
                            <input type="text" id="edit-bname-${acc.id}" value="${escapeHTML(acc.bank_name)}" class="font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-blue-500 outline-none" />
                            <input type="text" id="edit-bnum-${acc.id}" value="${escapeHTML(acc.account_number || '')}" placeholder="No A/C number" class="block text-[10px] text-slate-400 font-mono mt-0.5 bg-transparent border-b border-transparent focus:border-blue-500 outline-none" />
                        </div>
                        <div class="flex items-center gap-1.5">
                            <button data-save-bank-id="${acc.id}" class="text-blue-600 hover:text-blue-700 font-semibold text-[11px] px-1 cursor-pointer">Save</button>
                            <button data-del-bank-id="${acc.id}" class="text-slate-400 hover:text-red-500 p-1 cursor-pointer">
                                <i data-lucide="trash-2" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="flex justify-end">
                <button type="button" id="btn-close-banks" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs cursor-pointer transition-all">Close Panel</button>
            </div>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-close-banks').addEventListener('click', closeModal);

        // Submit form
        document.getElementById('add-bank-inline-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-bank-name').value;
            const number = document.getElementById('new-bank-num').value;

            showActionSpinner(true);
            try {
                const { error } = await supabase
                    .from('bank_accounts')
                    .insert({ user_id: currentUser.id, bank_name: name, account_number: number });
                if (error) throw error;
                
                closeModal();
                await reFetchAndRenderCurrentView();
            } catch (err) {
                alert("Failed to insert: " + err.message);
            } finally {
                showActionSpinner(false);
            }
        });

        // Inline saving
        accounts.forEach(acc => {
            const saveBtn = document.querySelector(`[data-save-bank-id="${acc.id}"]`);
            saveBtn.style.display = 'none';

            const nameInput = document.getElementById(`edit-bname-${acc.id}`);
            const numInput = document.getElementById(`edit-bnum-${acc.id}`);

            const onChange = () => { saveBtn.style.display = 'inline-block'; };
            nameInput.addEventListener('input', onChange);
            numInput.addEventListener('input', onChange);

            saveBtn.addEventListener('click', async () => {
                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('bank_accounts')
                        .update({ bank_name: nameInput.value, account_number: numInput.value })
                        .eq('id', acc.id);
                    if (error) throw error;
                    
                    closeModal();
                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Update failed: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
            });
        });

        // Delete bank
        document.querySelectorAll('[data-del-bank-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-del-bank-id');
                if (confirm("Deleting this bank account will cascade delete all monthly balance logs associated with it. Continue?")) {
                    showActionSpinner(true);
                    try {
                        const { error } = await supabase
                            .from('bank_accounts')
                            .delete()
                            .eq('id', id);
                        if (error) throw error;
                        
                        closeModal();
                        await reFetchAndRenderCurrentView();
                    } catch (err) {
                        alert("Delete failed: " + err.message);
                    } finally {
                        showActionSpinner(false);
                    }
                }
            });
        });
    });
}
