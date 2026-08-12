/**
 * ThemedDropdown — reusable dropdown component matching the SnapSpend brand
 * (purple → indigo gradient accents, glass surfaces, dark-mode aware).
 *
 * Usage:
 *   const dd = createThemedDropdown({
 *     options: [{ value: 'a', label: 'Alpha' }, ...],
 *     value: 'a',
 *     placeholder: 'Select…',
 *     required: true,
 *     size: 'md' | 'sm',
 *     onChange: (value) => { ... },
 *   });
 *   container.appendChild(dd.el);
 *   dd.setValue('b'); dd.setOptions([...]); dd.getValue(); dd.setError(true); dd.destroy();
 */

const instances = new Set();

// Lucide's createIcons sweeps the whole document; it is idempotent, so a global
// refresh after (re)inserting dropdown markup matches the app's existing pattern.
function refreshIcons() {
    if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}

function syncOpenStates(except) {
    instances.forEach((inst) => {
        if (inst !== except && inst.isOpen) inst.close();
    });
}

// Single global listener: click-outside close.
document.addEventListener('mousedown', (e) => {
    instances.forEach((inst) => {
        if (!inst.el.isConnected) { instances.delete(inst); return; }
        if (inst.isOpen && !inst.el.contains(e.target)) inst.close();
    });
});

// Close open panels when their scroll context moves (capture phase covers
// scrollable modal containers) or the viewport resizes. Scrolls originating
// inside the open panel itself (the user scrolling the option list) are
// ignored so the list can be scrolled without the dropdown closing.
document.addEventListener('scroll', (e) => {
    instances.forEach((inst) => {
        if (inst.isOpen && !(inst.panel && inst.panel.contains(e.target))) inst.close();
    });
}, true);

window.addEventListener('resize', () => {
    instances.forEach((inst) => { if (inst.isOpen) inst.close(); });
});

function triggerClasses(size, variant) {
    const base = [
        'w-full',
        'flex',
        'items-center',
        'justify-between',
        'gap-2',
        'bg-white',
        'dark:bg-slate-900/70',
        'border',
        'border-slate-200',
        'dark:border-slate-700',
        'outline-none',
        'rounded-xl',
        'transition-all',
        'text-xs',
        'text-left',
        'cursor-pointer',
        'hover:border-brand-300',
        'dark:hover:border-brand-600',
        'focus:border-brand-500',
        'focus:ring-2',
        'focus:ring-brand-500/20',
    ];
    if (variant === 'brand') {
        base.splice(base.indexOf('bg-white'), 1);
        base.splice(base.indexOf('dark:bg-slate-900/70'), 1);
        base.splice(base.indexOf('border-slate-200'), 1);
        base.splice(base.indexOf('dark:border-slate-700'), 1);
        base.push(
            'bg-brand-50/50',
            'dark:bg-brand-950/30',
            'border-brand-200/70',
            'dark:border-brand-900/60',
            'font-semibold',
        );
    }
    if (size === 'sm') {
        base.splice(base.indexOf('rounded-xl'), 1);
        base.push('px-2', 'py-1.5', 'text-[11px]', 'rounded-lg', 'font-medium');
    } else {
        base.push('px-3.5', 'py-2.5', 'font-medium', 'font-sans');
    }
    return base.join(' ');
}

