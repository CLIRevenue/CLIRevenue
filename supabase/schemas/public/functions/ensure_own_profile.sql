CREATE OR REPLACE FUNCTION public.ensure_own_profile (
  requested_role text
)
  RETURNS text
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $function$
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
$function$;

GRANT EXECUTE ON FUNCTION "public"."ensure_own_profile"(text) TO PUBLIC, "anon", "authenticated", "postgres", "service_role";
