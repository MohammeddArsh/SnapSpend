import { supabase } from './supabase.js';
import { currentUser, reFetchAndRenderCurrentView, showModal, closeModal, showActionSpinner } from './app.js';
import { formatCurrency, escapeHTML } from './utils.js';
import { NaiveBayesClassifier, classifyExpense, normalizeMerchantName } from './classifier.js';
import { parseReceiptDirectly } from './parserEngine.js';

/**
 * Safely parses an expense note into clean merchant name and any embedded itemized data.
 * @param {string} note 
 * @returns {{ merchant: string, itemizedData: Array }}
 */
function parseExpenseNote(note) {
    if (!note) return { merchant: '', itemizedData: [] };
    const trimmed = String(note).trim();

    if (trimmed.includes('[ITEMIZED:')) {
        const match = trimmed.match(/^([\s\S]*?)\s*\[ITEMIZED:([\s\S]*)\]$/);
        if (match) {
            const cleanMerchant = match[1].trim() || 'Store Receipt';
            try {
                const parsed = JSON.parse(match[2]);
                return {
                    merchant: cleanMerchant,
                    itemizedData: Array.isArray(parsed) ? parsed : []
                };
            } catch (e) {
                console.warn("Failed to parse embedded itemized JSON:", e);
                return { merchant: cleanMerchant, itemizedData: [] };
            }
        }
    }

    return { merchant: trimmed, itemizedData: [] };
}

/**
 * Helper to safely extract a store name without depending on `note`.
 */
function cleanNote(note) {
    if (!note) return 'General Purchase';
    if (typeof parseExpenseNote === 'function') {
        const parsed = parseExpenseNote(note);
        return parsed?.merchant || note;
    }
    return note;
}

/**
 * Gets receipt items for an entry following priority:
 * 1. DB expense_receipt_items
 * 2. Parsed raw_json.items
 */
function getReceiptItemsForEntry(entry) {
    if (!entry) return [];

    // Priority 1: Direct DB expense_receipt_items relationship
    if (Array.isArray(entry.expense_receipt_items) && entry.expense_receipt_items.length > 0) {
        return entry.expense_receipt_items;
    }

    // Priority 2: Parsed items inside raw_json (handles stringified JSON)
    if (entry.raw_json) {
        let rawObj = entry.raw_json;
        if (typeof rawObj === 'string') {
            try { rawObj = JSON.parse(rawObj); } catch (e) { rawObj = null; }
        }
        if (rawObj && Array.isArray(rawObj.items) && rawObj.items.length > 0) {
            return rawObj.items.map((it, idx) => ({
                id: it.id || `raw-${entry.id}-${idx}`,
                expense_id: entry.id,
                item_name: it.item_name || it.name || 'Item',
                quantity: parseFloat(it.quantity) || 1,
                unit_price: parseFloat(it.unit_price) || (parseFloat(it.price) / (parseFloat(it.quantity) || 1)),
                price: parseFloat(it.price) || 0,
                category: it.category || 'General'
            }));
        }
    }

    return [];
}

/**
 * Flattens parent expense entries into display rows.
 */
