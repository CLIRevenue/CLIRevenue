CREATE TABLE "public"."advertisers" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"          uuid                     NOT NULL,
  "company_name"        text,
  "contact_email"       text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "company_website"     text,
  "company_description" text,
  "company_size"        text,
  "industry"            text,
  "hear_about_us"       text,
  CONSTRAINT "advertisers_pkey" PRIMARY KEY (id),
  CONSTRAINT "advertisers_profile_id_key" UNIQUE (profile_id),
  CONSTRAINT "advertisers_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."advertisers"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_advertisers_updated_at
  BEFORE UPDATE ON public.advertisers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Advertisers can update their own advertiser profile" ON "public"."advertisers"
  FOR UPDATE
  TO PUBLIC
  USING ((profile_id = auth.uid()))
  WITH CHECK ((profile_id = auth.uid()));

CREATE POLICY "Advertisers can view their own advertiser profile" ON "public"."advertisers"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = advertisers.profile_id) AND (profiles.id = auth.uid())))));

CREATE POLICY "Users can insert their own advertiser row" ON "public"."advertisers"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = profile_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."advertisers" TO "anon", "authenticated", "postgres", "service_role";

COMMENT ON COLUMN "public"."advertisers"."company_size" IS 'Self-reported headcount band, e.g. "1-10". Free text by design.';

COMMENT ON COLUMN "public"."advertisers"."hear_about_us" IS 'Attribution answer for "How did you hear about us?"';
