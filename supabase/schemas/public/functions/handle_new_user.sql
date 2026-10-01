CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