function flattenExpenseEntries(entries, categories) {
    const rows = [];

    (entries || []).forEach(e => {
        // 1. Parse raw_json safely in case it's a JSON string from Supabase
        let rawObj = e.raw_json;
        if (typeof rawObj === 'string') {
            try { rawObj = JSON.parse(rawObj); } catch (err) { rawObj = null; }
        }

        // 2. Resolve store name safely
        let storeName = e.merchant;
        if ((!storeName || !storeName.trim()) && rawObj) {
            storeName = rawObj.merchant || rawObj.vendor;
        }
        storeName = (storeName && typeof storeName === 'string' && storeName.trim()) 
            ? storeName.trim() 
            : 'General Purchase';

        // 3. Resolve line items using helper
        const items = getReceiptItemsForEntry(e);

        // 4. Build flattened display rows
        if (items && items.length > 0) {
            items.forEach(item => {
                const itemName = item.item_name || item.name || 'Item';
                const catName = item.category || 'General';
                const matchedCat = (categories || []).find(c => c.name.toLowerCase() === catName.toLowerCase());
                const catId = matchedCat ? matchedCat.id : null;
                const qty = typeof item.quantity === 'number' && item.quantity > 0 ? item.quantity : 1;
                
                const qtyPrefix = qty > 1 ? `${itemName} (×${qty})` : itemName;
                const displayNote = `${qtyPrefix} — ${storeName}`;

                rows.push({
                    isItem: true,
                    itemId: item.id || null,
                    expenseId: e.id,
                    date: e.date,
                    merchant: storeName,
                    itemName: itemName,
                    quantity: qty,
                    displayNote: displayNote,
                    amount: parseFloat(item.price || 0),
                    categoryName: catName,
                    categoryId: catId,
                    rawItem: item,
                    rawParent: e
                });
            });
        } else {
            rows.push({
                isItem: false,
                itemId: null,
                expenseId: e.id,
                date: e.date,
                merchant: storeName,
                itemName: storeName,
                quantity: 1,
                displayNote: storeName,
                amount: parseFloat(e.amount || 0),
                categoryName: 'General',
                categoryId: null,
                rawParent: e
            });
        }
    });

    return rows;
}

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        // --- 1. DATA RE-FETCH PHASE ---
        const [
            { data: categories, error: cErr },
            { data: rawEntries, error: eErr },
            { data: trainingData }
        ] = await Promise.all([
            supabase
                .from('expense_categories')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('name', { ascending: true }),
            supabase
                .from('expense_entries')
                .select(`
                    id,
                    amount,
                    date,
                    merchant, 
                    raw_json, 
                    category_id,
                    expense_categories (name)
                `)
                .eq('user_id', currentUser.id)
                .eq('month', selectedMonth)
                .order('date', { ascending: false }),
            supabase
                .from('expense_entries')
                .select('note, category_id, amount')
                .eq('user_id', currentUser.id)
                .order('date', { ascending: false })
                .limit(200)
        ]);

        let entries = rawEntries || [];
        if (entries.length > 0) {
            const entryIds = entries.map(e => e.id);
            try {
                const { data: directItems, error: dErr } = await supabase
                    .from('expense_receipt_items')
                    .select('id, expense_id, item_name, quantity, unit_price, price, category, confidence')
                    .in('expense_id', entryIds);

                if (!dErr && directItems) {
                    entries.forEach(e => {
                        const matched = directItems.filter(it => it.expense_id === e.id);
                        if (matched.length > 0) {
                            e.expense_receipt_items = matched;
                        }
                    });
                }
            } catch (tblErr) {
                console.warn("[SnapSpend Notice] Querying expense_receipt_items table notice:", tblErr.message);
            }

            // Guarantee items are attached following priority: DB table -> Legacy Note metadata -> Normal note
            entries.forEach(e => {
                e.expense_receipt_items = getReceiptItemsForEntry(e);
            });
        }
        if (cErr) throw cErr;

        console.log("[SnapSpend Debug] Final processed entries:", entries);

        const displayRows = flattenExpenseEntries(entries, categories);
        const totalExpenses = entries.reduce((sum, item) => sum + parseFloat(item.amount), 0);

        // Train Naive Bayes Categorizer on historical transactions
        const classifier = new NaiveBayesClassifier();
        if (trainingData) {
            trainingData.forEach(e => {
                if (e.note && e.category_id) {
                    classifier.train(e.note, e.category_id);
                }
            });
        }

        // --- 2. RENDER THE INTERACTIVE WORKSPACE ---
        container.innerHTML = `
            <div class="space-y-6">
                <!-- Header Actions -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <span class="text-xs uppercase font-semibold text-emerald-600 tracking-wider">MONTHLY EXPENSES LOG</span>
                        <h2 class="text-2xl font-bold tracking-tight text-slate-900">Expenses</h2>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button id="btn-manage-exp-categories" class="px-3 py-2 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer">
                            <i data-lucide="settings" class="w-3.5 h-3.5"></i> Categories
                        </button>
                        <button id="btn-import-csv" class="px-3 py-2 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer">
                            <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i> Import CSV
                        </button>
                        <button id="btn-add-expense" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-emerald-500/15 cursor-pointer">
                            <i data-lucide="plus" class="w-4 h-4"></i> Add Entry
                        </button>
                    </div>
                </div>

                <!-- Monthly Total banner -->
                <div class="bento-card p-5 bg-gradient-to-r from-emerald-50 to-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-l-4 border-l-emerald-500 select-none">
                    <div class="flex items-center gap-3">
                        <div class="bg-emerald-100/80 p-2.5 rounded-xl text-emerald-600">
                            <i data-lucide="arrow-down-left" class="w-5 h-5"></i>
                        </div>
                        <div>
                            <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Monthly Expenditure</span>
                            <div class="text-xs text-slate-650">Sum of cash outflows in selected month</div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right">
                        <span class="text-[10px] text-slate-405 font-medium leading-none block">Aggregate Expenses</span>
                        <span class="text-xl font-mono font-bold text-slate-950">${formatCurrency(totalExpenses)}</span>
                    </div>
                </div>

                <!-- Live Search & Filtering bar -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="relative sm:col-span-2">
                        <input type="text" id="expense-search" placeholder="Search keywords..." class="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 outline-none rounded-xl focus:border-emerald-500 text-xs text-slate-800" />
                        <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <i data-lucide="search" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div>
                        <select id="expense-filter-cat" class="w-full px-3 py-2 bg-white border border-slate-200 outline-none rounded-xl focus:border-emerald-500 text-xs text-slate-700 font-medium font-sans">
                            <option value="ALL">All Categories</option>
                            ${categories.map(c => `<option value="${c.id}">${escapeHTML(c.name)}</option>`).join('')}
                        </select>
                    </div>
                </div>

                <!-- Category Filter Pill Bar -->
<div class="space-y-2 select-none my-3">
    <div class="flex items-center justify-between">
        <label class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Filter by Category</label>
        <span id="active-filter-label" class="text-[10px] text-slate-400 font-medium">Showing: All</span>
    </div>
    
    <div class="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-200">
        <!-- 'All' Reset Button -->
        <button type="button" 
                data-category-filter="all" 
                class="category-filter-btn active px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border bg-emerald-600 border-emerald-600 text-white shadow-sm cursor-pointer flex items-center gap-1.5">
            <span>All Categories</span>
            <span class="px-1.5 py-0.2 text-[10px] bg-white/20 text-white rounded-full font-mono">${displayRows.length}</span>
        </button>

        <!-- Dynamic Category Filter Buttons -->
        ${categories.map(cat => {
            const count = displayRows.filter(r => 
                r.categoryId === cat.id || 
                (r.categoryName && r.categoryName.toLowerCase() === cat.name.toLowerCase())
            ).length;

            return `
                <button type="button" 
                        data-category-filter="${escapeHTML(cat.name)}" 
                        data-category-id="${cat.id}"
                        class="category-filter-btn px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border bg-slate-100/80 border-slate-200 text-slate-600 hover:bg-slate-200/60 hover:text-slate-800 cursor-pointer flex items-center gap-1.5">
                    <span>${escapeHTML(cat.name)}</span>
                    <span class="px-1.5 py-0.2 text-[10px] bg-slate-200/80 text-slate-500 rounded-full font-mono">${count}</span>
                </button>
            `;
        }).join('')}
    </div>
</div>
                </div                
                <!-- Primary Newest-First Expense Table List -->
<div class="bento-card overflow-hidden">
    <div class="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
        <span class="text-xs font-bold text-slate-700 uppercase tracking-wider">Historical Debit Entries</span>
        <span class="text-[10px] font-mono text-slate-400">Listed Newest First • Click Row to Expand Items</span>
    </div>
    <table class="w-full text-left border-collapse text-xs" id="expense-main-table">
        <thead>
            <tr class="bg-slate-50/80 border-b border-slate-100 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                <th class="p-3.5 pl-4">Merchant / Store</th>
                <th class="p-3.5 w-28">Amount</th>
                <th class="p-3.5 w-28 hidden sm:table-cell">Date</th>
                <th class="p-3.5 w-32 hidden md:table-cell">Items</th>
                <th class="p-3.5 w-24 text-right pr-4">Actions</th>
            </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 text-xs">
            ${entries.length === 0 ? `
                <tr>
                    <td colspan="5" class="p-8 text-center text-slate-400">
                        <i data-lucide="inbox" class="w-8 h-8 opacity-40 mx-auto mb-2"></i>
                        <p class="font-medium text-slate-500 text-xs">No expense entries logged for this month.</p>
                        <p class="text-[10px] text-slate-400 mt-1">Click <b>'Add Entry'</b> to record your first expense or <b>'Scan Receipt'</b> to auto-parse.</p>
                    </td>
                </tr>
            ` : entries.map(entry => {
                // Safe formatting helpers
                const safeFormat = typeof formatCurrency === 'function' ? formatCurrency : (val) => '€' + (parseFloat(val) || 0).toFixed(2);
                const safeEscape = typeof escapeHTML === 'function' ? escapeHTML : (val) => String(val || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                // 1. Safely parse raw_json if string
                let rawObj = entry.raw_json;
                if (typeof rawObj === 'string') {
                    try { rawObj = JSON.parse(rawObj); } catch (e) { rawObj = null; }
                }

                // 2. Resolve items with DB table priority over raw_json
                const dbItems = Array.isArray(entry.expense_receipt_items) ? entry.expense_receipt_items : [];
                const helperItems = (typeof getReceiptItemsForEntry === 'function') ? getReceiptItemsForEntry(entry) : [];
                const jsonItems = (rawObj && Array.isArray(rawObj.items)) ? rawObj.items : [];
                
                const items = dbItems.length > 0 ? dbItems : (helperItems.length > 0 ? helperItems : jsonItems);
                const hasItems = items.length > 0;

                // 3. Resolve Merchant Name safely
                let merchantName = entry.merchant;
                if ((!merchantName || !merchantName.trim()) && rawObj) {
                    merchantName = rawObj.merchant || rawObj.vendor;
                }
                merchantName = (merchantName && typeof merchantName === 'string' && merchantName.trim()) 
                    ? merchantName.trim() 
                    : 'General Purchase';

                // 4. Source type check (Scanned vs Manual)
                const isScanned = entry.entry_type === 'scanned' || !!rawObj;

                const noteText = merchantName.toLowerCase();
                const itemKeywords = hasItems 
                    ? items.map(i => `${i.item_name || i.name || i[0] || ''}`).join(' ').toLowerCase() 
                    : '';

                return `
                    <!-- Primary Row -->
                    <tr class="hover:bg-slate-50/70 transition-all expense-row-element cursor-pointer select-none"
                        data-entry-type="${isScanned ? 'scanned' : 'manual'}"
                        data-text-note="${safeEscape((noteText + ' ' + itemKeywords).toLowerCase())}"
                        data-text-amount="${entry.amount || 0}"
                        data-toggle-receipt="${entry.id}">
                        
                        <!-- 1. Merchant / Store -->
                        <td class="p-3.5 pl-4 font-semibold text-slate-800">
                            <div class="flex items-center gap-2">
                                <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0" data-chevron-id="${entry.id}"></i>
                                <span class="font-bold text-slate-900">${safeEscape(merchantName)}</span>
                            </div>
                            <div class="pl-6 mt-1 flex items-center gap-1.5">
                                ${isScanned ? `
                                    <span class="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200/60 inline-flex items-center gap-1">
                                        <i data-lucide="sparkles" class="w-2.5 h-2.5"></i> Scanned
                                    </span>
                                ` : `
                                    <span class="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200 inline-flex items-center gap-1">
                                        <i data-lucide="pen-tool" class="w-2.5 h-2.5"></i> Manual
                                    </span>
                                `}
                            </div>
                        </td>

                        <!-- 2. Amount -->
                        <td class="p-3.5 font-mono font-bold text-rose-600">
                            ${safeFormat(entry.amount)}
                        </td>

                        <!-- 3. Date -->
                        <td class="p-3.5 font-mono text-slate-500 hidden sm:table-cell">
                            ${safeEscape(entry.date)}
                        </td>

                        <!-- 4. Items Badge -->
                        <td class="p-3.5 hidden md:table-cell">
                            ${hasItems ? `
                                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-semibold border border-emerald-200/80">
                                    <i data-lucide="receipt" class="w-3 h-3 text-emerald-500"></i> ${items.length} item${items.length > 1 ? 's' : ''}
                                </span>
                            ` : `
                                <span class="inline-flex items-center px-2.5 py-0.5 bg-slate-100 text-slate-500 rounded-full text-[10px] font-medium border border-slate-200">
                                    Single Entry
                                </span>
                            `}
                        </td>

                        <!-- 5. Actions -->
                        <td class="p-3.5 text-right pr-4">
                            <div class="inline-flex items-center gap-1">
                                <button data-edit-expense-id="${entry.id}" class="p-1.5 text-slate-400 hover:text-emerald-600 rounded hover:bg-slate-100 cursor-pointer" title="Edit Expense">
                                    <i data-lucide="edit-2" class="w-3.5 h-3.5"></i>
                                </button>
                                <button data-delete-expense-id="${entry.id}" class="p-1.5 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 cursor-pointer" title="Delete Expense">
                                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                                </button>
                            </div>
                        </td>
                    </tr>

                    <!-- Collapsible Itemized Receipt Drawer -->
                    <tr id="receipt-details-${entry.id}" class="hidden bg-slate-50/80 border-b border-slate-200 transition-all">
                        <td colspan="5" class="p-3 sm:p-4 pl-6 sm:pl-10">
                            <div class="bg-white p-3.5 rounded-xl border border-slate-200/90 shadow-sm space-y-2.5">
                                <div class="flex items-center justify-between border-b border-slate-100 pb-2">
                                    <div class="flex items-center gap-2">
                                        <div class="p-1.5 bg-emerald-100/70 text-emerald-600 rounded-lg">
                                            <i data-lucide="receipt" class="w-3.5 h-3.5"></i>
                                        </div>
                                        <span class="text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                                            Receipt Breakdown (${items.length})
                                        </span>
                                    </div>
                                    <span class="text-xs font-mono font-bold text-slate-800">
                                        Receipt Total: ${formatCurrency(entry.amount)}
                                    </span>
                                </div>
                                ${hasItems ? `
                                    <div class="overflow-x-auto">
                                        <table class="w-full text-left text-xs">
                                            <thead>
                                                <tr class="text-[9.5px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100 bg-slate-50/50">
                                                    <th class="py-2 px-3">Item Description</th>
                                                    <th class="py-2 px-2 w-16 text-center">Qty</th>
                                                    <th class="py-2 px-3 w-24 text-right">Price</th>
                                                    <th class="py-2 px-3 w-36">Category</th>
                                                    <th class="py-2 px-3 w-16 text-right">Actions</th>
                                                </tr>
                                            </thead>
                                            <tbody class="divide-y divide-slate-100">
                                                ${items.map(item => {
                                                    const itemName = item.item_name || item.name || item[0] || 'Item';
                                                    const itemQty = item.quantity || item[1] || 1;
                                                    const itemPrice = item.price || item[2] || 0;
                                                    const itemCat = item.category || item[4] || 'Other';
                                                    const itemId = item.id || '';

                                                    return `
                                                        <tr class="hover:bg-slate-50/60 transition-all font-sans">
                                                            <td class="py-2 px-3 font-medium text-slate-800">${escapeHTML(itemName)}</td>
                                                            <td class="py-2 px-2 font-mono text-center text-slate-600">
                                                                ${itemQty > 1 ? `<span class="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-semibold text-slate-700">×${itemQty}</span>` : '1'}
                                                            </td>
                                                            <td class="py-2 px-3 font-mono text-right font-bold text-rose-600">${formatCurrency(itemPrice)}</td>
                                                            <td class="py-2 px-3">
                                                                <span class="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200/60 rounded-full text-[10px] font-medium">
                                                                    ${escapeHTML(itemCat)}
                                                                </span>
                                                            </td>
                                                            <td class="py-2 px-3 text-right">
                                                                <div class="inline-flex items-center gap-1">
                                                                    <button data-edit-receipt-item-id="${itemId}" data-parent-expense-id="${entry.id}" class="p-1 text-slate-400 hover:text-emerald-600 rounded hover:bg-slate-100 cursor-pointer" title="Edit Item">
                                                                        <i data-lucide="edit-2" class="w-3 h-3"></i>
                                                                    </button>
                                                                    <button data-delete-receipt-item-id="${itemId}" data-parent-expense-id="${entry.id}" class="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 cursor-pointer" title="Delete Item">
                                                                        <i data-lucide="trash-2" class="w-3 h-3"></i>
                                                                    </button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    `;
                                                }).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                ` : `
                                    <div class="py-3 px-4 text-center text-slate-500 text-xs italic bg-slate-50 rounded-lg border border-slate-100">
                                        No itemized receipt line items saved for this transaction.
                                    </div>
                                `}
                            </div>
                        </td>
                    </tr>
                `;
            }).join('')}
        </tbody>
    </table>
</div>
        `;

        setupExpensesListeners(categories, entries, selectedMonth, classifier, trainingData);
        if (window.lucide) window.lucide.createIcons();

        // Check for global prefilled voice transactions
        if (window.prefilledVoiceTransaction && window.prefilledVoiceTransaction.type === 'expense') {
            const voiceData = window.prefilledVoiceTransaction;
            window.prefilledVoiceTransaction = null; // Clear immediately

            const matchingCat = categories.find(c => c.name.toLowerCase().includes(voiceData.category_name?.toLowerCase() || '')) || categories[0];
            const prefilledEntry = {
                amount: voiceData.amount,
                note: voiceData.note,
                date: voiceData.date,
                category_id: matchingCat ? matchingCat.id : null
            };
            setTimeout(() => openExpenseModal(prefilledEntry, categories, selectedMonth, classifier, trainingData), 100);
        }

    } catch (e) {
        console.error("Expenses view render failure:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render expenses content: ${e.message}</p>`;
    }
}

