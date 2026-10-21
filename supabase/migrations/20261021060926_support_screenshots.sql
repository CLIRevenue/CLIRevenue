-- Support screenshots: a private bucket for the images advertisers attach to
-- support queries, plus the two storage policies that make it work from the
-- Data API.
--
-- Before this migration the query row recorded file NAMES only (the dialog
-- mapped `files.map((f) => f.name)`), and the admin panel rendered those
-- names as plain text — an admin literally could not open an attached image,
-- because no bytes had ever been uploaded anywhere.
--
-- Layout: every object lives under `<auth uid>/<uuid>.<ext>`. The first path
-- segment is the uploader's id, which is what the policies key on.
--
-- The bucket is private on purpose: support attachments can contain business
-- data the advertiser did not post publicly. Images are read back with
-- short-lived signed URLs (client: createSignedUrl, TTL 1h) which go through
-- object RLS, so a signed URL is only ever issued to the folder owner or an
-- admin. Legacy rows that hold a bare filename with no "/" keep rendering as
-- plain text — those bytes never existed.
--
-- The whole body is guarded on storage.buckets existing: in-memory Postgres
-- test environments replay these files without the Supabase storage schema,
-- and there the feature simply doesn't apply; on a real Supabase project the
-- storage schema is always present.

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('support-screenshots', 'support-screenshots', false)
    ON CONFLICT (id) DO NOTHING;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'support screenshots: upload to own folder'
    ) THEN
      CREATE POLICY "support screenshots: upload to own folder" ON storage.objects
        FOR INSERT TO authenticated
        WITH CHECK (
          bucket_id = 'support-screenshots'
          AND (storage.foldername(name))[1] = auth.uid()::text
        );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname = 'support screenshots: read own folder or admin'
    ) THEN
      CREATE POLICY "support screenshots: read own folder or admin" ON storage.objects
        FOR SELECT TO authenticated
        USING (
          bucket_id = 'support-screenshots'
          AND (
            (storage.foldername(name))[1] = auth.uid()::text
            OR public.jwt_is_admin()
          )
        );
    END IF;
  END IF;
END $$;
