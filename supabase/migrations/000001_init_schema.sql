-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Define enums for campaign status
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed', 'archived');

-- Define enums for reward ledger status
CREATE TYPE reward_status AS ENUM ('accrued', 'available');

-- Define enums for payout status (if we implement payouts)
CREATE TYPE payout_status AS ENUM ('requested', 'processing', 'sent', 'failed');

-- Define enums for interaction kinds
CREATE TYPE interaction_kind AS ENUM ('click');

-- Profiles table (extends auth.users)
CREATE TABLE IF NOT EXISTS profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    role TEXT NOT NULL CHECK (role IN ('advertiser', 'developer', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Advertisers table
CREATE TABLE IF NOT EXISTS advertisers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    company_name TEXT,
    contact_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id)
);

-- Developer accounts table
CREATE TABLE IF NOT EXISTS developer_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
    payout_preferences JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id)
);

-- Audiences table (optional, we can use a check constraint on campaigns)
CREATE TABLE IF NOT EXISTS audiences (
    id TEXT PRIMARY KEY, -- e.g., 'backend', 'frontend'
    label TEXT NOT NULL,
    note TEXT
);

-- Insert predefined audiences
INSERT INTO audiences (id, label, note) VALUES
    ('backend', 'Backend & API', 'Node, Go, Rust, Postgres'),
    ('frontend', 'Frontend & Web', 'React, TypeScript, CSS'),
    ('devops', 'DevOps & Platform', 'CI, Kubernetes, observability'),
    ('data', 'Data & ML', 'Pipelines, notebooks, model ops'),
    ('oss', 'OSS maintainers', 'Public repos, 1k+ stars')
ON CONFLICT (id) DO NOTHING;

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id UUID REFERENCES advertisers(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    headline TEXT NOT NULL,
    description TEXT,
    cta TEXT DEFAULT 'Learn more',
    audience_id TEXT REFERENCES audiences(id) NOT NULL,
    budget_cents INTEGER NOT NULL CHECK (budget_cents >= 0),
    -- CPM in cents (cost per 1000 impressions)
    cpm_cents INTEGER NOT NULL DEFAULT 10,
    -- Spend in milli-cents (1/1000 of a cent) to avoid floating point
    spend_milli_cents INTEGER NOT NULL DEFAULT 0,
    impressions_count INTEGER NOT NULL DEFAULT 0 CHECK (impressions_count >= 0),
    clicks_count INTEGER NOT NULL DEFAULT 0 CHECK (clicks_count >= 0),
    conversions_count INTEGER NOT NULL DEFAULT 0 CHECK (conversions_count >= 0),
    status campaign_status NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table to store the active campaign (global setting)
CREATE TABLE IF NOT EXISTS platform_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    active_campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert a default row for platform settings
INSERT INTO platform_settings (id, active_campaign_id)
SELECT gen_random_uuid(), NULL
WHERE NOT EXISTS (SELECT 1 FROM platform_settings);

-- Ad impressions table
CREATE TABLE IF NOT EXISTS ad_impressions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    developer_id UUID REFERENCES developer_accounts(id) ON DELETE SET NULL, -- anonymous allowed
    cli_integration TEXT NOT NULL,
    session_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key TEXT NOT NULL,
    UNIQUE(idempotency_key)
);

-- Ad interactions table
CREATE TABLE IF NOT EXISTS ad_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    developer_id UUID REFERENCES developer_accounts(id) ON DELETE CASCADE NOT NULL,
    cli_integration TEXT NOT NULL,
    session_id TEXT NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    idempotency_key TEXT NOT NULL,
    impression_id UUID REFERENCES ad_impressions(id) ON DELETE SET NULL,
    kind interaction_kind NOT NULL DEFAULT 'click',
    UNIQUE(idempotency_key)
);

-- Reward ledger table (append-only)
CREATE TABLE IF NOT EXISTS reward_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id UUID REFERENCES developer_accounts(id) ON DELETE CASCADE NOT NULL,
    campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE NOT NULL,
    interaction_id UUID REFERENCES ad_interactions(id) ON DELETE CASCADE NOT NULL,
    amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
    status reward_status NOT NULL DEFAULT 'accrued',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    settled_at TIMESTAMPTZ NULL
);

-- Ledger events table for economic loop and audit
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

-- Payouts table
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

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ad_impressions_campaign_id ON ad_impressions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_developer_id ON ad_impressions(developer_id);
CREATE INDEX IF NOT EXISTS idx_ad_impressions_timestamp ON ad_impressions(timestamp);
CREATE INDEX IF NOT EXISTS idx_ad_interactions_campaign_id ON ad_interactions(campaign_id);
CREATE INDEX IF NOT EXISTS idx_ad_interactions_developer_id ON ad_interactions(developer_id);
CREATE INDEX IF NOT EXISTS idx_ad_interactions_timestamp ON ad_interactions(timestamp);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_developer_id ON reward_ledger(developer_id);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_campaign_id ON reward_ledger(campaign_id);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_status ON reward_ledger(status);
CREATE INDEX IF NOT EXISTS idx_reward_ledger_created_at ON reward_ledger(created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_events_timestamp ON ledger_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_ledger_events_type ON ledger_events(type);
CREATE INDEX IF NOT EXISTS idx_payouts_developer_id ON payouts(developer_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_payout_transactions_payout_id ON payout_transactions(payout_id);

-- Updated at triggers
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_profiles_updated_at') THEN
        CREATE TRIGGER update_profiles_updated_at
        BEFORE UPDATE ON profiles
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_advertisers_updated_at') THEN
        CREATE TRIGGER update_advertisers_updated_at
        BEFORE UPDATE ON advertisers
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_developer_accounts_updated_at') THEN
        CREATE TRIGGER update_developer_accounts_updated_at
        BEFORE UPDATE ON developer_accounts
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_campaigns_updated_at') THEN
        CREATE TRIGGER update_campaigns_updated_at
        BEFORE UPDATE ON campaigns
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_platform_settings_updated_at') THEN
        CREATE TRIGGER update_platform_settings_updated_at
        BEFORE UPDATE ON platform_settings
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
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