/**
 * Event triggers of expense list and breakdown drawers
 */

function setupExpensesListeners(categories, entries, selectedMonth, classifier, trainingData) {
    // 1. ADD MODAL TRIGGER
    document.getElementById('btn-add-expense').addEventListener('click', () => {
        openExpenseModal(null, categories, selectedMonth, classifier, trainingData);
    });

    // 2. MANAGE CATEGORIES TRIGGER
    document.getElementById('btn-manage-exp-categories').addEventListener('click', () => {
        openCategoriesModal(categories);
    });

    // 3. SECURE FILE CSV IMPORTER
    document.getElementById('btn-import-csv').addEventListener('click', () => {
        openCsvImportModal(categories, selectedMonth);
    });

    // 4. COLLAPSED DRAWER ACCORDIONS
    document.querySelectorAll('[data-collapse-trigger]').forEach(div => {
        div.addEventListener('click', (e) => {
            // Stop if they clicked edit/delete within collapsed view
            if (e.target.closest('button')) return;

            const id = div.getAttribute('data-collapse-trigger');
            const drawer = document.getElementById(`drawer-${id}`);
            const arrow = document.querySelector(`[data-arrow-id="${id}"]`);

            if (drawer.classList.contains('hidden')) {
                drawer.classList.remove('hidden');
                arrow.classList.add('rotate-90');
            } else {
                drawer.classList.add('hidden');
                arrow.classList.remove('rotate-90');
            }
        });
    });

    // 5. EVENT DELEGATION FOR EXPANDABLE RECEIPT DETAILS SUB-ROWS
    document.addEventListener('click', (e) => {
        // Ignore action buttons (Edit / Delete)
        if (e.target.closest('button')) return;

        // Find parent expense row with data-toggle-receipt attribute
        const row = e.target.closest('[data-toggle-receipt]');
        if (!row) return;

        const expenseId = row.getAttribute('data-toggle-receipt');
        console.log("HISTORICAL ROW CLICKED", expenseId);
        console.log("TOGGLE RECEIPT", expenseId);

        if (!expenseId) return;

        const detailsRow = document.getElementById(`receipt-details-${expenseId}`);
        if (!detailsRow) {
            console.error("DETAIL ROW NOT FOUND", expenseId);
            return;
        }

        const chevron = row.querySelector('[data-chevron-id]') || row.querySelector('.lucide-chevron-right, .lucide-chevron-down, svg, i');

        const isCurrentlyHidden = detailsRow.classList.contains('hidden');
        console.log("Current hidden state of details row:", isCurrentlyHidden);

        if (isCurrentlyHidden) {
            detailsRow.classList.remove('hidden');
            if (chevron) chevron.classList.add('rotate-90');
        } else {
            detailsRow.classList.add('hidden');
            if (chevron) chevron.classList.remove('rotate-90');
        }
    });

    // 6. LIVE SEARCH AND FILTERS CONTROLLER
    const search = document.getElementById('expense-search');
    const filterSelect = document.getElementById('expense-filter-cat');

    const handleSearchFilter = () => {
        const query = search.value.trim().toLowerCase();
        const catTarget = filterSelect.value;
        const selectedCatObj = categories.find(c => c.id === catTarget);
        const catTargetName = selectedCatObj ? selectedCatObj.name.toLowerCase() : '';

        document.querySelectorAll('.expense-row-element').forEach(row => {
            const catId = row.getAttribute('data-cat-id');
            const catName = row.getAttribute('data-cat-name') || '';
            const noteText = row.getAttribute('data-text-note') || '';
            const amtText = row.getAttribute('data-text-amount') || '';

            const matchesSearch = !query || noteText.includes(query) || amtText.includes(query) || catName.includes(query);
            const matchesCat = catTarget === 'ALL' || catId === catTarget || (catTargetName && catName === catTargetName);

            const receiptId = row.getAttribute('data-toggle-receipt');
            const detailsRow = receiptId ? document.getElementById(`receipt-details-${receiptId}`) : null;
            const chevron = receiptId ? document.querySelector(`[data-chevron-id="${receiptId}"]`) : null;

            if (matchesSearch && matchesCat) {
                row.classList.remove('hidden');
                if (query && detailsRow && noteText.includes(query)) {
                    detailsRow.classList.remove('hidden');
                    if (chevron) chevron.classList.add('rotate-90');
                }
            } else {
                row.classList.add('hidden');
                if (detailsRow) detailsRow.classList.add('hidden');
            }
        });
    };

    search.addEventListener('input', handleSearchFilter);
    filterSelect.addEventListener('change', handleSearchFilter);

    // 6. EDIT OR DELETE CRUD TRIGGER HANDLERS
    // Parent expense handlers
    document.querySelectorAll('[data-edit-expense-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-edit-expense-id');
            const entry = entries.find(e => e.id === id);
            openExpenseModal(entry, categories, selectedMonth, classifier, trainingData);
        });
    });

    document.querySelectorAll('[data-delete-expense-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-delete-expense-id');
            if (confirm("Are you sure you want to permanently delete this expense log?")) {
                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('expense_entries')
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

    // Receipt Line Item handlers
    document.querySelectorAll('[data-delete-receipt-item-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const itemId = btn.getAttribute('data-delete-receipt-item-id');
            const parentId = btn.getAttribute('data-parent-expense-id');
            if (confirm("Are you sure you want to delete this line item?")) {
                showActionSpinner(true);
                try {
                    const { error: delErr } = await supabase
                        .from('expense_receipt_items')
                        .delete()
                        .eq('id', itemId);
                    if (delErr) throw delErr;

                    const { data: remaining } = await supabase
                        .from('expense_receipt_items')
                        .select('price')
                        .eq('expense_id', parentId);

                    if (remaining && remaining.length > 0) {
                        const newTotal = remaining.reduce((sum, i) => sum + parseFloat(i.price || 0), 0);
                        await supabase.from('expense_entries').update({ amount: newTotal }).eq('id', parentId);
                    } else {
                        await supabase.from('expense_entries').delete().eq('id', parentId);
                    }

                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Delete failed: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
            }
        });
    });

    document.querySelectorAll('[data-edit-receipt-item-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const itemId = btn.getAttribute('data-edit-receipt-item-id');
            const displayRows = flattenExpenseEntries(entries, categories);
            const rowItem = displayRows.find(r => r.itemId === itemId);
            if (rowItem) {
                openEditSingleItemModal(rowItem, categories, selectedMonth);
            }
        });
    });
}



