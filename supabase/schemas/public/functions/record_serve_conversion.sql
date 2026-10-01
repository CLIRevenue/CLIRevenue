CREATE OR REPLACE FUNCTION public.record_serve_conversion (
  p_request_id      uuid,
  p_publisher_id    uuid,
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
  IF p_request_id IS NULL OR p_publisher_id IS NULL
     OR p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_serve
  FROM public.ad_serve_log
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_serve.publisher_id IS DISTINCT FROM p_publisher_id THEN
    RAISE EXCEPTION 'SERVE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_serve.conversion_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_SERVE',
      'request_id', p_request_id
    );
  END IF;

  IF now() > v_serve.expires_at THEN
    RAISE EXCEPTION 'SERVE_EXPIRED' USING ERRCODE = '22023';
  END IF;

  v_res := public.apply_interaction(
    v_serve.campaign_id,
    v_serve.developer_id,
    'clirevenue-server',
    v_serve.request_id::text,
    btrim(p_idempotency_key),
    NULL,
    'conversion'::public.interaction_kind,
    0
  );

  IF COALESCE((v_res ->> 'duplicate')::boolean, false) THEN
    RAISE EXCEPTION 'INTERACTION_KEY_REUSED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ad_serve_log
  SET conversion_recorded_at = now()
  WHERE request_id = p_request_id;

  RETURN v_res || jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', p_request_id
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."record_serve_conversion"(uuid, uuid, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."record_serve_conversion"(uuid, uuid, text) FROM PUBLIC, "anon", "authenticated";
