CREATE TABLE "public"."ad_interactions" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id"     uuid                     NOT NULL,
  "developer_id"    uuid                     NOT NULL,
  "cli_integration" text                     NOT NULL,
  "session_id"      text                     NOT NULL,
  "timestamp"       timestamp with time zone NOT NULL DEFAULT now(),
  "idempotency_key" text                     NOT NULL,
  "impression_id"   uuid,
  CONSTRAINT "ad_interactions_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "ad_interactions_impression_id_fkey" FOREIGN KEY (impression_id) REFERENCES public.ad_impressions(id) ON DELETE SET NULL,
  CONSTRAINT "ad_interactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "ad_interactions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT "ad_interactions_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES public.developer_accounts(id) ON DELETE CASCADE
);

ALTER TABLE "public"."ad_interactions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."ad_interactions"
  ADD COLUMN "kind" public.interaction_kind NOT NULL DEFAULT 'click'::public.interaction_kind;

CREATE INDEX idx_ad_interactions_campaign_id ON public.ad_interactions USING btree (campaign_id);

CREATE INDEX idx_ad_interactions_developer_id ON public.ad_interactions USING btree (developer_id);

CREATE INDEX idx_ad_interactions_timestamp ON public.ad_interactions USING btree ("timestamp");

CREATE POLICY "Advertisers can view interactions for their campaigns" ON "public"."ad_interactions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.campaigns
  WHERE ((campaigns.id = ad_interactions.campaign_id) AND (campaigns.advertiser_id IN ( SELECT advertisers.id
           FROM public.advertisers
          WHERE (advertisers.profile_id = auth.uid())))))));

CREATE POLICY "Developers can insert interactions" ON "public"."ad_interactions"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = ad_interactions.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

CREATE POLICY "Developers can view their own interactions" ON "public"."ad_interactions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = ad_interactions.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ad_interactions" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ad_interactions" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."ad_interactions" TO "authenticated";

REVOKE ALL ON TABLE "public"."ad_interactions" FROM "anon";
