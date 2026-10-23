-- =====================================================================
-- 20261021120100_wallet_governance_campaign_credits.sql
--
-- Three things the wallet needs that the wallet itself cannot provide.
--
-- 1. THE SUPPORT CHANNEL HAS TO CARRY AN UNFREEZE REQUEST.
--    A frozen person is told they are frozen, and then they have to be
--    able to ask for it to be lifted. The support inbox is where every
--    other request already lives, so the request goes there: a new
--    category, and a link back to the freeze it refers to.
--
-- 2. THE GOVERNANCE LOG HAS TO CARRY THE NEW DECISIONS.
--    `admin_governance_actions.action` and `.subject_type` are CHECK
--    constrained to the one decision the admin API could make when the
--    table was written. Granting credits and freezing an account are
--    new decisions, so the CHECK has to widen. It is widened here
--    rather than by editing 000024, because a migration that has
--    already run is history.
--
-- 3. A CAMPAIGN HAS TO BE PAID FOR.
--    An advertiser's campaign holds a reservation of credits for as
--    long as it is live. The reservation is the whole budget, because
--    the delivery path can spend at most `budget_cents` — so a
--    campaign can never spend more than it held. The delivery path
--    itself is not modified: `spend_milli_cents` stays the ceiling it
--    has always been, and the wallet is settled when the campaign
--    stops.
--
--    1 credit = 1 INR = 100 cents. A budget of 150000 cents is 1500
--    credits. Spend is held in milli-cents, so 100000 milli-cents is
--    one credit.
--
-- Additive. No table or row is destroyed. Existing campaigns keep
-- serving: this migration adds a gate on STARTING a campaign, not a
-- change to the delivery hot path.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. The support inbox carries an unfreeze request.
-- ---------------------------------------------------------------------
ALTER TABLE public.advertiser_queries
    DROP CONSTRAINT IF EXISTS advertiser_queries_category_check;

ALTER TABLE public.advertiser_queries
    ADD CONSTRAINT advertiser_queries_category_check
    CHECK (category IN ('general', 'billing', 'campaign', 'sdk', 'account', 'bug', 'unfreeze'));

ALTER TABLE public.advertiser_queries
    ADD COLUMN IF NOT EXISTS related_freeze_id UUID
    REFERENCES public.account_freezes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_advertiser_queries_related_freeze
    ON public.advertiser_queries (related_freeze_id)
    WHERE related_freeze_id IS NOT NULL;

COMMENT ON COLUMN public.advertiser_queries.related_freeze_id IS
    'The freeze this request refers to, when the person is asking to be unfrozen.';

-- ---------------------------------------------------------------------
-- 2. The governance log carries the new decisions.
-- ---------------------------------------------------------------------
ALTER TABLE public.admin_governance_actions
    DROP CONSTRAINT IF EXISTS admin_governance_actions_action_check;

ALTER TABLE public.admin_governance_actions
    ADD CONSTRAINT admin_governance_actions_action_check
    CHECK (action IN (
        'SERVING_GATE_ENABLED',
        'SERVING_GATE_DISABLED',
        'CREDITS_GRANTED',
        'ACCOUNT_FROZEN',
        'ACCOUNT_UNFROZEN',
        'WALLET_FROZEN',
        'WALLET_UNFROZEN',
        'KEYS_FROZEN',
        'KEYS_UNFROZEN',
        'TOPUP_CONFIRMED',
        'TOPUP_REJECTED'
    ));

ALTER TABLE public.admin_governance_actions
    DROP CONSTRAINT IF EXISTS admin_governance_actions_subject_type_check;

ALTER TABLE public.admin_governance_actions
    ADD CONSTRAINT admin_governance_actions_subject_type_check
    CHECK (subject_type IN ('advertiser', 'developer', 'publisher', 'profile', 'credit_account'));

COMMENT ON CONSTRAINT admin_governance_actions_action_check ON public.admin_governance_actions IS
    'The decisions the admin console can actually make. Widened from the two serving-gate verbs when the credit wallet arrived: granting credits, freezing an account, a wallet or a set of keys, and settling a top-up are all decisions somebody can be accountable for.';

