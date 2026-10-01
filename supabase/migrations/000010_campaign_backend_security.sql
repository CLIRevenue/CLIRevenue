-- 000010_campaign_backend_security.sql
-- Campaign/reward backend hardening: audiences are platform-controlled,
-- the profiles UPDATE policy no longer recurses, reward payouts debit the
-- ledger atomically, and settlement is an auditable server-side operation.
--
-- Additive and idempotent. No table or row is destroyed. No secret is
-- stored here; every privileged function is service_role-only.
--
-- Deliberately NOT in this migration (later phases, documented so the
-- schema stays forward-compatible): ad_reports(reason, description,
-- status, campaign_id, publisher_id, reviewed_by, reviewed_at). Nothing
-- in campaigns / ad_impressions / ad_interactions blocks adding it, and
-- a reporting developer's identity must never be exposed to advertisers.

-- ---------------------------------------------------------------
-- audiences: platform-controlled reference data
--
-- Audience identifiers are platform vocabulary (backend, data, devops,
-- frontend, oss). Advertisers select one; they never define one. Without
-- an explicit policy every role inherits the default Supabase table
-- grants, which is how a client could previously invent audience ids.
-- Reads stay open on purpose: the value is already visible on every
-- campaign response and is not sensitive.
-- ---------------------------------------------------------------
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Audiences are readable by everyone" ON public.audiences;
CREATE POLICY "Audiences are readable by everyone" ON public.audiences
  FOR SELECT USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.audiences FROM anon, authenticated;
GRANT SELECT ON public.audiences TO anon, authenticated;

-- ---------------------------------------------------------------
-- profiles: remove the self-referencing WITH CHECK
--
-- 000007 guarded `role` with a subquery on public.profiles from inside a
-- policy on public.profiles. Evaluating that subquery re-enters RLS on
-- the same relation, so an UPDATE could fail with "infinite recursion
-- detected in policy for relation \"profiles\"".
--
-- Role immutability does not depend on that expression: 000007 revoked
-- table-level UPDATE from `authenticated` and granted only the six
-- self-reported columns, so `role` is not client-writable at all.
-- `ensure_own_profile` (SECURITY DEFINER) remains the only writer of
-- role for a brand-new row, and it whitelists advertiser|developer.
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- ---------------------------------------------------------------
-- reward_ledger: consumption shape + no client writes
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_ledger_consumed_shape'
  ) THEN
    ALTER TABLE public.reward_ledger
      ADD CONSTRAINT reward_ledger_consumed_shape
      CHECK (status <> 'consumed' OR remaining_cents = 0);
  END IF;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.reward_ledger FROM anon, authenticated;
GRANT SELECT ON public.reward_ledger TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payouts FROM anon, authenticated;
GRANT SELECT ON public.payouts TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.payout_transactions FROM anon, authenticated;
GRANT SELECT ON public.payout_transactions TO authenticated;

-- ---------------------------------------------------------------
-- apply_settlement: accrued -> available, server-side and auditable
--
-- Replaces the broken client-triggerable update that wrote a
-- non-existent `settledAt` column. Rows are locked before they flip so
-- two concurrent settlement passes cannot double-write an audit row.
-- p_developer_id = NULL settles platform-wide (privileged callers only);
-- a developer id restricts the pass to that developer's own rewards.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_settlement(
  p_settlement_ms INTEGER DEFAULT 5000,
  p_developer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ---------------------------------------------------------------
-- request_payout: debit rewards and create the payout atomically
--
-- The previous implementation computed the available balance with a
-- hardcoded `reserved = 0` and never debited the rewards it paid out, so
-- the same settled reward could be paid out repeatedly; two concurrent
-- requests also both saw the full balance. Here the candidate rows are
-- locked FOR UPDATE and consumed inside the same transaction that
-- creates the payout: a second concurrent call blocks on the lock, then
-- finds nothing left and fails with INSUFFICIENT_BALANCE instead of
-- overspending. Any RAISE rolls the whole call back, payout row included.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_payout(
  p_developer_id UUID,
  p_amount_cents INTEGER,
  p_provider_id TEXT DEFAULT 'demo-ledger'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ---------------------------------------------------------------
-- reward_balance: one definition of a developer's money
--
-- available_cents is net of everything already consumed, so it is the
-- spendable figure; reserved_cents is informational (payouts requested
-- but not yet sent) and is deliberately NOT subtracted a second time —
-- those cents already left available_cents when they were consumed.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reward_balance(p_developer_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- ---------------------------------------------------------------
-- Execution privileges: service_role only
--
-- Every function above bypasses RLS, so none may be reachable from anon
-- or authenticated. Edge Functions (running as the service role and
-- resolving the caller's own developer id from their JWT) are the only
-- path to them; the browser never receives a service-role credential.
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.apply_settlement(INTEGER, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_payout(UUID, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reward_balance(UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_settlement(INTEGER, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_payout(UUID, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.reward_balance(UUID) TO service_role;
