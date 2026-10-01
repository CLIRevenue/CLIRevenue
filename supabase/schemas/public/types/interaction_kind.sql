CREATE TYPE "public"."interaction_kind" AS ENUM (
  'click',
  'conversion'
);

GRANT USAGE ON TYPE "public"."interaction_kind" TO "postgres";
