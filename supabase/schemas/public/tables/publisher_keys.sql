CREATE TABLE "public"."publisher_keys" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "publisher_id" uuid                     NOT NULL,
  "key_hash"     text                     NOT NULL,
  "key_prefix"   text                     NOT NULL,
  "label"        text,
  "revoked_at"   timestamp with time zone,
  "last_used_at" timestamp with time zone,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "publisher_keys_key_hash_key" UNIQUE (key_hash),
  CONSTRAINT "publisher_keys_pkey" PRIMARY KEY (id),
  CONSTRAINT "publisher_keys_publisher_id_fkey" FOREIGN KEY (publisher_id) REFERENCES public.publishers(id) ON DELETE CASCADE
);

ALTER TABLE "public"."publisher_keys"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX publisher_keys_publisher_id_idx ON public.publisher_keys USING btree (publisher_id);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."publisher_keys" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."publisher_keys" FROM "anon", "authenticated";
