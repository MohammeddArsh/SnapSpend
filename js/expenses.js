import { supabase } from './supabase.js';
import { currentUser, reFetchAndRenderCurrentView, showModal, closeModal, showActionSpinner, setSelectedMonth, selectedMonth } from './app.js';
import { formatCurrency, escapeHTML } from './utils.js';
import { NaiveBayesClassifier, classifyExpense, normalizeMerchantName } from './classifier.js';
import { parseReceiptDirectly } from './parserEngine.js';
import { CANONICAL_CATEGORIES, mapToCanonical, getCategoryColor } from './categories.js';
import { createThemedDropdown } from './dropdown.js';
import { attachDatePicker } from './datepicker.js';

/** Live instance of the themed category filter dropdown (set per render). */
let filterDropdownInstance = null;

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
 * Checks whether an id is a real PostgreSQL UUID (vs fabricated raw-<id>-<idx> ids
 * synthesized for line items that only exist inside raw_json).
 */
function isRealDbId(id) {
    return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Parses currency amounts from CSV cells, tolerating both "1,234.56" (en)
 * and "1.234,56" (de) conventions plus symbols like €, $, and whitespace.
 */
function parseCurrencyAmount(value) {
    if (value === null || value === undefined) return NaN;
    if (typeof value === 'number') return value;

    let str = String(value).trim().replace(/[€$£\s]/g, '');
    if (!str) return NaN;

    // Reject values that are not purely numeric after symbol removal
    if (!/^[0-9.,-]+$/.test(str)) return NaN;

    if (str.includes(',') && str.includes('.')) {
        // Both separators present: the LAST one is the decimal separator
        const lastComma = str.lastIndexOf(',');
        const lastDot = str.lastIndexOf('.');
        if (lastComma > lastDot) {
            str = str.replace(/\./g, '').replace(',', '.');
        } else {
            str = str.replace(/,/g, '');
        }
    } else if (str.includes(',')) {
        // Single comma: thousands if followed by exactly 3 digits, else decimal
        if (/,\d{3}$/.test(str) && !/,\d{3},/.test(str)) {
            str = str.replace(/,/g, '');
        } else {
            str = str.replace(',', '.');
        }
    }

    return parseFloat(str);
}

/**
 * Normalizes a CSV date cell to ISO YYYY-MM-DD.
 * Accepts YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY, and DD.MM.YYYY (EU convention).
 * Falls back to the first day of the active month for unparseable values.
 */
function normalizeCsvDate(value, selectedMonth) {
    const raw = String(value || '').trim();
    let iso = '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        iso = raw;
    } else if (/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.test(raw)) {
        const [, a, b, year] = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
        const day = parseInt(a, 10);
        const month = parseInt(b, 10);
        // DD/MM/YYYY is the default; swap only when the first part is clearly a month
        const dd = (month >= 1 && month <= 12 && day > 12) || month > 12 ? day : month;
        const mm = (month >= 1 && month <= 12 && day > 12) || month > 12 ? month : day;
        if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
            iso = `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
        }
    }
    return iso || `${selectedMonth}-01`;
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
                const parentCatName = e.expense_categories?.name || 'General';
                const rawItemCat = item.category || '';
                const catName = (rawItemCat && !['general', 'other'].includes(String(rawItemCat).toLowerCase()))
                    ? rawItemCat
                    : parentCatName;
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
            const manualItemName = (typeof e.note === 'string' && e.note.trim()) ? e.note.trim() : storeName;
            rows.push({
                isItem: false,
                itemId: null,
                expenseId: e.id,
                date: e.date,
                merchant: storeName,
                itemName: manualItemName,
                quantity: 1,
                displayNote: manualItemName,
                amount: parseFloat(e.amount || 0),
                categoryName: e.expense_categories?.name || 'General',
                categoryId: e.category_id || null,
                rawParent: e
            });
        }
    });

    return rows;
}

/**
 * Builds a single <tr> for one flattened display row (receipt item or manual entry).
 * @param {Object} row  Flattened row from flattenExpenseEntries()
 * @param {Object} opts { showVendor: boolean, indentClass: string }
 */
function buildItemRowHTML(row, { showVendor = true, indentClass = 'pl-4' } = {}) {
    const safeFormat = typeof formatCurrency === 'function' ? formatCurrency : (val) => '€' + (parseFloat(val) || 0).toFixed(2);
    const safeEscape = typeof escapeHTML === 'function' ? escapeHTML : (val) => String(val || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const isItemRow = !!row.isItem;
    const isLegacyItem = isItemRow && !isRealDbId(row.itemId);
    const searchableText = `${row.itemName || ''} ${row.merchant || ''} ${row.categoryName || ''}`.toLowerCase();
    const qtyBadge = row.quantity > 1
        ? `<span class="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[11px] font-semibold text-slate-700 dark:text-slate-300">×${row.quantity}</span>`
        : '';

    const actions = isItemRow
        ? `
            <button data-edit-receipt-item-id="${safeEscape(row.itemId)}" data-parent-expense-id="${row.expenseId}" class="p-2 sm:p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all" title="Edit Item">
                <i data-lucide="edit-2" class="w-5 h-5"></i>
            </button>
            <button data-delete-receipt-item-id="${safeEscape(row.itemId)}" data-parent-expense-id="${row.expenseId}" class="p-2 sm:p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all" title="Delete Item">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>`
        : `
            <button data-edit-expense-id="${row.expenseId}" class="p-2 sm:p-2 text-slate-400 dark:text-slate-500 hover:text-emerald-600 dark:hover:text-emerald-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all" title="Edit Expense">
                <i data-lucide="edit-2" class="w-5 h-5"></i>
            </button>
            <button data-delete-expense-id="${row.expenseId}" class="p-2 sm:p-2 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all" title="Delete Expense">
                <i data-lucide="trash-2" class="w-5 h-5"></i>
            </button>`;

    const vendorCell = showVendor
        ? `<div class="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                <i data-lucide="store" class="w-3 h-3 shrink-0"></i>
                <span class="font-medium">${safeEscape(row.merchant)}</span>
            </div>`
        : '';

    return `
        <tr class="hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-all expense-row-element cursor-pointer select-none"
            data-item-cat-id="${safeEscape(row.categoryId || '')}"
            data-item-cat-name="${safeEscape(row.categoryName || '')}"
            data-text-note="${safeEscape(searchableText)}"
            data-text-amount="${row.amount || 0}">
            <td class="p-3 sm:p-3.5 ${indentClass} min-w-0">
                <div class="flex items-center gap-2">
                    <i data-lucide="${isItemRow ? 'package' : 'receipt'}" class="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0"></i>
                    <div class="min-w-0">
                        <div class="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <span class="truncate">${safeEscape(row.itemName)}</span>${qtyBadge}
                        </div>
                        ${vendorCell}
                    </div>
                </div>
            </td>
            <td class="p-3 sm:p-3.5 font-mono font-bold text-rose-600 dark:text-rose-400 tabular whitespace-nowrap text-right">
                ${safeFormat(row.amount)}
            </td>
            <td class="p-3 sm:p-3.5 font-mono text-slate-500 dark:text-slate-400 hidden sm:table-cell tabular">
                ${safeEscape(row.date)}
            </td>
            <td class="p-3 sm:p-3.5 hidden md:table-cell">
                ${(() => {
                    const catColor = getCategoryColor(row.categoryName || 'General');
                    return `<span class="px-2 py-0.5 rounded-full text-[11px] font-medium border inline-flex items-center gap-1.5" style="background-color: ${catColor}1a; color: ${catColor}; border-color: ${catColor}40">
                        <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${catColor}"></span>
                        ${safeEscape(row.categoryName || 'General')}
                    </span>`;
                })()}
            </td>
            <td class="p-3 sm:p-3.5 pl-1 sm:pl-2 pr-2 sm:pr-4 text-right">
                <div class="inline-flex items-center gap-1">${actions}</div>
            </td>
        </tr>`;
}

/**
 * Groups flattened display rows by normalized merchant name.
 * @returns {Array<{ key: string, displayName: string, rows: Array }>}
 */
function groupRowsByMerchant(displayRows) {
    const groups = new Map();

    (displayRows || []).forEach(row => {
        const rawName = row.merchant || 'General Purchase';
        const key = normalizeMerchantName(rawName) || rawName.toLowerCase().trim() || 'general purchase';
        if (!groups.has(key)) {
            groups.set(key, { key, nameCounts: {}, rows: [] });
        }
        const group = groups.get(key);
        group.nameCounts[rawName] = (group.nameCounts[rawName] || 0) + 1;
        group.rows.push(row);
    });

    return [...groups.values()].map(group => {
        group.displayName = Object.entries(group.nameCounts).sort((a, b) => b[1] - a[1])[0][0];
        return group;
    });
}

/**
 * Builds the Merchants view HTML: one expandable group per merchant.
 */
function buildMerchantGroupsHTML(displayRows) {
    const safeFormat = typeof formatCurrency === 'function' ? formatCurrency : (val) => '€' + (parseFloat(val) || 0).toFixed(2);
    const safeEscape = typeof escapeHTML === 'function' ? escapeHTML : (val) => String(val || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const groups = groupRowsByMerchant(displayRows);

    return groups.map(group => {
        const total = group.rows.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);
        const entryCount = new Set(group.rows.map(r => r.expenseId)).size;
        const memberRows = group.rows.map(r => buildItemRowHTML(r, { showVendor: false, indentClass: 'pl-5 sm:pl-10' })).join('');

        return `
            <div class="merchant-group-element border-b border-slate-100 dark:border-slate-800" data-merchant-key="${safeEscape(group.key)}">
                <button type="button" class="merchant-group-toggle w-full flex items-center justify-between gap-3 p-3.5 pl-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/30 transition-all cursor-pointer select-none">
                    <div class="flex items-center gap-2 min-w-0">
                        <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform duration-200 shrink-0"></i>
                        <i data-lucide="store" class="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0"></i>
                        <div class="min-w-0 text-left">
                            <div class="font-bold text-slate-900 dark:text-white truncate">${safeEscape(group.displayName)}</div>
                            <div class="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                                ${entryCount} transaction${entryCount === 1 ? '' : 's'} · ${group.rows.length} item${group.rows.length === 1 ? '' : 's'}
                            </div>
                        </div>
                    </div>
                    <div class="font-mono font-bold text-rose-600 dark:text-rose-400 tabular text-sm">${safeFormat(total)}</div>
                </button>
                <div class="merchant-group-body hidden overflow-x-auto">
                    <table class="w-full table-fixed text-left border-collapse text-[13px]">
                        <colgroup>
                            <col />
                            <col class="w-24 sm:w-28" />
                            <col class="w-24 sm:w-28 hidden sm:table-column" />
                            <col class="w-28 sm:w-32 hidden md:table-column" />
                            <col class="w-24 sm:w-24" />
                        </colgroup>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">${memberRows}</tbody>
                    </table>
                </div>
            </div>`;
    }).join('');
}

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    try {
        // --- 1. DATA RE-FETCH PHASE ---
        const [
            { data: rawCategories, error: cErr },
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
                    note,
                    merchant, 
                    raw_json, 
                    entry_type,
                    currency,
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

        // Category tags sorted alphabetically with Miscellaneous always last
        const categories = (rawCategories || []).sort((a, b) => {
            if (a.name === 'Miscellaneous') return 1;
            if (b.name === 'Miscellaneous') return -1;
            return a.name.localeCompare(b.name);
        });

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
        const merchantGroupsHTML = buildMerchantGroupsHTML(displayRows);
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
                        <span class="text-[11px] uppercase font-black text-brand-600 dark:text-brand-400 tracking-widest">Monthly Expenses Log</span>
                        <h2 class="text-3xl sm:text-4xl font-black tracking-tight text-slate-900 dark:text-white">Expenses</h2>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button id="btn-import-csv" class="px-3 py-2.5 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer">
                            <i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i> Import CSV
                        </button>
                        <button id="btn-add-expense" class="px-4 py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-lg shadow-indigo-500/25 cursor-pointer">
                            <i data-lucide="plus" class="w-4 h-4"></i> Add Entry
                        </button>
                    </div>
                </div>

                <!-- Monthly Total banner -->
                <div class="relative overflow-hidden rounded-3xl bg-brand-gradient-soft dark:bg-brand-950/20 border border-brand-100 dark:border-brand-900/50 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 select-none">
                    <div class="glow-orb w-40 h-40 bg-rose-400/20 -top-20 -right-10"></div>
                    <div class="flex items-center gap-3">
                        <div class="bg-white dark:bg-slate-900/60 p-2.5 rounded-xl text-rose-500 dark:text-rose-400 shadow-sm">
                            <i data-lucide="arrow-down-left" class="w-5 h-5"></i>
                        </div>
                        <div>
                            <span class="text-[11px] uppercase font-bold text-slate-400 dark:text-slate-500 tracking-wider">Total Monthly Expenditure</span>
                            <div class="text-xs text-slate-600 dark:text-slate-400 mt-0.5">Sum of cash outflows in selected month</div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right relative z-10">
                        <span class="text-[11px] text-slate-400 dark:text-slate-500 font-medium leading-none block">Aggregate Expenses</span>
                        <span class="text-2xl font-mono font-bold text-slate-950 dark:text-white tabular">${formatCurrency(totalExpenses)}</span>
                    </div>
                </div>

                <!-- Live Search & Filtering bar -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="relative sm:col-span-2">
                        <input type="text" id="expense-search" placeholder="Search keywords..." class="w-full pl-10 pr-3 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-[13px] text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500" />
                        <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                            <i data-lucide="search" class="w-4 h-4"></i>
                        </div>
                    </div>
                    <div id="expense-filter-cat-wrap"></div>
                </div>

                <!-- Category Filter Pill Bar -->
<div class="space-y-2 select-none my-3">
    <div class="flex items-center justify-between">
        <label class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Filter by Category</label>
        <span id="active-filter-label" class="text-[11px] text-slate-400 dark:text-slate-500 font-medium">Showing: All</span>
    </div>
    
    <div class="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
        <!-- 'All' Reset Button -->
        <button type="button" 
                data-category-filter="all" 
                class="category-filter-btn active px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border bg-brand-gradient border-transparent text-white shadow-md shadow-indigo-500/25 cursor-pointer flex items-center gap-1.5">
            <span>All Categories</span>
            <span class="px-1.5 py-0.2 text-[11px] bg-white/20 text-white rounded-full font-mono">${displayRows.length}</span>
        </button>

        <!-- Dynamic Category Filter Buttons -->
        ${categories.map(cat => {
            const count = displayRows.filter(r => 
                r.categoryId === cat.id || 
                (r.categoryName && r.categoryName.toLowerCase() === cat.name.toLowerCase())
            ).length;
            const catColor = getCategoryColor(cat.name);

            return `
                <button type="button" 
                        data-category-filter="${escapeHTML(cat.name)}" 
                        data-category-id="${cat.id}"
                        class="category-filter-btn px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border bg-slate-100/80 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700 hover:text-slate-800 dark:hover:text-white cursor-pointer flex items-center gap-1.5">
                    <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${catColor}"></span>
                    <span>${escapeHTML(cat.name)}</span>
                    <span class="px-1.5 py-0.2 text-[11px] bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full font-mono">${count}</span>
                </button>
            `;
        }).join('')}
    </div>
</div>
                </div>
                <!-- Items / Merchants View -->
<div class="bento-card overflow-hidden">
    <div class="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
            <button type="button" data-exp-tab="items" class="exp-tab-btn active px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm">
                <i data-lucide="package" class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5"></i> Items
            </button>
            <button type="button" data-exp-tab="merchants" class="exp-tab-btn px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                <i data-lucide="store" class="w-3.5 h-3.5 inline-block mr-1 -mt-0.5"></i> Merchants
            </button>
        </div>
        <span class="text-[11px] font-mono text-slate-400 dark:text-slate-500">Newest First</span>
    </div>

    <!-- Items View (default): one row per item, vendor mentioned -->
    <div id="exp-items-view">
        <div class="overflow-x-auto">
            <table class="w-full table-fixed text-left border-collapse text-[13px]" id="expense-main-table">
                <thead>
                    <tr class="bg-slate-50/80 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                        <th class="p-3 sm:p-3.5 pl-3 sm:pl-4">Item</th>
                        <th class="p-3 sm:p-3.5 w-24 sm:w-28">Amount</th>
                        <th class="p-3 sm:p-3.5 w-24 sm:w-28 hidden sm:table-cell">Date</th>
                        <th class="p-3 sm:p-3.5 w-28 sm:w-32 hidden md:table-cell">Category</th>
                        <th class="p-3 sm:p-3.5 w-24 sm:w-24 text-right pr-2 sm:pr-4">Actions</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-100 dark:divide-slate-800 text-[13px]">
                    ${displayRows.length === 0 ? `
                        <tr>
                            <td colspan="5" class="p-10 text-center">
                                <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                                    <i data-lucide="inbox" class="w-6 h-6"></i>
                                </div>
                                <p class="font-medium text-slate-500 dark:text-slate-400 text-sm">No expense items logged for this month.</p>
                                <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-1">Click <b>'Add Entry'</b> to record your first expense or <b>'Scan Receipt'</b> to auto-parse.</p>
                            </td>
                        </tr>
                    ` : displayRows.map(row => buildItemRowHTML(row)).join('')}
                </tbody>
            </table>
        </div>
    </div>

    <!-- Merchants View: grouped by vendor -->
    <div id="exp-merchants-view" class="hidden">
        ${merchantGroupsHTML
            ? `<div class="divide-y divide-slate-100 dark:divide-slate-800">${merchantGroupsHTML}</div>`
            : `
                <div class="p-10 text-center">
                    <div class="bg-slate-50 dark:bg-slate-800/60 w-14 h-14 rounded-2xl text-slate-300 dark:text-slate-600 flex items-center justify-center mx-auto mb-3">
                        <i data-lucide="store" class="w-6 h-6"></i>
                    </div>
                    <p class="font-medium text-slate-500 dark:text-slate-400 text-sm">No merchants found for this month.</p>
                </div>
            `}
    </div>
</div>
        `;

        setupExpensesListeners(categories, entries, selectedMonth, classifier, trainingData);
        if (window.lucide) window.lucide.createIcons();

        // Pre-filter from dashboard category click-through
        if (window.pendingCategoryFilter) {
            const pendingName = String(window.pendingCategoryFilter).trim().toLowerCase();
            window.pendingCategoryFilter = null; // Clear immediately

            if (pendingName) {
                const pills = document.querySelectorAll('.category-filter-btn');
                for (const pill of pills) {
                    if (String(pill.getAttribute('data-category-filter') || '').toLowerCase() === pendingName) {
                        pill.click();
                        break;
                    }
                }
            }
        }

        // Check for global prefilled voice transactions
        if (window.prefilledVoiceTransaction && window.prefilledVoiceTransaction.type === 'expense') {
            const voiceData = window.prefilledVoiceTransaction;
            window.prefilledVoiceTransaction = null; // Clear immediately

            // Prefer an exact / partial match on the dictated category; fall back
            // to Miscellaneous when no category was dictated or nothing matches.
            const dictatedCat = (voiceData.category_name || '').trim().toLowerCase();
            const matchingCat = dictatedCat
                ? (categories.find(c => c.name.toLowerCase().includes(dictatedCat))
                    || categories.find(c => c.name.toLowerCase() === 'miscellaneous'))
                : (categories.find(c => c.name.toLowerCase() === 'miscellaneous') || categories[0]);
            const prefilledEntry = {
                amount: voiceData.amount,
                note: voiceData.note,
                date: voiceData.date,
                category_id: matchingCat ? matchingCat.id : null
            };
            setTimeout(() => openExpenseModal(null, categories, selectedMonth, classifier, trainingData, prefilledEntry), 100);
        }

    } catch (e) {
        console.error("Expenses view render failure:", e);
        container.innerHTML = `<p class="p-6 text-red-500">Failed to render expenses content: ${escapeHTML(e.message)}</p>`;
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

    // 2. SECURE FILE CSV IMPORTER
    document.getElementById('btn-import-csv').addEventListener('click', () => {
        openCsvImportModal(categories, selectedMonth, classifier);
    });

    // 3. COLLAPSED DRAWER ACCORDIONS
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
    //    Registered ONCE at module scope (see bottom of file) — not per-render.

    // 6. LIVE SEARCH AND FILTERS CONTROLLER
    const search = document.getElementById('expense-search');
    const filterWrap = document.getElementById('expense-filter-cat-wrap');

    const handleSearchFilter = () => {
        const query = search.value.trim().toLowerCase();
        const catTarget = filterDropdown.getValue();
        const selectedCatObj = categories.find(c => c.id === catTarget);
        const catTargetName = selectedCatObj ? selectedCatObj.name.toLowerCase() : '';

        const rowMatches = (row) => {
            const catId = row.getAttribute('data-item-cat-id');
            const catName = row.getAttribute('data-item-cat-name') || '';
            const noteText = row.getAttribute('data-text-note') || '';
            const amtText = row.getAttribute('data-text-amount') || '';

            const matchesSearch = !query || noteText.includes(query) || amtText.includes(query) || catName.includes(query);
            const matchesCat = catTarget === 'ALL' || catId === catTarget || (catTargetName && catName === catTargetName);

            return matchesSearch && matchesCat;
        };

        // Items view: filter item rows directly
        document.querySelectorAll('#exp-items-view .expense-row-element').forEach(row => {
            row.classList.toggle('hidden', !rowMatches(row));
        });

        // Merchants view: keep groups containing at least one matching member
        document.querySelectorAll('.merchant-group-element').forEach(group => {
            let groupVisible = false;
            group.querySelectorAll('.expense-row-element').forEach(member => {
                const visible = rowMatches(member);
                member.classList.toggle('hidden', !visible);
                if (visible) groupVisible = true;
            });
            group.classList.toggle('hidden', !groupVisible);
        });
    };

    const filterDropdown = createThemedDropdown({
        options: [{ value: 'ALL', label: 'All Categories' }, ...categories.map(c => ({ value: c.id, label: c.name, color: getCategoryColor(c.name) }))],
        value: 'ALL',
        placeholder: 'All Categories',
        onChange: handleSearchFilter,
    });
    filterDropdownInstance = filterDropdown;
    if (filterWrap) filterWrap.appendChild(filterDropdown.el);

    search.addEventListener('input', handleSearchFilter);

    // 5b. ITEMS / MERCHANTS TAB SWITCHER
    document.querySelectorAll('.exp-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.getAttribute('data-exp-tab');
            document.querySelectorAll('.exp-tab-btn').forEach(b => {
                const isActive = b === btn;
                b.classList.toggle('bg-white', isActive);
                b.classList.toggle('dark:bg-slate-700', isActive);
                b.classList.toggle('text-slate-900', isActive);
                b.classList.toggle('dark:text-white', isActive);
                b.classList.toggle('shadow-sm', isActive);
                b.classList.toggle('text-slate-500', !isActive);
                b.classList.toggle('dark:text-slate-400', !isActive);
                b.classList.toggle('hover:text-slate-700', !isActive);
                b.classList.toggle('dark:hover:text-slate-200', !isActive);
            });
            const itemsView = document.getElementById('exp-items-view');
            const merchantsView = document.getElementById('exp-merchants-view');
            if (itemsView) itemsView.classList.toggle('hidden', tab !== 'items');
            if (merchantsView) merchantsView.classList.toggle('hidden', tab !== 'merchants');
            applyCombinedFilters();
        });
    });

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

            // Legacy items that only live inside raw_json have fabricated ids
            // (raw-<entryId>-<idx>); they cannot be deleted from the DB table.
            if (!isRealDbId(itemId)) {
                alert("This line item is stored inside the receipt JSON and cannot be deleted individually. Delete the whole receipt entry instead.");
                return;
            }

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
function openExpenseModal(entry, categories, selectedMonth, classifier, trainingData, prefill) {
    const isEdit = !!entry;
    const pv = (key) => prefill ? (prefill[key] ?? '') : '';
    const uncategorized = isEdit && !entry.category_id;
    const defaultCatId = (isEdit && entry.category_id) || (!isEdit && prefill && prefill.category_id) || '';
    const catOptions = [
        ...(uncategorized ? [{ value: '', label: '— Uncategorized —' }] : []),
        ...categories.map(c => ({ value: c.id, label: c.name, color: getCategoryColor(c.name) })),
    ];

    const defaultDate = isEdit ? entry.date : (prefill && prefill.date ? prefill.date : `${selectedMonth}-01`);

    const html = `
        <div class="p-1">
            <div class="flex items-center gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="${isEdit ? 'edit-3' : 'plus-circle'}" class="w-4 h-4"></i>
                </span>
                <div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">${isEdit ? 'Alter' : 'Record'} Expense</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Ensure appropriate categories are tagged to keep financial indicators accurate.</p>
                </div>
            </div>

            ${!isEdit ? `
                <!-- Scan Receipt OCR Auto-fill Container -->
                <div class="mb-4 bg-brand-50/60 dark:bg-brand-950/30 border border-brand-100 dark:border-brand-900/50 rounded-2xl p-3.5 space-y-2">
                    <div class="flex items-center justify-between gap-2">
                        <div class="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                            <i data-lucide="scan" class="w-4 h-4 text-brand-600 dark:text-brand-400 shrink-0"></i>
                            <span>Scan Receipt (AI Auto-fill)</span>
                        </div>
                        <button type="button" id="btn-scan-receipt" class="px-3.5 py-1.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-md shadow-indigo-500/25">
                            <i data-lucide="camera" class="w-3.5 h-3.5" id="scan-receipt-icon"></i>
                            <span id="scan-receipt-btn-text">Scan Receipt</span>
                        </button>
                        <input type="file" id="scan-receipt-file-input" accept="image/png, image/jpeg, image/jpg, image/webp" class="hidden" />
                    </div>
                    <div id="ocr-status-box" class="hidden text-[11px] p-2.5 rounded-xl font-medium transition-all"></div>
                </div>
            ` : ''}

            <form id="expense-entry-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
                    <div id="exp-cat-id-wrap"></div>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Expense Date</label>
                    <input type="date" id="exp-date" required value="${defaultDate}" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Amount Spend (€)</label>
                    <input type="number" id="exp-amount" required value="${isEdit ? entry.amount : pv('amount')}" min="0.01" step="0.01" placeholder="Enter Spent Amount" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Observation Memo / Note</label>
                    <input type="text" id="exp-note" value="${isEdit ? escapeHTML(entry.note || '') : escapeHTML(pv('note'))}" placeholder="E.g., Groceries purchases, uber ride to station" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-modal" class="py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">Cancel</button>
                    <button type="submit" class="py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                        <i data-lucide="check" class="w-3.5 h-3.5"></i> Save Expense Record
                    </button>
                </div>
            </form>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-cancel-modal').addEventListener('click', closeModal);

        const catDropdown = createThemedDropdown({
            options: catOptions,
            value: defaultCatId,
            placeholder: 'Select a category…',
            required: true,
            onChange: () => { userManuallyChangedCategory = true; },
        });
        document.getElementById('exp-cat-id-wrap').appendChild(catDropdown.el);

        document.getElementById('expense-entry-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const categoryId = catDropdown.getValue();
            const date = document.getElementById('exp-date').value;
            const amount = parseFloat(document.getElementById('exp-amount').value);
            const note = document.getElementById('exp-note').value;

            if (!categoryId) {
                catDropdown.setError(true);
                alert("Please select a category for this expense.");
                return;
            }
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

        let userManuallyChangedCategory = false;

        if (!isEdit) {
            const handleCategoryPrediction = () => {
                if (userManuallyChangedCategory) return;
                const text = expNoteInput.value;
                if (!text || text.trim().length === 0) return;

                const classification = classifyExpense({ merchant: text, note: text }, categories, classifier);
                if (classification && classification.categoryId) {
                    catDropdown.setValue(classification.categoryId);
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
                statusBox.classList.remove('hidden', 'bg-blue-50', 'text-blue-700', 'dark:bg-blue-950/50', 'dark:text-blue-300', 'bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-950/50', 'dark:text-emerald-300', 'bg-rose-50', 'text-rose-700', 'dark:bg-rose-950/50', 'dark:text-rose-300', 'bg-amber-50', 'text-amber-700', 'dark:bg-amber-950/50', 'dark:text-amber-300');
                if (type === 'info') {
                    statusBox.classList.add('bg-blue-50', 'text-blue-700', 'dark:bg-blue-950/50', 'dark:text-blue-300');
                } else if (type === 'success') {
                    statusBox.classList.add('bg-emerald-50', 'text-emerald-700', 'dark:bg-emerald-950/50', 'dark:text-emerald-300');
                } else if (type === 'warning') {
                    statusBox.classList.add('bg-amber-50', 'text-amber-700', 'dark:bg-amber-950/50', 'dark:text-amber-300');
                } else if (type === 'error') {
                    statusBox.classList.add('bg-rose-50', 'text-rose-700', 'dark:bg-rose-950/50', 'dark:text-rose-300');
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
                    
                    openItemizedReceiptModal(ocrData, categories, selectedMonth, classifier);

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
function openCsvImportModal(categories, selectedMonth, classifier) {
    const html = `
        <div class="p-1">
            <div class="flex items-start gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                </span>
                <div class="grow">
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">Import Account CSV</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Select a valid CSV file containing transaction statements. Map the primary columns below manually.</p>
                </div>
                <button type="button" id="btn-close-csv-import" class="shrink-0 p-2.5 sm:p-2 -m-1 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer" aria-label="Close import dialog">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>

            <div id="csv-stage-1" class="space-y-4">
                <div class="border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-brand-500/60 dark:hover:border-brand-400/60 rounded-2xl p-8 text-center bg-slate-50/80 dark:bg-slate-900/50 cursor-pointer group transition-all relative">
                    <input type="file" id="csv-file-selector" accept=".csv" class="absolute inset-0 opacity-0 cursor-pointer h-full w-full" />
                    <div class="space-y-2">
                        <div class="bg-white dark:bg-slate-800 w-12 h-12 rounded-2xl text-slate-400 dark:text-slate-500 group-hover:text-brand-600 dark:group-hover:text-brand-400 shadow-sm flex items-center justify-center mx-auto transition-all">
                            <i data-lucide="upload-cloud" class="w-6 h-6"></i>
                        </div>
                        <p class="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Choose CSV file or Drag here</p>
                        <p class="text-[11px] text-slate-400 dark:text-slate-500">Values must be standard comma separated</p>
                    </div>
                </div>
            </div>

            <!-- Mapping Screen (Stage 2) -->
            <div id="csv-stage-2" class="hidden space-y-4">
                <div class="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-100 dark:border-emerald-900/60 rounded-xl">
                    <p class="text-[11px] text-emerald-800 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                        <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Statement Loaded successfully! Map columns below.
                    </p>
                </div>

                <div class="space-y-3">
                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Date Column</label>
                            <div id="map-date-wrap"></div>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Amount Spend</label>
                            <div id="map-amount-wrap"></div>
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase mb-1">Description Note</label>
                            <div id="map-desc-wrap"></div>
                        </div>
                    </div>
                </div>

                <button type="button" id="btn-process-mapped" class="w-full py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow-md shadow-indigo-500/25 transition-all cursor-pointer">
                    Compile Mapping List
                </button>
            </div>

            <!-- Categories Allocation Grid (Stage 3) -->
            <div id="csv-stage-3" class="hidden space-y-4">
                <div class="border-b border-slate-100 dark:border-slate-800 pb-2">
                    <h4 class="font-bold text-slate-800 dark:text-slate-200 text-[13px]">Assign Categories Manually</h4>
                    <p class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">Tag each spreadsheet record before final database upload. No auto-allocation of categories matches standard limits.</p>
                </div>

                <!-- Scrollable spreadsheet editor -->
                <div class="max-h-[260px] overflow-y-auto border border-slate-100 dark:border-slate-800 rounded-2xl divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50 scrollbar-thin">
                    <div id="csv-allocation-sheets-rows"></div>
                </div>

                <div class="grid grid-cols-2 gap-3 pt-2">
                    <button type="button" id="btn-cancel-import" class="py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">Cancel</button>
                    <button id="btn-publish-imported" class="py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center justify-center gap-1.5 cursor-pointer">
                        <i data-lucide="cloud-lightning" class="w-3.5 h-3.5"></i> Publish statement (0 entries)
                    </button>
                </div>
            </div>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-close-csv-import').addEventListener('click', closeModal);
        const fileSelector = document.getElementById('csv-file-selector');

        const mapDateDropdown = createThemedDropdown({ size: 'sm', placeholder: 'Column…' });
        const mapAmtDropdown = createThemedDropdown({ size: 'sm', placeholder: 'Column…' });
        const mapDescDropdown = createThemedDropdown({ size: 'sm', placeholder: 'Column…' });
        document.getElementById('map-date-wrap').appendChild(mapDateDropdown.el);
        document.getElementById('map-amount-wrap').appendChild(mapAmtDropdown.el);
        document.getElementById('map-desc-wrap').appendChild(mapDescDropdown.el);
        
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
                const dropOptions = headers.map((h, i) => ({ value: i, label: h || `Col ${i}` }));
                mapDateDropdown.setOptions(dropOptions);
                mapAmtDropdown.setOptions(dropOptions);
                mapDescDropdown.setOptions(dropOptions);

                // Try to predict cols index
                headers.forEach((h, idx) => {
                    const low = h.toLowerCase();
                    if (low.includes('date')) mapDateDropdown.setValue(idx);
                    else if (low.includes('amount') || low.includes('spent') || low.includes('debit')) mapAmtDropdown.setValue(idx);
                    else if (low.includes('desc') || low.includes('note') || low.includes('particular')) mapDescDropdown.setValue(idx);
                });
            };
            reader.readAsText(file);
        });

        // Mapping compile
        document.getElementById('btn-process-mapped').addEventListener('click', () => {
            const dateIdx = parseInt(mapDateDropdown.getValue());
            const amtIdx = parseInt(mapAmtDropdown.getValue());
            const descIdx = parseInt(mapDescDropdown.getValue());

            if (isNaN(dateIdx) || isNaN(amtIdx) || isNaN(descIdx)) {
                alert("Please map all three columns (Date, Amount, Description) before compiling.");
                return;
            }

            // Stage 2 hide, Stage 3 show
            document.getElementById('csv-stage-2').classList.add('hidden');
            const stage3 = document.getElementById('csv-stage-3');
            stage3.classList.remove('hidden');

            const rowsContainer = document.getElementById('csv-allocation-sheets-rows');
            rowsContainer.innerHTML = '';
            const rowCatDropdowns = {};

            const mappedData = parsedRows.map((r, rowIdx) => {
                // Ensure row has correct indices
                const rowDate = normalizeCsvDate(r[dateIdx], selectedMonth);
                const rawAmt = parseCurrencyAmount(r[amtIdx]);
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

                const item = document.createElement('div');
                item.className = "p-3 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs";
                item.innerHTML = `
                    <div class="space-y-0.5 grow">
                        <span class="text-[11px] text-slate-400 dark:text-slate-500 font-mono font-bold leading-none block">${rowDate}</span>
                        <input type="text" value="${escapeHTML(desc)}" class="font-semibold text-slate-800 dark:text-slate-200 bg-transparent outline-none w-full border-b border-transparent focus:border-slate-300 dark:focus:border-slate-600" id="row-desc-${rowIdx}" />
                        <span class="font-mono text-xs font-semibold text-rose-600 dark:text-rose-400 block tabular">€${rawAmt}</span>
                    </div>
                    <div class="sm:w-1/3 shrink-0">
                        <label class="block text-[11px] uppercase tracking-wider font-bold text-slate-400 dark:text-slate-500 mb-1">Tag Category</label>
                        <div id="row-cat-wrap-${rowIdx}"></div>
                    </div>
                `;
                rowsContainer.appendChild(item);

                const rowCatDropdown = createThemedDropdown({
                    options: categories.map(c => ({ value: c.id, label: c.name, color: getCategoryColor(c.name) })),
                    value: rowClassification.categoryId,
                    size: 'sm',
                });
                rowCatDropdowns[rowIdx] = rowCatDropdown;
                item.querySelector(`#row-cat-wrap-${rowIdx}`).appendChild(rowCatDropdown.el);

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
                        const catId = rowCatDropdowns[d.rowIdx] ? rowCatDropdowns[d.rowIdx].getValue() : '';
                        
                        const isoDate = d.date || `${selectedMonth}-01`;

                        // Parse month string YYYY-MM
                        const monthStr = isoDate.substring(0, 7);

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
 * Edit a single receipt line item (name / qty / price / category)
 */
function openEditSingleItemModal(rowItem, categories, selectedMonth) {
    const item = rowItem.rawItem || {};

    // Resolve the item's category against the user's categories (case-insensitive),
    // falling back to Miscellaneous so the select never silently snaps to the first option.
    const targetCatName = String(rowItem.categoryName || '').toLowerCase();
    const defaultCat = categories.find(c => c.name.toLowerCase() === targetCatName)
        || categories.find(c => c.name.toLowerCase() === 'miscellaneous')
        || null;

    const catOptions = categories.length > 0 ? categories.map(c => ({ value: c.id, label: c.name, color: getCategoryColor(c.name) })) : [{ value: '', label: 'General' }];
    const defaultCatId = defaultCat ? defaultCat.id : '';

    const html = `
        <div id="edit-item-modal-container" class="p-1">
            <div class="flex items-center gap-3 mb-5">
                <span class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="edit-3" class="w-4 h-4"></i>
                </span>
                <div>
                    <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">Edit Receipt Item</h3>
                    <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Adjust the item details. The parent expense total will be recalculated automatically.</p>
                </div>
            </div>

            <form id="edit-item-form" class="space-y-4">
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Item Name</label>
                    <input type="text" id="edit-item-name" required value="${escapeHTML(rowItem.itemName || '')}" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Quantity</label>
                        <input type="number" id="edit-item-qty" required value="${rowItem.quantity || 1}" min="0.01" step="0.01" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all text-xs text-slate-900 dark:text-slate-100" />
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Line Price (€)</label>
                        <input type="number" id="edit-item-price" required value="${rowItem.amount || 0}" min="0.01" step="0.01" class="w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 outline-none rounded-xl focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 transition-all font-mono text-xs text-slate-900 dark:text-slate-100" />
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5">Category</label>
                    <div id="edit-item-cat-wrap"></div>
                </div>
                <div class="flex items-center justify-between gap-3 pt-2">
                    <button type="button" id="btn-cancel-edit-item" class="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-all cursor-pointer">Cancel</button>
                    <button type="submit" class="px-5 py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-md shadow-indigo-500/25">Save Changes</button>
                </div>
            </form>
        </div>
    `;

    showModal(html, () => {
        document.getElementById('btn-cancel-edit-item').addEventListener('click', closeModal);

        const catDropdown = createThemedDropdown({
            options: catOptions,
            value: defaultCatId,
            placeholder: 'Select a category…',
        });
        document.getElementById('edit-item-cat-wrap').appendChild(catDropdown.el);

        document.getElementById('edit-item-form').addEventListener('submit', async (e) => {
            e.preventDefault();

            // Legacy items that only live inside raw_json cannot be updated in the DB table.
            if (!isRealDbId(rowItem.itemId)) {
                alert("This line item is stored inside the receipt JSON and cannot be edited directly. Delete the whole receipt entry and re-import it instead.");
                return;
            }

            const name = document.getElementById('edit-item-name').value.trim();
            const qty = parseFloat(document.getElementById('edit-item-qty').value) || 1;
            const price = parseFloat(document.getElementById('edit-item-price').value) || 0;
            const category = catDropdown.getValue();

            if (!name) {
                alert("Please enter an item name.");
                return;
            }
            if (price <= 0) {
                alert("Please enter a valid price greater than zero.");
                return;
            }

            showActionSpinner(true);
            try {
                const selectedCat = categories.find(c => c.id === category) || null;
                const { error: updErr } = await supabase
                    .from('expense_receipt_items')
                    .update({
                        item_name: name,
                        quantity: qty,
                        unit_price: qty > 0 ? (price / qty) : price,
                        price: price,
                        category: selectedCat ? selectedCat.name : 'Miscellaneous'
                    })
                    .eq('id', rowItem.itemId);
                if (updErr) throw updErr;

                const { data: remaining, error: remErr } = await supabase
                    .from('expense_receipt_items')
                    .select('price')
                    .eq('expense_id', rowItem.expenseId);
                if (remErr) throw remErr;

                const newTotal = (remaining || []).reduce((sum, i) => sum + parseFloat(i.price || 0), 0);
                const { error: parentErr } = await supabase
                    .from('expense_entries')
                    .update({ amount: newTotal })
                    .eq('id', rowItem.expenseId);
                if (parentErr) throw parentErr;

                closeModal();
                await reFetchAndRenderCurrentView();
            } catch (err) {
                alert("Failed to update item: " + err.message);
            } finally {
                showActionSpinner(false);
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
            b.classList.remove('bg-brand-gradient', 'border-transparent', 'text-white', 'shadow-md', 'shadow-indigo-500/25', 'active');
            b.classList.add('bg-slate-100/80', 'border-slate-200', 'text-slate-600', 'dark:bg-slate-800/70', 'dark:border-slate-700', 'dark:text-slate-300');
            
            const badge = b.querySelector('span:last-child');
            if (badge) {
                badge.className = "px-1.5 py-0.2 text-[11px] bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-full font-mono";
            }
        });

        // Set active styles on clicked button
        btn.classList.remove('bg-slate-100/80', 'border-slate-200', 'text-slate-600', 'dark:bg-slate-800/70', 'dark:border-slate-700', 'dark:text-slate-300');
        btn.classList.add('bg-brand-gradient', 'border-transparent', 'text-white', 'shadow-md', 'shadow-indigo-500/25', 'active');
        
        const activeBadge = btn.querySelector('span:last-child');
        if (activeBadge) {
            activeBadge.className = "px-1.5 py-0.2 text-[11px] bg-white/20 text-white rounded-full font-mono";
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

function applyCombinedFilters() {
    const search = document.getElementById('expense-search');
    if (!search) return;

    const activeBtn = document.querySelector('.category-filter-btn.active');
    const targetId = activeBtn ? activeBtn.getAttribute('data-category-id') : null;

    if (filterDropdownInstance) filterDropdownInstance.setValue(targetId || 'ALL');
    search.dispatchEvent(new Event('input'));
}

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
        <div class="space-y-4 select-none flex-1 flex flex-col min-h-0">
            <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 shrink-0">
                <div class="flex items-center gap-3">
                    <div class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                        <i data-lucide="receipt" class="w-5 h-5"></i>
                    </div>
                    <div>
                        <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-none">Review Itemized Receipt</h3>
                        <p class="text-slate-500 dark:text-slate-400 text-xs mt-1">Confirm extracted items and raw LLM category tags before saving.</p>
                    </div>
                </div>
                <span class="px-2.5 py-1 bg-brand-50 dark:bg-brand-950/50 text-brand-700 dark:text-brand-300 text-[11px] font-semibold rounded-full border border-brand-200/70 dark:border-brand-900/60 flex items-center gap-1">
                    <i data-lucide="sparkles" class="w-3 h-3 text-brand-500"></i> AI Parsed
                </span>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 dark:bg-slate-900/50 p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 shrink-0">
                <div>
                    <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Vendor / Store</label>
                    <input type="text" id="itemized-merchant" value="${escapeHTML(merchantName)}" placeholder="Vendor Name" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500" />
                </div>
                <div>
                    <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Receipt Date</label>
                    <input type="text" id="itemized-date" value="${normalizedDate}" readonly placeholder="Select date" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500 cursor-pointer" />
                </div>
                <div>
                    <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">Currency</label>
                    <input type="text" id="itemized-currency" value="${escapeHTML(currencyStr)}" class="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900/70 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 outline-none focus:border-brand-500 uppercase" />
                </div>
            </div>

            <div id="itemized-mismatch-banner" class="hidden p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 rounded-xl text-xs font-medium flex items-center gap-2 shrink-0">
                <i data-lucide="alert-triangle" class="w-4 h-4 text-amber-600 shrink-0"></i>
                <span id="itemized-mismatch-text">Itemized total does not match receipt total. Please review extracted items.</span>
            </div>

            <div class="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col min-h-0 flex-1 sm:flex-none">
                <div id="itemized-items-scroll" class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-thin sm:max-h-[320px]">
                    <table class="w-full table-fixed text-left border-collapse text-xs hidden sm:table">
                        <thead class="sticky top-0 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            <tr>
                                <th class="p-2.5 pl-3 w-[30%]">Item Description</th>
                                <th class="p-2.5 w-12 sm:w-14 text-center">Qty</th>
                                <th class="p-2.5 w-24 text-right">Line Price (€)</th>
                                <th class="p-2.5 w-36 sm:w-44">Category Tag</th>
                                <th class="p-2.5 w-8 text-center"></th>
                            </tr>
                        </thead>
                        <tbody id="itemized-rows-body" class="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50">
                        </tbody>
                    </table>
                    <div id="itemized-rows-cards" class="sm:hidden divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/50"></div>
                </div>
                <div class="p-3 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-2 shrink-0">
                    <button type="button" id="btn-add-item-row" class="px-3.5 py-1.5 bg-brand-50 dark:bg-brand-950/50 hover:bg-brand-100 dark:hover:bg-brand-900/50 text-brand-700 dark:text-brand-300 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all border border-brand-200/70 dark:border-brand-900/60 cursor-pointer">
                        <i data-lucide="plus" class="w-3.5 h-3.5"></i> Add Line Item
                    </button>
                    <div class="flex items-center gap-4 text-xs font-mono">
                        <div>
                            <span class="text-slate-400 dark:text-slate-500 text-[11px] font-sans">Receipt Total:</span>
                            <span class="font-bold text-slate-800 dark:text-slate-200 tabular" id="disp-receipt-total">€${receiptTotalAmount.toFixed(2)}</span>
                        </div>
                        <div>
                            <span class="text-slate-400 dark:text-slate-500 text-[11px] font-sans">Itemized Sum:</span>
                            <span class="font-bold text-emerald-600 dark:text-emerald-400 tabular" id="disp-itemized-sum">€0.00</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="flex items-center justify-between pt-2 shrink-0">
                <button type="button" id="btn-cancel-itemized" class="px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-medium rounded-xl text-xs hover:bg-slate-50 dark:hover:bg-slate-800 transition-all cursor-pointer">
                    Cancel
                </button>
                <button type="button" id="btn-save-itemized-expense" class="px-5 py-2.5 bg-brand-gradient hover:brightness-110 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="check" class="w-4 h-4"></i> Save Itemized Expense
                </button>
            </div>
        </div>
    `;

    showModal(html, () => {
        attachDatePicker(document.getElementById('itemized-date'));
        const body = document.getElementById('itemized-rows-body');
        let currentItems = [...items];
        let itemCatDropdowns = {};

        const fieldInputClasses = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-brand-500 bg-white dark:bg-slate-900/70 text-slate-900 dark:text-slate-100';
        const fieldLabelClasses = 'block text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1';

        const itemRowHTML = (it, index) => `
            <tr class="hover:bg-slate-50/60 dark:hover:bg-slate-800/30 transition-all" data-item-index="${index}">
                <td class="p-2 pl-3 min-w-0">
                    <input type="text" data-field="item_name" value="${escapeHTML(it.item_name)}" placeholder="Item description" class="w-full min-w-0 px-2 py-1 ${fieldInputClasses} font-medium" />
                </td>
                <td class="p-2">
                    <input type="number" min="1" step="1" data-field="quantity" value="${it.quantity}" class="no-spinner w-full min-w-0 px-1.5 py-1 ${fieldInputClasses} font-mono text-center" />
                </td>
                <td class="p-2">
                    <input type="number" min="0" step="0.01" data-field="price" value="${parseFloat(it.price || 0).toFixed(2)}" class="no-spinner w-full min-w-0 px-2 py-1 ${fieldInputClasses} font-mono text-right" />
                </td>
                <td class="p-2">
                    <div class="item-cat-wrap min-w-0" data-row-index="${index}"></div>
                </td>
                <td class="p-2 text-center">
                    <button type="button" data-delete-row="${index}" class="p-1.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all" aria-label="Remove line item">
                        <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                    </button>
                </td>
            </tr>
        `;

        const itemCardHTML = (it, index) => `
            <div class="p-3 space-y-2" data-item-index="${index}">
                <div class="flex items-start gap-2">
                    <div class="flex-1 min-w-0">
                        <label class="${fieldLabelClasses}">Item Description</label>
                        <input type="text" data-field="item_name" value="${escapeHTML(it.item_name)}" placeholder="Item description" class="w-full px-2.5 py-2 ${fieldInputClasses} font-medium" />
                    </div>
                    <button type="button" data-delete-row="${index}" class="mt-5 p-2.5 text-slate-400 dark:text-slate-500 hover:text-red-500 dark:hover:text-red-400 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all shrink-0" aria-label="Remove line item">
                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-2">
                    <div>
                        <label class="${fieldLabelClasses}">Qty</label>
                        <input type="number" min="1" step="1" data-field="quantity" value="${it.quantity}" class="no-spinner w-full px-2.5 py-2 ${fieldInputClasses} font-mono" />
                    </div>
                    <div>
                        <label class="${fieldLabelClasses}">Line Price (€)</label>
                        <input type="number" min="0" step="0.01" data-field="price" value="${parseFloat(it.price || 0).toFixed(2)}" class="no-spinner w-full px-2.5 py-2 ${fieldInputClasses} font-mono" />
                    </div>
                </div>
                <div>
                    <label class="${fieldLabelClasses}">Category Tag</label>
                    <div class="item-cat-wrap min-w-0" data-row-index="${index}"></div>
                </div>
            </div>
        `;

        const renderRows = () => {
            body.innerHTML = currentItems.map((it, index) => itemRowHTML(it, index)).join('');
            const cardsEl = document.getElementById('itemized-rows-cards');
            if (cardsEl) cardsEl.innerHTML = currentItems.map((it, index) => itemCardHTML(it, index)).join('');

            Object.keys(itemCatDropdowns).forEach((k) => itemCatDropdowns[k].destroy());
            itemCatDropdowns = {};
            const scrollContainer = document.getElementById('itemized-items-scroll') || body;
            scrollContainer.querySelectorAll('.item-cat-wrap').forEach((wrap) => {
                const index = parseInt(wrap.getAttribute('data-row-index'), 10);
                // Dropdowns live in BOTH the desktop table and the mobile cards.
                // Key them by medium so edits and saves always read the visible one.
                const medium = wrap.closest('#itemized-rows-body') ? 'table' : 'card';
                const canonicalTag = mapToCanonical(currentItems[index]?.category || 'Miscellaneous');
                itemCatDropdowns[`${medium}-${index}`] = createThemedDropdown({
                    options: CANONICAL_CATEGORIES.map(cat => ({ value: cat, label: cat, color: getCategoryColor(cat) })),
                    value: canonicalTag,
                    size: 'sm',
                    variant: 'brand',
                });
                wrap.appendChild(itemCatDropdowns[`${medium}-${index}`].el);
            });

            if (window.lucide) window.lucide.createIcons();
            attachRowListeners();
            updateCalculations();
        };

        const updateCalculations = () => {
            let sum = 0;
            const isDesktop = window.matchMedia('(min-width: 640px)').matches;
            const priceInputs = isDesktop
                ? document.querySelectorAll('#itemized-rows-body [data-field="price"]')
                : document.querySelectorAll('#itemized-rows-cards [data-field="price"]');
            priceInputs.forEach(priceInput => {
                sum += parseFloat(priceInput ? priceInput.value : 0) || 0;
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
            const scope = document.getElementById('itemized-items-scroll') || body;
            scope.querySelectorAll('input').forEach(input => {
                input.addEventListener('input', updateCalculations);
                input.addEventListener('change', updateCalculations);
            });

            scope.querySelectorAll('[data-delete-row]').forEach(btn => {
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

    // Collect extracted line items from whichever row medium is visible
    const lineItems = [];
    let calculatedTotal = 0;

    const isDesktop = window.matchMedia('(min-width: 640px)').matches;
    const catKeyPrefix = isDesktop ? 'table' : 'card';
    const rowEls = isDesktop
        ? document.querySelectorAll('#itemized-rows-body tr')
        : document.querySelectorAll('#itemized-rows-cards [data-item-index]');
    rowEls.forEach(rowEl => {
        const nameInput = rowEl.querySelector('[data-field="item_name"]');
        const qtyInput = rowEl.querySelector('[data-field="quantity"]');
        const priceInput = rowEl.querySelector('[data-field="price"]');
        const rowIndex = parseInt(rowEl.getAttribute('data-item-index'), 10);
        const catDropdown = itemCatDropdowns[`${catKeyPrefix}-${rowIndex}`];

        const name = nameInput ? nameInput.value.trim() : '';
        const qty = parseFloat(qtyInput ? qtyInput.value : 1) || 1;
        const price = parseFloat(priceInput ? priceInput.value : 0) || 0;
        const cat = catDropdown ? catDropdown.getValue() : 'General';

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
    if (entryMonth !== selectedMonth) {
        const proceed = confirm(`The receipt date (${date}) is in a different month than the active view (${selectedMonth}). Do you wish to save it anyway?`);
        if (!proceed) return;
    }

    // Dominant category (by amount) becomes the parent entry's category
    const catCounts = {};
    lineItems.forEach(it => {
        catCounts[it.category] = (catCounts[it.category] || 0) + it.price;
    });
    const dominantCatName = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const lowerName = String(dominantCatName || '').toLowerCase();
    const dominantCategory = (categories || []).find(c => c.name.toLowerCase() === lowerName)
        || (categories || []).find(c => c.name.toLowerCase() === 'miscellaneous')
        || null;

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
        // 1. Insert into consolidated expense_entries
        const { data: newEntry, error: entryErr } = await supabase
            .from('expense_entries')
            .insert({
                user_id: currentUser.id,
                category_id: dominantCategory ? dominantCategory.id : null,
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
        if (entryMonth !== selectedMonth) {
            setSelectedMonth(entryMonth);
        }
        await reFetchAndRenderCurrentView();
    } catch (err) {
        console.error("Error in save receipt process:", err);
        alert("Failed to save receipt: " + err.message);
    } finally {
        showActionSpinner(false);
    }
});
        renderRows();
    }, { widthClass: 'sm:max-w-2xl', sheet: true });
}

/**
 * Module-level (registered once) click delegation for expanding/collapsing
 * merchant groups in the Merchants view. Registered here so it does not
 * accumulate on re-renders.
 */
function onExpenseListClick(e) {
    // Merchant group expansion (header button)
    const toggle = e.target.closest('.merchant-group-toggle');
    if (toggle) {
        const group = toggle.closest('.merchant-group-element');
        if (!group) return;

        const body = group.querySelector('.merchant-group-body');
        if (body) body.classList.toggle('hidden');

        const chevron = toggle.querySelector('[data-lucide="chevron-right"], i, svg');
        if (chevron) chevron.classList.toggle('rotate-90');
        return;
    }

    // Ignore action buttons (Edit / Delete)
    if (e.target.closest('button')) return;
}

document.addEventListener('click', onExpenseListClick);

