-- =========================================================================
-- SNAPSPEND FINANCE TRACKER — FINAL PRODUCTION SCHEMA
-- Use this script to set up a fresh database on Supabase from scratch.
-- Includes tables, constraints, indices, triggers, RLS policies, and seed handlers.
-- =========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =========================================================================
-- 1. INCOME SOURCES
-- =========================================================================
CREATE TABLE public.income_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, name)
);

ALTER TABLE public.income_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own income sources" ON public.income_sources
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 2. INCOME ENTRIES
-- =========================================================================
CREATE TABLE public.income_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    source_id UUID NOT NULL REFERENCES public.income_sources(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    date_credited DATE NOT NULL,
    note TEXT,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.income_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own income entries" ON public.income_entries
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_income_entries_user_month ON public.income_entries(user_id, month);

-- =========================================================================
-- 3. BANK ACCOUNTS
-- =========================================================================
CREATE TABLE public.bank_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    bank_name TEXT NOT NULL,
    account_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, bank_name)
);

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own bank accounts" ON public.bank_accounts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 4. BANK MONTHLY BALANCES
-- =========================================================================
CREATE TABLE public.bank_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    bank_id UUID NOT NULL REFERENCES public.bank_accounts(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    opening_balance NUMERIC NOT NULL DEFAULT 0,
    closing_balance NUMERIC NOT NULL DEFAULT 0,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, bank_id, month)
);

ALTER TABLE public.bank_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own bank balances" ON public.bank_balances
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_bank_balances_user_month ON public.bank_balances(user_id, month);

-- =========================================================================
-- 5. INVESTMENT CATEGORIES
-- =========================================================================
CREATE TABLE public.investment_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, name)
);

ALTER TABLE public.investment_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own investment categories" ON public.investment_categories
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 6. HOLDINGS (Manual assets and SIPs)
-- =========================================================================
CREATE TABLE public.holdings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    category_id UUID NOT NULL REFERENCES public.investment_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'mutual_fund', -- e.g. fd, stock, gold, us_fund, mutual_fund, liquid_fund, pf, custom
    is_recurring BOOLEAN NOT NULL DEFAULT false,
    monthly_contribution NUMERIC NOT NULL DEFAULT 0, -- Set if recurring (SIP)
    current_value NUMERIC NOT NULL DEFAULT 0, -- User editable
    notes TEXT,
    -- One time fields (FD/SGB)
    invested_amount NUMERIC NOT NULL DEFAULT 0, -- Initial investment principal
    interest_rate NUMERIC, -- FD %, e.g., 7.1
    start_date DATE,
    maturity_date DATE,
    fd_bank_name TEXT, -- FD bank name
    -- Closure fields
    is_closed BOOLEAN NOT NULL DEFAULT false,
    closure_value NUMERIC,
    closure_date DATE,
    closure_note TEXT,
    currency VARCHAR(3) NOT NULL DEFAULT 'INR', -- 'INR' or 'USD'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own holdings" ON public.holdings
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 7. INVESTMENT CONTRIBUTIONS (History of contributions for recurring holdings)
-- =========================================================================
CREATE TABLE public.investment_contributions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    holding_id UUID NOT NULL REFERENCES public.holdings(id) ON DELETE CASCADE,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    amount NUMERIC NOT NULL,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, holding_id, month)
);

ALTER TABLE public.investment_contributions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own investment contributions" ON public.investment_contributions
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_investment_contributions_user_month ON public.investment_contributions(user_id, month);

-- =========================================================================
-- 8. INVESTMENT WITHDRAWALS
-- =========================================================================
CREATE TABLE public.investment_withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    holding_id UUID NOT NULL REFERENCES public.holdings(id) ON DELETE CASCADE,
    amount NUMERIC NOT NULL,
    date DATE NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.investment_withdrawals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Manage own investment withdrawals" ON public.investment_withdrawals
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 1. EXPENSE CATEGORIES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    name TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE (user_id, name)
);

