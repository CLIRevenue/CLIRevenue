-- Secure signup bootstrap: create profile + side rows when auth.users is created.
-- No service-role key is ever needed in the browser. Role is whitelisted;
-- requested role comes from auth.users.raw_user_meta_data->>'role' and only
-- 'advertiser' | 'developer' are honored (default: developer). Admin can
-- never be self-assigned through this path.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested TEXT := COALESCE(NULLIF((NEW.raw_user_meta_data ->> 'role'), ''), 'developer');
  safe_role TEXT := CASE WHEN requested IN ('advertiser', 'developer') THEN requested ELSE 'developer' END;
BEGIN
  INSERT INTO public.profiles (id, role)
  VALUES (NEW.id, safe_role)
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  IF safe_role = 'advertiser' THEN
    INSERT INTO public.advertisers (profile_id, contact_email)
    VALUES (NEW.id, NEW.email)
    ON CONFLICT (profile_id) DO NOTHING;
  ELSIF safe_role = 'developer' THEN
    INSERT INTO public.developer_accounts (profile_id, payout_preferences)
    VALUES (NEW.id, '{"preferred_provider": "demo-ledger"}'::jsonb)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Fallback for projects where the auth.users trigger cannot fire (e.g. email
-- confirmation timing or restricted auth schema): an RLS-safe RPC the browser
-- can call as the signed-in user. SECURITY DEFINER but constrained: it only
-- ever creates a row for auth.uid(), and only advertiser|developer.
CREATE OR REPLACE FUNCTION public.ensure_own_profile(requested_role TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
  safe_role TEXT := CASE WHEN requested_role IN ('advertiser', 'developer') THEN requested_role ELSE 'developer' END;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.profiles (id, role)
  VALUES (uid, safe_role)
  ON CONFLICT (id) DO NOTHING;

  SELECT role INTO safe_role FROM public.profiles WHERE id = uid;

  IF safe_role = 'advertiser' THEN
    INSERT INTO public.advertisers (profile_id)
    VALUES (uid)
    ON CONFLICT (profile_id) DO NOTHING;
  ELSIF safe_role = 'developer' THEN
    INSERT INTO public.developer_accounts (profile_id, payout_preferences)
    VALUES (uid, '{"preferred_provider": "demo-ledger"}'::jsonb)
    ON CONFLICT (profile_id) DO NOTHING;
  END IF;

  RETURN safe_role;
END;
$$;

-- Allow authenticated users to create exactly their own profile row via RLS
-- (trigger/RPC remain the primary paths; this keeps email-confirm flows working).
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id AND role IN ('advertiser', 'developer'));

-- Allow bootstrap inserts of the user's own side rows.
DROP POLICY IF EXISTS "Users can insert their own advertiser row" ON public.advertisers;
CREATE POLICY "Users can insert their own advertiser row" ON public.advertisers
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Users can insert their own developer row" ON public.developer_accounts;
CREATE POLICY "Users can insert their own developer row" ON public.developer_accounts
  FOR INSERT WITH CHECK (auth.uid() = profile_id);

-- Harden payout_transactions RLS (was referencing payouts table unqualified).
DROP POLICY IF EXISTS "Developers can view their own payout transactions" ON public.payout_transactions;
CREATE POLICY "Developers can view their own payout transactions" ON public.payout_transactions
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.payouts
    WHERE payouts.id = payout_transactions.payout_id
      AND payouts.developer_id IN (SELECT id FROM public.developer_accounts WHERE profile_id = auth.uid())
  ));
