-- =========================================================================
-- SNAPSPEND MIGRATION 0001 — CANONICAL CATEGORIES & CLEANUP
-- Run this once on databases created from the OLD schema.sql.
--
-- What it does:
--  1. Adds the missing `category_id` and `note` columns to expense_entries.
--  2. Remaps every legacy expense category onto the 4 canonical ones
--     (Groceries, Pharmacy, Outings, Miscellaneous) and merges duplicates.
--  3. Rewrites granular expense_receipt_items.category tags to canonical names.
--  4. Drops the bank & investment tables (modules removed from the app).
-- =========================================================================

-- 1. Ensure expense_entries has the columns the app writes today
ALTER TABLE public.expense_entries ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL;
ALTER TABLE public.expense_entries ADD COLUMN IF NOT EXISTS note TEXT;
CREATE INDEX IF NOT EXISTS idx_expense_entries_user_category ON public.expense_entries(user_id, category_id);

-- 2. Remap legacy category rows onto the canonical 4
DO $$
DECLARE
    r RECORD;
    canonical_name TEXT;
    target_id UUID;
BEGIN
    FOR r IN SELECT id, user_id, name FROM public.expense_categories LOOP
        canonical_name := CASE
            WHEN r.name = 'Groceries'   THEN 'Groceries'
            WHEN r.name = 'Pharmacy'    THEN 'Pharmacy'
            WHEN r.name = 'Outings' OR r.name = 'Trips / Outings' OR r.name = 'Travel' THEN 'Outings'
            WHEN r.name = 'Household'   THEN 'Groceries'
            ELSE 'Miscellaneous'
        END;

        -- If this user already has the canonical category row, point entries
        -- at it and delete this duplicate; otherwise rename in place.
        SELECT id INTO target_id FROM public.expense_categories
            WHERE user_id = r.user_id AND name = canonical_name AND id <> r.id
            LIMIT 1;

        IF target_id IS NULL THEN
            UPDATE public.expense_categories SET name = canonical_name WHERE id = r.id;
        ELSE
            UPDATE public.expense_entries SET category_id = target_id WHERE category_id = r.id;
            DELETE FROM public.expense_categories WHERE id = r.id;
        END IF;
    END LOOP;
END $$;

-- Ensure every existing user has all 4 canonical categories
INSERT INTO public.expense_categories (user_id, name)
SELECT DISTINCT user_id, n
FROM public.expense_categories
CROSS JOIN (VALUES ('Groceries'), ('Pharmacy'), ('Outings'), ('Miscellaneous')) AS v(n)
ON CONFLICT (user_id, name) DO NOTHING;

-- 3. Rewrite granular receipt-item tags onto canonical categories
UPDATE public.expense_receipt_items SET category = 'Groceries'
WHERE LOWER(category) IN ('pantry','beverages','bakery','dairy','produce','fruits','vegetables','meat','household','food','snacks','groceries');

UPDATE public.expense_receipt_items SET category = 'Pharmacy'
WHERE LOWER(category) IN ('medicine','medication','health','personal care','cosmetics','vitamins','supplements','pharmacy');

UPDATE public.expense_receipt_items SET category = 'Outings'
WHERE LOWER(category) IN ('outings','outing','travel','trips','dining','restaurant','cafe','coffee','entertainment','cinema','tobacco','alcohol','leisure','transport','fuel');

UPDATE public.expense_receipt_items SET category = 'Miscellaneous'
WHERE category IS NOT NULL
  AND LOWER(category) NOT IN ('pantry','beverages','bakery','dairy','produce','fruits','vegetables','meat','household','food','snacks','groceries','medicine','medication','health','personal care','cosmetics','vitamins','supplements','pharmacy','outings','outing','travel','trips','dining','restaurant','cafe','coffee','entertainment','cinema','tobacco','alcohol','leisure','transport','fuel','miscellaneous');

-- 4. Drop tables of removed modules (banking & investments)
DROP TABLE IF EXISTS public.investment_withdrawals;
DROP TABLE IF EXISTS public.investment_contributions;
DROP TABLE IF EXISTS public.holdings;
DROP TABLE IF EXISTS public.investment_categories;
DROP TABLE IF EXISTS public.bank_balances;
DROP TABLE IF EXISTS public.bank_accounts;
