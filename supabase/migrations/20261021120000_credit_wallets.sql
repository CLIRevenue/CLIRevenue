-- =====================================================================
-- 20261021120000_credit_wallets.sql
--
-- The advertiser and developer credit wallet, and the freeze machinery
-- that has to be enforced inside it.
--
-- WHY THIS FILE EXISTS
--
-- The platform had no money on the advertiser side at all. `campaigns`
-- carried a `budget_cents` ceiling compared against a `spend_milli_cents`
-- counter, and nothing anywhere recorded that an advertiser had paid for
-- anything. A publisher had a ledger (`reward_ledger`); an advertiser had
-- a spreadsheet column.
--
-- This adds the missing half: a wallet per person, an append-only
-- transaction log, a top-up instrument that captures who paid, how much,
-- in which currency, by which method and exactly when, and the freeze
-- state that stops all of it.
--
-- ---------------------------------------------------------------------
-- THE SECURITY MODEL. Read this before changing any line below.
-- ---------------------------------------------------------------------
--
-- 1. THE BROWSER NEVER ASSERTS MONEY.
--    Creating a top-up does NOT credit a wallet. A top-up is created in
--    status 'pending' and recorded; only `confirm_wallet_topup` posts the
--    credit, and that function is service_role only. A browser that lies
--    about having paid produces a pending row an operator has to look at,
--    not a balance. The same function is the hook a payment provider's
--    server-to-server verification will call later, so the provider
--    integration does not need a second credit path.
--
-- 2. ONE WRITER.
--    Every balance change goes through `post_wallet_transaction`. No
--    client role can INSERT into `wallets` or `wallet_transactions`, and
--    `wallets.balance_credits` is a PROJECTION of the transaction log,
--    not an independent truth. `reconcile_wallet` recomputes it from the
--    log and reports drift.
--
-- 3. THE TRANSACTION LOG IS APPEND-ONLY.
--    `wallet_transactions` is granted SELECT and INSERT to service_role
--    and nothing else. No UPDATE, no DELETE, for any role. A correction
--    is a new reversing row, never an edit.
--
-- 4. IDEMPOTENCY IS A CONSTRAINT, NOT A CONVENTION.
--    `wallet_transactions.idempotency_key` and
--    `wallet_topups.idempotency_key` are both UNIQUE. A replayed
--    confirmation returns the original transaction instead of posting a
--    second credit.
--
-- 5. A BALANCE NEVER GOES NEGATIVE.
--    `wallets.balance_credits` carries CHECK (>= 0) and the posting
--    function refuses an overdraft before it writes anything.
--
-- 6. FROZEN MEANS FROZEN.
--    A frozen wallet and a frozen account both refuse every credit and
--    every debit, in SQL, inside the posting function. The UI cannot
--    bypass it because the UI is not in the path.
--
-- 7. A FREEZE DOES NOT LOCK THE PERSON OUT.
--    Freezing stops money moving and stops keys working. It deliberately
--    does NOT stop sign-in: the frozen person has to be able to read the
--    notice and file the request to be unfrozen, and a freeze that
--    silenced the support channel would be a trap, not a control.
--
-- 8. THE ADMIN GRANT IS CAPPED IN THE DATABASE.
--    At most 2000 free credits per person per calendar month, enforced
--    by a sum over that person's grant transactions while the wallet row
--    is locked. The cap is not a number the Edge Function believes in; it
--    is a number the database computes.
--
-- 9. THE LEDGER IS AUTHORITATIVE; THE PROJECTION IS A CACHE.
--    `wallets.balance_credits` is maintained in the same transaction as
--    the transaction row, so the two cannot disagree unless somebody
--    writes around the function. `reconcile_wallet` is how that is
--    detected.
--
-- 10. ONE LOCK ORDER, EVERYWHERE.
--    Every function that touches both a profile and a wallet takes them
--    in the same order: profile, then wallet. A different order in two
--    functions is a deadlock waiting for a slow request to find it.
--
-- ---------------------------------------------------------------------
-- THE UNIT
-- ---------------------------------------------------------------------
--
-- One credit is one INR. Credits are whole numbers. A wallet holds
-- credits; the money that bought them is recorded beside them with the
-- currency it was paid in and the rate that was applied at the time.
-- `credit_rates` holds the rate table (credits per one whole unit of a
-- currency) and the rate used is snapshotted on every row that has a
-- fiat amount, so a later rate change cannot rewrite history.
--
-- Additive and idempotent. No table or row is destroyed. No secret is
-- stored here.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------
-- credit_rates: how many credits one whole unit of a currency buys.
--
-- INR is the credit unit, so its rate is 1 by definition. Other rows
-- are maintained by an operator; the browser can read them (a top-up
-- form has to show the rate it is quoting) but never write them.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.credit_rates (
    currency              TEXT PRIMARY KEY,
    credits_per_unit      NUMERIC(20,10) NOT NULL CHECK (credits_per_unit > 0),
    note                  TEXT,
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.credit_rates IS
    'How many credits one whole unit of a currency buys. INR is 1 by definition: one credit is one INR.';

INSERT INTO public.credit_rates (currency, credits_per_unit, note)
VALUES ('INR', 1, 'The credit unit. One credit is one INR.')
ON CONFLICT (currency) DO NOTHING;

-- ---------------------------------------------------------------------
-- Freeze state on the three things that can be frozen independently.
--
-- profiles: the account. The person can still sign in (see rule 7
-- above) but cannot move money or use publisher keys.
--
-- wallets: the balance, independently of the account. A wallet can be
-- frozen without the account being frozen.
--
-- publisher_keys: the delivery credential. A frozen key cannot
-- authenticate; the publisher's account and earnings are untouched.
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS frozen_reason TEXT,
    ADD COLUMN IF NOT EXISTS frozen_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.publisher_keys
    ADD COLUMN IF NOT EXISTS frozen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS frozen_reason TEXT;

COMMENT ON COLUMN public.profiles.frozen_at IS
    'When the account was frozen. A frozen account cannot move credits and cannot use publisher keys. It CAN still sign in: the notice and the unfreeze request have to be reachable.';

COMMENT ON COLUMN public.publisher_keys.frozen_at IS
    'When the key was frozen. A frozen key cannot authenticate. Distinct from revoked_at, which is permanent.';

-- ---------------------------------------------------------------------
-- wallets: one per person, keyed by the profile id.
--
-- `profile_id` is the user id, so a wallet is found the same way a
-- profile is. UNIQUE, which is what makes "one wallet per user" a
-- database fact rather than a convention.
--
-- balance_credits / reserved_credits are a projection of
-- wallet_transactions. They exist so a balance read is one row instead
-- of a sum; the transaction log remains the source of truth.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallets (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id              UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    owner_role              TEXT NOT NULL CHECK (owner_role IN ('advertiser','developer','admin')),
    -- The credit unit this wallet is denominated in. Always INR today.
    currency                TEXT NOT NULL DEFAULT 'INR',
    balance_credits         BIGINT NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
    reserved_credits        BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
    lifetime_credited_credits BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_credited_credits >= 0),
    lifetime_debited_credits  BIGINT NOT NULL DEFAULT 0 CHECK (lifetime_debited_credits >= 0),
    frozen_at               TIMESTAMPTZ,
    frozen_reason           TEXT,
    frozen_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.wallets IS
    'One credit wallet per profile. balance_credits and reserved_credits are a projection of wallet_transactions, not an independent truth.';

CREATE INDEX IF NOT EXISTS idx_wallets_frozen ON public.wallets (frozen_at) WHERE frozen_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- wallet_transactions: the append-only log.
--
-- The only table that records that money moved. `balance_after` is
-- denormalised onto the row so a statement of account can be read
-- without replaying the whole history, and so drift between the
-- projection and the log is visible on the row that caused it.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id               UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind                    TEXT NOT NULL CHECK (kind IN (
                                'topup',            -- money the person paid in
                                'admin_grant',      -- free credits an admin sent
                                'campaign_reserve', -- credits held against a live campaign
                                'campaign_release', -- a hold returned to the wallet
                                'campaign_spend',   -- a hold consumed by delivery
                                'refund',           -- money returned
                                'payout',            -- money sent out to a publisher
                                'adjustment'         -- a correcting entry
                            )),
    direction               TEXT NOT NULL CHECK (direction IN ('credit','debit')),
    credits                 BIGINT NOT NULL CHECK (credits > 0),
    balance_after           BIGINT NOT NULL CHECK (balance_after >= 0),
    -- The currency of amount_minor, when there is one. A reservation or
    -- an admin grant moves credits and has no fiat amount behind it.
    currency                TEXT,
    amount_minor            BIGINT CHECK (amount_minor IS NULL OR amount_minor > 0),
    -- The rate applied, snapshotted. NULL when there is no fiat amount.
    rate_credits_per_unit   NUMERIC(20,10),
    idempotency_key         TEXT NOT NULL UNIQUE,
    reference_type          TEXT,
    reference_id            UUID,
    description             TEXT,
    memo                    TEXT,
    -- Second precision on purpose: the record of a top-up states the
    -- second it happened, not a fraction of a second nobody can read.
    occurred_at             TIMESTAMPTZ NOT NULL DEFAULT date_trunc('second', NOW()),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.wallet_transactions IS
    'Append-only credit log. SELECT and INSERT to service_role only; no UPDATE or DELETE for any role. A correction is a new reversing row.';

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_wallet
    ON public.wallet_transactions (wallet_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_profile
    ON public.wallet_transactions (profile_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_kind
    ON public.wallet_transactions (profile_id, kind, occurred_at DESC);

-- ---------------------------------------------------------------------
-- wallet_topups: the instrument a person hands over money against.
--
-- It is created pending and it carries the details the record has to
-- keep: when, who, from where, how much, in which currency, by which
-- method, and under which reference. The row survives the confirmation
-- so the payment and the credit can be reconciled years later.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wallet_topups (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id               UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    -- The credits this top-up will grant, computed by the server from
    -- the amount and the rate. The client never states this.
    credits                 BIGINT NOT NULL CHECK (credits > 0),
    -- The currency the money was paid in. The wallet's own unit is INR.
    currency                TEXT NOT NULL,
    amount_minor            BIGINT NOT NULL CHECK (amount_minor > 0),
    rate_credits_per_unit   NUMERIC(20,10) NOT NULL CHECK (rate_credits_per_unit > 0),
    payment_method          TEXT NOT NULL CHECK (payment_method IN (
                                'upi', 'card', 'bank_transfer', 'manual', 'promo'
                            )),
    payment_reference       TEXT,
    payer_name              TEXT NOT NULL,
    payer_email             TEXT NOT NULL,
    payer_address           TEXT,
    payer_phone             TEXT,
    idempotency_key         TEXT NOT NULL UNIQUE,
    status                  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
                                'pending', 'confirmed', 'rejected', 'refunded'
                            )),
    confirmed_at            TIMESTAMPTZ,
    confirmed_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    rejected_at             TIMESTAMPTZ,
    rejected_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    rejection_reason        TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.wallet_topups IS
    'A pending or settled top-up instrument with the payer details the record has to keep. Creating one credits nothing.';

CREATE INDEX IF NOT EXISTS idx_wallet_topups_profile
    ON public.wallet_topups (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_topups_status
    ON public.wallet_topups (status, created_at DESC);

-- ---------------------------------------------------------------------
-- account_freezes: the history of every freeze, and the request to
-- have it lifted.
--
-- A freeze is a row, not a column, because there are three scopes
-- that can be frozen independently and because the history of who
-- froze what, when, and why is the only thing that makes a freeze
-- reviewable.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.account_freezes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope                   TEXT NOT NULL CHECK (scope IN ('account','wallet','keys')),
    reason                  TEXT NOT NULL,
    frozen_by               UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    frozen_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status                  TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','released')),
    released_at             TIMESTAMPTZ,
    released_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    release_reason          TEXT,
    -- Set when the person asks to be unfrozen. The request itself is a
    -- support query, linked from here so an operator sees it in the
    -- same place as the freeze.
    unfreeze_request_id     UUID,
    unfreeze_requested_at   TIMESTAMPTZ
);

COMMENT ON TABLE public.account_freezes IS
    'Every freeze ever applied, with its scope, reason, actor, and the moment the person asked to be unfrozen.';

CREATE INDEX IF NOT EXISTS idx_account_freezes_profile
    ON public.account_freezes (profile_id, frozen_at DESC);
CREATE INDEX IF NOT EXISTS idx_account_freezes_active
    ON public.account_freezes (profile_id) WHERE status = 'active';

-- ---------------------------------------------------------------------
-- user_notifications: what a person is told, in their own console.
--
-- The bell in the advertiser console reads support replies. That is not
-- enough for a freeze: a freeze is not a reply to a question, and the
-- person has to be told even if they never open the support inbox.
-- So freezes (and grants) write a row here, and both consoles read it.
--
-- The row is the notification. There is no delivery mechanism here, and
-- there is no claim that there is: a notification that is read on the
-- next page load is a notification, and pretending it was emailed
-- would be a lie about a system that does not exist.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_notifications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id              UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    kind                    TEXT NOT NULL CHECK (kind IN (
                                'account_frozen', 'wallet_frozen', 'keys_frozen',
                                'unfreeze_granted', 'unfreeze_denied',
                                'credits_granted', 'topup_confirmed'
                            )),
    severity                TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
    title                   TEXT NOT NULL,
    body                    TEXT NOT NULL,
    related_freeze_id       UUID REFERENCES public.account_freezes(id) ON DELETE SET NULL,
    read_at                 TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_notifications IS
    'Notices addressed to a person: a freeze, a grant, a settled top-up. Read receipts live here so the dot survives a refresh.';

CREATE INDEX IF NOT EXISTS idx_user_notifications_profile
    ON public.user_notifications (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_notifications_unread
    ON public.user_notifications (profile_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------
-- notify_user: the only writer of a notification.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_user(
  p_profile_id UUID,
  p_kind TEXT,
  p_severity TEXT,
  p_title TEXT,
  p_body TEXT,
  p_related_freeze_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.user_notifications (
    profile_id, kind, severity, title, body, related_freeze_id
  ) VALUES (
    p_profile_id, p_kind, COALESCE(p_severity, 'info'), p_title, p_body, p_related_freeze_id
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------------
-- mark_notifications_read: a read receipt.
--
-- An RPC and not an UPDATE policy, for the same reason
-- mark_queries_read is an RPC: a plain "own rows are updatable" policy
-- would let a signed-in person rewrite the title and the body of a
-- notice. The read receipt is the only thing that may change.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $mark_notifications_read$
DECLARE
  changed integer;
BEGIN
  UPDATE public.user_notifications AS n
     SET read_at = now()
   WHERE n.profile_id = auth.uid()
     AND n.read_at IS NULL
     AND (p_ids IS NULL OR n.id = ANY (p_ids));
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed;
END;
$mark_notifications_read$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- ---------------------------------------------------------------------
-- A wallet exists from the moment the account does.
--
-- The trigger is on profiles, not on advertisers/developer_accounts, so
-- every person gets exactly one wallet regardless of role and regardless
-- of which bootstrap path created them. ensure_own_profile (the
-- browser-facing fallback) also inserts a profile row, so it is covered
-- by the same trigger.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_wallet(p_profile_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_wallet UUID;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = p_profile_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.wallets (profile_id, owner_role)
  VALUES (p_profile_id, v_role)
  ON CONFLICT (profile_id) DO NOTHING
  RETURNING id INTO v_wallet;

  IF v_wallet IS NULL THEN
    SELECT id INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  END IF;

  RETURN v_wallet;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_profile_created_wallet()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_wallet(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_wallet ON public.profiles;
CREATE TRIGGER on_profile_created_wallet
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.on_profile_created_wallet();

-- Backfill for the accounts that already exist. A wallet with a zero
-- balance is the honest starting point: none of these people has paid
-- the platform money yet, and inventing an opening balance would be a
-- number with no instrument behind it.
INSERT INTO public.wallets (profile_id, owner_role)
SELECT p.id, p.role FROM public.profiles p
ON CONFLICT (profile_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- lock_profile / lock_wallet: the one place the profile-then-wallet
-- lock order is written down.
--
-- Two single-column functions rather than one multi-column one: a
-- record-returning function cannot be read into a multi-item INTO
-- list, and the order is the whole point of the helper, so it is
-- worth paying for two calls instead of fighting the grammar.
--
-- Every function that touches both a profile and a wallet calls these
-- two, in this order, and never in the other one.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_profile(p_profile_id UUID)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.profiles%ROWTYPE;
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_wallet(p_profile_id UUID)
RETURNS public.wallets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
BEGIN
  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  RETURN v_wallet;
END;
$$;

-- ---------------------------------------------------------------------
-- post_wallet_transaction: the only function that moves a balance.
--
-- Every credit and every debit in the system comes through here, so the
-- rules (frozen, non-negative, idempotent) are stated once.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.post_wallet_transaction(
  p_profile_id UUID,
  p_kind TEXT,
  p_direction TEXT,
  p_credits BIGINT,
  p_idempotency_key TEXT,
  p_currency TEXT DEFAULT NULL,
  p_amount_minor BIGINT DEFAULT NULL,
  p_rate NUMERIC DEFAULT NULL,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_memo TEXT DEFAULT NULL,
  -- A freeze stops money LEAVING a person, not money arriving. A release
  -- of a reservation, or a refund, has to be able to reach a frozen
  -- holder: a freeze that trapped somebody's own credits would be a way
  -- to take their money, which is not what a freeze is for.
  p_allow_frozen BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_existing public.wallet_transactions%ROWTYPE;
  v_balance BIGINT;
  v_kind TEXT := lower(btrim(COALESCE(p_kind, '')));
  v_direction TEXT := lower(btrim(COALESCE(p_direction, '')));
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;
  IF v_kind NOT IN ('topup','admin_grant','campaign_reserve','campaign_release','campaign_spend','refund','payout','adjustment') THEN
    RAISE EXCEPTION 'INVALID_KIND' USING ERRCODE = '22023';
  END IF;
  IF v_direction NOT IN ('credit','debit') THEN
    RAISE EXCEPTION 'INVALID_DIRECTION' USING ERRCODE = '22023';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;

  -- Lock profile, then wallet. The order is fixed by lock_profile and
  -- lock_wallet, and it is the same order everywhere.
  v_profile := public.lock_profile(p_profile_id);
  v_wallet := public.lock_wallet(p_profile_id);

  -- A replay is a success, not a second posting. The key is the proof.
  -- This is checked AFTER the lock, so two concurrent calls with the
  -- same key serialise: the second one finds the row the first wrote.
  SELECT * INTO v_existing
  FROM public.wallet_transactions
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'transaction_id', v_existing.id,
      'kind', v_existing.kind,
      'direction', v_existing.direction,
      'credits', v_existing.credits,
      'balance_after', v_existing.balance_after,
      'wallet_id', v_existing.wallet_id,
      'profile_id', v_existing.profile_id,
      'occurred_at', v_existing.occurred_at
    );
  END IF;

  -- Frozen means frozen, in both senses: a frozen wallet refuses to
  -- move, and so does a frozen account. The exception is a movement that
  -- GIVES credits back, which is always allowed.
  IF NOT COALESCE(p_allow_frozen, false) THEN
    IF v_wallet.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'WALLET_FROZEN' USING ERRCODE = '22023';
    END IF;
    IF v_profile.frozen_at IS NOT NULL THEN
      RAISE EXCEPTION 'ACCOUNT_FROZEN' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_direction = 'credit' THEN
    v_balance := v_wallet.balance_credits + p_credits;
  ELSE
    v_balance := v_wallet.balance_credits - p_credits;
    IF v_balance < 0 THEN
      RAISE EXCEPTION 'INSUFFICIENT_CREDITS' USING ERRCODE = '22023';
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.wallet_transactions (
      wallet_id, profile_id, kind, direction, credits, balance_after,
      currency, amount_minor, rate_credits_per_unit, idempotency_key,
      reference_type, reference_id, description, memo
    ) VALUES (
      v_wallet.id, p_profile_id, v_kind, v_direction, p_credits, v_balance,
      p_currency, p_amount_minor, p_rate, btrim(p_idempotency_key),
      p_reference_type, p_reference_id, p_description, p_memo
    ) RETURNING * INTO v_existing;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent caller won the race on the key. Its transaction is
    -- the truth; this one is a replay.
    SELECT * INTO v_existing
    FROM public.wallet_transactions
    WHERE idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'transaction_id', v_existing.id,
      'kind', v_existing.kind,
      'direction', v_existing.direction,
      'credits', v_existing.credits,
      'balance_after', v_existing.balance_after,
      'wallet_id', v_existing.wallet_id,
      'profile_id', v_existing.profile_id,
      'occurred_at', v_existing.occurred_at
    );
  END;

  UPDATE public.wallets
  SET balance_credits = v_balance,
      lifetime_credited_credits = lifetime_credited_credits
        + CASE WHEN v_direction = 'credit' THEN p_credits ELSE 0 END,
      lifetime_debited_credits = lifetime_debited_credits
        + CASE WHEN v_direction = 'debit' THEN p_credits ELSE 0 END,
      updated_at = NOW()
  WHERE id = v_wallet.id;

  RETURN jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'transaction_id', v_existing.id,
    'kind', v_existing.kind,
    'direction', v_existing.direction,
    'credits', v_existing.credits,
    'balance_after', v_balance,
    'wallet_id', v_wallet.id,
    'profile_id', p_profile_id,
    'occurred_at', v_existing.occurred_at
  );
END;
$$;

-- ---------------------------------------------------------------------
-- reserve_wallet_credits / release_wallet_credits
--
-- A reservation is a debit. It is not a separate pool of money: the
-- credits move out of the available balance when they are held and come
-- back when they are released or spent.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_wallet_credits(
  p_profile_id UUID,
  p_credits BIGINT,
  p_idempotency_key TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res FROM public.post_wallet_transaction(
    p_profile_id, 'campaign_reserve', 'debit', p_credits, p_idempotency_key,
    NULL, NULL, NULL, p_reference_type, p_reference_id, p_description, NULL
  );

  -- Only a first, non-duplicate reservation changes the reserved figure.
  IF NOT COALESCE((v_res ->> 'duplicate')::boolean, false) THEN
    UPDATE public.wallets
    SET reserved_credits = reserved_credits + p_credits, updated_at = NOW()
    WHERE profile_id = p_profile_id;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  RETURN v_res || jsonb_build_object('reserved_credits', v_wallet.reserved_credits);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_wallet_credits(
  p_profile_id UUID,
  p_credits BIGINT,
  p_idempotency_key TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_res jsonb;
  v_wallet public.wallets%ROWTYPE;
BEGIN
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;

  -- The reserved figure is read under the same lock the posting takes.
  -- Profile first, then wallet, in the same order as everywhere else.
  PERFORM public.lock_profile(p_profile_id);
  v_wallet := public.lock_wallet(p_profile_id);
  IF p_credits > v_wallet.reserved_credits THEN
    RAISE EXCEPTION 'RESERVED_CREDITS_MISMATCH' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res FROM public.post_wallet_transaction(
    p_profile_id, 'campaign_release', 'credit', p_credits, p_idempotency_key,
    NULL, NULL, NULL, p_reference_type, p_reference_id, p_description, NULL,
    -- A release gives credits back, so it has to work even for a frozen
    -- holder. Freezing must not be a way to trap somebody's own credits.
    TRUE
  );

  IF NOT COALESCE((v_res ->> 'duplicate')::boolean, false) THEN
    UPDATE public.wallets
    SET reserved_credits = GREATEST(0, reserved_credits - p_credits), updated_at = NOW()
    WHERE id = v_wallet.id;
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  RETURN v_res || jsonb_build_object('reserved_credits', v_wallet.reserved_credits);
END;
$$;

-- ---------------------------------------------------------------------
-- create_wallet_topup: records a payment claim. Credits nothing.
--
-- The credits are computed here, on the server, from the amount and the
-- rate in credit_rates. A client that asks for a million credits for a
-- hundred rupees gets a hundred rupees' worth, because the number it
-- asked for is not an input to anything.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_wallet_topup(
  p_profile_id UUID,
  p_amount_minor BIGINT,
  p_currency TEXT,
  p_payment_method TEXT,
  p_payment_reference TEXT,
  p_payer_name TEXT,
  p_payer_email TEXT,
  p_idempotency_key TEXT,
  p_payer_address TEXT DEFAULT NULL,
  p_payer_phone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_rate NUMERIC;
  v_credits BIGINT;
  v_topup public.wallet_topups%ROWTYPE;
  v_currency TEXT := upper(btrim(COALESCE(p_currency, '')));
  v_method TEXT := lower(btrim(COALESCE(p_payment_method, '')));
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;
  IF v_currency = '' THEN
    RAISE EXCEPTION 'INVALID_CURRENCY' USING ERRCODE = '22023';
  END IF;
  IF v_method NOT IN ('upi','card','bank_transfer','manual','promo') THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_METHOD' USING ERRCODE = '22023';
  END IF;
  IF p_payer_name IS NULL OR btrim(p_payer_name) = '' THEN
    RAISE EXCEPTION 'INVALID_PAYER' USING ERRCODE = '22023';
  END IF;
  IF p_payer_email IS NULL OR btrim(p_payer_email) = '' THEN
    RAISE EXCEPTION 'INVALID_PAYER' USING ERRCODE = '22023';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'INVALID_IDEMPOTENCY_KEY' USING ERRCODE = '22023';
  END IF;

  -- Replay returns the original instrument.
  SELECT * INTO v_topup
  FROM public.wallet_topups
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true, 'topup', row_to_json(v_topup)
    );
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_wallet.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'WALLET_FROZEN' USING ERRCODE = '22023';
  END IF;

  SELECT credits_per_unit INTO v_rate FROM public.credit_rates WHERE currency = v_currency;
  IF v_rate IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_CURRENCY' USING ERRCODE = '22023';
  END IF;

  -- amount_minor is in the minor unit of the currency paid (paise, cents).
  -- 100 minor units make one whole unit, which buys credits_per_unit
  -- credits. Floor, never round: rounding up would mint credits nobody
  -- paid for.
  v_credits := floor((p_amount_minor::numeric / 100) * v_rate);
  IF v_credits < 1 THEN
    RAISE EXCEPTION 'AMOUNT_TOO_SMALL' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.wallet_topups (
    wallet_id, profile_id, credits, currency, amount_minor, rate_credits_per_unit,
    payment_method, payment_reference, payer_name, payer_email, payer_address,
    payer_phone, idempotency_key, status
  ) VALUES (
    v_wallet.id, p_profile_id, v_credits, v_currency, p_amount_minor, v_rate,
    v_method, NULLIF(btrim(COALESCE(p_payment_reference, '')), ''),
    btrim(p_payer_name), btrim(p_payer_email),
    NULLIF(btrim(COALESCE(p_payer_address, '')), ''),
    NULLIF(btrim(COALESCE(p_payer_phone, '')), ''),
    btrim(p_idempotency_key), 'pending'
  ) RETURNING * INTO v_topup;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'topup', row_to_json(v_topup)
  );
END;
$$;

-- ---------------------------------------------------------------------
-- confirm_wallet_topup: the one path that turns a payment into a
-- balance. service_role only.
--
-- This is the function a payment provider's server-to-server
-- verification will call. It is deliberately the same function an
-- operator calls by hand today: one credit path, one set of rules, one
-- audit trail, whichever door the money came through.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.confirm_wallet_topup(
  p_topup_id UUID,
  p_payment_reference TEXT,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.wallet_topups%ROWTYPE;
  v_res jsonb;
  v_tx public.wallet_transactions%ROWTYPE;
BEGIN
  IF p_topup_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_topup FROM public.wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOPUP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- Already settled: a replay is a success, not a second credit.
  IF v_topup.status = 'confirmed' THEN
    SELECT * INTO v_tx FROM public.wallet_transactions
    WHERE idempotency_key = 'topup:' || v_topup.id::text;
    RETURN jsonb_build_object(
      'ok', true, 'duplicate', true, 'topup', row_to_json(v_topup),
      'transaction', CASE WHEN v_tx.id IS NULL THEN NULL ELSE row_to_json(v_tx) END
    );
  END IF;

  IF v_topup.status <> 'pending' THEN
    RAISE EXCEPTION 'TOPUP_NOT_CONFIRMABLE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res FROM public.post_wallet_transaction(
    v_topup.profile_id, 'topup', 'credit', v_topup.credits,
    'topup:' || v_topup.id::text,
    v_topup.currency, v_topup.amount_minor, v_topup.rate_credits_per_unit,
    'wallet_topup', v_topup.id,
    'Top-up confirmed', NULLIF(btrim(COALESCE(p_payment_reference, '')), '')
  );

  UPDATE public.wallet_topups
  SET status = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = p_actor_profile_id,
      payment_reference = COALESCE(
        NULLIF(btrim(COALESCE(p_payment_reference, '')), ''), payment_reference
      ),
      updated_at = NOW()
  WHERE id = v_topup.id;

  SELECT * INTO v_topup FROM public.wallet_topups WHERE id = v_topup.id;
  SELECT * INTO v_tx FROM public.wallet_transactions
  WHERE idempotency_key = 'topup:' || v_topup.id::text;

  RETURN jsonb_build_object(
    'ok', true, 'duplicate', false, 'topup', row_to_json(v_topup),
    'transaction', CASE WHEN v_tx.id IS NULL THEN NULL ELSE row_to_json(v_tx) END,
    'balance_after', v_res ->> 'balance_after'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_wallet_topup(
  p_topup_id UUID,
  p_reason TEXT,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_topup public.wallet_topups%ROWTYPE;
BEGIN
  SELECT * INTO v_topup FROM public.wallet_topups WHERE id = p_topup_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TOPUP_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_topup.status = 'confirmed' THEN
    RAISE EXCEPTION 'TOPUP_ALREADY_SETTLED' USING ERRCODE = '22023';
  END IF;

  UPDATE public.wallet_topups
  SET status = 'rejected',
      rejected_at = NOW(),
      rejected_by = p_actor_profile_id,
      rejection_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
      updated_at = NOW()
  WHERE id = v_topup.id;

  SELECT * INTO v_topup FROM public.wallet_topups WHERE id = v_topup.id;

  RETURN jsonb_build_object('ok', true, 'topup', row_to_json(v_topup));
END;
$$;

-- ---------------------------------------------------------------------
-- grant_free_credits: the admin's gift, capped in the database.
--
-- At most 2000 free credits per person per calendar month. The cap is
-- a sum over that person's grant transactions in the current month, and
-- it is computed while the wallet row is held, so two concurrent grants
-- cannot both see the same headroom and both pass.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.grant_free_credits(
  p_profile_id UUID,
  p_credits BIGINT,
  p_reason TEXT,
  p_actor_profile_id UUID DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used BIGINT;
  v_key TEXT;
  v_res jsonb;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;
  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'INVALID_AMOUNT' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  v_key := COALESCE(
    NULLIF(btrim(COALESCE(p_idempotency_key, '')), ''),
    'grant:' || p_profile_id::text || ':' || to_char(now(), 'YYYY-MM') || ':' || p_credits::text
  );

  -- Lock first, then measure. The measurement is only meaningful while
  -- this transaction holds the lock.
  PERFORM public.lock_profile(p_profile_id);
  PERFORM public.lock_wallet(p_profile_id);

  SELECT COALESCE(SUM(credits), 0) INTO v_used
  FROM public.wallet_transactions
  WHERE profile_id = p_profile_id
    AND kind = 'admin_grant'
    AND occurred_at >= date_trunc('month', NOW());

  IF v_used + p_credits > 2000 THEN
    RAISE EXCEPTION 'MONTHLY_GRANT_LIMIT' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_res FROM public.post_wallet_transaction(
    p_profile_id, 'admin_grant', 'credit', p_credits, v_key,
    NULL, NULL, NULL, 'admin_grant', p_actor_profile_id,
    'Gift by CLIRevenue Team', btrim(p_reason)
  );

  RETURN v_res || jsonb_build_object(
    'granted_credits', p_credits,
    'month_used_credits', v_used + p_credits,
    'month_remaining_credits', GREATEST(0, 2000 - (v_used + p_credits)),
    'monthly_limit_credits', 2000
  );
END;
$$;

-- ---------------------------------------------------------------------
-- wallet_snapshot: one call, everything a console needs to show.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_snapshot(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_used BIGINT;
  v_pending_count INTEGER;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(credits), 0) INTO v_used
  FROM public.wallet_transactions
  WHERE profile_id = p_profile_id
    AND kind = 'admin_grant'
    AND occurred_at >= date_trunc('month', NOW());

  SELECT COUNT(*)::INTEGER INTO v_pending_count
  FROM public.wallet_topups
  WHERE profile_id = p_profile_id AND status = 'pending';

  RETURN jsonb_build_object(
    'wallet_id', v_wallet.id,
    'profile_id', v_wallet.profile_id,
    'owner_role', v_wallet.owner_role,
    'currency', v_wallet.currency,
    'balance_credits', v_wallet.balance_credits,
    'reserved_credits', v_wallet.reserved_credits,
    'lifetime_credited_credits', v_wallet.lifetime_credited_credits,
    'lifetime_debited_credits', v_wallet.lifetime_debited_credits,
    'frozen_at', v_wallet.frozen_at,
    'frozen_reason', v_wallet.frozen_reason,
    'month_granted_credits', v_used,
    'month_grant_limit_credits', 2000,
    'month_grant_remaining_credits', GREATEST(0, 2000 - v_used),
    'pending_topup_count', v_pending_count,
    'created_at', v_wallet.created_at,
    'updated_at', v_wallet.updated_at
  );
END;
$$;

-- ---------------------------------------------------------------------
-- wallet_ledger: the statement of account.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_ledger(
  p_profile_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_count INTEGER;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.occurred_at DESC, t.id DESC), '[]'::jsonb),
         COUNT(*)::INTEGER
  INTO v_rows, v_count
  FROM (
    SELECT id, kind, direction, credits, balance_after, currency, amount_minor,
           rate_credits_per_unit, reference_type, reference_id, description, memo,
           occurred_at, created_at
    FROM public.wallet_transactions
    WHERE profile_id = p_profile_id
    ORDER BY occurred_at DESC, id DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 500))
  ) t;

  RETURN jsonb_build_object('transactions', v_rows, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------
-- wallet_topups_of: the top-up history, for the console.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.wallet_topups_of(
  p_profile_id UUID,
  p_limit INTEGER DEFAULT 25
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_count INTEGER;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.created_at DESC, t.id DESC), '[]'::jsonb),
         COUNT(*)::INTEGER
  INTO v_rows, v_count
  FROM (
    SELECT id, credits, currency, amount_minor, rate_credits_per_unit,
           payment_method, payment_reference, payer_name, payer_email,
           payer_address, payer_phone, status, confirmed_at, rejection_reason,
           created_at, updated_at
    FROM public.wallet_topups
    WHERE profile_id = p_profile_id
    ORDER BY created_at DESC, id DESC
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 200))
  ) t;

  RETURN jsonb_build_object('topups', v_rows, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------
-- reconcile_wallet: the projection is a cache, so it can drift. This
-- recomputes the truth from the log and reports the difference.
--
-- It repairs nothing. A repair is a correcting transaction, written by
-- a human decision, not by a job that guesses.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconcile_wallet(p_profile_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_wallet public.wallets%ROWTYPE;
  v_computed BIGINT;
  v_reserved BIGINT;
  v_drift BIGINT;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_wallet FROM public.wallets WHERE profile_id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'WALLET_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN credits ELSE -credits END), 0)
    INTO v_computed
  FROM public.wallet_transactions
  WHERE wallet_id = v_wallet.id;

  SELECT COALESCE(SUM(CASE WHEN kind = 'campaign_reserve' THEN credits ELSE -credits END), 0)
    INTO v_reserved
  FROM public.wallet_transactions
  WHERE wallet_id = v_wallet.id
    AND kind IN ('campaign_reserve','campaign_release','campaign_spend');

  v_drift := v_wallet.balance_credits - v_computed;

  RETURN jsonb_build_object(
    'profile_id', p_profile_id,
    'wallet_id', v_wallet.id,
    'balance_credits', v_wallet.balance_credits,
    'computed_credits', v_computed,
    'drift_credits', v_drift,
    'reserved_credits', v_wallet.reserved_credits,
    'computed_reserved_credits', v_reserved,
    'reserved_drift_credits', v_wallet.reserved_credits - v_reserved,
    'balanced', v_drift = 0
  );
END;
$$;

-- ---------------------------------------------------------------------
-- freeze_account / release_freeze
--
-- The scopes are independent, so a wallet can be frozen without the
-- account being frozen and keys can be frozen without either. The
-- function is the only writer of all three, so the states cannot drift
-- apart.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.freeze_account(
  p_profile_id UUID,
  p_scope TEXT,
  p_reason TEXT,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope TEXT := lower(btrim(COALESCE(p_scope, '')));
  v_freeze public.account_freezes%ROWTYPE;
BEGIN
  IF p_profile_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_PROFILE' USING ERRCODE = '22023';
  END IF;
  IF v_scope NOT IN ('account','wallet','keys') THEN
    RAISE EXCEPTION 'INVALID_SCOPE' USING ERRCODE = '22023';
  END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = '22023';
  END IF;

  PERFORM public.lock_profile(p_profile_id);
  PERFORM public.lock_wallet(p_profile_id);

  IF v_scope = 'account' THEN
    UPDATE public.profiles
    SET frozen_at = NOW(), frozen_reason = btrim(p_reason), frozen_by = p_actor_profile_id
    WHERE id = p_profile_id;
  ELSIF v_scope = 'wallet' THEN
    UPDATE public.wallets
    SET frozen_at = NOW(), frozen_reason = btrim(p_reason), frozen_by = p_actor_profile_id, updated_at = NOW()
    WHERE profile_id = p_profile_id;
  ELSE
    UPDATE public.publisher_keys
    SET frozen_at = NOW(), frozen_reason = btrim(p_reason)
    WHERE publisher_id IN (
      SELECT id FROM public.publishers WHERE owner_profile_id = p_profile_id
    ) AND frozen_at IS NULL;
  END IF;

  INSERT INTO public.account_freezes (profile_id, scope, reason, frozen_by)
  VALUES (p_profile_id, v_scope, btrim(p_reason), p_actor_profile_id)
  RETURNING * INTO v_freeze;

  -- The person is told. This is the only channel that reaches them
  -- whether or not they open their support inbox.
  PERFORM public.notify_user(
    p_profile_id,
    CASE v_scope
      WHEN 'account' THEN 'account_frozen'
      WHEN 'wallet'  THEN 'wallet_frozen'
      ELSE 'keys_frozen'
    END,
    CASE v_scope
      WHEN 'account' THEN 'critical'
      ELSE 'warning'
    END,
    CASE v_scope
      WHEN 'account' THEN 'Your account has been frozen'
      WHEN 'wallet'  THEN 'Your wallet has been frozen'
      ELSE 'Your publisher keys have been frozen'
    END,
    CASE v_scope
      WHEN 'account' THEN 'You cannot spend credits or use publisher keys while your account is frozen. You can still sign in and request an unfreeze from your console.'
      WHEN 'wallet'  THEN 'Credits cannot be added to or taken from your wallet while it is frozen. You can still sign in and request an unfreeze from your console.'
      ELSE 'Your publisher keys cannot authenticate requests while they are frozen. You can still sign in and request an unfreeze from your console.'
    END,
    v_freeze.id
  );

  RETURN jsonb_build_object('ok', true, 'freeze', row_to_json(v_freeze));
END;
$$;

CREATE OR REPLACE FUNCTION public.release_freeze(
  p_freeze_id UUID,
  p_reason TEXT,
  p_actor_profile_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_freeze public.account_freezes%ROWTYPE;
BEGIN
  IF p_freeze_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_ID' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_freeze FROM public.account_freezes WHERE id = p_freeze_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FREEZE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_freeze.status = 'released' THEN
    RETURN jsonb_build_object('ok', true, 'duplicate', true, 'freeze', row_to_json(v_freeze));
  END IF;

  PERFORM public.lock_profile(v_freeze.profile_id);
  PERFORM public.lock_wallet(v_freeze.profile_id);

  -- Only the scope that was frozen is released. Releasing one scope
  -- never quietly releases another.
  IF v_freeze.scope = 'account' THEN
    UPDATE public.profiles
    SET frozen_at = NULL, frozen_reason = NULL, frozen_by = NULL
    WHERE id = v_freeze.profile_id;
  ELSIF v_freeze.scope = 'wallet' THEN
    UPDATE public.wallets
    SET frozen_at = NULL, frozen_reason = NULL, frozen_by = NULL, updated_at = NOW()
    WHERE profile_id = v_freeze.profile_id;
  ELSE
    UPDATE public.publisher_keys
    SET frozen_at = NULL, frozen_reason = NULL
    WHERE publisher_id IN (
      SELECT id FROM public.publishers WHERE owner_profile_id = v_freeze.profile_id
    ) AND frozen_at IS NOT NULL;
  END IF;

  UPDATE public.account_freezes
  SET status = 'released',
      released_at = NOW(),
      released_by = p_actor_profile_id,
      release_reason = NULLIF(btrim(COALESCE(p_reason, '')), '')
  WHERE id = v_freeze.id;

  SELECT * INTO v_freeze FROM public.account_freezes WHERE id = v_freeze.id;

  PERFORM public.notify_user(
    v_freeze.profile_id,
    'unfreeze_granted',
    'info',
    'Your freeze has been lifted',
    'The ' || v_freeze.scope || ' freeze on your account has been released. You can use your account normally again.',
    v_freeze.id
  );

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'freeze', row_to_json(v_freeze));
END;
$$;

-- ---------------------------------------------------------------------
-- list_account_freezes: what an operator needs to see to unfreeze.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_account_freezes(
  p_profile_id UUID DEFAULT NULL,
  p_only_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_count INTEGER;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t) ORDER BY t.frozen_at DESC), '[]'::jsonb),
         COUNT(*)::INTEGER
  INTO v_rows, v_count
  FROM (
    SELECT id, profile_id, scope, reason, frozen_by, frozen_at, status,
           released_at, released_by, release_reason,
           unfreeze_request_id, unfreeze_requested_at
    FROM public.account_freezes
    WHERE (p_profile_id IS NULL OR profile_id = p_profile_id)
      AND (NOT COALESCE(p_only_active, TRUE) OR status = 'active')
    ORDER BY frozen_at DESC
    LIMIT 200
  ) t;

  RETURN jsonb_build_object('freezes', v_rows, 'count', v_count);
END;
$$;

-- ---------------------------------------------------------------------
-- RLS
--
-- The owner reads their own money. Nobody else reads it except an
-- admin, and no client role writes any of it.
-- ---------------------------------------------------------------------
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_topups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_freezes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own wallet" ON public.wallets;
CREATE POLICY "Users can view their own wallet" ON public.wallets
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallets" ON public.wallets;
CREATE POLICY "Admins can view all wallets" ON public.wallets
  FOR SELECT USING (public.jwt_is_admin());

DROP POLICY IF EXISTS "Users can view their own wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view their own wallet transactions" ON public.wallet_transactions
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Admins can view all wallet transactions" ON public.wallet_transactions
  FOR SELECT USING (public.jwt_is_admin());

DROP POLICY IF EXISTS "Users can view their own topups" ON public.wallet_topups;
CREATE POLICY "Users can view their own topups" ON public.wallet_topups
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all topups" ON public.wallet_topups;
CREATE POLICY "Admins can view all topups" ON public.wallet_topups
  FOR SELECT USING (public.jwt_is_admin());

DROP POLICY IF EXISTS "Users can view their own freezes" ON public.account_freezes;
CREATE POLICY "Users can view their own freezes" ON public.account_freezes
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all freezes" ON public.account_freezes;
CREATE POLICY "Admins can view all freezes" ON public.account_freezes
  FOR SELECT USING (public.jwt_is_admin());

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.user_notifications;
CREATE POLICY "Users can view their own notifications" ON public.user_notifications
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view all notifications" ON public.user_notifications;
CREATE POLICY "Admins can view all notifications" ON public.user_notifications
  FOR SELECT USING (public.jwt_is_admin());

-- The rate table is public reference data: a top-up form has to quote
-- the rate it is applying.
DROP POLICY IF EXISTS "Credit rates are readable by everyone" ON public.credit_rates;
CREATE POLICY "Credit rates are readable by everyone" ON public.credit_rates
  FOR SELECT USING (true);

-- ---------------------------------------------------------------------
-- Privileges.
--
-- The transaction log is append-only: SELECT and INSERT for
-- service_role, and never UPDATE or DELETE for anybody. The wallets
-- table is a projection and is updated by the posting function, so
-- service_role holds UPDATE on it. wallet_topups is a state machine
-- (pending -> confirmed/rejected) and needs UPDATE too.
-- ---------------------------------------------------------------------
REVOKE ALL ON public.wallets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wallet_transactions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.wallet_topups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.credit_rates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.account_freezes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.user_notifications FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.wallets TO authenticated;
GRANT SELECT ON public.wallet_transactions TO authenticated;
GRANT SELECT ON public.wallet_topups TO authenticated;
GRANT SELECT ON public.account_freezes TO authenticated;
GRANT SELECT ON public.user_notifications TO authenticated;
GRANT SELECT ON public.credit_rates TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.wallets TO service_role;
GRANT SELECT, INSERT ON public.wallet_transactions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.wallet_topups TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.credit_rates TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.account_freezes TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.user_notifications TO service_role;

-- Every function in this file is service_role only. The browser reaches
-- the wallet through an Edge Function that resolves the caller's own
-- profile id from their JWT.
REVOKE ALL ON FUNCTION public.ensure_wallet(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.on_profile_created_wallet() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_profile(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lock_wallet(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_wallet_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reserve_wallet_credits(UUID, BIGINT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_wallet_credits(UUID, BIGINT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_wallet_topup(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_wallet_topup(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_wallet_topup(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_free_credits(UUID, BIGINT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_snapshot(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_ledger(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.wallet_topups_of(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_wallet(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.freeze_account(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_freeze(UUID, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_account_freezes(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_user(UUID, TEXT, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.ensure_wallet(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.post_wallet_transaction(UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, UUID, TEXT, TEXT, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_wallet_credits(UUID, BIGINT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_wallet_credits(UUID, BIGINT, TEXT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_wallet_topup(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_wallet_topup(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_wallet_topup(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_free_credits(UUID, BIGINT, TEXT, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_snapshot(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_ledger(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.wallet_topups_of(UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_wallet(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.freeze_account(UUID, TEXT, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_freeze(UUID, TEXT, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_account_freezes(UUID, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_user(UUID, TEXT, TEXT, TEXT, TEXT, UUID) TO service_role;

COMMENT ON FUNCTION public.post_wallet_transaction(
  UUID, TEXT, TEXT, BIGINT, TEXT, TEXT, BIGINT, NUMERIC, TEXT, UUID, TEXT, TEXT, BOOLEAN
) IS
    'The only function that moves a credit balance. Idempotent on its key, refuses a frozen wallet or account, and never lets a balance go negative. p_allow_frozen is for movements that give credits BACK, which a freeze must never block.';

COMMENT ON FUNCTION public.grant_free_credits(UUID, BIGINT, TEXT, UUID, TEXT) IS
    'Admin free-credit grant, capped at 2000 credits per person per calendar month. The cap is computed in the database while the wallet row is locked.';

COMMENT ON FUNCTION public.create_wallet_topup(UUID, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) IS
    'Records a payment claim with the payer details and computes the credits from the amount and the rate. Credits nothing: only confirm_wallet_topup does that.';

COMMENT ON FUNCTION public.freeze_account(UUID, TEXT, TEXT, UUID) IS
    'Freezes an account, a wallet, or the publisher keys of a profile. The frozen person can still sign in: the notice and the unfreeze request have to be reachable.';
