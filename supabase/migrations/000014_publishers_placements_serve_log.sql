-- ---------------------------------------------------------------
-- 000014_publishers_placements_serve_log.sql
--
-- The data model the SDK-facing delivery layer needs.
--
-- The problem this solves: until now the only route into the accounting
-- functions accepted a campaign_id in the request body, so any caller who
-- could obtain a developer token could bill an impression to any active
-- campaign, including another advertiser's. Nothing server-side recorded what
-- was actually served, so there was no artefact to check a later impression
-- against.
--
-- ad_serve_log is that artefact. It is written only by the server at delivery
-- time, and it is the only authority for which campaign an impression or
-- click belongs to. A client-supplied campaign_id is no longer consulted.
--
-- publisher_keys stores only a SHA-256 hash. A publishable key is a
-- capability, not an identifier: the raw value is shown once at creation and
-- is unrecoverable afterwards, and a row id is useless for authentication.
-- ---------------------------------------------------------------

-- ---------------------------------------------------------------
-- campaigns.landing_url
--
-- The delivery contract hands the browser a destination to open on click, and
-- campaigns had nowhere to put one. The click itself is recorded through the
-- SDK, so this is the advertised destination only; it is not a signed or
-- attribution-carrying URL. Nullable so existing campaigns keep working.
-- ---------------------------------------------------------------
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS landing_url TEXT;

-- ---------------------------------------------------------------
-- publishers
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publishers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Nullable: a publisher may be created by staff/seed before any account
    -- claims it. ON DELETE SET NULL so deleting a profile does not delete the
    -- publisher and its delivery history.
    owner_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS publishers_owner_profile_id_idx
    ON public.publishers (owner_profile_id);

-- ---------------------------------------------------------------
-- publisher_keys
--
-- key_hash is sha256(key) hex, UNIQUE so lookup is a single index probe.
-- No salt: the key is a high-entropy random capability, not a password, and
-- salting would only prevent a precomputed rainbow table that is already
-- infeasible. key_prefix is a short display fragment and is deliberately not
-- unique or sufficient to authenticate.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.publisher_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES public.publishers(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    label TEXT,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS publisher_keys_publisher_id_idx
    ON public.publisher_keys (publisher_id);

-- ---------------------------------------------------------------
-- placements
--
-- A placement is a named slot on a publisher's surface. placement_key is
-- unique per publisher, not globally, so two publishers may both use
-- "sidebar" without colliding.
--
-- allowed_audience_id is optional and is the placement-level half of
-- audience matching: when set, only campaigns targeting that audience are
-- eligible for this placement. NULL means "any audience the campaign allows".
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.placements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publisher_id UUID NOT NULL REFERENCES public.publishers(id) ON DELETE CASCADE,
    placement_key TEXT NOT NULL,
    name TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_audience_id TEXT REFERENCES public.audiences(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (publisher_id, placement_key)
);

CREATE INDEX IF NOT EXISTS placements_publisher_id_idx
    ON public.placements (publisher_id);

-- ---------------------------------------------------------------
-- ad_serve_log
--
-- One row per successful delivery. This is the authoritative
-- requestId -> campaign relationship.
--
-- The three *_recorded_at columns are the anti-fraud guards. They are only
-- ever set by the SECURITY DEFINER tracking functions in 000015, under a
-- row lock, so "at most one impression per serve" is enforced by the
-- database rather than by the caller behaving.
--
-- impression_id and impression_session_id are captured at impression time
-- and then used by the click path. Without them a click could satisfy
-- apply_interaction's mandatory-impression check using an impression that
-- belonged to a *different* serve of the same campaign.
--
-- context_url / context_referrer are the only publisher context retained.
-- They are URLs supplied by the page, not user identity.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ad_serve_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Client-visible and echoed in the impression token. UNIQUE so a
    -- fabricated request id collides rather than silently creating a second
    -- serve.
    request_id UUID NOT NULL UNIQUE,
    publisher_id UUID NOT NULL REFERENCES public.publishers(id) ON DELETE CASCADE,
    placement_id UUID NOT NULL REFERENCES public.placements(id) ON DELETE CASCADE,
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    -- The developer the impression is billed to. Derived server-side; never
    -- taken from a request body.
    developer_id UUID REFERENCES public.developer_accounts(id) ON DELETE SET NULL,
    -- Denormalised for audit so a serve remains interpretable after the
    -- placement is renamed.
    placement_key TEXT NOT NULL,
    sdk_version TEXT,
    context_url TEXT,
    context_referrer TEXT,
    -- Snapshot of the campaign price at serve time, so the audit trail does
    -- not drift if the advertiser changes CPM later.
    cost_milli_cents INTEGER NOT NULL DEFAULT 0,
    served_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    impression_recorded_at TIMESTAMPTZ,
    impression_id UUID REFERENCES public.ad_impressions(id) ON DELETE SET NULL,
    impression_session_id TEXT,
    click_recorded_at TIMESTAMPTZ,
    conversion_recorded_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ad_serve_log_publisher_served_idx
    ON public.ad_serve_log (publisher_id, served_at DESC);
CREATE INDEX IF NOT EXISTS ad_serve_log_campaign_idx
    ON public.ad_serve_log (campaign_id);

-- ---------------------------------------------------------------
-- updated_at triggers, matching the convention used by 000001
-- ---------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_publishers_updated_at') THEN
        CREATE TRIGGER update_publishers_updated_at
        BEFORE UPDATE ON public.publishers
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_placements_updated_at') THEN
        CREATE TRIGGER update_placements_updated_at
        BEFORE UPDATE ON public.placements
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- ---------------------------------------------------------------
-- Row level security
--
-- These tables are server-authoritative: nothing a browser sends may create
-- or modify them. RLS is enabled with no policies at all, so anon and
-- authenticated have no path even if a grant were added by mistake, and the
-- table grants below revoke the privileges too. Two independent layers,
-- because this data decides whose money is spent.
--
-- Publisher-facing reporting (a publisher seeing its own delivery log) is
-- deliberately not granted yet; it needs a JWT path distinct from the
-- publishable key and is out of scope for this migration.
-- ---------------------------------------------------------------
ALTER TABLE public.publishers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.publisher_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.placements     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_serve_log   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.publishers     FROM anon, authenticated;
REVOKE ALL ON public.publisher_keys FROM anon, authenticated;
REVOKE ALL ON public.placements     FROM anon, authenticated;
REVOKE ALL ON public.ad_serve_log   FROM anon, authenticated;

-- The service role is the only writer. It already has broad grants from the
-- Supabase default-privilege baseline; these make the intent explicit and
-- survive a project whose defaults were tightened.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publishers     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.publisher_keys TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.placements     TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_serve_log   TO service_role;
