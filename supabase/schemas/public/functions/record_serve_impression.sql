CREATE OR REPLACE FUNCTION public.record_serve_impression (
  p_request_id      uuid,
  p_publisher_id    uuid,
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
  v_serve public.ad_serve_log%ROWTYPE;
  v_res JSONB;
BEGIN
  IF p_request_id IS NULL OR p_publisher_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;
  IF p_cli_integration IS NULL OR btrim(p_cli_integration) = ''
     OR p_session_id IS NULL OR btrim(p_session_id) = ''
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;

  -- FOR UPDATE is the atomic guard: two concurrent impressions for the same
  -- serve serialise here, and the loser observes impression_recorded_at set.
  SELECT * INTO v_serve
  FROM public.ad_serve_log
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SERVE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_serve.publisher_id IS DISTINCT FROM p_publisher_id THEN
    -- Same 404 as a missing serve, so a key cannot be used to probe which
    -- request ids exist under other publishers.
    RAISE EXCEPTION 'SERVE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_serve.impression_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_SERVE',
      'request_id', p_request_id,
      'impression_id', v_serve.impression_id
    );
  END IF;

  IF now() > v_serve.expires_at THEN
    RAISE EXCEPTION 'SERVE_EXPIRED' USING ERRCODE = '22023';
  END IF;

  v_res := public.apply_impression(
    v_serve.campaign_id,
    v_serve.developer_id,
    btrim(p_cli_integration),
    btrim(p_session_id),
    btrim(p_idempotency_key)
  );

  -- Reaching here with duplicate=true means the idempotency key was already
  -- consumed by a *different* serve, because a replay of this serve returns
  -- early above. Reusing one key across serves is not a legitimate retry and
  -- must not attach another serve's impression to this one.
  IF COALESCE((v_res ->> 'duplicate')::boolean, false) THEN
    RAISE EXCEPTION 'IMPRESSION_KEY_REUSED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ad_serve_log
  SET impression_recorded_at = now(),
      impression_id = (v_res ->> 'impression_id')::uuid,
      impression_session_id = btrim(p_session_id)
  WHERE request_id = p_request_id;

  RETURN v_res || jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', p_request_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."record_serve_impression"(uuid, uuid, text, text, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."record_serve_impression"(uuid, uuid, text, text, text) FROM PUBLIC, "anon", "authenticated";
