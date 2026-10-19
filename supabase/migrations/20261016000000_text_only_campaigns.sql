-- =====================================================================
-- text-only campaigns: a campaign no longer needs a creative
-- ---------------------------------------------------------------------
-- Every ad in this product is text. There is no upload, no object key,
-- no Filebase bucket and no HEAD-before-serve. The only thing that
-- actually changes is the rule that a campaign could not go live until a
-- creative row had reached `validated`.
--
-- campaign_creatives is NOT dropped. It is an identity slot, not an
-- asset table: 000021 created it as one row per campaign, mint trigger
-- tg_campaign_creative_mint() fills it on campaign INSERT, and
-- tg_ad_serve_log_set_creative() reads it to stamp ad_serve_log.creative_id
-- before every serve. Dropping it would take both triggers down and leave
-- ad_serve_log with nothing to record. So the table stays exactly as it
-- is, and the row it mints simply sits at `pending` forever, which is
-- what a text-only ad looks like.
--
-- The one thing dropped is campaign_creatives_validated_shape_check. It
-- required advertiser_id, media_type, object_key, mime_type and
-- file_size_bytes to be present whenever status = 'validated'. Nothing can
-- reach `validated` any more, so it was unreachable — but leaving a
-- constraint that encodes "a served creative must have an object" behind
-- is a trap for whoever reuses the table next.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The shape check, gone. `IF EXISTS` because a database that never ran
-- 000022 has nothing to drop and must not fail this migration.
-- ---------------------------------------------------------------------
ALTER TABLE public.campaign_creatives
    DROP CONSTRAINT IF EXISTS campaign_creatives_validated_shape_check;

-- ---------------------------------------------------------------------
-- Activation. Same function, same signature, same code contract minus
-- CREATIVE_MISSING. Every other blocker is untouched: an advertiser still
-- cannot go live without an eligible account, an audience, a budget, a
-- CPM, a sane schedule and a real landing URL. What changed is that a
-- sentence and a link is a complete advertisement.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_activation_blockers(p_campaign_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c       public.campaigns%ROWTYPE;
  blockers TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id;
  IF NOT FOUND THEN
    RETURN ARRAY['CAMPAIGN_NOT_FOUND'];
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.advertisers a WHERE a.id = c.advertiser_id AND a.can_run_campaigns IS TRUE
  ) THEN
    blockers := array_append(blockers, 'ADVERTISER_NOT_ELIGIBLE');
  END IF;

  IF c.audience_id IS NULL OR c.audience_id = '' THEN
    blockers := array_append(blockers, 'INVALID_AUDIENCE');
  END IF;

  IF c.budget_cents IS NULL OR c.budget_cents <= 0 THEN
    blockers := array_append(blockers, 'INVALID_BUDGET');
  END IF;

  IF COALESCE(c.cpm_cents, 0) <= 0 THEN
    blockers := array_append(blockers, 'INVALID_CPM');
  END IF;

  IF c.starts_at IS NOT NULL AND c.ends_at IS NOT NULL AND c.starts_at >= c.ends_at THEN
    blockers := array_append(blockers, 'INVALID_SCHEDULE');
  END IF;

  IF c.starts_at IS NOT NULL AND c.starts_at > now() THEN
    blockers := array_append(blockers, 'SCHEDULE_NOT_STARTED');
  END IF;

  IF c.ends_at IS NOT NULL AND c.ends_at < now() THEN
    blockers := array_append(blockers, 'SCHEDULE_ENDED');
  END IF;

  IF c.landing_url IS NULL
     OR c.landing_url !~ '^https?://[^\s]+$' THEN
    blockers := array_append(blockers, 'INVALID_LANDING_URL');
  END IF;

  IF COALESCE(c.spend_milli_cents, 0) >= COALESCE(c.budget_cents, 0) * 1000 THEN
    blockers := array_append(blockers, 'BUDGET_EXCEEDED');
  END IF;

  -- CREATIVE_MISSING used to be appended here. Ads are text, so there is
  -- nothing to upload and nothing to validate.

  RETURN blockers;
END;
$$;

COMMENT ON FUNCTION public.campaign_activation_blockers(UUID) IS
    'Blocker codes preventing a campaign from serving. Empty means ready. '
    'Service-role only. There is no creative gate: an ad is a headline, a '
    'body, a call to action and a link, and a campaign holding those is '
    'complete.';

REVOKE ALL ON FUNCTION public.campaign_activation_blockers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.campaign_activation_blockers(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.campaign_activation_blockers(UUID) TO service_role;