CREATE TABLE "public"."ad_impressions" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "campaign_id"     uuid                     NOT NULL,
  "developer_id"    uuid,
  "cli_integration" text                     NOT NULL,
  "session_id"      text                     NOT NULL,
  "timestamp"       timestamp with time zone NOT NULL DEFAULT now(),
  "idempotency_key" text                     NOT NULL,
  CONSTRAINT "ad_impressions_idempotency_key_key" UNIQUE (idempotency_key),
  CONSTRAINT "ad_impressions_pkey" PRIMARY KEY (id),
  CONSTRAINT "ad_impressions_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT "ad_impressions_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES public.developer_accounts(id) ON DELETE SET NULL
);

ALTER TABLE "public"."ad_impressions"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ad_impressions_campaign_id ON public.ad_impressions USING btree (campaign_id);

CREATE INDEX idx_ad_impressions_developer_id ON public.ad_impressions USING btree (developer_id);

CREATE INDEX idx_ad_impressions_timestamp ON public.ad_impressions USING btree ("timestamp");

CREATE POLICY "Advertisers can view impressions for their campaigns" ON "public"."ad_impressions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.campaigns
  WHERE ((campaigns.id = ad_impressions.campaign_id) AND (campaigns.advertiser_id IN ( SELECT advertisers.id
           FROM public.advertisers
          WHERE (advertisers.profile_id = auth.uid())))))));

CREATE POLICY "Developers can insert impressions" ON "public"."ad_impressions"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = ad_impressions.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

CREATE POLICY "Developers can view their own impressions" ON "public"."ad_impressions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = ad_impressions.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ad_impressions" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ad_impressions" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."ad_impressions" TO "authenticated";

REVOKE ALL ON TABLE "public"."ad_impressions" FROM "anon";
