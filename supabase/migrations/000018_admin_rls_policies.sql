-- 000018_admin_rls_policies.sql
--
-- Admin RLS policies that reference the admin_emails table created in
-- 000017_admin_rls.sql.
--
-- Admin policies call public.jwt_is_admin() (SECURITY DEFINER) to check
-- whether the caller's JWT email is on the admin allowlist. This avoids
-- circular profiles→profiles policy dependencies and lets callers without
-- direct admin_emails privileges still pass the admin check.

-- ------------------------------------------------------------------
-- Helper: return true if the caller's JWT email is in the admin_emails
-- allowlist. SECURITY DEFINER means it runs with the owner's privileges
-- regardless of who calls it; the caller never needs direct access to
-- the admin_emails table.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.jwt_is_admin()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.admin_emails
    WHERE email = lower(COALESCE(
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
      ''
    ))
  );
$$;

REVOKE ALL ON FUNCTION public.jwt_is_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jwt_is_admin() TO anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- profiles: users see their own row; admins see every row
-- ------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles" ON public.profiles
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- advertisers: advertisers see their own row; admins see every row
-- ------------------------------------------------------------------
ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advertisers can view their own advertiser profile" ON public.advertisers;
CREATE POLICY "Advertisers can view their own advertiser profile" ON public.advertisers
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = advertisers.profile_id AND profiles.id = auth.uid())
    );

DROP POLICY IF EXISTS "Advertisers can update their own advertiser profile" ON public.advertisers;
CREATE POLICY "Advertisers can update their own advertiser profile" ON public.advertisers
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = advertisers.profile_id AND profiles.id = auth.uid())
    );

CREATE POLICY "Admins can view all advertisers" ON public.advertisers
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- developer_accounts: developers see their own row; admins see every row
-- ------------------------------------------------------------------
ALTER TABLE public.developer_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own developer account" ON public.developer_accounts;
CREATE POLICY "Developers can view their own developer account" ON public.developer_accounts
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = developer_accounts.profile_id AND profiles.id = auth.uid())
    );

DROP POLICY IF EXISTS "Developers can update their own developer account" ON public.developer_accounts;
CREATE POLICY "Developers can update their own developer account" ON public.developer_accounts
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = developer_accounts.profile_id AND profiles.id = auth.uid())
    );

CREATE POLICY "Admins can view all developer accounts" ON public.developer_accounts
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- campaigns: advertisers see their own; admins see every row
-- ------------------------------------------------------------------
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Advertisers can view their own campaigns" ON public.campaigns;
CREATE POLICY "Advertisers can view their own campaigns" ON public.campaigns
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id)
    );

DROP POLICY IF EXISTS "Advertisers can update their own campaigns" ON public.campaigns;
CREATE POLICY "Advertisers can update their own campaigns" ON public.campaigns
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id)
    );

DROP POLICY IF EXISTS "Advertisers can insert campaigns" ON public.campaigns;
CREATE POLICY "Advertisers can insert campaigns" ON public.campaigns
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id)
    );

CREATE POLICY "Admins can view all campaigns" ON public.campaigns
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- platform_settings: authenticated can view (no UPDATE: 000012 removed
--   the active_campaign_id column and its policy; nothing to update)
-- ------------------------------------------------------------------
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view platform settings" ON public.platform_settings;
CREATE POLICY "Anyone can view platform settings" ON public.platform_settings
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- ------------------------------------------------------------------
-- ad_impressions: developers see own; advertisers see campaign rows; admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own impressions" ON public.ad_impressions;
CREATE POLICY "Developers can view their own impressions" ON public.ad_impressions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_impressions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

DROP POLICY IF EXISTS "Advertisers can view impressions for their campaigns" ON public.ad_impressions;
CREATE POLICY "Advertisers can view impressions for their campaigns" ON public.ad_impressions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = ad_impressions.campaign_id AND campaigns.advertiser_id IN (SELECT id FROM public.advertisers WHERE profile_id = auth.uid()))
    );

