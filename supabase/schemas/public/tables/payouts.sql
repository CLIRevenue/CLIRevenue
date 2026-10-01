CREATE TABLE "public"."payouts" (
  "id"           uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "developer_id" uuid                     NOT NULL,
  "amount_cents" integer                  NOT NULL,
  "provider_id"  text                     NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "payouts_amount_cents_check" CHECK ((amount_cents > 0)),
  CONSTRAINT "payouts_developer_id_fkey" FOREIGN KEY (developer_id) REFERENCES public.developer_accounts(id) ON DELETE CASCADE,
  CONSTRAINT "payouts_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."payouts"
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."payouts"
  ADD COLUMN "status" public.payout_status NOT NULL DEFAULT 'requested'::public.payout_status;

CREATE INDEX idx_payouts_developer_id ON public.payouts USING btree (developer_id);

CREATE INDEX idx_payouts_status ON public.payouts USING btree (status);

CREATE TRIGGER update_payouts_updated_at
  BEFORE UPDATE ON public.payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "Developers can view their own payouts" ON "public"."payouts"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.developer_accounts
  WHERE ((developer_accounts.id = payouts.developer_id) AND (developer_accounts.profile_id = auth.uid())))));

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."payouts" TO "postgres", "service_role";

REVOKE ALL ON TABLE "public"."payouts" FROM "anon";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."payouts" TO "anon";

REVOKE ALL ON TABLE "public"."payouts" FROM "authenticated";

GRANT MAINTAIN, REFERENCES, SELECT, TRIGGER ON TABLE "public"."payouts" TO "authenticated";
