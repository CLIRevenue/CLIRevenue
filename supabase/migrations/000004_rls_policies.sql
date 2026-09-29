-- Enable Row Level Security and set policies

-- Profiles table: users can only see their own profile
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own profile" ON public.profiles
    FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id);
-- Insert is handled by the signup flow (service role or trusted function)

-- Advertisers table: users can only see advertisers where they are the profile
ALTER TABLE public.advertisers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advertisers can view their own advertiser profile" ON public.advertisers
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = advertisers.profile_id AND profiles.id = auth.uid()));
CREATE POLICY "Advertisers can update their own advertiser profile" ON public.advertisers
    FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = advertisers.profile_id AND profiles.id = auth.uid()));
-- Insert is handled by the signup flow (service role or trusted function)

-- Developer accounts table: users can only see their own developer account
ALTER TABLE public.developer_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own developer account" ON public.developer_accounts
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = developer_accounts.profile_id AND profiles.id = auth.uid()));
CREATE POLICY "Developers can update their own developer account" ON public.developer_accounts
    FOR UPDATE USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = developer_accounts.profile_id AND profiles.id = auth.uid()));
-- Insert is handled by the signup flow (service role or trusted function)

-- Campaigns table: advertisers can see their own campaigns
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Advertisers can view their own campaigns" ON public.campaigns
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id));
CREATE POLICY "Advertisers can update their own campaigns" ON public.campaigns
    FOR UPDATE USING (EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id));
-- Insert is allowed for advertisers (they can create campaigns)
CREATE POLICY "Advertisers can insert campaigns" ON public.campaigns
    FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.advertisers WHERE advertisers.profile_id = auth.uid() AND advertisers.id = campaigns.advertiser_id));

-- Platform settings table: 
--   - Anyone can view platform settings (authenticated users)
--   - Advertisers and admins can update platform settings
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can view platform settings" ON public.platform_settings
    FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "Advertisers and admins can update platform settings" ON public.platform_settings
    FOR UPDATE USING (
        EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('advertiser', 'admin'))
    );

-- Ad impressions table: 
--   - Developers can view their own impressions
--   - Advertisers can view impressions for their campaigns
--   - Developers can insert impressions
ALTER TABLE public.ad_impressions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own impressions" ON public.ad_impressions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_impressions.developer_id AND developer_accounts.profile_id = auth.uid()));
CREATE POLICY "Advertisers can view impressions for their campaigns" ON public.ad_impressions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = ad_impressions.campaign_id AND campaigns.advertiser_id IN (SELECT id FROM public.advertisers WHERE profile_id = auth.uid())));
CREATE POLICY "Developers can insert impressions" ON public.ad_impressions
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_impressions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

-- Ad interactions table: 
--   - Developers can view their own interactions
--   - Advertisers can view interactions for their campaigns
--   - Developers can insert interactions
ALTER TABLE public.ad_interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own interactions" ON public.ad_interactions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_interactions.developer_id AND developer_accounts.profile_id = auth.uid()));
CREATE POLICY "Advertisers can view interactions for their campaigns" ON public.ad_interactions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.campaigns WHERE campaigns.id = ad_interactions.campaign_id AND campaigns.advertiser_id IN (SELECT id FROM public.advertisers WHERE profile_id = auth.uid())));
CREATE POLICY "Developers can insert interactions" ON public.ad_interactions
    FOR INSERT WITH CHECK (
        EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = ad_interactions.developer_id AND developer_accounts.profile_id = auth.uid())
    );

-- Reward ledger table: 
--   - Developers can view their own reward ledger entries
ALTER TABLE public.reward_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own reward ledger" ON public.reward_ledger
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = reward_ledger.developer_id AND developer_accounts.profile_id = auth.uid()));
-- Insert is not allowed directly; it's done via the interaction endpoint (service role).

-- Ledger events table: 
--   - Only admins can view ledger events (audit trail)
ALTER TABLE public.ledger_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view ledger events" ON public.ledger_events
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));
-- Insert is not allowed directly.

-- Payouts table: 
--   - Developers can view their own payouts
ALTER TABLE public.payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own payouts" ON public.payouts
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.developer_accounts WHERE developer_accounts.id = payouts.developer_id AND developer_accounts.profile_id = auth.uid()));
-- Insert is not allowed directly.

-- Payout transactions table: 
--   - Developers can view their own payout transactions
ALTER TABLE public.payout_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Developers can view their own payout transactions" ON public.payout_transactions
    FOR SELECT USING (EXISTS (SELECT 1 FROM public.payouts WHERE payouts.id = payout_transactions.payout_id AND payouts.developer_id IN (SELECT id FROM public.developer_accounts WHERE profile_id = auth.uid())));

-- Note: The service role bypasses RLS, so our Edge Functions (which use the service role) can perform all operations.
