-- 000020_contact_submissions_hardening.sql
--
-- Idempotent repair for public.contact_submissions.
--
-- 000019 defines this table's policies correctly, but 000019 may already have
-- been applied to a live project before those corrections landed. Every
-- statement here is therefore DROP IF EXISTS / CREATE OR REPLACE / CREATE INDEX
-- IF NOT EXISTS, so running it against a database where 000019 is already
-- fixed is a no-op and against one where it is not, it converges to the fixed
-- state. Nothing here widens access.
--
-- What it repairs:
--
--   1. "Owners can update their own submission" (000019 draft). Its WITH CHECK
--      contained the tautology "status" IS NOT DISTINCT FROM "status" and
--      "admin_notes" = "admin_notes", so it restricted nothing: any signed-in
--      visitor who owned a row could set any status and write admin_notes,
--      which is internal triage data. Non-admins must not UPDATE at all, so
--      the policy is removed rather than tightened.
--
--   2. "Visitors can submit messages" had WITH CHECK (auth.uid() IS NULL OR
--      auth.uid() = "user_id"). For an anonymous caller the first disjunct is
--      unconditionally true, which let an anonymous submitter attribute the row
--      to ANY account UUID. Replaced with an explicit anonymous-is-NULL rule.
--
--   3. The three inbox indexes are re-asserted with IF NOT EXISTS. 000019 now
--      creates them, but a project that applied the older 000019 does not have
--      them, and an already-applied migration is not re-run. This is a
--      backstop for that case, not a first source of the indexes.
--
--   4. Grants are re-asserted so anon/authenticated hold INSERT and nothing
--      else, independent of any earlier grant drift.
--
--   5. The three jwt_is_admin() inbox policies are dropped. See section 1b.

-- ------------------------------------------------------------------
-- 1. Non-admins must not UPDATE submissions.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners can update their own submission" ON "public"."contact_submissions";

-- ------------------------------------------------------------------
-- 1b. Drop the jwt_is_admin() inbox policies, which are dead code that
--     contradicts the real admin path and would reopen it if ever re-granted.
--
--     supabase/functions/admin/index.ts gates every request behind
--     requireAdmin() (profiles.role='admin' AND admin_emails allowlist) and
--     then queries with adminClient(), a service_role client that has
--     BYPASSRLS. These policies are therefore never consulted on the admin
--     path at all.
--
--     They are not merely redundant, they are weaker than the gate they sit
--     beside: jwt_is_admin() (000018) checks ONLY the admin_emails allowlist,
--     so it is single-factor where requireAdmin() is two-factor. An account on
--     the allowlist with a non-admin profiles.role would get full inbox
--     SELECT/UPDATE/DELETE if it were live.
--
--     They are inert today solely because step 4 revoked the table privilege
--     from every browser role -- and a policy that is dead only because of a
--     GRANT elsewhere is a footgun, not a safety net. Any future GRANT to
--     anon/authenticated would silently make an admin's own browser token a
--     direct inbox credential. Dropping a policy can only narrow access.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can view all contact submissions" ON "public"."contact_submissions";
DROP POLICY IF EXISTS "Admins can update all contact submissions" ON "public"."contact_submissions";
DROP POLICY IF EXISTS "Admins can delete contact submissions" ON "public"."contact_submissions";

-- ------------------------------------------------------------------
-- 2. Anonymous submissions may not claim an identity.
-- ------------------------------------------------------------------
DROP POLICY IF EXISTS "Visitors can submit messages" ON "public"."contact_submissions";
CREATE POLICY "Visitors can submit messages" ON "public"."contact_submissions"
  FOR INSERT
  WITH CHECK (
    (auth.uid() IS NULL AND "user_id" IS NULL)
    OR "user_id" = auth.uid()
  );

-- ------------------------------------------------------------------
-- 3. Re-assert the inbox indexes: newest-first list, status filter,
--    user_id lookup. Idempotent backstop -- 000019 creates these too, but a
--    project that applied the older 000019 lacks them.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "contact_submissions_created_at_idx"
  ON "public"."contact_submissions" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "contact_submissions_status_idx"
  ON "public"."contact_submissions" ("status");

CREATE INDEX IF NOT EXISTS "contact_submissions_user_id_idx"
  ON "public"."contact_submissions" ("user_id")
  WHERE "user_id" IS NOT NULL;

-- ------------------------------------------------------------------
-- 4. Grants: INSERT only for anon/authenticated; service_role does the
--    admin work through the Edge Function.
-- ------------------------------------------------------------------
REVOKE ALL ON "public"."contact_submissions" FROM anon, authenticated;
GRANT INSERT ON "public"."contact_submissions" TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON "public"."contact_submissions" TO service_role;