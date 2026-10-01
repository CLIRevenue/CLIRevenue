CREATE TABLE "public"."placements" (
  "id"                  uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "publisher_id"        uuid                     NOT NULL,
  "placement_key"       text                     NOT NULL,
  "name"                text,
  "enabled"             boolean                  NOT NULL DEFAULT true,
  "allowed_audience_id" text,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "placements_allowed_audience_id_fkey" FOREIGN KEY (allowed_audience_id) REFERENCES public.audiences(id),
  CONSTRAINT "placements_pkey" PRIMARY KEY (id),
  CONSTRAINT "placements_publisher_id_placement_key_key" UNIQUE (publisher_id, placement_key),
  CONSTRAINT "placements_publisher_id_fkey" FOREIGN KEY (publisher_id) REFERENCES public.publishers(id) ON DELETE CASCADE
);

ALTER TABLE "public"."placements"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX placements_publisher_id_idx ON public.placements USING btree (publisher_id);

CREATE TRIGGER update_placements_updated_at
  BEFORE UPDATE ON public.placements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."placements" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."placements" FROM "anon", "authenticated";
