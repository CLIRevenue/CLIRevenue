CREATE OR REPLACE FUNCTION public.serve_click_reward_cents()
  RETURNS integer
  LANGUAGE sql
  IMMUTABLE
  AS $function$ SELECT 18 $function$;

GRANT EXECUTE ON FUNCTION "public"."serve_click_reward_cents"() TO "postgres", "service_role";

REVOKE ALL ON FUNCTION "public"."serve_click_reward_cents"() FROM PUBLIC, "anon", "authenticated";
