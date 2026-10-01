CREATE TABLE "public"."ad_serve_log" (
  "id"                     uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "request_id"             uuid                     NOT NULL,
  "publisher_id"           uuid                     NOT NULL,
  "placement_id"           uuid                     NOT NULL,
  "campaign_id"            uuid                     NOT NULL,
  "developer_id"           uuid,
  "placement_key"          text                     NOT NULL,
  "sdk_version"            text,
  "context_url"            text,
  "context_referrer"       text,
  "cost_milli_cents"       integer                  NOT NULL DEFAULT 0,
  "served_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at"             timestamp with time zone NOT NULL,
  "impression_recorded_at" timestamp with time zone,
  "impression_id"          uuid,
  "impression_session_id"  text,
  "click_recorded_at"      timestamp with time zone,
  "conversion_recorded_at" timestamp with time zone,
  CONSTRAINT "ad_serve_log_impression_id_fkey" FOREIGN KEY (impression_id) REFERENCES public.ad_impressions(id) ON DELETE SET NULL,
  CONSTRAINT "ad_serve_log_pkey" PRIMARY KEY (id),
  CONSTRAINT "ad_serve_log_request_id_key" UNIQUE (request_id),
  CONSTRAINT "ad_serve_log_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT "ad_serve_log_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES public.developer_accounts(id) ON DELETE SET NULL,
  CONSTRAINT "ad_serve_log_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES public.placements(id) ON DELETE CASCADE,
  CONSTRAINT "ad_serve_log_publisher_id_fkey" FOREIGN KEY (publisher_id) REFERENCES public.publishers(id) ON DELETE CASCADE
);

ALTER TABLE "public"."ad_serve_log"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ad_serve_log_campaign_idx ON public.ad_serve_log USING btree (campaign_id);

CREATE INDEX ad_serve_log_publisher_served_idx ON public.ad_serve_log USING btree (publisher_id, served_at DESC);

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ad_serve_log" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ad_serve_log" FROM "anon", "authenticated";
