-- ---------------------------------------------------------------
-- 000013_payout_transactions_updated_at.sql
--
-- Fixes a runtime failure found by executing the migrations, not by reading
-- them: 000001 (and again 000005) attach a BEFORE UPDATE trigger named
-- update_payout_transactions_updated_at to payout_transactions, which calls
-- update_updated_at_column(). That function assigns NEW.updated_at, but
-- payout_transactions was never given an updated_at column. Every UPDATE on
-- that table therefore failed with:
--
--     record "new" has no field "updated_at"
--
-- Nothing exercised this because no code path currently UPDATEs a
-- payout_transaction -- request_payout only INSERTs one -- so the defect sat
-- dormant behind a live trigger.
--
-- Why add the column rather than drop the trigger: every other table in the
-- schema has both an updated_at column and this trigger, and a payout rail
-- will need to move a transaction through its statuses. Adding the column
-- makes the existing, idempotent trigger work as originally intended.
--
-- The column is NOT NULL DEFAULT NOW(), so existing rows backfill to their
-- current time and no rewrite or data loss occurs. Safe to re-run.
-- ---------------------------------------------------------------

ALTER TABLE public.payout_transactions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- The trigger already exists (000001 and 000005 both create it under a
-- NOT EXISTS guard), so it starts working now that the column is present.
-- Assert the column landed rather than trusting ADD COLUMN IF NOT EXISTS.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'payout_transactions'
      AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'payout_transactions.updated_at still missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_payout_transactions_updated_at'
  ) THEN
    CREATE TRIGGER update_payout_transactions_updated_at
      BEFORE UPDATE ON public.payout_transactions
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
