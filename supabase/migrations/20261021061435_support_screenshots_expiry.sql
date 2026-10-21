-- Support screenshot expiry: attached images live for 12 hours after their
-- query is answered, then the bytes leave storage.
--
-- Object layout is `<auth uid>/<query id>/<uuid>.<ext>` (the client generates
-- the query id and names each upload before the row is written, so the link
-- between an object and its query is structural, not a metadata lookup).
-- The purge deletes objects whose owning query has replied_at older than 12
-- hours. Queries that have not been answered keep their attachments — they
-- cannot be seen in the replied list anyway, and the admin still needs them
-- to write the answer.
--
-- private bucket still enforced by the support_screenshots migration; signed
-- links are read time-limited (1h per view), this purge is what makes the
-- retention promise real. Queries that have not been answered keep their
-- attachments: they cannot be seen in the replied list anyway, and the
-- admin still needs them to write the answer.

CREATE OR REPLACE FUNCTION public.purge_support_screenshots()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  deleted integer;
BEGIN
  -- In-memory test environments replay these files without the Supabase
  -- storage schema; there is nothing to purge there.
  IF to_regclass('storage.objects') IS NULL THEN
    RETURN 0;
  END IF;

  -- window = 12 hours for ordinary queries, 48 hours when an admin(flagged) important
  DELETE FROM storage.objects o
  WHERE o.bucket_id = 'support-screenshots'
    AND EXISTS (
      SELECT 1
      FROM public.advertiser_queries q
      WHERE q.id::text = split_part(o.name, '/', 2)
        AND q.profile_id::text = split_part(o.name, '/', 1)
        AND q.replied_at IS NOT NULL
        AND q.replied_at < now() - interval '12 hours' * (CASE WHEN q.important THEN 4 ELSE 1 END)
    );

  GET DIAGNOSTICS deleted = ROW_COUNT;
  RETURN deleted;
END $$;

REVOKE EXECUTE ON FUNCTION public.purge_support_screenshots() FROM PUBLIC, anon, authenticated;

-- Flagged-important + retention + admin destructive powers all ride on the
-- same table facts:
ALTER TABLE public.advertiser_queries
  ADD COLUMN IF NOT EXISTS important boolean NOT NULL DEFAULT 'false';

CREATE INDEX IF NOT EXISTS advertiser_queries_replied_idx
  ON public.advertiser_queries (replied_at)
  WHERE replied_at IS NOT NULL;

-- Admin delete: the answer is the row is gone for both sides, attachments
-- route against profile via the purge (nothing stays readable once the
-- query is deleted).
DROP POLICY IF EXISTS "Admins can delete queries" ON public.advertiser_queries;
CREATE POLICY "Admins can delete queries" ON public.advertiser_queries
    FOR DELETE USING (public.jwt_is_admin());
GRANT DELETE ON public.advertiser_queries TO authenticated;

-- Admin deletes developer/advertiser ACCOUNTS: deleting profile row cascades
-- (000001) — and now must actually be possible, which it was not before
-- (no delete grant/policy): the admin console's effort on accounts was
-- silently ringing against RLS denial.
DROP POLICY IF EXISTS "Admins can remove accounts" ON public.profiles;
CREATE POLICY "Admins can remove accounts" ON public.profiles
    FOR DELETE TO authenticated
    USING (public.jwt_is_admin());
GRANT DELETE ON public.profiles TO authenticated;

-- Hourly sweep (idempotent). pg_cron may not exist (locally replayed files,
-- or a project without the extension): everything is guarded so the file is
-- safe to replay in either environment.

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    IF to_regclass('cron.job') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-support-screenshots') THEN
      PERFORM cron.schedule(
        'purge-support-screenshots',
        '9 * * * *',
        $croncmd$SELECT public.purge_support_screenshots()$croncmd$
      );
    END IF;
  END IF;
END
$outer$;