/**
 * Add / Edit Expense entry modals
 */
function openExpenseModal(entry, categories, selectedMonth, classifier, trainingData) {
    const isEdit = !!entry;
    const catOptionsHTML = categories.map(c => {
        const sel = isEdit && entry.category_id === c.id ? 'selected' : '';
        return `<option value="${c.id}" ${sel}>${escapeHTML(c.name)}</option>`;
    }).join('');

    const defaultDate = isEdit ? entry.date : `${selectedMonth}-01`;

    const html = `
        <div>
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="${isEdit ? 'edit-3' : 'plus-circle'}" class="text-rose-600"></i> ${isEdit ? 'Alter' : 'Record'} Expense
            </h3>
            <p class="text-slate-500 text-xs mb-4">Ensure appropriate categories are tagged to keep financial indicators accurate.</p>

            ${!isEdit ? `
                <!-- Scan Receipt OCR Auto-fill Container -->
                <div class="mb-4 bg-emerald-50/60 border border-emerald-100 rounded-xl p-3 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 text-xs font-semibold text-slate-800">
                            <i data-lucide="scan" class="w-4 h-4 text-emerald-600 shrink-0"></i>
                            <span>Scan Receipt (AI Auto-fill)</span>
                        </div>
                        <button type="button" id="btn-scan-receipt" class="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm">
                            <i data-lucide="camera" class="w-3.5 h-3.5" id="scan-receipt-icon"></i>
                            <span id="scan-receipt-btn-text">Scan Receipt</span>
                        </button>
                        <input type="file" id="scan-receipt-file-input" accept="image/png, image/jpeg, image/jpg, image/webp" class="hidden" />
                    </div>
                    <div id="ocr-status-box" class="hidden text-[11px] p-2 rounded-lg font-medium transition-all"></div>
                </div>
            ` : ''}

            <form id="expense-entry-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Category</label>
                    <select id="exp-cat-id" required class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-emerald-500 text-xs font-medium font-sans">
                        ${catOptionsHTML}
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Expense Date</label>
                    <input type="date" id="exp-date" required value="${defaultDate}" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-emerald-500 text-xs" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Amount Spend (€)</label>
                    <input type="number" id="exp-amount" required value="${isEdit ? entry.amount : ''}" min="0.01" step="0.01" placeholder="Enter Spent Amount" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-emerald-500 font-mono text-xs" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1">Observation Memo / Note</label>
                    <input type="text" id="exp-note" value="${isEdit ? escapeHTML(entry.note || '') : ''}" placeholder="E.g., Groceries purchases, uber ride to station" class="w-full px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-emerald-500 text-xs" />
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-modal" class="py-2 border border-slate-200 text-slate-600 font-medium rounded-lg text-xs hover:bg-slate-50 transition-all">Cancel</button>
                    <button type="submit" class="py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-medium shadow-lg shadow-emerald-600/10 transition-all flex items-center justify-center gap-1">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> Save Expense Record
                    </button>
                </div>
            </form>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);

        document.getElementById('expense-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const categoryId = document.getElementById('exp-cat-id').value;
            const date = document.getElementById('exp-date').value;
            const amount = parseFloat(document.getElementById('exp-amount').value);
            const note = document.getElementById('exp-note').value;

            if (isNaN(amount) || amount <= 0) {
                alert("Please enter a valid amount greater than zero.");
                return;
            }

            // Compute month index
            const entryMonth = date.substring(0, 7);
            if (entryMonth !== selectedMonth) {
                const proceed = confirm(`The date entered (${date}) is in a different month than the active view (${selectedMonth}). Do you wish to save it anyway?`);
                if (!proceed) return;
            }

            // Spending Anomaly Checker (2.5 standard deviations)
            if (trainingData && trainingData.length > 0) {
                const categoryData = trainingData.filter(e => e.category_id === categoryId && e.amount);
                if (categoryData.length >= 3) {
                    const amounts = categoryData.map(e => parseFloat(e.amount));
                    const mean = amounts.reduce((sum, val) => sum + val, 0) / amounts.length;
                    const variance = amounts.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / amounts.length;
                    const stdDev = Math.sqrt(variance);

                    if (stdDev > 0 && amount > mean + (2.5 * stdDev)) {
                        const proceed = confirm(`Warning: The amount logged (€${amount}) deviates significantly from your category average (Mean: €${mean.toFixed(0)}, StdDev: €${stdDev.toFixed(0)}). Is this correct?`);
                        if (!proceed) return;
                    }
                }
            }

            showActionSpinner(true);
            try {
                if (isEdit) {
                    const { error } = await supabase
                        .from('expense_entries')
                        .update({ category_id: categoryId, amount, date, note, month: entryMonth })
                        .eq('id', entry.id);
                    if (error) throw error;
                } else {
                    const { error } = await supabase
                        .from('expense_entries')
                        .insert({
                            user_id: currentUser.id,
                            category_id: categoryId,
                            amount,
                            date,
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

        // Setup AI Autocomplete & Voice dictation listeners
        const expNoteInput = document.getElementById('exp-note');
        const expCatSelect = document.getElementById('exp-cat-id');

        let userManuallyChangedCategory = false;
        expCatSelect.addEventListener('change', () => {
            userManuallyChangedCategory = true;
        });

        if (!isEdit) {
            const handleCategoryPrediction = () => {
                if (userManuallyChangedCategory) return;
                const text = expNoteInput.value;
                if (!text || text.trim().length === 0) return;

                const classification = classifyExpense({ merchant: text, note: text }, categories, classifier);
                if (classification && classification.categoryId) {
                    expCatSelect.value = classification.categoryId;
                    console.log(`[Category Autocomplete Debug] Input: "${text}" -> Category: "${classification.categoryName}" (ID: ${classification.categoryId}, Conf: ${classification.confidence}, Reason: "${classification.reason}")`);
                }
            };

            expNoteInput.addEventListener('input', handleCategoryPrediction);

            if (expNoteInput.value) {
                handleCategoryPrediction();
            }
        }

        // Setup Scan Receipt OCR handler
        if (!isEdit) {
            const btnScan = document.getElementById('btn-scan-receipt');
            const fileInput = document.getElementById('scan-receipt-file-input');
            const btnText = document.getElementById('scan-receipt-btn-text');
            const statusBox = document.getElementById('ocr-status-box');

            const setOcrStatus = (msg, type = 'info') => {
                if (!statusBox) return;
                statusBox.classList.remove('hidden', 'bg-blue-50', 'text-blue-700', 'bg-emerald-50', 'text-emerald-700', 'bg-rose-50', 'text-rose-700', 'bg-amber-50', 'text-amber-700');
                if (type === 'info') {
                    statusBox.classList.add('bg-blue-50', 'text-blue-700');
                } else if (type === 'success') {
                    statusBox.classList.add('bg-emerald-50', 'text-emerald-700');
                } else if (type === 'warning') {
                    statusBox.classList.add('bg-amber-50', 'text-amber-700');
                } else if (type === 'error') {
                    statusBox.classList.add('bg-rose-50', 'text-rose-700');
                }
                statusBox.textContent = msg;
            };

            btnScan.addEventListener('click', () => {
                fileInput.click();
            });

            fileInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;

                // Client-side validations
                const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
                if (!validTypes.includes(file.type.toLowerCase())) {
                    setOcrStatus('Please select a valid image file (PNG, JPG, JPEG, WEBP).', 'error');
                    fileInput.value = '';
                    return;
                }

                // UI Loading state
                btnScan.disabled = true;
                btnScan.classList.add('opacity-60', 'cursor-not-allowed');
                btnText.textContent = 'Scanning...';
                setOcrStatus('Extracting receipt data via Gemini API...', 'info');

                try {
                    // Call Gemini directly from the client!
                    const ocrData = await parseReceiptDirectly(file);

                    setOcrStatus('✓ Receipt parsed! Opening Itemized Review...', 'success');
                    
                    closeModal();
                    setTimeout(() => {
                        openItemizedReceiptModal(ocrData, categories, selectedMonth, classifier);
                    }, 150);

                } catch (err) {
                    setOcrStatus(`Parsing Error: ${err.message}`, 'error');
                    console.error("Receipt parse failure:", err);
                } finally {
                    btnScan.disabled = false;
                    btnScan.classList.remove('opacity-60', 'cursor-not-allowed');
                    btnText.textContent = 'Scan Receipt';
                    fileInput.value = '';
                }
            });
        }
        
        // Refresh icons inside modal
        if (window.lucide) window.lucide.createIcons();
    });
}

/**
 * Normalizes OCR date string into HTML input standard YYYY-MM-DD
 */
function normalizeOcrDate(dateStr, fallbackMonth) {
    if (!dateStr || typeof dateStr !== 'string') return `${fallbackMonth}-01`;
    dateStr = dateStr.trim();
    
    // Format: YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    
    // Format: DD.MM.YYYY or DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = dateStr.match(/^(\d{1,2})[\.\/\-](\d{1,2})[\.\/\-](\d{4})$/);
    if (dmyMatch) {
        const day = dmyMatch[1].padStart(2, '0');
        const month = dmyMatch[2].padStart(2, '0');
        const year = dmyMatch[3];
        return `${year}-${month}-${day}`;
    }
    
    // Format: YYYY.MM.DD or YYYY/MM/DD
    const ymdMatch = dateStr.match(/^(\d{4})[\.\/\-](\d{1,2})[\.\/\-](\d{1,2})$/);
    if (ymdMatch) {
        const year = ymdMatch[1];
        const month = ymdMatch[2].padStart(2, '0');
        const day = ymdMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Try Native Date parsing fallback
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
        const y = parsed.getFullYear();
        const m = String(parsed.getMonth() + 1).padStart(2, '0');
        const d = String(parsed.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    return `${fallbackMonth}-01`;
}

/**
 * Handle CSV parser and drop zones (no automatic logic rules!)
 */
function openCsvImportModal(categories, selectedMonth) {
    const html = `
        <div>
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="file-spreadsheet" class="text-emerald-600"></i> Import Account CSV
            </h3>
            <p class="text-slate-500 text-xs mb-5">Select a valid CSV file containing transaction statements. Map the primary columns below manually.</p>

            <!-- File uploading screen (Stage 1) -->
            <div id="csv-stage-1" class="space-y-4">
                <div class="border-2 border-dashed border-slate-200 hover:border-emerald-500 rounded-2xl p-8 text-center bg-slate-50 cursor-pointer group transition-all relative">
                    <input type="file" id="csv-file-selector" accept=".csv" class="absolute inset-0 opacity-0 cursor-pointer h-full w-full" />
                    <div class="space-y-2">
                        <div class="bg-white w-10 h-10 rounded-xl text-slate-400 group-hover:text-emerald-600 shadow-sm flex items-center justify-center mx-auto transition-all">
                            <i data-lucide="upload-cloud" class="w-6 h-6"></i>
                        </div>
                        <p class="text-xs font-semibold text-slate-700">Choose CSV file or Drag here</p>
                        <p class="text-[9px] text-slate-400">Values must be standard comma separated</p>
                    </div>
                </div>
            </div>

            <!-- Mapping Screen (Stage 2) -->
            <div id="csv-stage-2" class="hidden space-y-4">
                <div class="p-3 bg-emerald-50 border border-emerald-100 rounded-xl">
                    <p class="text-[10px] text-emerald-800 font-semibold flex items-center gap-1">
                        <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Statement Loaded successfully! Map columns below.
                    </p>
                </div>

                <div class="space-y-3">
                    <div class="grid grid-cols-3 gap-2">
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Date Column</label>
                            <select id="map-date" class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"></select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Amount Spend</label>
                            <select id="map-amount" class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"></select>
                        </div>
                        <div>
                            <label class="block text-[10px] font-bold text-slate-500 uppercase mb-0.5">Description Note</label>
                            <select id="map-desc" class="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono"></select>
                        </div>
                    </div>
                </div>

                <button type="button" id="btn-process-mapped" class="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-md transition-all">
                    Compile Mapping List
                </button>
            </div>

            <!-- Categories Allocation Grid (Stage 3) -->
            <div id="csv-stage-3" class="hidden space-y-4">
                <div class="border-b border-slate-50 pb-2">
                    <h4 class="font-bold text-slate-800 text-xs">Assign Categories Manually</h4>
                    <p class="text-[9px] text-slate-400">Tag each spreadsheet record before final database upload. No auto-allocation of categories matches standard limits.</p>
                </div>

                <!-- Scrollable spreadsheet editor -->
                <div class="max-h-[260px] overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100 bg-white">
                    <div id="csv-allocation-sheets-rows"></div>
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-import" class="py-2 border border-slate-200 text-slate-600 font-semibold rounded-lg text-xs hover:bg-slate-50 transition-all">Cancel</button>
                    <button id="btn-publish-imported" class="py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-lg shadow-emerald-600/10 transition-all flex items-center justify-center gap-1">
                        <i data-lucide="cloud-lightning" class="w-3.5 h-3.5"></i> Publish statement (0 entries)
                    </button>
                </div>
            </div>
        </div>
    `;

    showModal(html, () => {
        const fileSelector = document.getElementById('csv-file-selector');
        
        // CSV Parsing tracking state
        let parsedRows = []; // Raw un-headers array
        let headers = [];

        fileSelector.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = function(evt) {
                const text = evt.target.result;
                const rows = text.split(/\r?\n/).filter(l => l.trim().length > 0).map(line => {
                    // split on comma avoiding quoted quotes
                    const result = [];
                    let cur = '';
                    let quotes = false;
                    for (let i = 0; i < line.length; i++) {
                        const char = line[i];
                        if (char === '"') {
                            quotes = !quotes;
                        } else if (char === ',' && !quotes) {
                            result.push(cur.trim());
                            cur = '';
                        } else {
                            cur += char;
                        }
                    }
                    result.push(cur.trim());
                    return result;
                });

                if (rows.length < 2) {
                    alert("A database statement sheet must contain at least 1 headers line and 1 record line.");
                    return;
                }

                // Stage 1 hide, Stage 2 show
                document.getElementById('csv-stage-1').classList.add('hidden');
                document.getElementById('csv-stage-2').classList.remove('hidden');

                headers = rows[0];
                parsedRows = rows.slice(1);

                // Populate selections
                const selectDate = document.getElementById('map-date');
                const selectAmt = document.getElementById('map-amount');
                const selectDesc = document.getElementById('map-desc');

                const dropHTML = headers.map((h, i) => `<option value="${i}">${h || `Col ${i}`}</option>`).join('');
                selectDate.innerHTML = dropHTML;
                selectAmt.innerHTML = dropHTML;
                selectDesc.innerHTML = dropHTML;

                // Try to predict cols index
                headers.forEach((h, idx) => {
                    const low = h.toLowerCase();
                    if (low.includes('date')) selectDate.value = idx;
                    else if (low.includes('amount') || low.includes('spent') || low.includes('debit')) selectAmt.value = idx;
                    else if (low.includes('desc') || low.includes('note') || low.includes('particular')) selectDesc.value = idx;
                });
            };
            reader.readAsText(file);
        });

        // Mapping compile
        document.getElementById('btn-process-mapped').addEventListener('click', () => {
            const dateIdx = parseInt(document.getElementById('map-date').value);
            const amtIdx = parseInt(document.getElementById('map-amount').value);
            const descIdx = parseInt(document.getElementById('map-desc').value);

            // Stage 2 hide, Stage 3 show
            document.getElementById('csv-stage-2').classList.add('hidden');
            const stage3 = document.getElementById('csv-stage-3');
            stage3.classList.remove('hidden');

            const rowsContainer = document.getElementById('csv-allocation-sheets-rows');
            rowsContainer.innerHTML = '';

            const mappedData = parsedRows.map((r, rowIdx) => {
                // Ensure row has correct indices
                const rowDate = r[dateIdx] || `${selectedMonth}-01`;
                const rawAmt = parseFloat(r[amtIdx] || 0);
                const desc = r[descIdx] || 'Imported Entry';

                // Skip rows where amount is invalid
                if (isNaN(rawAmt) || rawAmt <= 0) return null;

                // Intelligently classify CSV entry description
                const rowClassification = classifyExpense({
                    note: desc,
                    merchant: desc,
                    amount: rawAmt
                }, categories, classifier);

                console.log(`[CSV Import Classification Debug] Desc: "${desc}" -> Category: "${rowClassification.categoryName}" (ID: ${rowClassification.categoryId}, Conf: ${rowClassification.confidence}, Reason: "${rowClassification.reason}")`);

                const categoryDrop = categories.map(c => {
                    const sel = c.id === rowClassification.categoryId ? 'selected' : '';
                    return `<option value="${c.id}" ${sel}>${escapeHTML(c.name)}</option>`;
                }).join('');

                const item = document.createElement('div');
                item.className = "p-3 bg-slate-50/50 hover:bg-white flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs";
                item.innerHTML = `
                    <div class="space-y-0.5 grow">
                        <span class="text-[10px] text-slate-400 font-mono font-bold leading-none block">${rowDate}</span>
                        <input type="text" value="${desc}" class="font-semibold text-slate-800 bg-transparent outline-none w-full border-b border-transparent focus:border-slate-300" id="row-desc-${rowIdx}" />
                        <span class="font-mono text-xs font-semibold text-rose-600 block">€${rawAmt}</span>
                    </div>
                    <div class="sm:w-1/3 shrink-0">
                        <label class="block text-[8px] uppercase tracking-wider font-bold text-slate-450 mb-0.5">Tag Category</label>
                        <select id="row-cat-${rowIdx}" class="w-full bg-white border border-slate-200 rounded-lg p-1.5 text-[11px] font-sans font-medium">
                            ${categoryDrop}
                        </select>
                    </div>
                `;
                rowsContainer.appendChild(item);

                return {
                    rowIdx,
                    date: rowDate,
                    amount: rawAmt,
                };
            }).filter(Boolean);

            const compileBtn = document.getElementById('btn-publish-imported');
            compileBtn.textContent = `Publish statements (${mappedData.length} entries)`;

            // Bind publish event
            document.getElementById('btn-cancel-import').addEventListener('click', closeModal);

            compileBtn.onclick = async () => {
                showActionSpinner(true);
                try {
                    // Scan current elements to build write logs payload
                    const inserts = mappedData.map(d => {
                        const noteVal = document.getElementById(`row-desc-${d.rowIdx}`).value;
                        const catId = document.getElementById(`row-cat-${d.rowIdx}`).value;
                        
                        // Parse month string YYYY-MM
                        let monthStr = selectedMonth;
                        if (d.date && d.date.length >= 7) {
                            monthStr = d.date.substring(0, 7);
                        }

                        // Try format Date if it's not standard YYYY-MM-DD
                        let isoDate = d.date;
                        if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
                            // Try convert DD/MM/YYYY or MM/DD/YYYY? Simple fallback
                            isoDate = `${selectedMonth}-01`;
                        }

                        return {
                            user_id: currentUser.id,
                            category_id: catId,
                            amount: d.amount,
                            date: isoDate,
                            note: noteVal,
                            month: monthStr
                        };
                    });

                    const { error } = await supabase
                        .from('expense_entries')
                        .insert(inserts);
                    if (error) throw error;

                    closeModal();
                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Batch write failure: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
            };
        });
    });
}

/**
 * Categories Master CRUD Editor Modals
 */
function openCategoriesModal(categories) {
    const html = `
        <div id="categories-modal-container">
            <h3 class="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2 mb-1">
                <i data-lucide="tag" class="text-rose-600"></i> Expense Categories
            </h3>
            <p class="text-slate-500 text-xs mb-5">Define or modify categories used in your monthly logging.</p>

            <form id="add-exp-cat-form" class="flex gap-2 mb-4">
                <input type="text" id="new-cat-name" required placeholder="Add Category (E.g., Medical, Subscriptions)" class="grow px-3 py-2 bg-slate-50 border border-slate-200 outline-none rounded-lg focus:border-emerald-500 text-xs" />
                <button type="submit" class="bg-slate-950 hover:bg-slate-800 text-white rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer">Add</button>
            </form>

            <div class="max-h-[220px] overflow-y-auto mb-5 border border-slate-100 rounded-lg divide-y divide-slate-100">
                ${categories.length === 0 ? `
                    <p class="p-4 text-center text-slate-400 text-xs">No custom categories established yet.</p>
                ` : categories.map(c => `
                    <div class="flex items-center justify-between p-3 bg-white hover:bg-slate-50 transition-all text-xs" data-cat-row="${c.id}">
                        <input type="text" value="${escapeHTML(c.name)}" data-item-cat-id="${c.id}" class="cat-input-name font-bold text-slate-800 bg-transparent border-b border-transparent focus:border-rose-500 outline-none pb-0.5" />
                        <div class="flex items-center gap-1.5">
                            <button type="button" data-save-exp-cat="${c.id}" class="btn-save-cat hidden text-emerald-600 hover:text-emerald-700 font-semibold text-[11px] h-6 px-1 cursor-pointer">Save</button>
                            <button type="button" data-del-exp-cat="${c.id}" class="text-slate-400 hover:text-red-500 p-1 cursor-pointer">
                                <i data-lucide="trash" class="w-3.5 h-3.5"></i>
                            </button>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="flex justify-end">
                <button type="button" id="btn-close-cat-modal" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg text-xs cursor-pointer transition-all">Close Panel</button>
            </div>
        </div>
    `;

    showModal(html, () => {
        const container = document.getElementById('categories-modal-container');
        if (!container) return;

        // Initialize Lucide icons if available
        if (window.lucide) window.lucide.createIcons();

        // 1. Add Category Form Submission
        const addForm = container.querySelector('#add-exp-cat-form');
        if (addForm) {
            addForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                const input = document.getElementById('new-cat-name');
                const name = input ? input.value.trim() : '';
                if (!name) return;

                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('expense_categories')
                        .insert({ user_id: currentUser.id, name });
                    if (error) throw error;
                    
                    closeModal();
                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Creation failed: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
            });
        }

        // 2. Input event listener to show the "Save" button when category text changes
        container.addEventListener('input', (e) => {
            if (e.target.matches('.cat-input-name')) {
                const catId = e.target.getAttribute('data-item-cat-id');
                const saveBtn = container.querySelector(`[data-save-exp-cat="${catId}"]`);
                if (saveBtn) {
                    saveBtn.classList.remove('hidden');
                    saveBtn.style.display = 'inline-block';
                }
            }
        });

        // 3. Delegated Click Listener for Close, Save, and Delete Actions
        container.addEventListener('click', async (e) => {
            // Close Button
            if (e.target.closest('#btn-close-cat-modal')) {
                closeModal();
                return;
            }

            // Save Category Name
            const saveBtn = e.target.closest('[data-save-exp-cat]');
            if (saveBtn) {
                const catId = saveBtn.getAttribute('data-save-exp-cat');
                const input = container.querySelector(`input[data-item-cat-id="${catId}"]`);
                const newName = input ? input.value.trim() : '';

                if (!newName) {
                    alert("Category name cannot be empty.");
                    return;
                }

                showActionSpinner(true);
                try {
                    const { error } = await supabase
                        .from('expense_categories')
                        .update({ name: newName })
                        .eq('id', catId);
                    if (error) throw error;
                    
                    closeModal();
                    await reFetchAndRenderCurrentView();
                } catch (err) {
                    alert("Update failed: " + err.message);
                } finally {
                    showActionSpinner(false);
                }
                return;
            }

            // Delete Category
            const delBtn = e.target.closest('[data-del-exp-cat]');
            if (delBtn) {
                const catId = delBtn.getAttribute('data-del-exp-cat');
                if (confirm("Deleting this category cascades and deletes all historical expense records logged in it. Continue?")) {
                    showActionSpinner(true);
                    try {
                        const { error } = await supabase
                            .from('expense_categories')
                            .delete()
                            .eq('id', catId);
                        if (error) throw error;
                        
                        closeModal();
                        await reFetchAndRenderCurrentView();
                    } catch (err) {
                        alert("Delete failed: " + err.message);
                    } finally {
                        showActionSpinner(false);
                    }
                }
            }
        });
    });
}

