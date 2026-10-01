CREATE TYPE "public"."campaign_status" AS ENUM (
  'draft',
  'active',
  'paused',
  'completed',
  'archived'
);

GRANT USAGE ON TYPE "public"."campaign_status" TO "postgres";
