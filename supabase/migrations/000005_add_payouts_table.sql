-- Payouts table
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id UUID REFERENCES developer_accounts(id) ON DELETE CASCADE NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    provider_id TEXT NOT NULL,
    status payout_status NOT NULL DEFAULT 'requested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payout transactions table (mirroring the mock)
CREATE TABLE IF NOT EXISTS payout_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payout_id UUID REFERENCES payouts(id) ON DELETE CASCADE NOT NULL,
    type TEXT NOT NULL CHECK (type = 'payout'),
    amount_cents INTEGER NOT NULL,
    currency TEXT DEFAULT 'USD',
    provider_id TEXT NOT NULL,
    status payout_status NOT NULL DEFAULT 'requested',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_payouts_developer_id ON payouts(developer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_payout_id ON payout_transactions(payout_id);

-- Updated at triggers for payouts and payout_transactions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_payouts_updated_at') THEN
        CREATE TRIGGER update_payouts_updated_at
        BEFORE UPDATE ON payouts
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_payout_transactions_updated_at') THEN
        CREATE TRIGGER update_payout_transactions_updated_at
        BEFORE UPDATE ON payout_transactions
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;