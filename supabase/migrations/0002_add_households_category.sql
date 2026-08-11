-- =========================================================================
-- SNAPSPEND MIGRATION 0002 — ADD "Households" CATEGORY
-- Ensures every existing user gets the new canonical expense category.
--
-- What it does:
--  1. Adds a 'Households' expense_categories row for every existing user.
--  2. Leaves all existing entries, tags and mappings untouched.
-- =========================================================================

-- Ensure every existing user has the Households canonical category
INSERT INTO public.expense_categories (user_id, name)
SELECT DISTINCT user_id, 'Households'
FROM public.expense_categories
ON CONFLICT (user_id, name) DO NOTHING;
