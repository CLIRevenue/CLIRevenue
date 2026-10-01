CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "role"       text                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "full_name"  text,
  "phone"      text,
  "address"    text,
  "city"       text,
  "state"      text,
  "country"    text,
  CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id),
  CONSTRAINT "profiles_role_check" CHECK ((role = ANY (ARRAY['advertiser'::text, 'developer'::text, 'admin'::text])))
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Users can insert their own profile" ON "public"."profiles"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((auth.uid() = id) AND (role = ANY (ARRAY['advertiser'::text, 'developer'::text]))));

CREATE POLICY "Users can update their own profile" ON "public"."profiles"
  FOR UPDATE
  TO PUBLIC
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));

CREATE POLICY "Users can view their own profile" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((auth.uid() = id));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres", "service_role";

COMMENT ON COLUMN "public"."profiles"."address" IS 'Street address. Self-reported, optional.';

COMMENT ON COLUMN "public"."profiles"."city" IS 'City. Self-reported, optional.';

COMMENT ON COLUMN "public"."profiles"."country" IS 'Country. Self-reported, optional.';

COMMENT ON COLUMN "public"."profiles"."full_name" IS 'Display name of the account holder. Self-reported.';

COMMENT ON COLUMN "public"."profiles"."phone" IS 'Contact phone. Self-reported, optional.';

COMMENT ON COLUMN "public"."profiles"."state" IS 'State/region. Self-reported, optional.';

REVOKE ALL ("address") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("address") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("city") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("city") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("country") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("country") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("full_name") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("full_name") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("phone") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("phone") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ("state") ON TABLE "public"."profiles" FROM "authenticated";

GRANT UPDATE ("state") ON TABLE "public"."profiles" TO "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."profiles" TO "authenticated";
