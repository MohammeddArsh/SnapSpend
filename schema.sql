-- =========================================================================
-- SNAPSPEND EXPENSE TRACKER — PRODUCTION SCHEMA
-- Target database: snapspend_db (Supabase-hosted PostgreSQL).
-- Use this script to set up a fresh database on Supabase from scratch.
-- Includes tables, constraints, indices, triggers, RLS policies, and seed handlers.
--
-- NOTE: CREATE DATABASE snapspend_db is intentionally omitted because
-- Supabase provisions the database; this script runs inside snapspend_db.
--
-- If you are upgrading an EXISTING database, run the migrations in
-- supabase/migrations/ instead (they preserve user data).
-- =========================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Resolve all unqualified table/function references against the public schema
SET search_path TO public;

-- =========================================================================
-- 1. PROFILES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profiles_username ON public.profiles (username);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
CREATE POLICY "Allow public read access to profiles" ON public.profiles
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "Allow individual update access" ON public.profiles;
CREATE POLICY "Allow individual update access" ON public.profiles
    FOR ALL USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =========================================================================
-- 2. INCOME SOURCES
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
-- 3. INCOME ENTRIES
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
-- 4. EXPENSE CATEGORIES (canonical set: Groceries, Pharmacy, Travel, Households, Miscellaneous)
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
-- 5. EXPENSE ENTRIES (Manual & Scanned)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    amount NUMERIC(12, 2) NOT NULL,
    date DATE NOT NULL,
    month VARCHAR(7) NOT NULL, -- Format: YYYY-MM
    merchant TEXT,             -- Vendor name (e.g. "PENNY-MARKT GMBH" or "Coffee Shop")
    note TEXT,                 -- Free-text description
    currency VARCHAR(3) NOT NULL DEFAULT 'EUR',

    -- Entry Source Metadata
    entry_type VARCHAR(10) NOT NULL DEFAULT 'manual'
        CHECK (entry_type IN ('manual', 'scanned')),

    -- Optional Audit Store for Scanned Receipts
    raw_json JSONB,            -- Stores full raw parser output for audit/re-parsing

    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.expense_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Manage own expense entries" ON public.expense_entries;
CREATE POLICY "Manage own expense entries" ON public.expense_entries
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_expense_entries_user_month ON public.expense_entries(user_id, month);
CREATE INDEX IF NOT EXISTS idx_expense_entries_user_category ON public.expense_entries(user_id, category_id);
CREATE INDEX IF NOT EXISTS idx_expense_entries_user_type ON public.expense_entries(user_id, entry_type);
CREATE INDEX IF NOT EXISTS idx_expense_entries_raw_json ON public.expense_entries USING gin (raw_json);

-- =========================================================================
-- 6. EXPENSE RECEIPT ITEMS (Line-item breakdowns for scanned receipts)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.expense_receipt_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    expense_id UUID NOT NULL REFERENCES public.expense_entries(id) ON DELETE CASCADE,
    item_name TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 1,
    unit_price NUMERIC(12, 2),
    price NUMERIC(12, 2) NOT NULL,
    category TEXT,            -- Canonical category (Groceries/Pharmacy/Travel/Households/Miscellaneous)
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
-- AUTOMATIC SEEDING ON USER REGISTRATION
-- Creates the profile and the canonical income sources & expense categories.
-- =========================================================================
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

    -- Seed canonical Expense Categories
    INSERT INTO public.expense_categories (user_id, name) VALUES
        (new.id, 'Groceries'),
        (new.id, 'Pharmacy'),
        (new.id, 'Travel'),
        (new.id, 'Households'),
        (new.id, 'Miscellaneous')
    ON CONFLICT (user_id, name) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger on auth.users (runs post-signup)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
