-- =========================================================================
-- SNAPSPEND MIGRATION 0003 — RENAME "Outings" CATEGORY TO "Travel"
-- Canonical category rename for existing databases.
--
-- What it does:
--  1. Renames 'Outings' / 'Trips / Outings' category rows to 'Travel',
--     merging with an existing 'Travel' row if the user already has one.
--  2. Ensures every existing user has a 'Travel' canonical category.
--  3. Rewrites granular expense_receipt_items tags onto 'Travel'.
-- =========================================================================

-- 1. Rename Outings / Trips / Outings rows to Travel, merging duplicates
DO $$
DECLARE
    r RECORD;
    target_id UUID;
BEGIN
    FOR r IN SELECT id, user_id FROM public.expense_categories
             WHERE name IN ('Outings', 'Trips / Outings') LOOP
        SELECT id INTO target_id FROM public.expense_categories
            WHERE user_id = r.user_id AND name = 'Travel' AND id <> r.id
            LIMIT 1;

        IF target_id IS NULL THEN
            UPDATE public.expense_categories SET name = 'Travel' WHERE id = r.id;
        ELSE
            UPDATE public.expense_entries SET category_id = target_id WHERE category_id = r.id;
            DELETE FROM public.expense_categories WHERE id = r.id;
        END IF;
    END LOOP;
END $$;

-- 2. Ensure every existing user has the Travel canonical category
INSERT INTO public.expense_categories (user_id, name)
SELECT DISTINCT id, 'Travel'
FROM public.profiles
ON CONFLICT (user_id, name) DO NOTHING;

-- 3. Rewrite receipt-item tags onto the renamed category
UPDATE public.expense_receipt_items SET category = 'Travel'
WHERE LOWER(category) IN ('outings','outing','travel','trips','dining','restaurant','cafe','coffee','entertainment','cinema','tobacco','alcohol','leisure','transport','fuel');
