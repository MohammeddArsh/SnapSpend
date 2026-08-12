import { supabase } from './supabase.js';
import { currentUser, reFetchAndRenderCurrentView, showModal, closeModal, showActionSpinner } from './app.js';
import { formatCurrency, escapeHTML } from './utils.js';
import { createThemedDropdown } from './dropdown.js';

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        // --- 1. DATA RE-FETCH PHASE — Fetch in parallel ---
        const [
            { data: sources, error: sErr },
            { data: entries, error: eErr }
        ] = await Promise.all([
            // A. Fetch Income Sources
            supabase.from('income_sources').select('*')
                .eq('user_id', currentUser.id).order('name', { ascending: true }),
            // B. Fetch Income Entries for selected month
            supabase.from('income_entries').select(`
                id,
                amount,
                date_credited,
                note,
                source_id,
                income_sources (name)
            `).eq('user_id', currentUser.id).eq('month', selectedMonth)
              .order('date_credited', { ascending: false })
        ]);

        if (sErr) throw sErr;
        if (eErr) throw eErr;

        const totalIncome = entries.reduce((sum, item) => sum + parseFloat(item.amount), 0);

        // --- 2. RENDER MAIN INTERACTIVE LAYOUT ---
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Header Actions -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <span class="text-[11px] uppercase font-black text-brand-600 dark:text-brand-400 tracking-widest">Monthly Credit Tracking</span>
                        <h2 class="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">Income Log</h2>
                    </div>
                    <div class="flex items-center gap-2">
                        <button id="btn-manage-sources" class="px-3.5 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer">
                            <i data-lucide="settings" class="w-3.5 h-3.5"></i> Manage Sources
                        </button>
                        <button id="btn-add-income" class="px-4 py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-500/25 cursor-pointer">
                            <i data-lucide="plus" class="w-4 h-4"></i> Add Entry
                        </button>
                    </div>
                </div>

                <!-- Monthly Total banner -->
                <div class="relative overflow-hidden rounded-3xl bg-brand-gradient-soft dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 select-none">
                    <div class="glow-orb w-40 h-40 bg-brand-400/20 -top-20 -right-10"></div>
                    <div class="flex items-center gap-3">
                        <div class="bg-white dark:bg-slate-900/60 p-2.5 rounded-xl text-brand-600 dark:text-brand-400 shadow-sm">
                            <i data-lucide="arrow-up-right" class="w-5 h-5"></i>
                        </div>
                        <div>
                            <span class="text-[11px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Monthly Income Aggregation</span>
                            <div class="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Total credited funds in base currency (EUR)</div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right relative z-10">
                        <span class="text-[11px] text-slate-400 dark:text-slate-500 font-medium leading-none block">Total Recorded</span>
                        <span class="text-2xl font-mono font-bold text-slate-950 dark:text-white tabular">${formatCurrency(totalIncome)}</span>
                    </div>
                </div>

                <!-- Entries List -->
                <div class="bento-card overflow-hidden">
                    <div class="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
                        <span class="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider">Income Entries</span>
                        <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">Newest First</span>
                    </div>
                    <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                                <th class="p-4">Source</th>
                                <th class="p-4">Amount</th>
                                <th class="p-4 hidden sm:table-cell">Date Credited</th>
                                <th class="p-4 hidden md:table-cell">Note</th>
                                <th class="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800 text-[13px]">
                             ${entries.length === 0 ? `
                                 <tr>
                                     <td colspan="5" class="p-10 text-center">
                                         <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                                             <i data-lucide="inbox" class="w-6 h-6"></i>
                                         </div>
                                         <p class="font-medium text-slate-500 dark:text-slate-400 text-sm">No income records entered for this month.</p>
                                         <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Get started by clicking <b>'Add Entry'</b> above to log your first income payout.</p>
                                     </td>
                                 </tr>
                            ` : entries.map(entry => `
                                <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-all">
                                    <td class="p-4 font-semibold text-slate-800 dark:text-slate-200">
                                        ${escapeHTML(entry.income_sources?.name || 'Unassigned Source')}
                                        <span class="block sm:hidden text-[11px] font-mono text-slate-400 dark:text-slate-500 leading-none mt-1">${entry.date_credited}</span>
                                    </td>
                                    <td class="p-4 font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular">${formatCurrency(entry.amount)}</td>
                                    <td class="p-4 font-mono text-slate-500 dark:text-slate-400 hidden sm:table-cell tabular">${entry.date_credited}</td>
                                    <td class="p-4 text-slate-400 dark:text-slate-500 hidden md:table-cell max-w-[200px] truncate" title="${escapeHTML(entry.note || '')}">${escapeHTML(entry.note || '—')}</td>
                                    <td class="p-4 text-right">
                                        <div class="inline-flex items-center gap-1">
                                            <button data-edit-id="${entry.id}" class="p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all">
                                                <i data-lucide="edit-2" class="w-5 h-5"></i>
                                            </button>
                                            <button data-delete-id="${entry.id}" class="p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all">
                                                <i data-lucide="trash-2" class="w-5 h-5"></i>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    </div>
                </div>
            </div>
        `;

        // Register button actions
        setupIncomeListeners(sources, entries, selectedMonth);

        // Check for global prefilled voice transactions
        if (window.prefilledVoiceTransaction && window.prefilledVoiceTransaction.type === 'income') {
            const voiceData = window.prefilledVoiceTransaction;
            window.prefilledVoiceTransaction = null; // Clear immediately

            // Only match a dictated source name when one was actually provided;
            // otherwise fall back to the first source instead of an empty match.
            const dictatedSource = (voiceData.category_name || '').trim().toLowerCase();
            const matchingSrc = dictatedSource
                ? (sources.find(s => s.name.toLowerCase().includes(dictatedSource)) || sources[0])
                : (sources[0] || null);
            const prefilledEntry = {
                amount: voiceData.amount,
                note: voiceData.note,
                date_credited: voiceData.date,
                source_id: matchingSrc ? matchingSrc.id : null
            };
            setTimeout(() => openEntryModal(prefilledEntry, sources, selectedMonth), 100);
        }

    } catch (e) {
        console.error("Income view render error:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render income view: ${escapeHTML(e.message)}</p>`;
    }
}

/**
 * Event bindings of income module
 */
function setupIncomeListeners(sources, entries, selectedMonth) {
    // 1. ADD ENTRY MODAL
    document.getElementById('btn-add-income').addEventListener('click', () => {
        openEntryModal(null, sources, selectedMonth);
    });

    // 2. MANAGE SOURCES MODAL
    document.getElementById('btn-manage-sources').addEventListener('click', () => {
        openSourcesModal(sources);
    });

    // 3. EDIT OR DELETE BINDINGS
    document.querySelectorAll('[data-edit-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-edit-id');
            const entry = entries.find(e => e.id === id);
            if (entry) openEntryModal(entry, sources, selectedMonth);
        });
    });

    document.querySelectorAll('[data-delete-id]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.getAttribute('data-delete-id');
            if (confirm("Are you sure you want to permanently delete this income entry?")) {
                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('income_entries')
                        .delete()
                        .eq('id', id);
                    if (error) throw error;
                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Delete failed: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
            }
        });
    });
}

