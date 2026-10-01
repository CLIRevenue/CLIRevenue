CREATE TABLE "public"."payout_transactions" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "payout_id"    uuid                     NOT NULL,
  "type"         text                     NOT NULL,
  "amount_cents" integer                  NOT NULL,
  "currency"     text                     DEFAULT 'USD'::text,
  "provider_id"  text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payout_transactions_pkey" PRIMARY KEY (id),
  CONSTRAINT "payout_transactions_type_check" CHECK ((type = 'payout'::text)),
  CONSTRAINT "payout_transactions_payout_id_fkey" FOREIGN KEY (payout_id) REFERENCES public.payouts(id) ON DELETE CASCADE
);

ALTER TABLE "public"."payout_transactions"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payout_transactions"
  ADD COLUMN "status" public.payout_status NOT NULL DEFAULT 'requested'::public.payout_status;

CREATE INDEX idx_payout_transactions_payout_id ON public.payout_transactions USING btree (payout_id);

CREATE TRIGGER update_payout_transactions_updated_at
  BEFORE UPDATE ON public.payout_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Developers can view their own payout transactions" ON "public"."payout_transactions"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.payouts
  WHERE ((payouts.id = payout_transactions.payout_id) AND (payouts.developer_id IN ( SELECT developer_accounts.id
           FROM public.developer_accounts
          WHERE (developer_accounts.profile_id = auth.uid())))))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payout_transactions" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."payout_transactions" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."payout_transactions" TO "anon";

REVOKE ALL ON TABLE "public"."payout_transactions" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."payout_transactions" TO "authenticated";
