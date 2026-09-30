-- 000008_campaign_lifecycle.sql
-- Additive campaign accounting, ownership hardening, and atomic event RPCs.
-- Preserves existing rows. No destructive table drops.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser_id ON public.campaigns(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON public.campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_advertiser_status ON public.campaigns(advertiser_id, status);

-- ---------------------------------------------------------------
-- Ledger: attach campaign spend to existing ledger_events
-- ---------------------------------------------------------------
ALTER TABLE public.ledger_events
  ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS advertiser_id UUID REFERENCES public.advertisers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reference_id UUID,
  ADD COLUMN IF NOT EXISTS reference_type TEXT,
  ADD COLUMN IF NOT EXISTS amount_milli_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_ledger_events_campaign_id ON public.ledger_events(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ledger_events_advertiser_id ON public.ledger_events(advertiser_id);
CREATE INDEX IF NOT EXISTS idx_ledger_events_reference_id ON public.ledger_events(reference_id);

-- ---------------------------------------------------------------
-- Conversion reuses ad_interactions.kind (do not add a second event table)
-- ---------------------------------------------------------------
DO $$
BEGIN
  ALTER TYPE public.interaction_kind ADD VALUE IF NOT EXISTS 'conversion';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------
-- Protect server-controlled campaign columns from client role updates
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_campaign_accounting()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Freeze accounting columns only for the authenticated client role.
  -- SECURITY DEFINER RPCs and service-role Edge Functions still update counters.
  IF current_user IN ('authenticated', 'anon')
     OR current_setting('role', true) IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.advertiser_id := OLD.advertiser_id;
      NEW.spend_milli_cents := OLD.spend_milli_cents;
      NEW.impressions_count := OLD.impressions_count;
      NEW.clicks_count := OLD.clicks_count;
      NEW.conversions_count := OLD.conversions_count;
      NEW.created_at := OLD.created_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_campaign_accounting ON public.campaigns;
CREATE TRIGGER protect_campaign_accounting
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_campaign_accounting();

-- Mutations go through Edge Functions (service role). Clients may SELECT own rows.
REVOKE ALL ON TABLE public.campaigns FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.campaigns FROM authenticated;
GRANT SELECT ON TABLE public.campaigns TO authenticated;

REVOKE ALL ON TABLE public.ad_impressions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ad_impressions FROM authenticated;
GRANT SELECT ON TABLE public.ad_impressions TO authenticated;

REVOKE ALL ON TABLE public.ad_interactions FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.ad_interactions FROM authenticated;
GRANT SELECT ON TABLE public.ad_interactions TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.ledger_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.ledger_events TO authenticated;

-- ---------------------------------------------------------------
-- Atomic impression accounting (CPM: spend_milli_cents += cpm_cents)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_impression(
  p_campaign_id UUID,
  p_developer_id UUID,
  p_cli_integration TEXT,
  p_session_id TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_impression public.ad_impressions%ROWTYPE;
  v_existing UUID;
  v_cost_milli INTEGER;
BEGIN
  IF p_campaign_id IS NULL OR p_cli_integration IS NULL OR btrim(p_cli_integration) = ''
     OR p_session_id IS NULL OR btrim(p_session_id) = ''
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing FROM public.ad_impressions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_EVENT',
      'impression_id', v_existing
    );
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_campaign.status IS DISTINCT FROM 'active'
     OR (v_campaign.starts_at IS NOT NULL AND now() < v_campaign.starts_at)
     OR (v_campaign.ends_at IS NOT NULL AND now() > v_campaign.ends_at) THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_SERVABLE' USING ERRCODE = '22023';
  END IF;

  v_cost_milli := v_campaign.cpm_cents;
  IF v_campaign.spend_milli_cents + v_cost_milli > v_campaign.budget_cents * 1000 THEN
    RAISE EXCEPTION 'BUDGET_EXCEEDED' USING ERRCODE = '22023';
  END IF;

  BEGIN
    INSERT INTO public.ad_impressions (
      campaign_id, developer_id, cli_integration, session_id, idempotency_key
    ) VALUES (
      p_campaign_id, p_developer_id, p_cli_integration, p_session_id, p_idempotency_key
    ) RETURNING * INTO v_impression;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing FROM public.ad_impressions WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_EVENT',
      'impression_id', v_existing
    );
  END;

  UPDATE public.campaigns
  SET
    impressions_count = impressions_count + 1,
    spend_milli_cents = spend_milli_cents + v_cost_milli
  WHERE id = p_campaign_id;

  INSERT INTO public.ledger_events (
    type, amount_cents, amount_milli_cents, label, detail, simulated,
    campaign_id, advertiser_id, reference_id, reference_type
  ) VALUES (
    'impression',
    0,
    v_cost_milli,
    'Impression recorded',
    v_campaign.name,
    false,
    v_campaign.id,
    v_campaign.advertiser_id,
    v_impression.id,
    'ad_impression'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'impression_id', v_impression.id,
    'spend_milli_cents', v_campaign.spend_milli_cents + v_cost_milli,
    'impressions_count', v_campaign.impressions_count + 1
  );
END;
$$;

-- ---------------------------------------------------------------
-- Atomic click / conversion. Spend is CPM-on-impression only.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_interaction(
  p_campaign_id UUID,
  p_developer_id UUID,
  p_cli_integration TEXT,
  p_session_id TEXT,
  p_idempotency_key TEXT,
  p_impression_id UUID,
  p_kind public.interaction_kind,
  p_reward_cents INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_interaction public.ad_interactions%ROWTYPE;
  v_impression public.ad_impressions%ROWTYPE;
  v_existing UUID;
  v_reward public.reward_ledger%ROWTYPE;
  v_kind public.interaction_kind;
  v_reward_cents INTEGER;
BEGIN
  v_kind := COALESCE(p_kind, 'click');
  IF p_campaign_id IS NULL OR p_developer_id IS NULL
     OR p_cli_integration IS NULL OR btrim(p_cli_integration) = ''
     OR p_session_id IS NULL OR btrim(p_session_id) = ''
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('click', 'conversion') THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_existing FROM public.ad_interactions WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_EVENT',
      'interaction_id', v_existing
    );
  END IF;

  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_campaign.status IS DISTINCT FROM 'active'
     OR (v_campaign.starts_at IS NOT NULL AND now() < v_campaign.starts_at)
     OR (v_campaign.ends_at IS NOT NULL AND now() > v_campaign.ends_at) THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_SERVABLE' USING ERRCODE = '22023';
  END IF;

  IF p_impression_id IS NOT NULL THEN
    SELECT * INTO v_impression FROM public.ad_impressions WHERE id = p_impression_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
    END IF;
    IF v_impression.campaign_id IS DISTINCT FROM p_campaign_id THEN
      RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
    END IF;
    IF v_impression.developer_id IS NOT NULL AND v_impression.developer_id IS DISTINCT FROM p_developer_id THEN
      RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.ad_interactions (
      campaign_id, developer_id, cli_integration, session_id,
      idempotency_key, impression_id, kind
    ) VALUES (
      p_campaign_id, p_developer_id, p_cli_integration, p_session_id,
      p_idempotency_key, p_impression_id, v_kind
    ) RETURNING * INTO v_interaction;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_existing FROM public.ad_interactions WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_EVENT',
      'interaction_id', v_existing
    );
  END;

  IF v_kind = 'click' THEN
    UPDATE public.campaigns SET clicks_count = clicks_count + 1 WHERE id = p_campaign_id;
    v_reward_cents := COALESCE(p_reward_cents, 18);
    IF v_reward_cents > 0 THEN
      INSERT INTO public.reward_ledger (
        developer_id, campaign_id, interaction_id, amount_cents, status
      ) VALUES (
        p_developer_id, p_campaign_id, v_interaction.id, v_reward_cents, 'accrued'
      ) RETURNING * INTO v_reward;
    END IF;
  ELSE
    UPDATE public.campaigns SET conversions_count = conversions_count + 1 WHERE id = p_campaign_id;
  END IF;

  INSERT INTO public.ledger_events (
    type, amount_cents, amount_milli_cents, label, detail, simulated,
    campaign_id, advertiser_id, reference_id, reference_type
  ) VALUES (
    CASE WHEN v_kind = 'click' THEN 'interaction' ELSE 'conversion' END,
    COALESCE(v_reward.amount_cents, 0),
    0,
    CASE WHEN v_kind = 'click' THEN 'Interaction recorded' ELSE 'Conversion recorded' END,
    v_campaign.name,
    false,
    v_campaign.id,
    v_campaign.advertiser_id,
    v_interaction.id,
    'ad_interaction'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'interaction_id', v_interaction.id,
    'kind', v_kind,
    'reward_accrued', CASE WHEN v_reward.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_reward.id,
      'amount_cents', v_reward.amount_cents,
      'status', v_reward.status,
      'campaign_id', v_reward.campaign_id,
      'created_at', v_reward.created_at
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_impression(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_interaction(UUID, UUID, TEXT, TEXT, TEXT, UUID, public.interaction_kind, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_impression(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_interaction(UUID, UUID, TEXT, TEXT, TEXT, UUID, public.interaction_kind, INTEGER) TO service_role;