/**
 * Add / Edit Income Entry Modal Overlay
 */
function openEntryModal(entry, sources, selectedMonth) {
    const isEdit = !!entry;
    
    // Choose selected option for dropdown
    const sourceOptions = sources.map(src => ({ value: src.id, label: src.name }));
    const defaultSourceId = isEdit ? entry.source_id : (sources.length > 0 ? String(sources[0].id) : '');

    const defaultDate = isEdit ? entry.date_credited : `${selectedMonth}-01`;

    const html = `
        <div class="p-1">
            <div class="flex items-center gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="${isEdit ? 'edit-3' : 'plus-circle'}" class="w-4 h-4"></i>
                </span>
                <div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">${isEdit ? 'Modify' : 'Log'} Income</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Ensure values match your bank statement credits.</p>
                </div>
            </div>

            <form id="income-entry-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Source</label>
                    <div id="entry-source-wrap"></div>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Credited Date</label>
                    <input type="date" id="entry-date" required value="${defaultDate}" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Amount (€)</label>
                    <input type="number" id="entry-amount" required value="${isEdit ? entry.amount : ''}" min="0.01" step="0.01" placeholder="Enter amount" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Note (Optional)</label>
                    <input type="text" id="entry-note" value="${isEdit ? escapeHTML(entry.note || '') : ''}" placeholder="E.g., Client payout, side job salary" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-modal" class="py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">Cancel</button>
                    <button type="submit" class="py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> Save Record
                    </button>
                </div>
            </form>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);

        const sourceDropdown = createThemedDropdown({
            options: sourceOptions,
            value: defaultSourceId,
            placeholder: 'Select a source…',
            required: true,
        });
        document.getElementById('entry-source-wrap').appendChild(sourceDropdown.el);

        document.getElementById('income-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const sourceId = sourceDropdown.getValue();
            const date = document.getElementById('entry-date').value;
            const amount = parseFloat(document.getElementById('entry-amount').value);
            const note = document.getElementById('entry-note').value;

            if (!sourceId) {
                sourceDropdown.setError(true);
                alert("Please select an income source.");
                return;
            }
            if (isNaN(amount) || amount <= 0) {
                alert("Please enter a valid amount greater than zero.");
                return;
            }

            // Automatically extract YYYY-MM from credit date to maintain index query speed
            const entryMonth = date.substring(0, 7);
            if (entryMonth !== selectedMonth) {
                const proceed = confirm(`The date entered (${date}) is in a different month than the active view (${selectedMonth}). Do you wish to save it anyway?`);
                if (!proceed) return;
            }

            showActionSpinner(true);
            try {
                if (isEdit) {
                    const { error } = await supabase
                        .from('income_entries')
                        .update({
                            source_id: sourceId,
                            amount,
                            date_credited: date,
                            note,
                            month: entryMonth
                        })
                        .eq('id', entry.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase
                        .from('income_entries')
                        .insert({
                            user_id: currentUser.id,
                            source_id: sourceId,
                            amount,
                            date_credited: date,
                            note,
                            month: entryMonth
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

        if (window.lucide) window.lucide.createIcons();
    });
}

/**
 * Manage Income Sources (CRUD modal lists)
 */
function openSourcesModal(sources) {
    const html = `
        <div class="p-1">
            <div class="flex items-center gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="settings" class="w-4 h-4"></i>
                </span>
                <div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">Income Sources</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Define or modify categories used in your monthly logging.</p>
                </div>
            </div>

            <!-- Inline source creator -->
            <form id="add-source-inline-form" class="flex gap-2 mb-4">
                <input type="text" id="new-source-name" required placeholder="Add source (e.g. Consulting, Freelance)" class="grow px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                <button type="submit" class="bg-brand-gradient hover:brightness-110 text-white rounded-xl px-4 py-2 text-xs font-semibold shadow-md shadow-indigo-500/25 cursor-pointer">Add</button>
            </form>

            <div class="max-h-[250px] overflow-y-auto mb-5 border border-slate-100 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 scrollbar-thin">
                ${sources.length === 0 ? `
                    <p class="p-4 text-center text-slate-400 dark:text-slate-500 text-xs">No custom sources available.</p>
                ` : sources.map(src => `
                    <div class="flex items-center justify-between p-3 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all text-[13px] gap-2">
                        <input type="text" value="${escapeHTML(src.name)}" data-source-id="${src.id}" class="font-medium text-slate-800 dark:text-slate-200 bg-transparent border-b border-transparent focus:border-brand-500 outline-none pb-0.5 min-w-0 flex-1 w-full" />
                        <div class="flex items-center gap-1.5 shrink-0">
                            <button data-save-source-id="${src.id}" class="text-brand-600 dark:text-brand-400 hover:text-brand-700 font-semibold text-[11px] h-9 px-2 rounded-lg cursor-pointer hide">Save</button>
                            <button data-del-source-id="${src.id}" class="text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 p-1.5 cursor-pointer transition-all">
                                <i data-lucide="trash" class="w-4 h-4"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="flex justify-end">
                <button type="button" id="btn-close-sources-modal" class="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium rounded-xl text-xs cursor-pointer transition-all">Close Panel</button>
            </div>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-close-sources-modal').addEventListener('click', closeModal);

        // Bind Inline Creator
        document.getElementById('add-source-inline-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('new-source-name').value;
            
            showActionSpinner(true);
            try {
                const { error } = await supabase
                    .from('income_sources')
                    .insert({ user_id: currentUser.id, name });
                if (error) throw error;
                
                // Refresh modal state
                closeModal();
                await reFetchAndRenderCurrentView();
            } catch (err) {
                alert("Failed to add source: " + err.message);
            } finally {
                showActionSpinner(false);
            }
        });

        // Save inline edit tracking
        document.querySelectorAll('input[data-source-id]').forEach(input => {
            const id = input.getAttribute('data-source-id');
            const saveBtn = document.querySelector(`[data-save-source-id="${id}"]`);
            
            saveBtn.style.display = 'none';

            input.addEventListener('input', () => {
                saveBtn.style.display = 'inline-block';
            });

            saveBtn.addEventListener('click', async () => {
                const name = input.value;
                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('income_sources')
                        .update({ name })
                        .eq('id', id);
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

        // Delete source
        document.querySelectorAll('[data-del-source-id]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.getAttribute('data-del-source-id');
                if (confirm("Deleting this source will automatically delete all income entries logged under it. Continue?")) {
                    showActionSpinner(true);
                    try {
                        const { error } = await supabase
                            .from('income_sources')
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
