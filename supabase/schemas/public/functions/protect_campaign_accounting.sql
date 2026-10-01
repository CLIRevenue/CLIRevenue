CREATE OR REPLACE FUNCTION public.protect_campaign_accounting()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  AS $function$
BEGIN
  -- Freeze accounting columns only for the authenticated client role.
  -- SECURITY DEFINER RPCs and service-role Edge Functions still update counters.
  IF current_user IN ('authenticated', 'anon')
     OR current_setting('role', true) IN ('authenticated', 'anon') THEN
    IF TG_OP = 'UPDATE' THEN
      NEW.advertiser_id := OLD.advertiser_id;
      NEW.spend_milli_cents := OLD.spend_milli_cents;
      NEW.impressions_count := OLD.impressions_count;
      NEW.clicks_count := OLD.clicks_count;
      NEW.conversions_count := OLD.conversions_count;
      NEW.created_at := OLD.created_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION "public"."protect_campaign_accounting"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
