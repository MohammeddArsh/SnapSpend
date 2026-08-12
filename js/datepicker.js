/**
 * Lightweight custom date picker popover for a text input.
 * Mirrors the dropdown component's patterns: glass surface, dark-mode aware,
 * click-outside / Escape / scroll close, and a single shared document listener.
 *
 * Usage:
 *   const dp = attachDatePicker(input, { onChange: (value) => { ... } });
 *   dp.open(); dp.close(); dp.destroy();
 */

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

let activePicker = null;

function refreshIcons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function parseISO(value) {
    if (!value || typeof value !== 'string') return null;
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return isNaN(date.getTime()) ? null : date;
}

function toISO(date) {
    const y = date.getFullYear();
    const mo = String(date.getMonth() + 1).padStart(2, '0');
    const da = String(date.getDate()).padStart(2, '0');
    return `${y}-${mo}-${da}`;
}

function sameDay(a, b) {
    return !!a && !!b
        && a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function dispose(inst) {
    if (!inst) return;
    activePicker = null;
    if (inst.popover && inst.popover.parentNode === inst.wrap) {
        inst.wrap.removeChild(inst.popover);
    }
    if (inst.input && inst.input.parentNode === inst.wrap) {
        inst.wrap.parentNode && inst.wrap.parentNode.insertBefore(inst.input, inst.wrap);
    }
    if (inst.wrap && inst.wrap.parentNode) inst.wrap.parentNode.removeChild(inst.wrap);
}

// Single shared document listeners (mirrors dropdown.js).
document.addEventListener('mousedown', (e) => {
    if (!activePicker) return;
    if (!activePicker.wrap.isConnected) { dispose(activePicker); return; }
    if (!activePicker.wrap.contains(e.target)) activePicker.close();
});

document.addEventListener('scroll', () => {
    if (activePicker && activePicker.isOpen) activePicker.close();
}, true);

window.addEventListener('resize', () => {
    if (activePicker && activePicker.isOpen) activePicker.close();
});

document.addEventListener('keydown', (e) => {
    if (!activePicker || !activePicker.isOpen) return;
    if (e.key === 'Escape') activePicker.close();
});

function render(inst) {
    const year = inst.viewDate.getFullYear();
    const month = inst.viewDate.getMonth();
    const today = new Date();

    const title = inst.viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    const weekdayHeader = WEEKDAYS.map((d) =>
        `<span class="h-7 flex items-center justify-center text-[10px] font-bold text-slate-400 dark:text-slate-500">${d}</span>`
    ).join('');

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-first
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const dayCells = [];
    for (let i = 0; i < firstWeekday; i++) dayCells.push('<span></span>');

    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(year, month, day);
        const isSelected = sameDay(date, inst.selectedDate);
        const isToday = sameDay(date, today);

        const classList = [
            'h-7',
            'flex',
            'items-center',
            'justify-center',
            'rounded-lg',
            'text-xs',
            'cursor-pointer',
            'transition-all',
            'mx-auto',
            'w-7',
        ];
        if (isSelected) {
            classList.push('bg-brand-gradient', 'text-white', 'font-bold', 'shadow-md', 'shadow-indigo-500/25');
        } else {
            classList.push('text-slate-700', 'dark:text-slate-200');
            if (isToday) classList.push('border', 'border-brand-400', 'dark:border-brand-500', 'font-semibold', 'text-brand-600', 'dark:text-brand-300');
            classList.push('hover:bg-brand-50', 'dark:hover:bg-brand-950/50');
        }

        dayCells.push(`<button type="button" data-day="${day}" class="${classList.join(' ')}">${day}</button>`);
    }

    inst.popover.innerHTML = `
        <div class="flex items-center justify-between mb-1.5">
            <button type="button" data-dp-prev aria-label="Previous month" class="p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all">
                <i data-lucide="chevron-left" class="w-4 h-4"></i>
            </button>
            <span class="text-xs font-bold text-slate-700 dark:text-slate-200">${title}</span>
            <button type="button" data-dp-next aria-label="Next month" class="p-1 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-all">
                <i data-lucide="chevron-right" class="w-4 h-4"></i>
            </button>
        </div>
        <div class="grid grid-cols-7 gap-0.5">
            ${weekdayHeader}
            ${dayCells.join('')}
        </div>
    `;

    inst.popover.querySelector('[data-dp-prev]').addEventListener('click', () => {
        inst.viewDate = new Date(inst.viewDate.getFullYear(), inst.viewDate.getMonth() - 1, 1);
        render(inst);
    });
    inst.popover.querySelector('[data-dp-next]').addEventListener('click', () => {
        inst.viewDate = new Date(inst.viewDate.getFullYear(), inst.viewDate.getMonth() + 1, 1);
        render(inst);
    });
    inst.popover.querySelectorAll('[data-day]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const date = new Date(inst.viewDate.getFullYear(), inst.viewDate.getMonth(), Number(btn.getAttribute('data-day')));
            inst.selectedDate = date;
            inst.input.value = toISO(date);
            if (inst.onChange) inst.onChange(inst.input.value);
            inst.close();
        });
    });

    refreshIcons();
}

function position(inst) {
    const rect = inst.input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceAbove > spaceBelow;

    if (openUp) {
        inst.popover.classList.add('bottom-full', 'mb-2');
        inst.popover.classList.remove('top-full', 'mt-2');
    } else {
        inst.popover.classList.add('top-full', 'mt-2');
        inst.popover.classList.remove('bottom-full', 'mb-2');
    }
}

export function attachDatePicker(input, { onChange = null } = {}) {
    if (!input) return null;
    if (activePicker && activePicker.input === input) return activePicker;

    const wrap = document.createElement('div');
    wrap.className = 'relative';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);

    const popover = document.createElement('div');
    popover.className = 'absolute left-auto right-0 z-50 min-w-[264px] max-w-[90vw] glass-surface rounded-2xl shadow-xl overflow-hidden p-2.5 animate-scale-in hidden';
    wrap.appendChild(popover);

    const inst = {
        input,
        wrap,
        popover,
        onChange,
        isOpen: false,
        viewDate: parseISO(input.value) || new Date(),
        selectedDate: parseISO(input.value),
        open() {
            if (inst.isOpen) return;
            render(inst);
            inst.popover.classList.remove('hidden');
            position(inst);
            inst.isOpen = true;
            activePicker = inst;
        },
        close() {
            if (!inst.isOpen) return;
            inst.popover.classList.add('hidden');
            inst.isOpen = false;
            if (activePicker === inst) activePicker = null;
        },
        destroy() {
            dispose(inst);
        },
    };

    input.addEventListener('click', () => {
        if (inst.isOpen) inst.close();
        else inst.open();
    });
    input.addEventListener('focus', () => inst.open());

    return inst;
}