-- ---------------------------------------------------------------------
-- 3. Campaign credit reservations.
-- ---------------------------------------------------------------------

-- The one place the credit budget is calculated. Both the activation
-- gate and the reservation use it, so they cannot disagree.
CREATE OR REPLACE FUNCTION public.campaign_credit_budget(p_budget_cents BIGINT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, FLOOR(COALESCE(p_budget_cents, 0) / 100.0)::BIGINT);
$$;

COMMENT ON FUNCTION public.campaign_credit_budget(BIGINT) IS
    'The credits a campaign budget costs. 1 credit is 1 INR is 100 cents. A budget of 150000 cents is 1500 credits.';

-- The hold: one open reservation per campaign.
CREATE TABLE IF NOT EXISTS public.campaign_credit_holds (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id             UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    advertiser_id           UUID NOT NULL REFERENCES public.advertisers(id) ON DELETE CASCADE,
    profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    credits                 BIGINT NOT NULL CHECK (credits > 0),
    status                  TEXT NOT NULL DEFAULT 'held' CHECK (status IN ('held','settled')),
    idempotency_key         TEXT NOT NULL UNIQUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at              TIMESTAMPTZ
);

COMMENT ON TABLE public.campaign_credit_holds IS
    'The credits a live campaign holds in its advertiser wallet. One open hold per campaign.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_campaign_credit_holds_open
    ON public.campaign_credit_holds (campaign_id) WHERE status = 'held';
CREATE INDEX IF NOT EXISTS idx_campaign_credit_holds_profile
    ON public.campaign_credit_holds (profile_id, created_at DESC);

-- The credits a campaign has actually consumed, in credits.
CREATE OR REPLACE FUNCTION public.campaign_credits_spent(p_spend_milli_cents BIGINT)
RETURNS BIGINT
LANGUAGE sql
IMMUTABLE
AS $$
  -- spend_milli_cents is milli-cents; 100000 of them is one credit.
  SELECT GREATEST(0, FLOOR(COALESCE(p_spend_milli_cents, 0) / 100000.0)::BIGINT);
$$;

