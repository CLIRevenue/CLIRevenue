CREATE TABLE "public"."campaigns" (
  "id"                uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "advertiser_id"     uuid                     NOT NULL,
  "name"              text                     NOT NULL,
  "headline"          text                     NOT NULL,
  "description"       text,
  "cta"               text                     DEFAULT 'Learn more'::text,
  "audience_id"       text                     NOT NULL,
  "budget_cents"      integer                  NOT NULL,
  "cpm_cents"         integer                  NOT NULL DEFAULT 10,
  "spend_milli_cents" integer                  NOT NULL DEFAULT 0,
  "impressions_count" integer                  NOT NULL DEFAULT 0,
  "clicks_count"      integer                  NOT NULL DEFAULT 0,
  "conversions_count" integer                  NOT NULL DEFAULT 0,
  "starts_at"         timestamp with time zone,
  "ends_at"           timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "landing_url"       text,
  CONSTRAINT "campaigns_advertiser_id_fkey" FOREIGN KEY (advertiser_id) REFERENCES public.advertisers(id) ON DELETE CASCADE,
  CONSTRAINT "campaigns_audience_id_fkey" FOREIGN KEY (audience_id) REFERENCES public.audiences(id),
  CONSTRAINT "campaigns_budget_cents_check" CHECK ((budget_cents >= 0)),
  CONSTRAINT "campaigns_clicks_count_check" CHECK ((clicks_count >= 0)),
  CONSTRAINT "campaigns_conversions_count_check" CHECK ((conversions_count >= 0)),
  CONSTRAINT "campaigns_impressions_count_check" CHECK ((impressions_count >= 0)),
  CONSTRAINT "campaigns_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."campaigns"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."campaigns"
  ADD COLUMN "status" public.campaign_status NOT NULL DEFAULT 'draft'::public.campaign_status;

CREATE INDEX idx_campaigns_advertiser_id ON public.campaigns USING btree (advertiser_id);

CREATE INDEX idx_campaigns_advertiser_status ON public.campaigns USING btree (advertiser_id, status);

CREATE INDEX idx_campaigns_status ON public.campaigns USING btree (status);

CREATE TRIGGER protect_campaign_accounting
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_campaign_accounting();

CREATE TRIGGER update_campaigns_updated_at
  BEFORE UPDATE ON public.campaigns
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Advertisers can insert campaigns" ON "public"."campaigns"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((EXISTS ( SELECT 1
   FROM public.advertisers
  WHERE ((advertisers.profile_id = auth.uid()) AND (advertisers.id = campaigns.advertiser_id)))));

CREATE POLICY "Advertisers can update their own campaigns" ON "public"."campaigns"
  FOR UPDATE
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.advertisers
  WHERE ((advertisers.profile_id = auth.uid()) AND (advertisers.id = campaigns.advertiser_id)))));

CREATE POLICY "Advertisers can view their own campaigns" ON "public"."campaigns"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.advertisers
  WHERE ((advertisers.profile_id = auth.uid()) AND (advertisers.id = campaigns.advertiser_id)))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."campaigns" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."campaigns" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."campaigns" TO "authenticated";

REVOKE ALL ON TABLE "public"."campaigns" FROM "anon";
