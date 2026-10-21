-- Admin "delete" used to be a hard DELETE, which erased the row for the
-- advertiser too: the advertiser's bell reads this same table, so their own
-- request silently vanished the moment an admin tidied the console. Removal
-- is instead a stamp: the row stays (the advertiser keeps the request, the
-- answer, and their attachments), and the admin's read filters it out.
-- This mirrors subscriber_read_at, where writing the column directly was
-- shunned in favour of an RPC because a full UPDATE opens the row for
-- rewriting subject/body/category. Here the writer is an admin, subject to
-- the same jwt_is_admin() policy the old DELETE used, and nothing else on
-- the row is touched.
ALTER TABLE public.advertiser_queries
  ADD COLUMN IF NOT EXISTS admin_dismissed_at timestamptz;

COMMENT ON COLUMN public.advertiser_queries.admin_dismissed_at IS
  'Set when an admin removes the query from the admin console. The row is kept for the advertiser, so their bell still shows the request and its answer; admin reads filter these out. Attachments are purged on schedule only after the query has been replied to.';