DROP POLICY IF EXISTS "Developers can insert impressions" ON public.ad_impressions;
CREATE POLICY "Developers can insert impressions" ON public.ad_impressions
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_impressions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

CREATE POLICY "Admins can view all impressions" ON public.ad_impressions
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- ad_interactions: developers see own; advertisers see campaign rows; admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.ad_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own interactions" ON public.ad_interactions;
CREATE POLICY "Developers can view their own interactions" ON public.ad_interactions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_interactions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

DROP POLICY IF EXISTS "Advertisers can view interactions for their campaigns" ON public.ad_interactions;
CREATE POLICY "Advertisers can view interactions for their campaigns" ON public.ad_interactions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = ad_interactions.campaign_id AND campaigns.advertiser_id IN (SELECT id FROM public.advertisers WHERE profile_id = auth.uid()))
    );

DROP POLICY IF EXISTS "Developers can insert interactions" ON public.ad_interactions;
CREATE POLICY "Developers can insert interactions" ON public.ad_interactions
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_interactions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

CREATE POLICY "Admins can view all interactions" ON public.ad_interactions
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- reward_ledger: developers see own; admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own reward ledger" ON public.reward_ledger;
CREATE POLICY "Developers can view their own reward ledger" ON public.reward_ledger
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = reward_ledger.developer_id AND developer_accounts.profile_id = auth.uid())
    );

CREATE POLICY "Admins can view all reward ledger" ON public.reward_ledger
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- ledger_events: admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.ledger_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view ledger events" ON public.ledger_events;
CREATE POLICY "Admins can view ledger events" ON public.ledger_events
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- payouts: developers see own; admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own payouts" ON public.payouts;
CREATE POLICY "Developers can view their own payouts" ON public.payouts
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = payouts.developer_id AND developer_accounts.profile_id = auth.uid())
    );

CREATE POLICY "Admins can view all payouts" ON public.payouts
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- payout_transactions: developers see own; admins see all
-- ------------------------------------------------------------------
ALTER TABLE public.payout_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Developers can view their own payout transactions" ON public.payout_transactions;
CREATE POLICY "Developers can view their own payout transactions" ON public.payout_transactions
    FOR SELECT USING (
        EXISTS (SELECT 1 FROM public.payouts WHERE payouts.id = payout_transactions.payout_id AND payouts.developer_id IN (SELECT id FROM public.developer_accounts WHERE profile_id = auth.uid()))
    );

CREATE POLICY "Admins can view all payout transactions" ON public.payout_transactions
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- audiences: admins can manage; authenticated can view
-- ------------------------------------------------------------------
ALTER TABLE public.audiences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view audiences" ON public.audiences
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can manage audiences" ON public.audiences
    FOR ALL USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- publishers: service_role writes; admins read all
-- ------------------------------------------------------------------
ALTER TABLE public.publishers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all publishers" ON public.publishers
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- publisher_keys: admins can view all (never expose key_hash to non-admin)
-- ------------------------------------------------------------------
ALTER TABLE public.publisher_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all publisher keys" ON public.publisher_keys
    FOR SELECT USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- placements: admins can view and manage all
-- ------------------------------------------------------------------
ALTER TABLE public.placements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all placements" ON public.placements
    FOR SELECT USING (public.jwt_is_admin());

CREATE POLICY "Admins can manage placements" ON public.placements
    FOR INSERT WITH CHECK (public.jwt_is_admin());

CREATE POLICY "Admins can update placements" ON public.placements
    FOR UPDATE USING (public.jwt_is_admin());

-- ------------------------------------------------------------------
-- ad_serve_log: admins can view all
-- ------------------------------------------------------------------
ALTER TABLE public.ad_serve_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all serve log" ON public.ad_serve_log
    FOR SELECT USING (public.jwt_is_admin());
