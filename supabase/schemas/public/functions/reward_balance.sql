CREATE OR REPLACE FUNCTION public.reward_balance (
  p_developer_id uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_available INTEGER;
  v_pending INTEGER;
  v_lifetime INTEGER;
  v_reserved INTEGER;
BEGIN
  IF p_developer_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PAYOUT' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(SUM(remaining_cents), 0) INTO v_available
  FROM public.reward_ledger
  WHERE developer_id = p_developer_id AND status = 'available';

  SELECT COALESCE(SUM(remaining_cents), 0) INTO v_pending
  FROM public.reward_ledger
  WHERE developer_id = p_developer_id AND status = 'accrued';

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_lifetime
  FROM public.reward_ledger
  WHERE developer_id = p_developer_id;

  SELECT COALESCE(SUM(amount_cents), 0) INTO v_reserved
  FROM public.payouts
  WHERE developer_id = p_developer_id AND status IN ('requested', 'processing');

  RETURN jsonb_build_object(
    'available_cents', v_available,
    'pending_cents', v_pending,
    'lifetime_cents', v_lifetime,
    'reserved_cents', v_reserved
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."reward_balance"(uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."reward_balance"(uuid) FROM PUBLIC, "anon", "authenticated";
