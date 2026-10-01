-- 000009_reward_consumed_status.sql
-- Reward consumption state, so a payout can debit the ledger instead of
-- leaving every 'available' row spendable forever.
--
-- Why this is its own migration: PostgreSQL requires a newly added enum
-- value to be committed before any other statement may reference it, so
-- the value is added here and only *used* from 000010 onwards.
--
-- Additive and idempotent. No rows are destroyed.

-- ---------------------------------------------------------------
-- consumed: the reward has been spent by a payout
--   accrued    -> minted by an interaction, still pending settlement
--   available  -> settled, spendable, not yet paid out
--   consumed   -> debited by a payout (remaining_cents = 0)
-- ---------------------------------------------------------------
DO $$
BEGIN
  ALTER TYPE public.reward_status ADD VALUE IF NOT EXISTS 'consumed';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------
-- remaining_cents: how much of this reward is still spendable.
--   remaining_cents = amount_cents      -> untouched
--   0 < remaining_cents < amount_cents  -> partially paid out
--   remaining_cents = 0 + consumed      -> fully paid out
-- Integer milli-free cents only; no floating point anywhere in the
-- reward path. Backfilled from amount_cents so existing rows keep the
-- exact balance they had before this migration.
-- ---------------------------------------------------------------
ALTER TABLE public.reward_ledger
  ADD COLUMN IF NOT EXISTS remaining_cents INTEGER,
  ADD COLUMN IF NOT EXISTS payout_id UUID REFERENCES public.payouts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

UPDATE public.reward_ledger
  SET remaining_cents = amount_cents
  WHERE remaining_cents IS NULL;

ALTER TABLE public.reward_ledger
  ALTER COLUMN remaining_cents SET DEFAULT 0;

UPDATE public.reward_ledger
  SET remaining_cents = 0
  WHERE remaining_cents < 0;

ALTER TABLE public.reward_ledger
  ALTER COLUMN remaining_cents SET NOT NULL;

-- A reward can never be worth more than it was minted for, and can never
-- go negative. This is the hard invariant the payout RPC relies on.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reward_ledger_remaining_cents_check'
  ) THEN
    ALTER TABLE public.reward_ledger
      ADD CONSTRAINT reward_ledger_remaining_cents_check
      CHECK (remaining_cents >= 0 AND remaining_cents <= amount_cents);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_reward_ledger_developer_status
  ON public.reward_ledger(developer_id, status);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_spendable
  ON public.reward_ledger(developer_id, created_at)
  WHERE status = 'available' AND remaining_cents > 0;
CREATE INDEX IF NOT EXISTS idx_reward_ledger_payout_id
  ON public.reward_ledger(payout_id);
