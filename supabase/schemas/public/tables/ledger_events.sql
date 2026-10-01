CREATE TABLE "public"."ledger_events" (
  "id"                 uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "type"               text                     NOT NULL,
  "amount_cents"       integer                  DEFAULT 0,
  "currency"           text                     DEFAULT 'USD'::text,
  "label"              text                     NOT NULL,
  "detail"             text,
  "timestamp"          timestamp with time zone NOT NULL DEFAULT now(),
  "simulated"          boolean                  NOT NULL DEFAULT false,
  "campaign_id"        uuid,
  "advertiser_id"      uuid,
  "reference_id"       uuid,
  "reference_type"     text,
  "amount_milli_cents" integer                  NOT NULL DEFAULT 0,
  CONSTRAINT "ledger_events_advertiser_id_fkey" FOREIGN KEY (advertiser_id) REFERENCES public.advertisers(id) ON DELETE SET NULL,
  CONSTRAINT "ledger_events_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE SET NULL,
  CONSTRAINT "ledger_events_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."ledger_events"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_ledger_events_advertiser_id ON public.ledger_events USING btree (advertiser_id);

CREATE INDEX idx_ledger_events_campaign_id ON public.ledger_events USING btree (campaign_id);

CREATE INDEX idx_ledger_events_reference_id ON public.ledger_events USING btree (reference_id);

CREATE INDEX idx_ledger_events_timestamp ON public.ledger_events USING btree ("timestamp");

CREATE INDEX idx_ledger_events_type ON public.ledger_events USING btree (TYPE);

CREATE POLICY "Admins can view ledger events" ON "public"."ledger_events"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.profiles
  WHERE ((profiles.id = auth.uid()) AND (profiles.role = 'admin'::text)))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."ledger_events" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."ledger_events" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."ledger_events" TO "anon";

REVOKE ALL ON TABLE "public"."ledger_events" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE ON TABLE "public"."ledger_events" TO "authenticated";