-- ---------------------------------------------------------------------
-- settle_campaign_credit_hold: close a hold, return the unused part,
-- and book what was actually spent.
--
-- Three ledger rows, and the arithmetic works out:
--   reserve   debit  reserved        (at activation)
--   release   credit reserved        (at settlement, returns the hold)
--   spend     debit  spent           (at settlement, books the delivery)
-- Net movement: -spent. The campaign's own ceiling is `budget_cents`,
-- so spent can never exceed reserved.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_campaign_credit_hold(
  p_campaign_id UUID,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_hold public.campaign_credit_holds%ROWTYPE;
  v_spent BIGINT;
  v_release jsonb;
  v_spend jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_hold FROM public.campaign_credit_holds
  WHERE campaign_id = p_campaign_id AND status = 'held'
  FOR UPDATE;
  IF NOT FOUND THEN
    -- Nothing held: either it was never reserved, or it is already
    -- settled. Both are a no-op, not an error.
    RETURN jsonb_build_object('ok', true, 'settled', false, 'reason', 'NO_OPEN_HOLD');
  END IF;

  v_spent := public.campaign_credits_spent(v_campaign.spend_milli_cents);
  IF v_spent > v_hold.credits THEN
    v_spent := v_hold.credits;
  END IF;

  -- Return the whole hold first, so the money is back in the wallet.
  SELECT * INTO v_release FROM public.release_wallet_credits(
    v_hold.profile_id,
    v_hold.credits,
    'campaign-hold-release:' || v_hold.id::text,
    'campaign', v_campaign.id,
    'Campaign budget released'
  );

  -- Then book what the campaign actually spent.
  IF v_spent > 0 THEN
    SELECT * INTO v_spend FROM public.post_wallet_transaction(
      v_hold.profile_id, 'campaign_spend', 'debit', v_spent,
      'campaign-hold-spend:' || v_hold.id::text,
      NULL, NULL, NULL, 'campaign', v_campaign.id,
      'Campaign spend', NULL,
      -- The delivery already happened. Refusing to record it would
      -- strand the money rather than protect it.
      TRUE
    );
  END IF;

  UPDATE public.campaign_credit_holds
  SET status = 'settled', settled_at = NOW()
  WHERE id = v_hold.id;

  RETURN jsonb_build_object(
    'ok', true,
    'settled', true,
    'campaign_id', v_campaign.id,
    'reserved_credits', v_hold.credits,
    'spent_credits', v_spent,
    'returned_credits', v_hold.credits - v_spent
  );
END;
$$;

-- ---------------------------------------------------------------------
-- reserve_campaign_credits: hold the budget before a campaign goes live.
--
-- Idempotent per campaign. Reserving twice for the same budget is a
-- no-op, so a retried activation does not take the money twice. A
-- budget that grew takes the difference; a budget that shrank gives
-- back the difference.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_campaign_credits(
  p_campaign_id UUID,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign public.campaigns%ROWTYPE;
  v_advertiser public.advertisers%ROWTYPE;
  v_hold public.campaign_credit_holds%ROWTYPE;
  v_budget BIGINT;
  v_delta BIGINT;
  v_res jsonb;
BEGIN
  SELECT * INTO v_campaign FROM public.campaigns WHERE id = p_campaign_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CAMPAIGN_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_advertiser FROM public.advertisers WHERE id = v_campaign.advertiser_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ADVERTISER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  v_budget := public.campaign_credit_budget(v_campaign.budget_cents);
  IF v_budget <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'reserved', false, 'reason', 'NO_BUDGET');
  END IF;

  SELECT * INTO v_hold FROM public.campaign_credit_holds
  WHERE campaign_id = p_campaign_id AND status = 'held'
  FOR UPDATE;

  IF FOUND THEN
    v_delta := v_budget - v_hold.credits;
    IF v_delta = 0 THEN
      RETURN jsonb_build_object(
        'ok', true, 'reserved', false, 'duplicate', true,
        'campaign_id', p_campaign_id, 'credits', v_hold.credits
      );
    END IF;
  ELSE
    v_delta := v_budget;
  END IF;

  IF v_delta > 0 THEN
    SELECT * INTO v_res FROM public.reserve_wallet_credits(
      v_advertiser.profile_id,
      v_delta,
      'campaign-hold:' || p_campaign_id::text || ':' || v_budget::text,
      'campaign', p_campaign_id,
      'Campaign budget reserved'
    );
  ELSE
    SELECT * INTO v_res FROM public.release_wallet_credits(
      v_advertiser.profile_id,
      -v_delta,
      'campaign-hold-shrink:' || p_campaign_id::text || ':' || v_budget::text,
      'campaign', p_campaign_id,
      'Campaign budget reduced'
    );
  END IF;

  IF v_hold.id IS NULL THEN
    INSERT INTO public.campaign_credit_holds (
      campaign_id, advertiser_id, profile_id, credits, idempotency_key
    ) VALUES (
      p_campaign_id, v_advertiser.id, v_advertiser.profile_id, v_budget,
      'campaign-hold:' || p_campaign_id::text
    )
    ON CONFLICT (campaign_id) WHERE status = 'held' DO UPDATE SET credits = EXCLUDED.credits;
  ELSE
    UPDATE public.campaign_credit_holds SET credits = v_budget WHERE id = v_hold.id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'reserved', true, 'duplicate', false,
    'campaign_id', p_campaign_id, 'credits', v_budget, 'delta', v_delta
  );
END;
$$;

COMMENT ON FUNCTION public.reserve_campaign_credits(UUID, UUID) IS
    'Holds a campaign budget in the advertiser wallet. Idempotent per campaign: a retried activation does not take the money twice.';

