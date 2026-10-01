-- ---------------------------------------------------------------
-- 000015_serve_tracking_rpcs.sql
--
-- Server-authoritative impression / click / conversion for served ads.
--
-- The vulnerability these close: apply_impression and apply_interaction both
-- take a campaign_id, and the Edge Functions that called them took that
-- campaign_id from the request body. A caller holding a developer token
-- could therefore attribute an impression to any active campaign and spend
-- another advertiser's budget.
--
-- The fix is that these functions never accept a campaign_id. They accept a
-- request_id, resolve the serve under a row lock, and take the campaign and
-- developer from that row. A client-supplied campaign_id cannot reach the
-- accounting at all -- there is no parameter to put it in.
--
-- They also delegate to the existing apply_impression / apply_interaction
-- rather than reimplementing the money logic, so there is exactly one place
-- that moves cents. The serve guard is taken first, under FOR UPDATE, so
-- "at most one impression per serve" is decided by the database.
--
-- Response contract for a replay: a replay is a SUCCESS, not an error. It
-- returns {"ok": true, "duplicate": true} with HTTP 200 semantics. This is
-- deliberate. The SDK retries with the same idempotency key after a timeout
-- or a 5xx, and a 4xx would tell it to give up, silently losing a real
-- impression. A genuine forgery still fails loudly with a raised error.
-- ---------------------------------------------------------------

-- Reward for a click, in cents. Server-side policy, identical to
-- REWARD_PER_CLICK_CENTS in the Edge Function. It lives here as well so the
-- amount cannot be influenced by any caller of this path.
CREATE OR REPLACE FUNCTION public.serve_click_reward_cents()
RETURNS INTEGER
LANGUAGE sql IMMUTABLE AS $$ SELECT 18 $$;

-- ---------------------------------------------------------------
-- record_serve_impression
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_serve_impression(
  p_request_id UUID,
  p_publisher_id UUID,
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
$$;

-- ---------------------------------------------------------------
-- record_serve_click
--
-- No campaign_id, no session_id, no impression_id, and no kind: all of those
-- are read from the serve and its impression. The only caller-supplied values
-- are the serve's request id, the publisher identity to check against, and
-- the idempotency key.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_serve_click(
  p_request_id UUID,
  p_publisher_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_serve public.ad_serve_log%ROWTYPE;
  v_imp public.ad_impressions%ROWTYPE;
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

  IF v_serve.click_recorded_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'code', 'DUPLICATE_SERVE',
      'request_id', p_request_id
    );
  END IF;

  -- A click is only billable behind this serve's own impression.
  IF v_serve.impression_recorded_at IS NULL OR v_serve.impression_id IS NULL THEN
    RAISE EXCEPTION 'CLICK_WITHOUT_IMPRESSION' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_imp FROM public.ad_impressions WHERE id = v_serve.impression_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLICK_WITHOUT_IMPRESSION' USING ERRCODE = '22023';
  END IF;

  v_res := public.apply_interaction(
    v_serve.campaign_id,
    v_serve.developer_id,
    v_imp.cli_integration,
    v_imp.session_id,
    btrim(p_idempotency_key),
    v_imp.id,
    'click'::public.interaction_kind,
    public.serve_click_reward_cents()
  );

  IF COALESCE((v_res ->> 'duplicate')::boolean, false) THEN
    RAISE EXCEPTION 'INTERACTION_KEY_REUSED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.ad_serve_log
  SET click_recorded_at = now()
  WHERE request_id = p_request_id;

  RETURN v_res || jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', p_request_id
  );
END;
$$;

-- ---------------------------------------------------------------
-- record_serve_conversion
--
-- Separate from the click path on purpose: a client cannot turn a click
-- request into a conversion by sending {"kind":"conversion"}, because no
-- caller of this function can choose the kind -- it is a literal here, and
-- the two functions have separate guards and separate counters.
--
-- Conversions are not required to follow an impression, matching
-- apply_interaction. The session is derived from the serve so the caller
-- cannot influence the interaction row.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_serve_conversion(
  p_request_id UUID,
  p_publisher_id UUID,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ---------------------------------------------------------------
-- Privileges
--
-- All three bypass RLS and are therefore service_role only. They are the
-- only path to the accounting for SDK traffic, and they refuse to run
-- without a publisher id to check the serve against.
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.serve_click_reward_cents() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_serve_impression(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_serve_click(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_serve_conversion(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.record_serve_impression(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_serve_click(UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_serve_conversion(UUID, UUID, TEXT) TO service_role;