let activeCategoryFilter = 'all';

function setupCategoryFilterDelegation() {
    // Single delegation listener attached to the document body
    document.addEventListener('click', (e) => {
        // Find if the clicked element or its parent is a category filter button
        const btn = e.target.closest('.category-filter-btn');
        if (!btn) return; // Ignore clicks outside the buttons

        console.log("Filter button clicked:", btn.getAttribute('data-category-filter'));

        const targetFilter = btn.getAttribute('data-category-filter');
        activeCategoryFilter = targetFilter;

        const filterButtons = document.querySelectorAll('.category-filter-btn');
        const filterLabel = document.getElementById('active-filter-label');

        // 1. Update Active UI Styling for Buttons
        filterButtons.forEach(b => {
            b.classList.remove('bg-emerald-600', 'border-emerald-600', 'text-white', 'shadow-sm', 'active');
            b.classList.add('bg-slate-100/80', 'border-slate-200', 'text-slate-600');
            
            const badge = b.querySelector('span:last-child');
            if (badge) {
                badge.className = "px-1.5 py-0.2 text-[10px] bg-slate-200/80 text-slate-500 rounded-full font-mono";
            }
        });

        // Set active styles on clicked button
        btn.classList.remove('bg-slate-100/80', 'border-slate-200', 'text-slate-600');
        btn.classList.add('bg-emerald-600', 'border-emerald-600', 'text-white', 'shadow-sm', 'active');
        
        const activeBadge = btn.querySelector('span:last-child');
        if (activeBadge) {
            activeBadge.className = "px-1.5 py-0.2 text-[10px] bg-white/20 text-white rounded-full font-mono";
        }

        if (filterLabel) {
            filterLabel.textContent = `Showing: ${targetFilter === 'all' ? 'All' : targetFilter}`;
        }

        // 2. Trigger table re-filtering
        applyCombinedFilters();
    });
}

