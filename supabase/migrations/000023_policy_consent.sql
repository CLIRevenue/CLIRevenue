-- Policy consent tracking.
--
-- Records which policy version the user accepted and when.
-- The application sets these at signup; they are not user-editable.

ALTER TABLE "public"."profiles"
  ADD COLUMN IF NOT EXISTS "privacy_policy_version" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "terms_version" TEXT NULL,
  ADD COLUMN IF NOT EXISTS "privacy_policy_accepted_at" TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMPTZ NULL;

-- Keep the columns out of browser-facing selects: the profile API does not
-- expose them, and the admin console is the only reader that needs them.
COMMENT ON COLUMN "public"."profiles"."privacy_policy_version" IS 'Privacy policy version accepted by the user.';
COMMENT ON COLUMN "public"."profiles"."terms_version" IS 'Terms & conditions version accepted by the user.';
COMMENT ON COLUMN "public"."profiles"."privacy_policy_accepted_at" IS 'Timestamp of privacy policy acceptance.';
COMMENT ON COLUMN "public"."profiles"."terms_accepted_at" IS 'Timestamp of terms & conditions acceptance.';
