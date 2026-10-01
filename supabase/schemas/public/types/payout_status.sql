CREATE TYPE "public"."payout_status" AS ENUM (
  'requested',
  'processing',
  'sent',
  'failed'
);

GRANT USAGE ON TYPE "public"."payout_status" TO "postgres";
