CREATE OR REPLACE FUNCTION public.request_payout (
  p_developer_id uuid,
  p_amount_cents integer,
  p_provider_id  text    DEFAULT 'demo-ledger'::text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_payout public.payouts%ROWTYPE;
  v_txn public.payout_transactions%ROWTYPE;
  v_rec RECORD;
  v_needed INTEGER;
  v_take INTEGER;
  v_after INTEGER;
  v_consumed INTEGER := 0;
BEGIN
  IF p_developer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYOUT' USING ERRCODE = '22023';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;
  IF p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
    RAISE EXCEPTION 'INVALID_PROVIDER' USING ERRCODE = '22023';
  END IF;

  v_needed := p_amount_cents;

  INSERT INTO public.payouts (developer_id, amount_cents, provider_id, status)
  VALUES (p_developer_id, p_amount_cents, btrim(p_provider_id), 'requested')
  RETURNING * INTO v_payout;

  FOR v_rec IN
    SELECT id, remaining_cents
    FROM public.reward_ledger
    WHERE developer_id = p_developer_id
      AND status = 'available'
      AND remaining_cents > 0
    ORDER BY created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_needed <= 0;

    v_take := LEAST(v_rec.remaining_cents, v_needed);
    v_after := v_rec.remaining_cents - v_take;

    UPDATE public.reward_ledger
    SET remaining_cents = v_after,
        status = CASE WHEN v_after = 0 THEN 'consumed'::public.reward_status
                      ELSE 'available'::public.reward_status END,
        consumed_at = CASE WHEN v_after = 0 THEN now() ELSE consumed_at END,
        payout_id = v_payout.id
    WHERE id = v_rec.id;

    v_needed := v_needed - v_take;
    v_consumed := v_consumed + v_take;
  END LOOP;

  IF v_needed > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_BALANCE' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payout_transactions (
    payout_id, type, amount_cents, currency, provider_id, status
  ) VALUES (
    v_payout.id, 'payout', v_payout.amount_cents, 'USD', v_payout.provider_id, v_payout.status
  ) RETURNING * INTO v_txn;

  INSERT INTO public.ledger_events (type, amount_cents, label, detail, simulated)
  VALUES (
    'payout', v_payout.amount_cents, 'Payout requested',
    v_payout.provider_id || ' · demo rail, not sent', false
  );

  RETURN jsonb_build_object(
    'payout', jsonb_build_object(
      'id', v_payout.id,
      'amount_cents', v_payout.amount_cents,
      'provider_id', v_payout.provider_id,
      'status', v_payout.status,
      'created_at', v_payout.created_at
    ),
    'transaction', jsonb_build_object(
      'id', v_txn.id,
      'type', v_txn.type,
      'amount_cents', v_txn.amount_cents,
      'status', v_txn.status,
      'created_at', v_txn.created_at
    ),
    'consumed_cents', v_consumed
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."request_payout"(uuid, integer, text) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."request_payout"(uuid, integer, text) FROM PUBLIC, "anon", "authenticated";
