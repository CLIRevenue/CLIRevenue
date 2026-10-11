-- 000024_admin_governance_audit.sql
--
-- Why this exists
-- ---------------
-- The governance console has to be able to say what an administrator changed.
-- Until now there was nowhere to record it:
--
--   - contact-submission status edits, notes and deletes were applied straight
--     to contact_submissions, so nothing records who did them;
--   - advertisers.can_run_campaigns (000022) is the only other lever an admin
--     has, and it had never been flipped, so no write path existed for it
--     either;
--   - telemetry_events (000021) is an append-only record of what the delivery
--     pipeline did. It is not an operator action log and must not be read as
--     one.
--
-- So the honest fix is a small, separate, append-only table rather than
-- reinterpreting an existing one.
--
-- Properties this migration deliberately establishes
-- --------------------------------------------------
--   - additive only: creates a table and two indexes, grants nothing else, and
--     rolls back with a single DROP TABLE. Safe to apply to a live database.
--   - append-only by privilege: service_role is granted SELECT and INSERT and
--     is explicitly denied UPDATE and DELETE, so a later "correction" cannot
--     rewrite a recorded decision through PostgREST.
--   - invisible to end users: RLS is enabled with zero policies, so neither
--     anon nor authenticated matches any row. The service role bypasses RLS
--     and is the only reader.
--   - not tamper-evident. A privileged direct connection can still alter it.
--     Nothing in the schema commits to a hash chain or a signature, and the
--     console says so rather than implying the rows are cryptographic proof.

CREATE TABLE IF NOT EXISTS public.admin_governance_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- ON DELETE SET NULL, not CASCADE: removing a profile must not remove the
    -- record that the person acted. The decision outlives the account.
    actor_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

    -- Copied from the verified JWT at write time. profiles has no email column
    -- (000001, 000007), so this is the only place an administrator's address
    -- is preserved after the fact. Null when the JWT carried no address.
    actor_email TEXT,

    -- Constrained to the one decision the admin API can actually make. Adding a
    -- value here is a deliberate schema change, not a string the caller picks,
    -- so the log cannot accumulate action names nobody implemented.
    action TEXT NOT NULL CHECK (action IN ('SERVING_GATE_ENABLED', 'SERVING_GATE_DISABLED')),

    subject_type TEXT NOT NULL CHECK (subject_type IN ('advertiser')),
    subject_id UUID,

    -- Required, bounded: the Edge Function rejects a change without one. A
    -- serving gate can stop a live advertiser from delivering, so the reason is
    -- what makes the change accountable once it has happened.
    reason TEXT NOT NULL,
    previous_value TEXT,
    new_value TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT admin_governance_actions_reason_length
        CHECK (char_length(reason) BETWEEN 3 AND 500)
);

COMMENT ON TABLE public.admin_governance_actions IS
    'Append-only record of admin console governance decisions (migration 000024). '
    'Written only by supabase/functions/admin PATCH /admin/accounts/gate. '
    'Readable by service_role alone; no UPDATE or DELETE is granted to any role. '
    'Not tamper-evident: no signature or hash chain is stored.';

CREATE INDEX IF NOT EXISTS admin_governance_actions_created_at_idx
    ON public.admin_governance_actions (created_at DESC);

CREATE INDEX IF NOT EXISTS admin_governance_actions_subject_idx
    ON public.admin_governance_actions (subject_id, created_at DESC);

ALTER TABLE public.admin_governance_actions ENABLE ROW LEVEL SECURITY;

-- RLS enabled with zero policies below: anon and authenticated match nothing
-- and can read nothing, even if a policy were ever added to the wrong table.
REVOKE ALL ON public.admin_governance_actions FROM PUBLIC;
REVOKE ALL ON public.admin_governance_actions FROM anon, authenticated;

-- SELECT so the admin console can render the log; INSERT so it can be written.
-- UPDATE and DELETE are intentionally not granted to any role.
GRANT SELECT, INSERT ON public.admin_governance_actions TO service_role;
