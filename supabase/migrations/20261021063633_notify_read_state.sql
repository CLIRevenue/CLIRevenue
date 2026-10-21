-- Notification read state, provider-side.
--
-- The advertiser bell counts "replies from support" it has not been opened
-- yet. Until now that read state lived only in React state: clicking a
-- notification marked it read for the current tab, but a refresh pulled the
-- list again and the red dot came back, because nothing was ever written to
-- the database. This adds the persistent store: a per-row timestamp on the
-- advertiser's own copy of the query, plus a narrow RPC to set it.
--
-- Why an RPC and not an UPDATE policy: a plain "own rows are updatable"
-- policy would also let a signed-in user rewrite subject/body/category on
-- rows the admin has already answered — more surface than we want to grant
-- for a read receipt. The function is SECURITY DEFINER (owner = postgres,
-- the migration role) but its WHERE clause is bound to the caller's
-- auth.uid(), so it can only ever stamp rows that already belong to the
-- caller. It flips subscriber_read_at one way: NULL -> answered time; a
-- row already marked read is not re-touched — the unread count is defined
-- as subscriber_read_at IS NULL and we do not resurrect dot state.
--
-- p_ids = NULL means "everything unread that is mine", which is what the
-- "Mark all as read" button in the bell asks for. Passing a subset marks
-- just that subset — what opening a single notification does.

ALTER TABLE public.advertiser_queries
    ADD COLUMN IF NOT EXISTS subscriber_read_at timestamptz;

CREATE OR REPLACE FUNCTION public.mark_queries_read(p_ids uuid[] DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $mark_queries_read$
DECLARE
    changed integer;
BEGIN
    UPDATE public.advertiser_queries AS q
       SET subscriber_read_at = now()
     WHERE q.profile_id = auth.uid()
       AND q.subscriber_read_at IS NULL
       AND (p_ids IS NULL OR q.id = ANY (p_ids));
    GET DIAGNOSTICS changed = ROW_COUNT;
    RETURN changed;
END;
$mark_queries_read$;

REVOKE ALL ON FUNCTION public.mark_queries_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_queries_read(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.mark_queries_read(uuid[]) IS
'Advisory only in billing terms: marks the signed-in caller''s support
queries as read (NULL timestamp -> now). p_ids NULL marks everything
unread; passing ids marks a subset. Returns the number of rows stamped.';

COMMENT ON COLUMN public.advertiser_queries.subscriber_read_at IS
'When the owner of this query opened it as a notification. NULL = unseen.';
