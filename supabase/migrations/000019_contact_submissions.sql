-- 000019_contact_submissions.sql
--
-- Website-native contact / inquiry system.
--
-- Visitor submits the public contact form -> the record is stored in
-- public.contact_submissions (the website IS the inbox) -> the admin panel
-- reads and triages it. No email delivery is involved: nothing is sent
-- anywhere, no SMTP/transactional provider, no credentials anywhere in this
-- repository.
--
-- RLS:
--   * Anonymous and authenticated callers can INSERT (public-facing form).
--   * Nobody but an admin can SELECT, UPDATE or DELETE. There is no public
--     SELECT policy and no owner UPDATE policy, so reads and writes are
--     closed to anon/authenticated at the grant layer as well as by policy.
--   * Admins (profiles.role = 'admin' AND JWT email in public.admin_emails)
--     can read, update, and delete all submissions. Admins are authorized
--     through public.jwt_is_admin() (defined in 000018), which runs as a
--     SECURITY DEFINER so the caller never needs direct admin_emails access.
--   * The service_role bypasses RLS and is how the Edge Function performs
--     admin reads/writes.
--
-- Field limits keep payloads bounded and make denial-of-service submissions
-- expensive; message is capped so the inbox never fills with unusable text.
-- "Obviously abusive" payloads are not aggressively filtered — length limits
-- are the reasonable measure and heavier filtering would block legitimate
-- technical messages (per the brief).

-- ------------------------------------------------------------------
-- Controlled status set: new, read, in_progress, resolved, archived.
-- ------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'contact_statuses'
      AND n.nspname = 'public'
  ) THEN
    CREATE TYPE "public"."contact_statuses" AS ENUM (
      'new',
      'read',
      'in_progress',
      'resolved',
      'archived'
    );
  END IF;
END $$;

GRANT USAGE ON TYPE "public"."contact_statuses" TO "postgres";

-- ------------------------------------------------------------------
-- contact_submissions: one row per visitor message.
--
-- name / email / subject / message are required and bounded. category is
-- optional but controlled (developer, advertiser, other) and is populated
-- from the "you are a" select on the form. status defaults to 'new'.
-- user_id ties the submission to an account when the visitor is signed in;
-- it stays NULL for anonymous visitors, so every submission has a path to
-- reply within the admin panel. admin_notes are internal and never
-- exposed outside the admin panel. read_at and resolved_at track triage.
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."contact_submissions" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "name"          TEXT NOT NULL CHECK (char_length("name") <= 120),
  "email"         TEXT NOT NULL CHECK (char_length("email") <= 254)
                                CHECK ("email" ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
  "subject"       TEXT NOT NULL CHECK (char_length("subject") <= 200),
  "message"       TEXT NOT NULL CHECK (char_length("message") <= 2000),
  "category"      TEXT CHECK ("category" IS NULL OR "category" = ANY(ARRAY['developer','advertiser','other']::text[])),
  "status"        "public"."contact_statuses" NOT NULL DEFAULT 'new',
  "user_id"       UUID NULL REFERENCES "auth"."users"("id") ON DELETE SET NULL,
  "admin_notes"   TEXT NULL CHECK (char_length("admin_notes") <= 4000),
  "read_at"       TIMESTAMPTZ NULL,
  "resolved_at"   TIMESTAMPTZ NULL
);

ALTER TABLE "public"."contact_submissions" ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------
-- Indexes.
--
-- The inbox is read newest-first and filtered by triage state, and
-- anon/authenticated only ever INSERT, so these cover the two access paths
-- that matter: the admin list query (created_at DESC, status) and the
-- user_id FK. Without them the inbox degrades to a sequential sort as the
-- table grows.
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "contact_submissions_created_at_idx"
  ON "public"."contact_submissions" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "contact_submissions_status_idx"
  ON "public"."contact_submissions" ("status");

-- Partial: the large majority of submissions are anonymous and carry no
-- user_id, so indexing only the rows that have one keeps this small.
CREATE INDEX IF NOT EXISTS "contact_submissions_user_id_idx"
  ON "public"."contact_submissions" ("user_id")
  WHERE "user_id" IS NOT NULL;

