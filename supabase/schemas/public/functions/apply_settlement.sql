CREATE OR REPLACE FUNCTION public.apply_settlement (
  p_settlement_ms integer DEFAULT 5000,
  p_developer_id  uuid    DEFAULT NULL::uuid
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
DECLARE
  v_cutoff TIMESTAMPTZ := now()
    - ((GREATEST(COALESCE(p_settlement_ms, 5000), 0)::text || ' milliseconds')::interval);
  v_ids UUID[];
BEGIN
  SELECT array_agg(s.id) INTO v_ids
  FROM (
    SELECT id
    FROM public.reward_ledger
    WHERE status = 'accrued'
      AND created_at < v_cutoff
      AND (p_developer_id IS NULL OR developer_id = p_developer_id)
    ORDER BY created_at, id
    FOR UPDATE
  ) s;

  IF v_ids IS NULL THEN
    RETURN jsonb_build_object('settled_count', 0, 'settled_cents', 0);
  END IF;

  UPDATE public.reward_ledger
  SET status = 'available', settled_at = now()
  WHERE id = ANY(v_ids);

  INSERT INTO public.ledger_events (
    type, amount_cents, label, detail, simulated, campaign_id, reference_id, reference_type
  )
  SELECT
    'reward_available', r.amount_cents, 'Reward available',
    COALESCE(c.name, r.campaign_id::text), false, r.campaign_id, r.id, 'reward_ledger'
  FROM public.reward_ledger r
  LEFT JOIN public.campaigns c ON c.id = r.campaign_id
  WHERE r.id = ANY(v_ids);

  RETURN jsonb_build_object(
    'settled_count', COALESCE(array_length(v_ids, 1), 0),
    'settled_cents', (
      SELECT COALESCE(SUM(amount_cents), 0) FROM public.reward_ledger WHERE id = ANY(v_ids)
    )
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."apply_settlement"(integer, uuid) TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."apply_settlement"(integer, uuid) FROM PUBLIC, "anon", "authenticated";