// Call this ONCE when script loads
setupCategoryFilterDelegation();

/**
 * Interactive Itemized Receipt Review Modal
 */
function openItemizedReceiptModal(ocrData, categories, selectedMonth, classifier) {
    let items = [];
    if (Array.isArray(ocrData.items) && ocrData.items.length > 0) {
        items = ocrData.items.map(it => ({
            item_name: it.item_name || it.name || 'Item',
            quantity: typeof it.quantity === 'number' && it.quantity > 0 ? it.quantity : 1,
            unit_price: typeof it.unit_price === 'number' ? it.unit_price : null,
            price: typeof it.price === 'number' ? it.price : 0,
            category: it.category || 'Miscellaneous',
            confidence: it.confidence || 0.95
        }));
    } else if (Array.isArray(ocrData.purchased_items) && ocrData.purchased_items.length > 0) {
        items = ocrData.purchased_items.map(it => ({
            item_name: it[0] || 'Item',
            quantity: typeof it[1] === 'number' && it[1] > 0 ? it[1] : 1,
            unit_price: null,
            price: typeof it[2] === 'number' ? it[2] : 0,
            category: it[4] || 'Miscellaneous',
            confidence: 0.95
        }));
    } else {
        items = [{ item_name: 'General Receipt Purchase', quantity: 1, unit_price: ocrData.total_amount || 0, price: ocrData.total_amount || 0, category: 'Miscellaneous', confidence: 1.0 }];
    }

    const merchantName = (ocrData.merchant || ocrData.vendor || 'Store').trim();
    const rawDate = ocrData.receipt_date || ocrData.date || '';
    const normalizedDate = normalizeOcrDate(rawDate, selectedMonth);
    const currencyStr = (ocrData.currency || 'EUR').toUpperCase();
    const receiptTotalAmount = typeof ocrData.total_amount === 'number' ? ocrData.total_amount : 0;

    const html = `
        <div class="space-y-4 select-none">
            <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                <div class="flex items-center gap-2.5">
                    <div class="p-2 bg-emerald-100/70 text-emerald-600 rounded-xl">
                        <i data-lucide="receipt" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-slate-900 tracking-tight">Review Itemized Receipt</h3>
                        <p class="text-slate-500 text-xs">Confirm extracted items and raw LLM category tags before saving.</p>
                    </div>
                </div>
                <span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-[11px] font-semibold rounded-full border border-emerald-200 flex items-center gap-1">
                    <i data-lucide="sparkles" class="w-3 h-3 text-emerald-500"></i> AI Parsed
                </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 p-3 rounded-xl border border-slate-200/80">
                <div>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Vendor / Store</label>
                    <input type="text" id="itemized-merchant" value="${escapeHTML(merchantName)}" placeholder="Vendor Name" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500" />
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Receipt Date</label>
                    <input type="date" id="itemized-date" value="${normalizedDate}" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500" />
                </div>
                <div>
                    <label class="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Currency</label>
                    <input type="text" id="itemized-currency" value="${escapeHTML(currencyStr)}" class="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:border-emerald-500 uppercase" />
                </div>
            </div>

            <div id="itemized-mismatch-banner" class="hidden p-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl text-xs font-medium flex items-center gap-2">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600 shrink-0"></i>
                <span id="itemized-mismatch-text">Itemized total does not match receipt total. Please review extracted items.</span>
            </div>

            <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div class="max-h-[300px] overflow-y-auto">
                    <table class="w-full text-left border-collapse text-xs">
                        <thead class="sticky top-0 bg-slate-100 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            <tr>
                                <th class="p-2.5 pl-3">Item Description</th>
                                <th class="p-2.5 w-16 text-center">Qty</th>
                                <th class="p-2.5 w-24 text-right">Price (€)</th>
                                <th class="p-2.5 w-36">Category Tag</th>
                                <th class="p-2.5 w-10 text-center"></th>
                            </tr>
                        </thead>
                        <tbody id="itemized-rows-body" class="divide-y divide-slate-100 bg-white">
                        </tbody>
                    </table>
                </div>
                <div class="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-2">
                    <button type="button" id="btn-add-item-row" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all border border-emerald-200 cursor-pointer">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Line Item
                    </button>
                    <div class="flex items-center gap-4 text-xs font-mono">
                        <div>
                            <span class="text-slate-400 text-[10px] font-sans">Receipt Total:</span>
                            <span class="font-bold text-slate-800" id="disp-receipt-total">€${receiptTotalAmount.toFixed(2)}</span>
                        </div>
                        <div>
                            <span class="text-slate-400 text-[10px] font-sans">Itemized Sum:</span>
                            <span class="font-bold text-emerald-600" id="disp-itemized-sum">€0.00</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between pt-2">
                <button type="button" id="btn-cancel-itemized" class="px-4 py-2 border border-slate-200 text-slate-600 font-medium rounded-xl text-xs hover:bg-slate-50 transition-all cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="btn-save-itemized-expense" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-emerald-600/15 transition-all flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Itemized Expense
                </button>
            </div>
        </div>
    `;

    showModal(html, () => {
        const body = document.getElementById('itemized-rows-body');
        let currentItems = [...items];

        const renderRows = () => {
            body.innerHTML = currentItems.map((it, index) => {
                // Directly use the exact string from Gemini
                const rawCategoryTag = it.category || 'Miscellaneous';

                return `
                    <tr class="hover:bg-slate-50/60 transition-all" data-item-index="${index}">
                        <td class="p-2 pl-3">
                            <input type="text" data-field="item_name" value="${escapeHTML(it.item_name)}" placeholder="Item description" class="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-medium text-slate-800 outline-none focus:border-emerald-500" />
                        </td>
                        <td class="p-2">
                            <input type="number" min="1" step="1" data-field="quantity" value="${it.quantity}" class="w-full px-1.5 py-1 border border-slate-200 rounded-lg text-xs font-mono text-center outline-none focus:border-emerald-500" />
                        </td>
                        <td class="p-2">
                            <input type="number" min="0" step="0.01" data-field="price" value="${parseFloat(it.price || 0).toFixed(2)}" class="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-mono text-right outline-none focus:border-emerald-500" />
                        </td>
                        <td class="p-2">
                            <input type="text" data-field="category" value="${escapeHTML(rawCategoryTag)}" placeholder="Category Tag" class="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs font-semibold text-emerald-700 bg-emerald-50/50 outline-none focus:border-emerald-500" />
                        </td>
                        <td class="p-2 text-center">
                            <button type="button" data-delete-row="${index}" class="p-1 text-slate-400 hover:text-red-500 rounded hover:bg-slate-100 cursor-pointer transition-all">
                                <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');

            if (window.lucide) window.lucide.createIcons();
            attachRowListeners();
            updateCalculations();
        };

        const updateCalculations = () => {
            let sum = 0;
            const rows = body.querySelectorAll('tr');
            rows.forEach(tr => {
                const qtyInput = tr.querySelector('[data-field="quantity"]');
                const priceInput = tr.querySelector('[data-field="price"]');
                const qty = parseFloat(qtyInput ? qtyInput.value : 1) || 1;
                const price = parseFloat(priceInput ? priceInput.value : 0) || 0;
                sum += (qty * price);
            });

            document.getElementById('disp-itemized-sum').textContent = `€${sum.toFixed(2)}`;

            const mismatchBanner = document.getElementById('itemized-mismatch-banner');
            const mismatchText = document.getElementById('itemized-mismatch-text');

            if (receiptTotalAmount > 0 && Math.abs(sum - receiptTotalAmount) > 0.01) {
                mismatchBanner.classList.remove('hidden');
                mismatchText.textContent = `Itemized total (€${sum.toFixed(2)}) does not match receipt total (€${receiptTotalAmount.toFixed(2)}). Please review extracted items.`;
            } else {
                mismatchBanner.classList.add('hidden');
            }
        };

        const attachRowListeners = () => {
            body.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', updateCalculations);
                input.addEventListener('change', updateCalculations);
            });

            body.querySelectorAll('[data-delete-row]').forEach(btn => {
                btn.addEventListener('click', () => {
                    const index = parseInt(btn.getAttribute('data-delete-row'), 10);
                    currentItems.splice(index, 1);
                    renderRows();
                });
            });
        };

        document.getElementById('btn-add-item-row').addEventListener('click', () => {
            currentItems.push({
                item_name: '',
                quantity: 1,
                price: 0.00,
                category: 'Groceries'
            });
            renderRows();
        });

        document.getElementById('btn-cancel-itemized').addEventListener('click', closeModal);

        document.getElementById('btn-save-itemized-expense').addEventListener('click', async () => {
    const merchant = document.getElementById('itemized-merchant').value.trim() || 'Receipt Expense';
    const date = document.getElementById('itemized-date').value;
    const currencyStr = (document.getElementById('itemized-currency')?.value || 'EUR').trim().toUpperCase();
    
    if (!date) {
        alert("Please select or enter a valid receipt date.");
        return;
    }

    // Collect extracted line items from the modal table
    const lineItems = [];
    let calculatedTotal = 0;

    const rows = document.querySelectorAll('#itemized-rows-body tr');
    rows.forEach(tr => {
        const nameInput = tr.querySelector('[data-field="item_name"]');
        const qtyInput = tr.querySelector('[data-field="quantity"]');
        const priceInput = tr.querySelector('[data-field="price"]');
        const catInput = tr.querySelector('[data-field="category"]');

        const name = nameInput ? nameInput.value.trim() : '';
        const qty = parseFloat(qtyInput ? qtyInput.value : 1) || 1;
        const price = parseFloat(priceInput ? priceInput.value : 0) || 0;
        const cat = catInput ? catInput.value.trim() : 'General';

        if (name) {
            lineItems.push({
                item_name: name,
                quantity: qty,
                unit_price: qty > 0 ? (price / qty) : price,
                price: price,
                category: cat
            });
            calculatedTotal += price;
        }
    });

    if (lineItems.length === 0) {
        alert("Please add at least one line item to save.");
        return;
    }

    const entryMonth = date.substring(0, 7);

    // Construct the full raw receipt payload for raw_json
    const receiptPayload = {
        merchant: merchant,
        date: date,
        total_amount: calculatedTotal,
        currency: currencyStr,
        items: lineItems
    };

    showActionSpinner(true);
    try {
        // 1. Insert into consolidated expense_entries (NO category_id or note)
        const { data: newEntry, error: entryErr } = await supabase
            .from('expense_entries')
            .insert({
                user_id: currentUser.id,
                amount: calculatedTotal,
                date: date,
                month: entryMonth,
                merchant: merchant,        // Populates dedicated merchant column
                currency: currencyStr,
                entry_type: 'scanned',     // Identifies AI-scanned entry
                raw_json: receiptPayload   // Stores entire JSON directly in expense_entries
            })
            .select()
            .single();

        if (entryErr) {
            console.error("Failed to insert into expense_entries:", entryErr);
            throw entryErr;
        }

        console.log("Successfully created parent expense_entry:", newEntry);

        // 2. Insert line items into expense_receipt_items
        if (newEntry && newEntry.id && lineItems.length > 0) {
            const dbItems = lineItems.map(it => ({
                user_id: currentUser.id,
                expense_id: newEntry.id,   // Foreign key link to expense_entries
                item_name: it.item_name,
                quantity: it.quantity,
                unit_price: it.unit_price,
                price: it.price,
                category: it.category,
                confidence: 0.95
            }));

            console.log("Inserting line items into expense_receipt_items:", dbItems);

            const { data: savedItems, error: itemsErr } = await supabase
                .from('expense_receipt_items')
                .insert(dbItems)
                .select();

            if (itemsErr) {
                console.error("Error inserting into expense_receipt_items:", itemsErr);
                alert("Saved parent expense, but failed to save line items: " + itemsErr.message);
            } else {
                console.log("Successfully saved line items:", savedItems);
            }
        }

        closeModal();
        await reFetchAndRenderCurrentView();
    } catch (err) {
        console.error("Error in save receipt process:", err);
        alert("Failed to save receipt: " + err.message);
    } finally {
        showActionSpinner(false);
    }
});
        renderRows();
    });
}

