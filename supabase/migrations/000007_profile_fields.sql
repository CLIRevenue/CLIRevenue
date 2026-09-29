-- 000007_profile_fields.sql
-- Structured profile information for advertiser and developer consoles.
-- Common identity/contact fields live on profiles; role-specific fields
-- live on the role tables. All new columns are NULLABLE so existing users
-- and the 000006 bootstrap keep working unchanged.
--
-- Security notes:
--   * SELECT/UPDATE RLS policies already scope rows to their owner
--     (000004). This migration re-keys the profiles UPDATE policy with an
--     explicit role guard (users.role = profiles.role) so a profile UPDATE
--     can never change `role` even in a row where it would otherwise pass,
--     and REVOKes table-level UPDATE on profiles from authenticated so a
--     stolen client can never attempt a role write at all. Column grants
--     below are the mechanism the account pages use.
--   * No service-role involvement: every policy uses auth.uid() only.

-- ---------------------------------------------------------------
-- profiles — common identity/contact fields
-- ---------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS city TEXT,
  ADD COLUMN IF NOT EXISTS state TEXT,
  ADD COLUMN IF NOT EXISTS country TEXT;

COMMENT ON COLUMN public.profiles.full_name IS 'Display name of the account holder. Self-reported.';
COMMENT ON COLUMN public.profiles.phone    IS 'Contact phone. Self-reported, optional.';
COMMENT ON COLUMN public.profiles.address  IS 'Street address. Self-reported, optional.';
COMMENT ON COLUMN public.profiles.city     IS 'City. Self-reported, optional.';
COMMENT ON COLUMN public.profiles.state    IS 'State/region. Self-reported, optional.';
COMMENT ON COLUMN public.profiles.country  IS 'Country. Self-reported, optional.';

-- ---------------------------------------------------------------
-- advertisers — role-specific company fields
-- (company_name / contact_email already exist from 000001)
-- ---------------------------------------------------------------
ALTER TABLE public.advertisers
  ADD COLUMN IF NOT EXISTS company_website     TEXT,
  ADD COLUMN IF NOT EXISTS company_description TEXT,
  ADD COLUMN IF NOT EXISTS company_size        TEXT,
  ADD COLUMN IF NOT EXISTS industry            TEXT,
  ADD COLUMN IF NOT EXISTS hear_about_us       TEXT;

COMMENT ON COLUMN public.advertisers.company_size IS 'Self-reported headcount band, e.g. "1-10". Free text by design.';
COMMENT ON COLUMN public.advertisers.hear_about_us IS 'Attribution answer for "How did you hear about us?"';

-- ---------------------------------------------------------------
-- developer_accounts — role-specific developer/studio fields
-- ---------------------------------------------------------------
ALTER TABLE public.developer_accounts
  ADD COLUMN IF NOT EXISTS developer_name    TEXT,
  ADD COLUMN IF NOT EXISTS developer_type    TEXT,
  ADD COLUMN IF NOT EXISTS website           TEXT,
  ADD COLUMN IF NOT EXISTS apps_description  TEXT,
  ADD COLUMN IF NOT EXISTS app_count         INTEGER,
  ADD COLUMN IF NOT EXISTS platforms         TEXT,
  ADD COLUMN IF NOT EXISTS experience_level  TEXT,
  ADD COLUMN IF NOT EXISTS hear_about_us     TEXT;

COMMENT ON COLUMN public.developer_accounts.developer_name   IS 'Developer or studio name shown in the console.';
COMMENT ON COLUMN public.developer_accounts.developer_type   IS 'Self-reported type, e.g. indie / studio / hobbyist. Free text by design.';
COMMENT ON COLUMN public.developer_accounts.app_count        IS 'Approximate shipped app/product count.';
COMMENT ON COLUMN public.developer_accounts.platforms        IS 'Self-reported platforms, e.g. "CLI, web, mobile". Free text by design.';
COMMENT ON COLUMN public.developer_accounts.experience_level IS 'Self-reported experience band. Free text by design.';
COMMENT ON COLUMN public.developer_accounts.hear_about_us    IS 'Attribution answer for "How did you hear about us?"';

-- app_count sanity: negative counts are meaningless, never block a row otherwise.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'developer_accounts_app_count_check'
  ) THEN
    ALTER TABLE public.developer_accounts
      ADD CONSTRAINT developer_accounts_app_count_check CHECK (app_count IS NULL OR app_count >= 0);
  END IF;
END $$;

-- ---------------------------------------------------------------
-- Role-change hardening on profiles
-- ---------------------------------------------------------------
-- Re-key the UPDATE policy so `role` must equal itself: a profile UPDATE
-- that touches role can never pass, for anyone, via RLS.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (
      SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
    ));

-- Belt and braces: table-level UPDATE grant is revoked from authenticated;
-- the per-column grants below are what the account pages use. (created_at /
-- updated_at are maintained by triggers and need no grant; `id` and `role`
-- are never client-updatable.)
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, phone, address, city, state, country)
  ON public.profiles TO authenticated;

-- ---------------------------------------------------------------
-- Owner-scoped UPDATE confirmation for the role tables
-- (SELECT/UPDATE policies exist from 000004; re-key identically so the
-- WITH CHECK side cannot be satisfied for another user's row either.)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Advertisers can update their own advertiser profile" ON public.advertisers;
CREATE POLICY "Advertisers can update their own advertiser profile" ON public.advertisers
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Developers can update their own developer account" ON public.developer_accounts;
CREATE POLICY "Developers can update their own developer account" ON public.developer_accounts
    FOR UPDATE USING (profile_id = auth.uid())
    WITH CHECK (profile_id = auth.uid());
