-- Data API grants, consolidated ahead of the 2026-10-30 platform change.
--
-- From that date Supabase stops automatically granting Data API access to new
-- tables in the public schema. Our earliest migrations relied on that baseline,
-- so their explicit grants arrived as these same statements appended to the tail
-- of each creating migration. Those tails are already recorded as applied in any
-- database built before the grants audit and will never replay there, so this
-- file gathers the whole set into one idempotent, order-independent place that
-- every database — old or fresh — reaches through its own recorded history.
--
-- Doctrine (observed both here and in the tails):
--   * tables the browser reaches through the Data API get narrow grants for
--     exactly the roles that walk those rows;
--   * Edge-Function-only tables belong to service_role alone;
--   * trigger functions need no EXECUTE grant from their callers — the
--     privilege is checked once, at CREATE TRIGGER time;
--   * RPC-called functions the browser invokes get EXECUTE grants of their own
--     (ensure_own_profile, increment_heart, jwt_is_admin — the latter two were
--     always explicit and are not repeated here).

-- Browser-readable identity and self-service rows (000001 tail).
--
-- profiles is deliberately NOT given a table-wide UPDATE here. 000007 narrowed
-- its UPDATE to named columns (role is one thing an authenticated user must
-- never be able to write; tests/db authorization test 10 depends on the
-- privilege layer rejecting the statement). Replay order put 000007 after
-- 000001's wide grant, so a fresh database ends narrow; apply this file to an
-- already-built database and the net posture must be narrow all the same.
GRANT SELECT, INSERT ON public.profiles TO authenticated;
GRANT UPDATE (full_name, phone, address, city, state, country) ON public.profiles TO authenticated;
-- Consent columns were added after 000007 narrowed profiles' UPDATE to a named
-- column list, so they always needed their own grant (000023 tail).
GRANT UPDATE ("privacy_policy_version", "terms_version", "privacy_policy_accepted_at", "terms_accepted_at") ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.advertisers, public.developer_accounts TO authenticated;
GRANT SELECT ON public.platform_settings TO authenticated;

-- Sign-in profile catcher (000006 tail): the browser calls it after sign-up.
GRANT EXECUTE ON FUNCTION public.ensure_own_profile(TEXT) TO anon, authenticated;

-- Campaign engine and its accounting: written only by Edge Functions after
-- 000008 took authenticated's write path away.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_impressions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_interactions TO service_role;
-- The immutable per-reward log stays unreadable to anon (old-baseline leftover).
REVOKE SELECT ON public.ledger_events FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ledger_events TO service_role;

-- Reward machinery is backend-only (000010 tail); the old baseline left able
-- anon SELECTs on the financial tables that contradict their authored policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audiences TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reward_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payouts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payout_transactions TO service_role;
REVOKE SELECT ON public.reward_ledger FROM anon;
REVOKE SELECT ON public.payouts FROM anon;
REVOKE SELECT ON public.payout_transactions FROM anon;

-- Advertiser support inbox (20261015000000 tail): browser-side everything
-- except delete, which is admin-only and pathed through RLS policies.
GRANT SELECT, INSERT, UPDATE ON public.advertiser_queries TO authenticated;

-- Homepage hearts (20261014000000 tail): the single public counter row.
GRANT SELECT ON public.site_hearts TO anon, authenticated;
