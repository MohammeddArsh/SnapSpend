// js/theme.mjs
// Shared light/dark theme toggle for the standalone evaluation page
// (eval.html). Mirrors the behaviour of the main app's toggle: persisted in
// localStorage under "snapspend-theme" and synced to the theme-color meta tag.
// The pre-paint bootstrap script inside each page's <head> applies the saved
// theme before this module runs.

export function setupThemeToggle() {
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