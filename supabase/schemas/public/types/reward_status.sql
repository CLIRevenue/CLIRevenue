CREATE TYPE "public"."reward_status" AS ENUM (
  'accrued',
  'available',
  'consumed'
);

GRANT USAGE ON TYPE "public"."reward_status" TO "postgres";
