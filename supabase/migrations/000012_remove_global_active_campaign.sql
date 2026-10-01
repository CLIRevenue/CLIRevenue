-- 000012_remove_global_active_campaign.sql
-- Remove the global active_campaign_id pointer from platform_settings.
--
-- The single global pointer made the last advertiser to press "select" decide
-- what every publisher on the network saw. Selection is now per-placement and
-- eligibility lives on the campaign row (see 000008, 000011, 000014, 000015).
-- The column and its UPDATE policy are removed so no future code can accidentally
-- write or depend on this shared state.

ALTER TABLE public.platform_settings
  DROP COLUMN IF EXISTS active_campaign_id;

DROP POLICY IF EXISTS "Advertisers and admins can update platform settings"
  ON public.platform_settings;

-- Verify the column is gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'platform_settings'
      AND column_name = 'active_campaign_id'
  ) THEN
    RAISE EXCEPTION 'active_campaign_id column still exists';
  END IF;
END $$;

-- Verify the UPDATE policy is gone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'platform_settings'
      AND upper(cmd) = 'UPDATE'
  ) THEN
    RAISE EXCEPTION 'UPDATE policy on platform_settings still exists';
  END IF;
END $$;