-- Nobody can read, change, or remove submissions through the browser by
-- default. No public SELECT policy is created here on purpose: the table is
-- owned by service_role and the absence of a SELECT policy keeps it closed
-- to anon/authenticated. The inbox is read exclusively through the admin
-- Edge Function (service_role), so a public SELECT policy is unnecessary
-- and would contradict the "no public read" requirement.

-- Visitors (anon or authenticated) can submit. The WITH CHECK is deliberately
-- narrow about identity:
--   * an anonymous caller (no session) must leave user_id NULL, otherwise an
--     attacker could attribute an arbitrary submission to any account UUID;
--   * a signed-in caller may only file the submission under their own id.
-- So the short-circuit is "anon AND user_id IS NULL", not "anon OR ...".
DROP POLICY IF EXISTS "Visitors can submit messages" ON "public"."contact_submissions";
CREATE POLICY "Visitors can submit messages" ON "public"."contact_submissions"
  FOR INSERT
  WITH CHECK (
    (auth.uid() IS NULL AND "user_id" IS NULL)
    OR "user_id" = auth.uid()
  );

-- There is deliberately NO owner UPDATE policy.
--
-- An earlier draft had one ("Owners can update their own submission") whose
-- WITH CHECK was written as:
--     "status" = ANY(ARRAY['read','resolved']) OR "status" IS NOT DISTINCT FROM "status"
--     AND ("admin_notes" IS NULL OR "admin_notes" = "admin_notes")
-- Both disjuncts are tautologies — a column is always identical to itself — so
-- the policy restricted nothing at all: any signed-in visitor who owned a row
-- could set status to in_progress/archived and, worse, write `admin_notes`,
-- which is internal admin triage data. It also contradicted the requirement
-- that non-admins cannot UPDATE submissions at all.
--
-- Triage is an admin-only concern, so the policy is dropped rather than
-- repaired. DROP IF EXISTS keeps this migration re-runnable against a database
-- where the draft policy was already created.
DROP POLICY IF EXISTS "Owners can update their own submission" ON "public"."contact_submissions";

-- Admins can view all submissions.
DROP POLICY IF EXISTS "Admins can view all contact submissions" ON "public"."contact_submissions";
CREATE POLICY "Admins can view all contact submissions" ON "public"."contact_submissions"
  FOR SELECT USING (public.jwt_is_admin());

-- Admins can update all submissions (status + internal notes).
DROP POLICY IF EXISTS "Admins can update all contact submissions" ON "public"."contact_submissions";
CREATE POLICY "Admins can update all contact submissions" ON "public"."contact_submissions"
  FOR UPDATE USING (public.jwt_is_admin());

-- Admins can delete submissions (archived or duplicates).
DROP POLICY IF EXISTS "Admins can delete contact submissions" ON "public"."contact_submissions";
CREATE POLICY "Admins can delete contact submissions" ON "public"."contact_submissions"
  FOR DELETE USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- The official CLIRevenue contact/admin address is added to the admin
-- allowlist. Adding an admin is an operator action (service role / SQL
-- console), not a self-service path: this INSERT lives in the migration so
-- it applies with the service role during deployment. No credentials are
-- stored — only an email address, the same shape admin_emails already has.
-- ------------------------------------------------------------------
INSERT INTO "public"."admin_emails" ("email", "note", "created_at")
VALUES ('clirevenue@gmail.com', 'Official CLIRevenue contact/admin address', now())
ON CONFLICT ("email") DO NOTHING;

-- ------------------------------------------------------------------
-- Grants follow the existing admin pattern (000017/000018): no direct
-- client access to admin_emails; admin reads go through jwt_is_admin().
-- ------------------------------------------------------------------
REVOKE ALL ON "public"."contact_submissions" FROM anon, authenticated;
GRANT INSERT ON "public"."contact_submissions" TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON "public"."contact_submissions" TO service_role;
