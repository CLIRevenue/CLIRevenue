-- jwt_is_admin() was documented in 000018 as SECURITY DEFINER, but the clause
-- was missing from its CREATE OR REPLACE FUNCTION, so the function shipped as
-- SECURITY INVOKER. With invoker semantics it runs inside the caller's row
-- visibility: admin_emails has RLS enabled and no policies, so an
-- authenticated (or anonymous) caller sees zero rows and the function answers
-- FALSE for everyone. Every policy whose USING clause is public.jwt_is_admin()
-- — advertiser_queries admin reads, the admin Edge Function's expectations,
-- admin_governance — silently denied even the real admin, and the admin panel
-- rendered the "not on the admin allowlist" upsell with no error from RLS
-- itself. Supabase's Data API also surfaces this: the browser calls the RPC
-- under `authenticated`, whereas any psql check done as a superuser bypasses
-- RLS and shows TRUE, which is why the bug hid until now.
ALTER FUNCTION public.jwt_is_admin() SECURITY DEFINER;
ALTER FUNCTION public.jwt_is_admin() OWNER TO postgres;

-- Sanity: the function must now run as its owner, ignoring admin_emails RLS,
-- while callers keep the narrow EXECUTE grants from 000018 (anon,
-- authenticated, service_role — nothing else gains).