ALTER TABLE public.expense_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manage own expense categories" ON public.expense_categories;
CREATE POLICY "Manage own expense categories" ON public.expense_categories
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================================================
-- 2. CONSOLIDATED EXPENSE ENTRIES (Manual & Scanned)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    date DATE NOT NULL,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    merchant TEXT,             -- Vendor name (e.g. "PENNY-MARKT GMBH" or "Coffee Shop")
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
    
    -- Entry Source Metadata
    entry_type VARCHAR(10) NOT NULL DEFAULT 'manual' 
        CHECK (entry_type IN ('manual', 'scanned')),
    
    -- Optional Audit Store for Scanned Receipts
    raw_json JSONB,            -- Stores full raw Gemini output for audit/re-parsing
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manage own expense entries" ON public.expense_entries;
CREATE POLICY "Manage own expense entries" ON public.expense_entries
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_expense_entries_user_month ON public.expense_entries(user_id, month);
CREATE INDEX IF NOT EXISTS idx_expense_entries_user_type ON public.expense_entries(user_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_expense_entries_raw_json ON public.expense_entries USING gin (raw_json);

-- =========================================================================
-- 3. EXPENSE RECEIPT ITEMS (Line-item breakdowns for scanned receipts)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    expense_id UUID NOT NULL REFERENCES public.expense_entries(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2),
    price NUMERIC(12, 2) NOT NULL,
    category TEXT,            -- Specific granular tag (e.g. "Pantry", "Beverages", "Deposit")
    confidence NUMERIC(3, 2) DEFAULT 0.95,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.expense_receipt_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manage own expense receipt items" ON public.expense_receipt_items;
CREATE POLICY "Manage own expense receipt items" ON public.expense_receipt_items
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_receipt_items_expense_id ON public.expense_receipt_items(expense_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_user_category ON public.expense_receipt_items(user_id, category);


-- =========================================================================
-- TRIGGERS FOR Month AUTO-DERIVATION (Data Integrity)
-- Auto-derives YYYY-MM values from input dates to prevent data mismatch.
-- =========================================================================

-- 1. Income Entries Trigger
CREATE OR REPLACE FUNCTION set_income_month()
RETURNS TRIGGER AS $$
BEGIN
  NEW.month := to_char(NEW.date_credited, 'YYYY-MM');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_income_month ON public.income_entries;
CREATE TRIGGER trg_income_month
  BEFORE INSERT OR UPDATE ON public.income_entries
  FOR EACH ROW EXECUTE FUNCTION set_income_month();

-- 2. Expense Entries Trigger
CREATE OR REPLACE FUNCTION set_expense_month()
RETURNS TRIGGER AS $$
BEGIN
  NEW.month := to_char(NEW.date, 'YYYY-MM');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expense_month ON public.expense_entries;
CREATE TRIGGER trg_expense_month
  BEFORE INSERT OR UPDATE ON public.expense_entries
  FOR EACH ROW EXECUTE FUNCTION set_expense_month();


-- =========================================================================
-- AUTOMATIC SEEDING ON USER REGISTRATION & PROFILES
-- This function and trigger automatically seed a new user with the default:
-- - User Profile mapping username and email
-- - Income sources (Salary, Bonus, Other)
-- - Bank accounts (HDFC, IDFC, SBI)
-- - Expense categories (Travel, Trips / Outings, Shopping, Miscellaneous)
-- - Investment categories (Mutual Funds, US Funds, Liquid Funds, PF, Gold (SGB), Fixed Deposits, Stocks, Other Assets)
-- =========================================================================

-- Create profiles table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index on username for fast queries
CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username);

-- Enable RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Set up policies
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
CREATE POLICY "Allow public read access to profiles" ON public.profiles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow individual update access" ON public.profiles;
CREATE POLICY "Allow individual update access" ON public.profiles
    FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Trigger definition
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
    username_val TEXT;
BEGIN
    -- Extract username from user metadata, fallback to email prefix if not supplied
    username_val := LOWER(COALESCE(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
    
    -- Ensure username doesn't exist, if it does, append random digits to prevent registration failure
    IF EXISTS (SELECT 1 FROM public.profiles WHERE username = username_val) THEN
        username_val := username_val || floor(random() * 10000)::text;
    END IF;

    -- Create profile entry
    INSERT INTO public.profiles (id, username, email)
    VALUES (new.id, username_val, new.email)
    ON CONFLICT (id) DO NOTHING;

    -- Seed Income Sources
    INSERT INTO public.income_sources (user_id, name) VALUES
        (new.id, 'Salary'),
        (new.id, 'Bonus'),
        (new.id, 'Other')
    ON CONFLICT (user_id, name) DO NOTHING;

    -- Seed Bank Accounts
    INSERT INTO public.bank_accounts (user_id, bank_name) VALUES
        (new.id, 'HDFC'),
        (new.id, 'IDFC'),
        (new.id, 'SBI')
    ON CONFLICT (user_id, bank_name) DO NOTHING;

    -- Seed Expense Categories
    INSERT INTO public.expense_categories (user_id, name) VALUES
        (new.id, 'Travel'),
        (new.id, 'Trips / Outings'),
        (new.id, 'Shopping'),
        (new.id, 'Miscellaneous')
    ON CONFLICT (user_id, name) DO NOTHING;

    -- Seed Investment Categories
    INSERT INTO public.investment_categories (user_id, name, is_recurring) VALUES
        (new.id, 'Mutual Funds', true),
        (new.id, 'US Funds', true),
        (new.id, 'Liquid Funds', true),
        (new.id, 'PF', true),
        (new.id, 'Gold (SGB)', false),
        (new.id, 'Fixed Deposits', false),
        (new.id, 'Stocks', false),
        (new.id, 'Other Assets', false)
    ON CONFLICT (user_id, name) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on auth.users (runs post-signup)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
