CREATE TABLE "public"."audiences" (
  "id"    text NOT NULL,
  "label" text NOT NULL,
  "note"  text,
  CONSTRAINT "audiences_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."audiences"
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Audiences are readable by everyone" ON "public"."audiences"
  FOR SELECT
  TO PUBLIC
  USING (true);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."audiences" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."audiences" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."audiences" TO "anon";

REVOKE ALL ON TABLE "public"."audiences" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."audiences" TO "authenticated";
