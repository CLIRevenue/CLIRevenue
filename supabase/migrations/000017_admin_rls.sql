-- 000017_admin_rls.sql
--
-- Admin authorization mechanism:
--
--   profiles.role = 'admin' is the canonical per-user role.
--   Admin accounts are never self-assigned: handle_new_user only allows
--   'advertiser' | 'developer'.
--
--   A separate admin_emails allowlist is the RLS-safe signal that a profile
--   is an admin. A jwt_is_admin() SECURITY DEFINER function checks whether
--   the caller's JWT email is on the allowlist, so RLS policies never need
--   direct access to the admin_emails table (avoiding circular or broken
--   policy dependencies).
--
--   The authoritative allowlist lives in public.admin_emails. Adding an
--   entry requires a direct INSERT (service role / SQL console), not a
--   self-service path.
--
-- Migration 000017 creates the allowlist table and grants.

-- ------------------------------------------------------------------
-- admin_emails: the RLS-safe admin allowlist
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_emails (
    email TEXT PRIMARY KEY,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_emails ENABLE ROW LEVEL SECURITY;

-- Nobody can read or write this table from the browser directly.
-- Entries are added by a trusted operator (service role / SQL console).
-- SELECT is granted to anon/authenticated so that the RLS admin policies
-- (which check this table via jwt_is_admin()) can execute. The table only
-- stores email addresses — no credentials or secrets.
REVOKE ALL ON public.admin_emails FROM anon, authenticated;
GRANT SELECT ON public.admin_emails TO anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.admin_emails TO service_role;
