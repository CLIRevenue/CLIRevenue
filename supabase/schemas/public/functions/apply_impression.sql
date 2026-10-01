CREATE OR REPLACE FUNCTION public.apply_impression (
  p_campaign_id     uuid,
  p_developer_id    uuid,
  p_cli_integration text,
  p_session_id      text,
  p_idempotency_key text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."apply_impression"(uuid, uuid, text, text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."apply_impression"(uuid, uuid, text, text, text) FROM PUBLIC, "anon", "authenticated";