-- ---------------------------------------------------------------------
-- The activation gate now knows about money and about freezes.
--
-- `INSUFFICIENT_CREDITS` and `ACCOUNT_FROZEN` are the two new codes.
-- They are reported by the same function the dashboard renders, so one
-- answer describes the problem wherever it is found.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.campaign_activation_blockers(p_campaign_id UUID)
RETURNS TEXT[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    c       public.campaigns%ROWTYPE;
    blockers TEXT[] := ARRAY[]::TEXT[];
    headline_length INTEGER;
    v_profile_id UUID;
    v_available BIGINT;
    v_credit_budget BIGINT;
BEGIN
    SELECT * INTO c FROM public.campaigns WHERE id = p_campaign_id;
    IF NOT FOUND THEN
        RETURN ARRAY['CAMPAIGN_NOT_FOUND'];
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.advertisers a WHERE a.id = c.advertiser_id AND a.can_run_campaigns IS TRUE
    ) THEN
        blockers := array_append(blockers, 'ADVERTISER_NOT_ELIGIBLE');
    END IF;

    -- A frozen account cannot start spending. It can still sign in, so
    -- it can still read the notice and ask to be unfrozen.
    SELECT a.profile_id INTO v_profile_id
    FROM public.advertisers a
    WHERE a.id = c.advertiser_id;

    IF v_profile_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = v_profile_id AND p.frozen_at IS NOT NULL
    ) THEN
        blockers := array_append(blockers, 'ACCOUNT_FROZEN');
    END IF;

    IF c.audience_id IS NULL OR c.audience_id = '' THEN
        blockers := array_append(blockers, 'INVALID_AUDIENCE');
    END IF;

    IF c.budget_cents IS NULL OR c.budget_cents <= 0 THEN
        blockers := array_append(blockers, 'INVALID_BUDGET');
    END IF;

    IF COALESCE(c.cpm_cents, 0) <= 0 THEN
        blockers := array_append(blockers, 'INVALID_CPM');
    END IF;

    -- The money question. A campaign needs its whole budget in the
    -- wallet before it goes live, because the wallet is what pays for
    -- the delivery it is about to buy.
    v_credit_budget := public.campaign_credit_budget(c.budget_cents);
    IF v_credit_budget > 0 THEN
        SELECT COALESCE(w.balance_credits, 0) INTO v_available
        FROM public.wallets w
        WHERE w.profile_id = v_profile_id;

        IF COALESCE(v_available, 0) < v_credit_budget THEN
            blockers := array_append(blockers, 'INSUFFICIENT_CREDITS');
        END IF;
    END IF;

    IF c.starts_at IS NOT NULL AND c.ends_at IS NOT NULL AND c.starts_at >= c.ends_at THEN
        blockers := array_append(blockers, 'INVALID_SCHEDULE');
    END IF;

    IF c.starts_at IS NOT NULL AND c.starts_at > now() THEN
        blockers := array_append(blockers, 'SCHEDULE_NOT_STARTED');
    END IF;

    IF c.ends_at IS NOT NULL AND c.ends_at < now() THEN
        blockers := array_append(blockers, 'SCHEDULE_ENDED');
    END IF;

    IF c.landing_url IS NULL
       OR c.landing_url !~ '^https?://[^\s]+$' THEN
        blockers := array_append(blockers, 'INVALID_LANDING_URL');
    END IF;

    IF COALESCE(c.spend_milli_cents, 0) >= COALESCE(c.budget_cents, 0) * 1000 THEN
        blockers := array_append(blockers, 'BUDGET_EXCEEDED');
    END IF;

    -- The ad text itself. The same function the CHECK constraint uses, so
    -- the blocker and the constraint can never disagree about which
    -- campaigns are too long.
    headline_length := public.ad_text_length(c.headline);
    IF headline_length = 0 THEN
        blockers := array_append(blockers, 'AD_TEXT_REQUIRED');
    ELSIF headline_length > 60 THEN
        blockers := array_append(blockers, 'AD_TEXT_TOO_LONG');
    END IF;

    RETURN blockers;
END;
$$;

COMMENT ON FUNCTION public.campaign_activation_blockers(UUID) IS
    'Blocker codes preventing a campaign from serving. Empty means ready. '
    'Service-role only. Includes the money gate: a campaign needs its whole '
    'budget in the advertiser wallet before it goes live. The ad text is at most 60 characters.';

