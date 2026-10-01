CREATE TABLE "public"."developer_accounts" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "profile_id"         uuid                     NOT NULL,
  "payout_preferences" jsonb,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "developer_name"     text,
  "developer_type"     text,
  "website"            text,
  "apps_description"   text,
  "app_count"          integer,
  "platforms"          text,
  "experience_level"   text,
  "hear_about_us"      text,
  CONSTRAINT "developer_accounts_app_count_check" CHECK (((app_count IS NULL) OR (app_count >= 0))),
  CONSTRAINT "developer_accounts_pkey" PRIMARY KEY (id),
  CONSTRAINT "developer_accounts_profile_id_key" UNIQUE (profile_id),
  CONSTRAINT "developer_accounts_profile_id_fkey" FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."developer_accounts"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_developer_accounts_updated_at
  BEFORE UPDATE ON public.developer_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Developers can update their own developer account" ON "public"."developer_accounts"
  FOR UPDATE
  TO PUBLIC
  USING ((profile_id = auth.uid()))
  WITH CHECK ((profile_id = auth.uid()));

CREATE POLICY "Developers can view their own developer account" ON "public"."developer_accounts"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = developer_accounts.profile_id) AND (profiles.id = auth.uid())))));

CREATE POLICY "Users can insert their own developer row" ON "public"."developer_accounts"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((auth.uid() = profile_id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."developer_accounts" TO "anon", "authenticated", "postgres", "service_role";

COMMENT ON COLUMN "public"."developer_accounts"."app_count" IS 'Approximate shipped app/product count.';

COMMENT ON COLUMN "public"."developer_accounts"."developer_name" IS 'Developer or studio name shown in the console.';

COMMENT ON COLUMN "public"."developer_accounts"."developer_type" IS 'Self-reported type, e.g. indie / studio / hobbyist. Free text by design.';

COMMENT ON COLUMN "public"."developer_accounts"."experience_level" IS 'Self-reported experience band. Free text by design.';

COMMENT ON COLUMN "public"."developer_accounts"."hear_about_us" IS 'Attribution answer for "How did you hear about us?"';

COMMENT ON COLUMN "public"."developer_accounts"."platforms" IS 'Self-reported platforms, e.g. "CLI, web, mobile". Free text by design.';
