CREATE OR REPLACE FUNCTION public.apply_interaction (
  p_campaign_id     uuid,
  p_developer_id    uuid,
  p_cli_integration text,
  p_session_id      text,
  p_idempotency_key text,
  p_impression_id   uuid,
  p_kind            public.interaction_kind,
  p_reward_cents    integer
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_interaction public.ad_interactions%ROWTYPE;
  v_impression public.ad_impressions%ROWTYPE;
  v_existing UUID;
  v_reward public.reward_ledger%ROWTYPE;
  v_kind public.interaction_kind;
  v_reward_cents INTEGER;
  v_has_impression BOOLEAN;
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

  -- A click is only billable behind a real impression for this exact
  -- developer and session, so a click cannot be manufactured on its own.
  IF v_kind = 'click' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.ad_impressions i
      WHERE i.campaign_id = p_campaign_id
        AND i.developer_id = p_developer_id
        AND i.session_id = p_session_id
    ) INTO v_has_impression;

    IF NOT v_has_impression THEN
      RAISE EXCEPTION 'CLICK_WITHOUT_IMPRESSION' USING ERRCODE = '22023';
    END IF;
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
    IF v_impression.session_id IS DISTINCT FROM p_session_id THEN
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
        developer_id, campaign_id, interaction_id, amount_cents, remaining_cents, status
      ) VALUES (
        p_developer_id, p_campaign_id, v_interaction.id, v_reward_cents, v_reward_cents, 'accrued'
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."apply_interaction"(uuid, uuid, text, text, text, uuid, public.interaction_kind, integer) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."apply_interaction"(uuid, uuid, text, text, text, uuid, public.interaction_kind, integer) FROM PUBLIC, "anon", "authenticated";
