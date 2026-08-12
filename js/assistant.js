import { currentUser } from './app.js';
import { escapeHTML, formatCurrency } from './utils.js';
import { askAssistantClient } from './assistantClient.js';

const SUGGESTED_QUESTIONS = [
    "How much did I spend on Groceries this month?",
    "What was my biggest single expense this year?",
    "Show my spending per category this month"
];

let messages = [];

let chatHeightEl = null;

function applyChatHeight() {
    if (!chatHeightEl || !chatHeightEl.isConnected) return;
    const vv = window.visualViewport;
    const viewportH = (vv && vv.height) ? vv.height : window.innerHeight;
    const top = chatHeightEl.getBoundingClientRect().top;
    const main = chatHeightEl.closest('main');
    const mainBottomPad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
    const bodyBottomPad = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    const gap = 8;
    const h = viewportH - top - mainBottomPad - bodyBottomPad - gap;
    // No arbitrary floor: if the available space is tiny (small phone, open
    // keyboard) the shell shrinks to fit instead of spilling a dead zone that
    // makes the page itself scroll. Only the messages pane scrolls (the shell
    // itself is overflow-hidden).
    const safe = Math.max(h, 0);
    chatHeightEl.style.height = `${safe}px`;
    chatHeightEl.style.maxHeight = `${safe}px`;
}

if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', applyChatHeight);
}

window.addEventListener('load', applyChatHeight);

export async function render(container, selectedMonth) {
    if (!currentUser) return;

    container.innerHTML = `
        <div id="assistant-chat" class="max-w-3xl mx-auto flex flex-col overflow-hidden">
            <!-- Assistant Header -->
            <div class="flex items-center gap-3 pb-3">
                <div class="bg-brand-gradient p-2.5 rounded-xl text-white shadow-lg shadow-indigo-500/30">
                    <i data-lucide="bot" class="w-5 h-5"></i>
                </div>
                <div>
                    <h2 class="text-xl font-black tracking-tight text-slate-900 dark:text-white leading-none">AI Expense Assistant</h2>
                    <p class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">Ask anything about your spending.</p>
                </div>
            </div>

            <!-- Messages Area -->
            <div id="assistant-messages" class="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-3 pr-1 pb-3 rounded-2xl scrollbar-thin"></div>

            <!-- Suggested Questions (hidden once chatting) -->
            <div id="assistant-suggestions" class="pb-2">
                <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-2">I can answer questions about your income and spending. Try asking:</p>
                <div class="flex flex-wrap gap-2">
                    ${SUGGESTED_QUESTIONS.map(q => `
                        <button class="suggestion-chip text-xs font-semibold text-brand-700 dark:text-brand-300 bg-brand-50 dark:bg-brand-950/50 hover:bg-brand-100 dark:hover:bg-brand-900/50 border border-brand-200/70 dark:border-brand-900/60 rounded-full px-3 py-1.5 transition-all cursor-pointer">
                            ${escapeHTML(q)}
                        </button>
                    `).join('')}
                </div>
            </div>

            <!-- Composer -->
            <div class="glass-surface dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl p-2.5 shadow-lg shadow-slate-900/5 dark:shadow-black/30 flex items-end gap-2">
                <textarea id="assistant-input" rows="1" placeholder="Ask about your spending…" class="flex-1 resize-none outline-none text-sm px-2 py-1.5 max-h-32 text-slate-800 dark:text-slate-200 placeholder:text-slate-400 dark:placeholder:text-slate-500 bg-transparent"></textarea>
                <button id="assistant-send" class="shrink-0 bg-brand-gradient hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-xs font-semibold shadow-lg shadow-indigo-500/25 transition-all flex items-center gap-1.5 cursor-pointer">
                    <i data-lucide="send" class="w-4 h-4"></i> Ask
                </button>
            </div>
        </div>
    `;

    chatHeightEl = container.querySelector('#assistant-chat');
    window.scrollTo({ top: 0 });
    applyChatHeight();

    if (window.lucide) window.lucide.createIcons();
    applyChatHeight();
    bindAssistantEvents();
    if (messages.length > 0) {
        document.getElementById('assistant-suggestions')?.classList.add('hidden');
    }
    renderPersistedMessages();
    applyChatHeight();
}

function bindAssistantEvents() {
    const input = document.getElementById('assistant-input');
    const sendBtn = document.getElementById('assistant-send');
    const messagesEl = document.getElementById('assistant-messages');
    const suggestionsEl = document.getElementById('assistant-suggestions');

    const resizeInput = () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 128) + 'px';
    };
    input.addEventListener('input', resizeInput);

    const send = () => {
        const question = input.value.trim();
        if (!question) return;
        input.value = '';
        resizeInput();
        suggestionsEl.classList.add('hidden');
        addUserMessage(question);
        askAssistant(question);
    };

    sendBtn.addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    });

    suggestionsEl.querySelectorAll('.suggestion-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            suggestionsEl.classList.add('hidden');
            const question = chip.textContent.trim();
            addUserMessage(question);
            askAssistant(question);
        });
    });

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildUserBubble(question) {
    return `
        <div class="flex justify-end animate-fade-in">
            <div class="max-w-[85%] bg-brand-gradient text-white rounded-2xl rounded-br-md px-4 py-2.5 text-xs leading-relaxed shadow-lg shadow-indigo-500/25">
                ${escapeHTML(question)}
            </div>
        </div>
    `;
}

