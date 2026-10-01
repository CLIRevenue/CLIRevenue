CREATE TABLE "public"."reward_ledger" (
  "id"              uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "developer_id"    uuid                     NOT NULL,
  "campaign_id"     uuid                     NOT NULL,
  "interaction_id"  uuid                     NOT NULL,
  "amount_cents"    integer                  NOT NULL,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now(),
  "settled_at"      timestamp with time zone,
  "remaining_cents" integer                  NOT NULL DEFAULT 0,
  "payout_id"       uuid,
  "consumed_at"     timestamp with time zone,
  CONSTRAINT "reward_ledger_amount_cents_check" CHECK ((amount_cents > 0)),
  CONSTRAINT "reward_ledger_campaign_id_fkey" FOREIGN KEY (campaign_id) REFERENCES public.campaigns(id) ON DELETE CASCADE,
  CONSTRAINT "reward_ledger_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES public.developer_accounts(id) ON DELETE CASCADE,
  CONSTRAINT "reward_ledger_interaction_id_fkey" FOREIGN KEY (interaction_id) REFERENCES public.ad_interactions(id) ON DELETE CASCADE,
  CONSTRAINT "reward_ledger_payout_id_fkey" FOREIGN KEY (payout_id) REFERENCES public.payouts(id) ON DELETE SET NULL,
  CONSTRAINT "reward_ledger_pkey" PRIMARY KEY (id),
  CONSTRAINT "reward_ledger_remaining_cents_check" CHECK (((remaining_cents >= 0) AND (remaining_cents <= amount_cents)))
);

ALTER TABLE "public"."reward_ledger"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."reward_ledger"
  ADD COLUMN "status" public.reward_status NOT NULL DEFAULT 'accrued'::public.reward_status;

ALTER TABLE "public"."reward_ledger"
  ADD CONSTRAINT "reward_ledger_consumed_shape" CHECK (((status <> 'consumed'::public.reward_status) OR (remaining_cents = 0)));

CREATE INDEX idx_reward_ledger_campaign_id ON public.reward_ledger USING btree (campaign_id);

CREATE INDEX idx_reward_ledger_created_at ON public.reward_ledger USING btree (created_at);

CREATE INDEX idx_reward_ledger_developer_id ON public.reward_ledger USING btree (developer_id);

CREATE INDEX idx_reward_ledger_developer_status ON public.reward_ledger USING btree (developer_id, status);

CREATE INDEX idx_reward_ledger_payout_id ON public.reward_ledger USING btree (payout_id);

CREATE INDEX idx_reward_ledger_spendable ON public.reward_ledger USING btree (developer_id, created_at)
  WHERE ((status = 'available'::public.reward_status) AND (remaining_cents > 0));

CREATE INDEX idx_reward_ledger_status ON public.reward_ledger USING btree (status);

CREATE POLICY "Developers can view their own reward ledger" ON "public"."reward_ledger"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = reward_ledger.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."reward_ledger" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."reward_ledger" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."reward_ledger" TO "anon";

REVOKE ALL ON TABLE "public"."reward_ledger" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."reward_ledger" TO "authenticated";
