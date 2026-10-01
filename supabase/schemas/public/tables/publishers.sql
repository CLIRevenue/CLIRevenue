CREATE TABLE "public"."publishers" (
  "id"               uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "owner_profile_id" uuid,
  "name"             text                     NOT NULL,
  "status"           text                     NOT NULL DEFAULT 'active'::text,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "publishers_owner_profile_id_fkey" FOREIGN KEY (owner_profile_id) REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT "publishers_pkey" PRIMARY KEY (id),
  CONSTRAINT "publishers_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);

ALTER TABLE "public"."publishers"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX publishers_owner_profile_id_idx ON public.publishers USING btree (owner_profile_id);

CREATE TRIGGER update_publishers_updated_at
  BEFORE UPDATE ON public.publishers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."publishers" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."publishers" FROM "anon", "authenticated";