function addUserMessage(question) {
    messages.push({ role: 'user', content: question });
    const el = document.getElementById('assistant-messages');
    el.insertAdjacentHTML('beforeend', buildUserBubble(question));
    scrollToBottom();
}

function addTypingIndicator() {
    const el = document.getElementById('assistant-messages');
    el.insertAdjacentHTML('beforeend', `
        <div class="flex justify-start" id="assistant-typing">
            <div class="glass-surface dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-brand-400 rounded-full animate-bounce" style="animation-delay: 0ms"></span>
                <span class="w-1.5 h-1.5 bg-brand-500 rounded-full animate-bounce" style="animation-delay: 150ms"></span>
                <span class="w-1.5 h-1.5 bg-brand-600 rounded-full animate-bounce" style="animation-delay: 300ms"></span>
            </div>
        </div>
    `);
    scrollToBottom();
}

function removeTypingIndicator() {
    document.getElementById('assistant-typing')?.remove();
}

async function askAssistant(question) {
    const sendBtn = document.getElementById('assistant-send');
    sendBtn.disabled = true;
    addTypingIndicator();

    try {
        const result = await askAssistantClient(question);
        if (result.error) throw new Error(result.error);
        const replyData = { content: result.answer, rows: result.rows, toolRounds: result.toolRounds };
        messages.push({ role: 'assistant', ...replyData });
        renderAssistantReply(replyData);
    } catch (err) {
        renderAssistantError(err.message);
    } finally {
        removeTypingIndicator();
        sendBtn.disabled = false;
        if (window.lucide) window.lucide.createIcons();
    }
}

function buildAssistantReply(data) {
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const hasRows = rows.length > 0;
    // Only attach the raw-result table when a single tool call produced the
    // answer; multi-round answers merge several queries and the table would
    // mismatch (and mislead) the summary prose.
    const isTabular = hasRows && (data.toolRounds ?? 1) === 1 && rows.length <= 50 && rows[0] && typeof rows[0] === 'object';

    return `
        <div class="flex justify-start animate-fade-in">
            <div class="max-w-[95%] glass-surface dark:bg-slate-900/70 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm space-y-2.5">
                <p class="text-xs leading-relaxed text-slate-800 dark:text-slate-200 whitespace-pre-line">${escapeHTML(data.content || "I couldn't find an answer for that. Try rephrasing your question.")}</p>

                ${isTabular ? `
                    <details class="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 overflow-hidden">
                        <summary class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider px-3 py-2 cursor-pointer select-none hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                            ${rows.length} result row${rows.length === 1 ? '' : 's'}
                        </summary>
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[11px] font-mono">
                                <thead>
                                    <tr class="bg-slate-100 dark:bg-slate-800 text-[11px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                                        ${Object.keys(rows[0]).map(k => `<th class="px-3 py-1.5 font-semibold">${escapeHTML(k)}</th>`).join('')}
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900/60">
                                    ${rows.map(row => `
                                        <tr class="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all">
                                            ${Object.values(row).map(v => `<td class="px-3 py-1.5 text-slate-700 dark:text-slate-300">${escapeHTML(v === null || v === undefined ? '' : typeof v === 'number' ? formatCurrency(v) : String(v))}</td>`).join('')}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </details>
                ` : ''}
            </div>
        </div>
    `;
}

function renderAssistantReply(data) {
    const el = document.getElementById('assistant-messages');
    el.insertAdjacentHTML('beforeend', buildAssistantReply(data));
    scrollToBottom();
}

function renderPersistedMessages() {
    const el = document.getElementById('assistant-messages');
    if (!el) return;
    el.innerHTML = '';
    messages.forEach(m => {
        if (m.role === 'user') {
            el.insertAdjacentHTML('beforeend', buildUserBubble(m.content));
        } else if (m.role === 'assistant') {
            el.insertAdjacentHTML('beforeend', buildAssistantReply(m));
        }
    });
}

function renderAssistantError(message) {
    const el = document.getElementById('assistant-messages');
    el.insertAdjacentHTML('beforeend', `
        <div class="flex justify-start animate-fade-in">
            <div class="max-w-[85%] bg-rose-50 dark:bg-rose-950/50 border border-rose-100 dark:border-rose-900/60 rounded-2xl rounded-bl-md px-4 py-2.5 shadow-sm">
                <p class="text-[11px] font-semibold text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <i data-lucide="alert-circle" class="w-3.5 h-3.5"></i> ${escapeHTML(message)}
                </p>
            </div>
        </div>
    `);
    scrollToBottom();
}

function scrollToBottom() {
    const el = document.getElementById('assistant-messages');
    if (el) el.scrollTop = el.scrollHeight;
}