export function createThemedDropdown({
    options = [],
    value = '',
    placeholder = 'Select…',
    required = false,
    size = 'md',
    variant = 'default',
    onChange = null,
} = {}) {
    const root = document.createElement('div');
    root.className = 'relative ss-dropdown';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = triggerClasses(size, variant);
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    const labelWrap = document.createElement('span');
    labelWrap.className = 'flex items-center gap-2 min-w-0';

    const triggerColorDot = document.createElement('span');
    triggerColorDot.className = 'w-2 h-2 rounded-full shrink-0 hidden';

    const triggerLabel = document.createElement('span');
    triggerLabel.className = 'truncate text-slate-700 dark:text-slate-300';

    labelWrap.appendChild(triggerColorDot);
    labelWrap.appendChild(triggerLabel);

const chevronWrap = document.createElement('span');
chevronWrap.className = 'flex items-center shrink-0 text-slate-400 dark:text-slate-500 transition-transform duration-200';
chevronWrap.innerHTML = '<i data-lucide="chevron-down" class="w-4 h-4"></i>';

trigger.appendChild(labelWrap);
trigger.appendChild(chevronWrap);

    const panel = document.createElement('div');
    panel.className = [
        'absolute',
        'left-0',
        'right-0',
        'top-full',
        'mt-2',
        'z-50',
        'glass-surface',
        'rounded-2xl',
        'shadow-xl',
        'overflow-hidden',
        'max-h-56',
        'overflow-y-auto',
        'scrollbar-thin',
        'py-1',
        'animate-scale-in',
        'hidden',
    ].join(' ');
    panel.setAttribute('role', 'listbox');

    root.appendChild(trigger);
    root.appendChild(panel);
    requestAnimationFrame(() => refreshIcons());

    const state = {
        options,
        value: '',
        required,
        onChange,
        size,
        isOpen: false,
        selectedIndex: -1,
    };

    let selectedLabel = '';

    function renderOptions() {
        panel.innerHTML = '';
        state.selectedIndex = -1;
        state.options.forEach((opt, idx) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = [
                'w-full',
                'flex',
                'items-center',
                'justify-between',
                'gap-2',
                'px-3.5',
                'py-2.5',
                'text-left',
                'text-xs',
                'cursor-pointer',
                'transition-colors',
                'hover:bg-brand-50',
                'dark:hover:bg-brand-950/50',
                'hover:text-brand-700',
                'dark:hover:text-brand-300',
            ].join(' ');

            const isSelected = String(opt.value) === String(state.value);

            if (isSelected) {
                item.classList.add('text-brand-600', 'dark:text-brand-400', 'font-semibold', 'bg-brand-50/60', 'dark:bg-brand-950/30');
                state.selectedIndex = idx;
            } else {
                item.classList.add('text-slate-700', 'dark:text-slate-300', 'font-medium');
            }

            item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(isSelected));
            item.dataset.value = opt.value;

            const labelWrap = document.createElement('span');
            labelWrap.className = 'flex items-center gap-2 min-w-0';

            if (opt.color) {
                const dot = document.createElement('span');
                dot.className = 'w-2 h-2 rounded-full shrink-0';
                dot.style.backgroundColor = opt.color;
                labelWrap.appendChild(dot);
            }

            const label = document.createElement('span');
            label.className = 'truncate';
            label.textContent = opt.label;
            labelWrap.appendChild(label);

            const checkWrap = document.createElement('span');
            checkWrap.className = `flex items-center shrink-0 text-brand-600 dark:text-brand-400 transition-opacity duration-150 ${isSelected ? 'opacity-100' : 'opacity-0'}`;
            checkWrap.innerHTML = '<i data-lucide="check" class="w-3.5 h-3.5"></i>';

            item.appendChild(labelWrap);
            item.appendChild(checkWrap);
            item.addEventListener('click', () => selectValue(opt.value));
            item.addEventListener('mouseenter', () => {
                state.selectedIndex = idx;
            });

            panel.appendChild(item);
        });
        refreshIcons();
    }

    function updateTrigger() {
        const opt = state.options.find((o) => String(o.value) === String(state.value));
        selectedLabel = opt ? opt.label : '';
        triggerLabel.textContent = opt ? opt.label : placeholder;
        if (opt && opt.color) {
            triggerColorDot.style.backgroundColor = opt.color;
            triggerColorDot.classList.remove('hidden');
        } else {
            triggerColorDot.classList.add('hidden');
        }
        if (variant === 'brand') {
            triggerLabel.classList.toggle('text-brand-400', !opt);
            triggerLabel.classList.toggle('dark:text-brand-400/80', !opt);
            triggerLabel.classList.toggle('!text-brand-700', !!opt);
            triggerLabel.classList.toggle('dark:!text-brand-300', !!opt);
        } else {
            triggerLabel.classList.toggle('text-slate-400', !opt);
            triggerLabel.classList.toggle('dark:text-slate-500', !opt);
            triggerLabel.classList.toggle('!text-slate-700', !!opt);
            triggerLabel.classList.toggle('dark:!text-slate-300', !!opt);
        }
        if (state.error) setError(false);
    }

    function setError(show) {
        state.error = !!show;
        const classes = [
            'border-red-400', 'dark:border-red-500',
            'ring-2', 'ring-red-500/20',
        ];
        trigger.classList.toggle('border-red-400', show);
        trigger.classList.toggle('dark:border-red-500', show);
        trigger.classList.toggle('ring-2', show);
        trigger.classList.toggle('ring-red-500/20', show);
        if (show) trigger.focus();
    }

    function selectValue(val) {
        if (String(state.value) !== String(val)) {
            state.value = val;
            renderOptions();
            updateTrigger();
            if (state.onChange) state.onChange(val);
        }
        close();
    }

    // Panels live inside scrollable containers (modals, CSV grid, receipt table),
    // so pick direction + max-height from the space available in the nearest
    // scrollable ancestor (falling back to the viewport).
    function openMetrics() {
        const tr = trigger.getBoundingClientRect();
        let sc = root.parentElement;
        let scRect = null;
        while (sc) {
            const style = getComputedStyle(sc);
            if (/(auto|scroll|hidden)/.test(style.overflowY)) { scRect = sc.getBoundingClientRect(); break; }
            sc = sc.parentElement;
        }
        let spaceBelow = Math.max(0, window.innerHeight - tr.bottom);
        let spaceAbove = Math.max(0, tr.top);
        if (scRect) {
            spaceBelow = Math.min(spaceBelow, scRect.bottom - tr.bottom);
            spaceAbove = Math.min(spaceAbove, tr.top - scRect.top);
        }
        const openUp = spaceAbove > spaceBelow;
        return { openUp, maxH: Math.min(Math.max(80, (openUp ? spaceAbove : spaceBelow) - 8), 224) };
    }

    function positionPanel() {
        const { openUp, maxH } = openMetrics();
        panel.style.maxHeight = `${maxH}px`;
        if (openUp) {
            panel.classList.add('bottom-full', 'mb-2');
            panel.classList.remove('top-full', 'mt-2');
        } else {
            panel.classList.add('top-full', 'mt-2');
            panel.classList.remove('bottom-full', 'mb-2');
        }
    }

    function open() {
        if (state.isOpen) return;
        syncOpenStates(inst);
        state.isOpen = true;
        panel.classList.remove('hidden');
        positionPanel();
        trigger.setAttribute('aria-expanded', 'true');
        chevronWrap.classList.add('rotate-180', 'text-brand-500', 'dark:text-brand-400');
        if (state.selectedIndex >= 0) {
            const items = panel.querySelectorAll('[role="option"]');
            if (items[state.selectedIndex]) items[state.selectedIndex].focus();
        } else {
            trigger.focus();
        }
        refreshIcons();
    }

    function close() {
        if (!state.isOpen) return;
        state.isOpen = false;
        panel.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
        chevronWrap.classList.remove('rotate-180', 'text-brand-500', 'dark:text-brand-400');
    }

    function toggle() {
        if (state.isOpen) close(); else open();
    }

    function selectByIndex(idx) {
        const opt = state.options[idx];
        if (opt) selectValue(opt.value);
    }

    function onKeydown(e) {
        if (e.key === 'Escape') { close(); return; }
        if (!state.isOpen && e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !state.isOpen) { open(); e.preventDefault(); return; }

        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const direction = e.key === 'ArrowDown' ? 1 : -1;
            const max = state.options.length - 1;
            if (max < 0) return;
            if (state.selectedIndex === -1) state.selectedIndex = direction === 1 ? 0 : max;
            else state.selectedIndex = Math.min(max, Math.max(0, state.selectedIndex + direction));
            const items = panel.querySelectorAll('[role="option"]');
            if (items[state.selectedIndex]) items[state.selectedIndex].focus();
            return;
        }

        if (e.key === 'Enter' && state.isOpen) {
            e.preventDefault();
            if (state.selectedIndex >= 0) selectByIndex(state.selectedIndex);
            return;
        }

        if ((e.key === ' ' || e.key === 'Enter') && !state.isOpen) {
            e.preventDefault();
            open();
        }
    }

    trigger.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    trigger.addEventListener('keydown', onKeydown);
    panel.addEventListener('keydown', (e) => {
        e.stopPropagation();
        onKeydown(e);
    });

    const inst = {
        el: root,
        panel,
        getValue: () => state.value,
        setValue: (val) => { state.value = val; renderOptions(); updateTrigger(); },
        setOptions: (opts) => {
            const current = state.value;
            state.options = opts;
            if (required && !opts.some((o) => String(o.value) === String(current))) {
                state.value = '';
            }
            renderOptions();
            updateTrigger();
        },
        setPlaceholder: (text) => { placeholder = text; updateTrigger(); },
        setError,
        open,
        close,
        destroy: () => {
            instances.delete(inst);
            trigger.removeEventListener('click', toggle);
            trigger.removeEventListener('keydown', onKeydown);
            root.remove();
        },
    };

    Object.defineProperty(inst, 'isOpen', { get: () => state.isOpen });
    instances.add(inst);

    state.value = value;
    renderOptions();
    updateTrigger();

    return inst;
}