-- ---------------------------------------------------------------------
-- A frozen account stops running campaigns.
--
-- The trigger fires once, when the freeze is applied, and it is NOT on
-- the delivery hot path: the delivery query still only asks for
-- campaigns with status 'active'. Pausing them here means a frozen
-- advertiser's campaigns stop being selected at delivery, without the
-- delivery query learning anything about freezes.
--
-- The campaigns are NOT resumed automatically when the freeze is
-- lifted. An operator decides to bring a campaign back.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.on_profile_frozen_pause_campaigns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campaign_id UUID;
BEGIN
  IF NEW.frozen_at IS NULL OR OLD.frozen_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  FOR v_campaign_id IN
    SELECT c.id FROM public.campaigns c
    JOIN public.advertisers a ON a.id = c.advertiser_id
    WHERE a.profile_id = NEW.id AND c.status = 'active'
  LOOP
    UPDATE public.campaigns
    SET status = 'paused', updated_at = NOW()
    WHERE id = v_campaign_id;

    PERFORM public.settle_campaign_credit_hold(v_campaign_id, NEW.frozen_by);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_frozen_pause_campaigns ON public.profiles;
CREATE TRIGGER on_profile_frozen_pause_campaigns
  AFTER UPDATE OF frozen_at ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.on_profile_frozen_pause_campaigns();

-- ---------------------------------------------------------------------
-- A request to be unfrozen.
--
-- The request is a support query with a new category, linked back to
-- the freeze. It is filed by the person, through the support channel
-- they already have, and it lands in the admin console's inbox.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_unfreeze(
  p_profile_id UUID,
  p_freeze_id UUID,
  p_subject TEXT,
  p_body TEXT,
  p_user_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freeze public.account_freezes%ROWTYPE;
  v_query_id UUID;
BEGIN
  IF p_profile_id IS NULL OR p_freeze_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ID' USING ERRCODE = '22023';
  END IF;
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'EMPTY_BODY' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_freeze FROM public.account_freezes WHERE id = p_freeze_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FREEZE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  -- A person can only ask about their own freeze.
  IF v_freeze.profile_id <> p_profile_id THEN
    RAISE EXCEPTION 'NOT_YOUR_FREEZE' USING ERRCODE = '22023';
  END IF;
  IF v_freeze.status <> 'active' THEN
    RAISE EXCEPTION 'FREEZE_ALREADY_RELEASED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.advertiser_queries (
    profile_id, user_email, subject, body, category, related_freeze_id
  ) VALUES (
    p_profile_id,
    NULLIF(btrim(COALESCE(p_user_email, '')), ''),
    COALESCE(NULLIF(btrim(COALESCE(p_subject, '')), ''), 'Request to unfreeze my account'),
    btrim(p_body),
    'unfreeze',
    p_freeze_id
  ) RETURNING id INTO v_query_id;

  UPDATE public.account_freezes
  SET unfreeze_request_id = v_query_id, unfreeze_requested_at = NOW()
  WHERE id = p_freeze_id;

  SELECT * INTO v_freeze FROM public.account_freezes WHERE id = p_freeze_id;

  RETURN jsonb_build_object(
    'ok', true,
    'request_id', v_query_id,
    'freeze', row_to_json(v_freeze)
  );
END;
$$;

COMMENT ON FUNCTION public.request_unfreeze(UUID, UUID, TEXT, TEXT, TEXT) IS
    'Files a support request asking for a freeze to be lifted, and links it to the freeze. The person can only ask about their own freeze.';

-- ---------------------------------------------------------------------
-- RLS and privileges for the new tables.
-- ---------------------------------------------------------------------
ALTER TABLE public.campaign_credit_holds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advertisers can view their own campaign holds" ON public.campaign_credit_holds;
CREATE POLICY "Advertisers can view their own campaign holds" ON public.campaign_credit_holds
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all campaign holds" ON public.campaign_credit_holds;
CREATE POLICY "Admins can view all campaign holds" ON public.campaign_credit_holds
  FOR SELECT USING (public.jwt_is_admin());

REVOKE ALL ON public.campaign_credit_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.campaign_credit_holds TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.campaign_credit_holds TO service_role;

REVOKE ALL ON FUNCTION public.campaign_credit_budget(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.campaign_credits_spent(BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_campaign_credit_hold(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_campaign_credits(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_unfreeze(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_profile_frozen_pause_campaigns() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.campaign_credit_budget(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.campaign_credits_spent(BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_campaign_credit_hold(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_campaign_credits(UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_unfreeze(UUID, UUID, TEXT, TEXT, TEXT) TO service_role;
