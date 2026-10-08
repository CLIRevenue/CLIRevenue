-- 000022_campaign_creatives.sql
-- Extends the existing creative-identity slot into a real, validated asset
-- record, and adds a server-side activation-readiness function.
--
-- What already exists (migration 000021, not this file)
-- -----------------------------------------------------
-- `public.campaign_creatives` was created by 000021 as a *slot*, not an asset:
--
--   id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
--   campaign_id UUID NOT NULL UNIQUE REFERENCES campaigns(id) ON DELETE CASCADE
--   created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
--
-- and it is maintained by two triggers that must keep working:
--
--   * `campaign_creative_mint` (AFTER INSERT ON campaigns) inserts a row with
--     only `campaign_id`. Its `ON CONFLICT` has no target, so it resolves
--     against the `campaign_id` UNIQUE constraint. Dropping that constraint
--     breaks the mint trigger.
--   * `ad_serve_log_set_creative` (BEFORE INSERT ON ad_serve_log) resolves the
--     campaign's creative and sets `NEW.creative_id`.
--
-- 000021 also already set `ad_serve_log.creative_id` and
-- `telemetry_events.creative_id` to reference this table, and already applied
-- RLS with zero policies plus service_role-only grants.
--
-- Therefore this migration is EXTEND-ONLY. It does not create the table, does
-- not drop `campaign_id UNIQUE`, and does not touch `campaigns` columns beyond
-- adding the advertiser running-flag the activation check needs.
--
-- Why extend instead of replace
-- -----------------------------
-- Dropping and recreating the table would orphan the mint trigger, the serve-log
-- creative linkage, and the telemetry linkage, and would drop the attribution
-- guarantee 000021 documents: creative identity survives in-place campaign
-- edits so delivery attribution does not drift when the copy changes.
--
-- Nullable columns are a consequence, not sloppiness
-- -------------------------------------------------
-- The mint trigger creates the row at campaign-create time, long before any
-- file exists. Every asset column therefore has to tolerate "no asset yet", and
-- the row is born in status `pending`, which reads exactly as "this campaign has
-- nothing to serve". That is the same fact the activation check acts on, so the
-- placeholder state and the activation gate are two views of one truth.
--
-- Delivery impact to note at deploy time: any campaign already `active` whose
-- creative is still an auto-minted `pending` slot becomes ineligible for
-- delivery until an advertiser uploads and confirms a file. That is the intended
-- consequence of "serve only real creatives", but it is a visible behaviour
-- change, not a no-op.

-- ---------------------------------------------------------------
-- creative_status
--
-- pending   : row exists (minted at campaign creation); no asset recorded yet
-- uploaded  : object confirmed present in storage with the declared size
-- validated : passed the allowlists and is eligible for delivery
-- failed    : confirmation found no object, or storage disagreed with the row
-- revoked   : withdrawn by the advertiser; never selected again
--
-- Only `validated` is ever selected by delivery. A half-finished upload can
-- therefore never become a served ad.
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'creative_status') THEN
    CREATE TYPE public.creative_status AS ENUM (
      'pending', 'uploaded', 'validated', 'failed', 'revoked'
    );
  END IF;
END $$;

-- ---------------------------------------------------------------
-- advertisers: running flag
--
-- Phase 6 requires "advertiser is allowed to run campaigns" to be an enforced
-- rule, not a comment. Adding the column gives that rule a home without
-- inventing a second accounts table. Default TRUE so every existing advertiser
-- is unaffected by the migration.
-- ---------------------------------------------------------------
ALTER TABLE public.advertisers
  ADD COLUMN IF NOT EXISTS can_run_campaigns BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.advertisers.can_run_campaigns IS
  'Serving gate. FALSE stops this advertiser activating or resuming campaigns; already-active campaigns stop being selected at delivery time.';

