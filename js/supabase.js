import { createClient } from '@supabase/supabase-js';

// Read from Vite env variables or fallback to dynamically configured ones stored in sessionStorage
// sessionStorage is safer than localStorage: credentials auto-clear when browser tab is closed
let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || sessionStorage.getItem('FIN_SUPABASE_URL') || '';
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || sessionStorage.getItem('FIN_SUPABASE_ANON_KEY') || '';

export let supabase = null;

export function isSupabaseConfigured() {
    return !!(supabaseUrl && supabaseAnonKey);
}

export const isConfiguredViaEnv = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

if (isSupabaseConfigured()) {
    try {
        supabase = createClient(supabaseUrl, supabaseAnonKey);
    } catch (e) {
        console.error("Failed to initialize Supabase client:", e);
    }
}

export function saveSupabaseConfig(url, anonKey) {
    sessionStorage.setItem('FIN_SUPABASE_URL', url.trim());
    sessionStorage.setItem('FIN_SUPABASE_ANON_KEY', anonKey.trim());
    supabaseUrl = url.trim();
    supabaseAnonKey = anonKey.trim();
    supabase = createClient(supabaseUrl, supabaseAnonKey);
    return true;
}

export function clearSupabaseConfig() {
    sessionStorage.removeItem('FIN_SUPABASE_URL');
    sessionStorage.removeItem('FIN_SUPABASE_ANON_KEY');
    supabaseUrl = '';
    supabaseAnonKey = '';
    supabase = null;
}
