-- Ledger events table for economic loop and audit
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE TABLE IF NOT EXISTS ledger_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type TEXT NOT NULL, -- e.g., 'campaign', 'revenue', 'delivery', 'impression', 'interaction', 'reward_accrued', 'reward_available', 'payout'
    amount_cents INTEGER DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    label TEXT NOT NULL,
    detail TEXT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    simulated BOOLEAN NOT NULL DEFAULT false
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ledger_events_timestamp ON ledger_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_ledger_events_type ON ledger_events(type);