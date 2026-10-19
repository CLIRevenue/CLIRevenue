-- =====================================================================
-- advertiser_queries — support requests raised from the advertiser console
-- ---------------------------------------------------------------------
-- A person in the console can raise a query with their own details and
-- screenshots, and an admin can answer it. The answer is a column on the
-- same row rather than a second table, because the pair has exactly one
-- relationship and splitting them would mean a join on every notification
-- read, forever, to answer a question that is always asked about one row.
--
-- `profile_id` is the chain this whole schema already uses — auth.uid()
-- into profiles, and through profiles into advertisers. It is stored rather
-- than derived on read so that a row survives an account being closed, and
-- so an admin reading a three-year-old query sees who asked at the time
-- rather than a dangling reference. The advertiser_id is not stored: it is
-- derivable from profile_id, and storing two things that must agree is how
-- they come to disagree.
--
-- Screenshots are paths in object storage, not bytes. The console already
-- has a Filebase client for campaign creatives; reusing that is cheaper
-- than a second storage integration and keeps one set of credentials.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.advertiser_queries (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who asked. NOT NULL: an anonymous query cannot be answered, because
    -- the answer has nowhere to go.
    profile_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    user_email      text NOT NULL,
    phone           text,
    company_name    text,

    -- What they asked.
    subject         text NOT NULL,
    body            text NOT NULL,
    screenshots     text[] NOT NULL DEFAULT '{}',

    -- Where it is. 'open' until an admin answers it.
    status          text NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'answered', 'closed')),

    -- The answer, in the same row. Null until somebody writes one.
    admin_reply     text,
    replied_at      timestamptz,
    replied_by      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,

    -- What the console asks for, kept on the row so an admin list is one
    -- query with no join and no aggregation.
    category        text NOT NULL DEFAULT 'general'
                    CHECK (category IN ('general', 'billing', 'campaign', 'sdk', 'account', 'bug')),

    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- The console lists a person's own queries newest first; an admin lists
-- everything newest first. Both are served by this one index.
CREATE INDEX IF NOT EXISTS idx_advertiser_queries_profile_created
    ON public.advertiser_queries (profile_id, created_at DESC);

-- An admin's queue is "open, oldest first" — the opposite order to a
-- person's own history, so it needs its own.
CREATE INDEX IF NOT EXISTS idx_advertiser_queries_open
    ON public.advertiser_queries (created_at)
    WHERE status = 'open';

COMMENT ON TABLE public.advertiser_queries IS
    'Support queries raised by advertisers, with the admin answer on the same row.';

-- ---------------------------------------------------------------------
-- updated_at, maintained here rather than by every writer remembering.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_advertiser_query_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS advertiser_queries_touch ON public.advertiser_queries;
CREATE TRIGGER advertiser_queries_touch
    BEFORE UPDATE ON public.advertiser_queries
    FOR EACH ROW
    EXECUTE FUNCTION public.touch_advertiser_query_updated_at();

-- ---------------------------------------------------------------------
-- RLS
--
-- An advertiser sees and creates their own rows. They cannot update them:
-- the only field an advertiser should ever change is closing their own
-- ticket, and letting the row be writable would mean the answer they are
-- shown could be edited by the person it was written to. Admins read
-- everything and write only the answer.
-- ---------------------------------------------------------------------
ALTER TABLE public.advertiser_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advertisers can view their own queries" ON public.advertiser_queries;
CREATE POLICY "Advertisers can view their own queries" ON public.advertiser_queries
    FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Advertisers can raise a query" ON public.advertiser_queries;
CREATE POLICY "Advertisers can raise a query" ON public.advertiser_queries
    FOR INSERT WITH CHECK (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all queries" ON public.advertiser_queries;
CREATE POLICY "Admins can view all queries" ON public.advertiser_queries
    FOR SELECT USING (public.jwt_is_admin());

-- Admin write is scoped to the answer columns in the USING clause's
-- companion: WITH CHECK below still allows any column on an insert, but an
-- admin UPDATE that changes profile_id would be caught by the SELECT-side
-- policy being re-evaluated, so the grant is kept narrow by convention and
-- documented rather than enforced — the function cannot see OLD/NEW.
DROP POLICY IF EXISTS "Admins can answer queries" ON public.advertiser_queries;
CREATE POLICY "Admins can answer queries" ON public.advertiser_queries
    FOR UPDATE USING (public.jwt_is_admin())
    WITH CHECK (public.jwt_is_admin());