-- ---------------------------------------------------------------
-- campaign_creatives: asset columns
--
-- `advertiser_id` is denormalised (already reachable via campaign_id) so an
-- ownership check is one equality instead of a join, and so no row is ever
-- addressable without naming its tenant.
--
-- `media_type` is an explicit column, not a derived expression: "image or video"
-- is the primary routing decision at delivery time and must not be re-derived
-- per request from a string that could disagree with itself.
--
-- `mime_type` and `file_size_bytes` are what the advertiser declared. Both are
-- cross-checked against a real HEAD of the object before the row reaches
-- `validated`, so a lying declaration cannot survive to delivery.
--
-- `width`/`height`/`duration_ms` are layout hints only. They never gate
-- authorisation, selection, or accounting.
--
-- `checksum` is the storage-reported ETag: evidence of what was confirmed, not
-- a trust anchor.
-- ---------------------------------------------------------------
ALTER TABLE public.campaign_creatives
  ADD COLUMN IF NOT EXISTS advertiser_id     UUID REFERENCES public.advertisers(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS media_type        TEXT,
  ADD COLUMN IF NOT EXISTS object_key        TEXT,
  ADD COLUMN IF NOT EXISTS mime_type         TEXT,
  ADD COLUMN IF NOT EXISTS file_size_bytes   BIGINT,
  ADD COLUMN IF NOT EXISTS extension         TEXT,
  ADD COLUMN IF NOT EXISTS width             INTEGER,
  ADD COLUMN IF NOT EXISTS height            INTEGER,
  ADD COLUMN IF NOT EXISTS duration_ms       INTEGER,
  ADD COLUMN IF NOT EXISTS poster_object_key TEXT,
  ADD COLUMN IF NOT EXISTS checksum          TEXT,
  ADD COLUMN IF NOT EXISTS label             TEXT,
  ADD COLUMN IF NOT EXISTS status            public.creative_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN public.campaign_creatives.advertiser_id IS
  'Owning advertiser, denormalised from campaigns.advertiser_id at confirm time. NULL only for the auto-minted slot that has no asset.';
COMMENT ON COLUMN public.campaign_creatives.object_key IS
  'Canonical Filebase key: advertisers/{advertiserId}/campaigns/{campaignId}/creatives/{creativeId}/original. Never supplied by a browser.';
COMMENT ON COLUMN public.campaign_creatives.status IS
  'Lifecycle gate. Only validated creatives are eligible for delivery.';
COMMENT ON TABLE public.campaign_creatives IS
  'Creative identity and asset record per campaign. Identity is minted by trigger and survives in-place campaign edits so delivery attribution does not drift when copy changes. Asset columns are NULL until an advertiser uploads a real file.';

-- Existing minted slots can be attributed to their campaign's advertiser now,
-- so ownership queries see a tenant even before the first upload.
UPDATE public.campaign_creatives cc
   SET advertiser_id = c.advertiser_id
  FROM public.campaigns c
 WHERE c.id = cc.campaign_id
   AND cc.advertiser_id IS NULL;

-- ---------------------------------------------------------------
-- The mint trigger learns to carry ownership forward
--
-- 000021's trigger inserts only `campaign_id`, which left every newly created
-- campaign's slot with advertiser_id NULL -- the backfill above only reaches
-- rows that existed at migration time. Every later campaign would mint a slot
-- with no tenant attached, and a slot with no tenant is a row that ownership
-- checks can only reject. Replacing the function body (not the trigger) keeps
-- 000021's behaviour -- same table, same `ON CONFLICT (campaign_id) DO NOTHING`
-- that the UNIQUE constraint backs -- and closes the gap.
--
-- Reads `NEW.advertiser_id`, never a client value: it is the same column the
-- caller already wrote.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_campaign_creative_mint() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.campaign_creatives (campaign_id, advertiser_id)
  VALUES (NEW.id, NEW.advertiser_id)
  ON CONFLICT (campaign_id) DO NOTHING;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.tg_campaign_creative_mint() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- constraints
--
-- Every one of these is conditional on the asset actually existing, because a
-- minted slot must satisfy all of them. They are deliberately strict where an
-- asset IS present: the database is the last place a bad creative can be
-- refused, so the allowlists live here as well as in the Edge Function.
-- ---------------------------------------------------------------

-- Identity: a row can only claim to be validated if it names its tenant, its
-- object, its type and its size. There is no way to reach `validated` with a
-- half-filled row.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_validated_shape_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_validated_shape_check
      CHECK (
        status <> 'validated'
        OR (
          advertiser_id IS NOT NULL
          AND media_type IS NOT NULL
          AND object_key IS NOT NULL
          AND mime_type IS NOT NULL
          AND file_size_bytes IS NOT NULL
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_media_type_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_media_type_check
      CHECK (media_type IS NULL OR media_type IN ('image', 'video'));
  END IF;
END $$;

-- Defence in depth. SVG is absent on purpose: it is a document format that can
-- carry script, and serving it from the creative origin would be stored XSS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_mime_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_mime_check
      CHECK (
        media_type IS NULL
        OR (media_type = 'image' AND mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'))
        OR (media_type = 'video' AND mime_type IN ('video/mp4', 'video/webm'))
      );
  END IF;
END $$;

-- Zero bytes is not a creative; a negative size is not a measurement.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_size_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_size_check
      CHECK (file_size_bytes IS NULL OR file_size_bytes > 0);
  END IF;
END $$;

-- Only a video needs a poster frame.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_poster_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_poster_check
      CHECK (poster_object_key IS NULL OR media_type = 'video');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_dimensions_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_dimensions_check
      CHECK (
        (width IS NULL OR width > 0)
        AND (height IS NULL OR height > 0)
        AND (duration_ms IS NULL OR duration_ms > 0)
      );
  END IF;
END $$;

-- The key shape is the storage namespace contract. A browser cannot choose a
-- path, and if the Edge Function ever regressed, the database still refuses a
-- key that is not exactly the deterministic advertiser/campaign/creative path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'campaign_creatives_object_key_check'
  ) THEN
    ALTER TABLE public.campaign_creatives
      ADD CONSTRAINT campaign_creatives_object_key_check
      CHECK (
        object_key IS NULL
        OR object_key ~ '^advertisers/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/campaigns/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/creatives/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/(original|poster)$'
      );
  END IF;
END $$;

-- ---------------------------------------------------------------
-- indexes
--
-- (campaign_id, status) serves the two hot reads: "does this campaign have a
-- validated creative" at activation time, and "pick a validated creative" at
-- delivery time.
--
-- The UNIQUE on campaign_id from 000021 already covers the plain campaign_id
-- lookup, so no second index is created here.
--
-- Partial UNIQUE on object_key: two creatives can never point at one object, so
-- revoking or replacing one creative can never disturb another.
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS campaign_creatives_campaign_status_idx
  ON public.campaign_creatives (campaign_id, status);

CREATE INDEX IF NOT EXISTS campaign_creatives_advertiser_idx
  ON public.campaign_creatives (advertiser_id);

CREATE UNIQUE INDEX IF NOT EXISTS campaign_creatives_object_key_idx
  ON public.campaign_creatives (object_key)
  WHERE object_key IS NOT NULL;

-- ---------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS update_campaign_creatives_updated_at ON public.campaign_creatives;
CREATE TRIGGER update_campaign_creatives_updated_at
  BEFORE UPDATE ON public.campaign_creatives
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------
-- campaign_activation_blockers
--
-- One place that answers "may this campaign serve?", used by the campaigns Edge
-- Function before it allows draft -> active, and by the database test suite.
-- Putting the rules in SQL rather than only in TypeScript means activation
-- readiness is testable without an Edge runtime and cannot drift between the
-- two call sites.
--
-- Returns an empty array when the campaign is ready, otherwise blocker codes in
-- a stable order. Not raising means the caller can report every reason at once
-- instead of making the advertiser fix one problem per attempt.
--
-- The storage-level check ("does the object actually exist in Filebase") cannot
-- live here: it needs the network. The Edge Function performs a HEAD before it
-- flips status, so this function covers everything the database can see.
--
-- SECURITY DEFINER because callers are the service role and the rules must read
-- rows the caller's own RLS would otherwise hide. Granted to service_role only,
-- so no client can call it.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_activation_blockers(p_campaign_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c RECORD;
  blockers TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id;

  IF NOT FOUND THEN
    RETURN ARRAY['CAMPAIGN_NOT_FOUND'];
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.advertisers a
     WHERE a.id = c.advertiser_id
       AND a.can_run_campaigns IS NOT TRUE
  ) THEN
    blockers := array_append(blockers, 'ADVERTISER_NOT_ELIGIBLE');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.audiences WHERE id = c.audience_id) THEN
    blockers := array_append(blockers, 'INVALID_AUDIENCE');
  END IF;

  IF c.budget_cents IS NULL OR c.budget_cents <= 0 THEN
    blockers := array_append(blockers, 'INVALID_BUDGET');
  END IF;

  IF COALESCE(c.cpm_cents, 0) <= 0 THEN
    blockers := array_append(blockers, 'INVALID_CPM');
  END IF;

  IF c.starts_at IS NOT NULL AND c.ends_at IS NOT NULL
     AND c.starts_at >= c.ends_at THEN
    blockers := array_append(blockers, 'INVALID_SCHEDULE');
  END IF;

  IF c.starts_at IS NOT NULL AND c.starts_at > NOW() THEN
    blockers := array_append(blockers, 'SCHEDULE_NOT_STARTED');
  END IF;

  IF c.ends_at IS NOT NULL AND c.ends_at <= NOW() THEN
    blockers := array_append(blockers, 'SCHEDULE_ENDED');
  END IF;

  -- The ad renders as a link, so a destination is part of being servable rather
  -- than optional decoration.
  IF c.landing_url IS NULL
     OR c.landing_url !~* '^https?://[^\s]+$' THEN
    blockers := array_append(blockers, 'INVALID_LANDING_URL');
  END IF;

  IF c.budget_cents IS NOT NULL
     AND COALESCE(c.spend_milli_cents, 0) >= c.budget_cents * 1000 THEN
    blockers := array_append(blockers, 'BUDGET_EXCEEDED');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.campaign_creatives cc
     WHERE cc.campaign_id = c.id
       AND cc.status = 'validated'
  ) THEN
    blockers := array_append(blockers, 'CREATIVE_MISSING');
  END IF;

  RETURN blockers;
END;
$$;

COMMENT ON FUNCTION public.campaign_activation_blockers(UUID) IS
  'Blocker codes preventing a campaign from serving. Empty means ready. Service-role only; the Edge Function additionally HEADs the stored object before activating.';

REVOKE ALL ON FUNCTION public.campaign_activation_blockers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campaign_activation_blockers(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_activation_blockers(UUID) TO service_role;

-- ---------------------------------------------------------------
-- RLS and grants
--
-- Re-asserted idempotently. RLS stays enabled with zero policies and all
-- `anon`/`authenticated` access revoked: the only writer is an Edge Function
-- using the service role, so the database cannot be the thing that enforces
-- ownership. Ownership is enforced in code on every request by deriving
-- JWT -> profiles.role -> advertisers.id -> campaigns.advertiser_id. A SELECT
-- policy here would create a second, weaker path that skips that chain.
-- ---------------------------------------------------------------
ALTER TABLE public.campaign_creatives ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.campaign_creatives FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_creatives TO service_role;

ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;