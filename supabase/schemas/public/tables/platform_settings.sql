CREATE TABLE "public"."platform_settings" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."platform_settings"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Anyone can view platform settings" ON "public"."platform_settings"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() IS NOT NULL));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."platform_settings" TO "anon", "authenticated", "postgres", "service_role";
