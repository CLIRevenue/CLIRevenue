-- 000025_clirevenue_key_system.sql
--
-- The clirevenue_ads_ / clirevenue_account_ key system.
--
-- Three things land here, and one thing deliberately does not.
--
-- 1. An internal ACCOUNT KEY on publishers. Same capability model as an ads
--    key -- minted with a CSPRNG, stored only as sha256, shown exactly once --
--    but it is never handed to a browser, never embedded in a page and never
--    travels in a delivery request. It exists so the creators can identify a
--    publisher by a short opaque string instead of by walking a delivery log.
--
--    `publishers.owner_profile_id` already has a UNIQUE index from migration
--    000016, and a profile is one auth.users row, which is one email. So
--    "one account key per email" needs no new identity column: the one
--    publisher, its owner profile and that profile's email are already a
--    single row. Adding a sequential 10-digit id here would have made every
--    user's name, email, phone and address enumerable by counting.
--
-- 2. A publisher_summary() read function. The SDK and the CLI both need to
--    greet a publisher by name and show them two numbers, and those numbers
--    only exist as an aggregate over ad_serve_log. Aggregation belongs in
--    Postgres; doing it in the Edge Function would either pull the whole
--    serve log across the wire or grow a second, divergent SQL query.
--
-- 3. The key_env backfill is NOT repeated. key_env is a column, not a prefix
--    fact, and migration 000016 already populated it for every existing row.
--    New keys are minted with generateAdsKey() -- which carries no environment
--    segment -- and the provisioning routes set key_env on insert. That is
--    strictly better than the old scheme: `pk_live_` vs `pk_test_` told anyone
--    holding a test key that a production sibling existed and which leaked key
--    was the interesting one. The environment is still recorded, where the
--    dashboard can use it and an attacker cannot see it.
--
-- WHAT IS DELIBERATELY NOT HERE: no new PII columns. profiles.full_name,
-- .phone, .address, .city, .state and .country already exist (migration
-- 000007), and the email is the auth.users row that profiles.id points at.
-- Adding an account-key-keyed copy of any of that would be a second store of
-- the same personal data with a weaker access story. publisher_summary returns
-- the display name and two aggregates. It never returns an email, a phone
-- number or an address, and no endpoint that a publisher key can reach will.

-- ---------------------------------------------------------------
-- publishers.account_key_hash / account_key_prefix
--
-- key_hash is sha256(key) hex, UNIQUE so lookup is one index probe. The
-- unsalted-single-probe reasoning is identical to publisher_keys.key_hash and
-- is set out in full in migration 000014: this is a 148-bit random value, not
-- a password, so a rainbow table over it is not a threat and salting would
-- only force a per-row comparison.
--
-- Nullable: a publisher created by staff, or one that predates this
-- migration, has no account key until somebody mints one. NULL rows are
-- excluded from the unique index, so any number of them can coexist.
-- ---------------------------------------------------------------
ALTER TABLE public.publishers
  ADD COLUMN IF NOT EXISTS account_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS account_key_prefix TEXT;

COMMENT ON COLUMN public.publishers.account_key_hash IS
  'sha256 of the internal clirevenue_account_ key. Capability only: the raw value is shown once at creation and is unrecoverable. NULL until minted.';
COMMENT ON COLUMN public.publishers.account_key_prefix IS
  'Display fragment of the account key. Not an authenticator, not unique, not sufficient to identify an account.';

CREATE UNIQUE INDEX IF NOT EXISTS publishers_account_key_hash_key
    ON public.publishers (account_key_hash)
    WHERE account_key_hash IS NOT NULL;

-- ---------------------------------------------------------------
-- publisher_summary(p_publisher_id)
--
-- What a publisher is shown about themselves after their key verifies: the
-- name to greet them by, and the two counters the in-CLI panel renders.
--
--   adsSeen            impressions actually recorded against their serves.
--                      COUNT(impression_recorded_at IS NOT NULL), NOT
--                      COUNT(*): a serve is a request for an ad, an impression
--                      is proof a human saw it. Billing and this number have
--                      to agree or the panel is lying about money.
--   earningsMilliCents SUM(cost_milli_cents) over the same rows. This is the
--                      price snapshot taken when the ad was served, which is
--                      the only figure that cannot drift when an advertiser
--                      later edits their CPM.
--   slotCount          placements on the account, so the panel can say
--                      "no slots yet" without a second round trip.
--
-- The display name is profiles.full_name when it is set and publishers.name
-- otherwise. The order matters: a publisher row is auto-created as
-- 'Untitled publisher' by migration 000016, so preferring it would greet most
-- developers by a placeholder string.
--
-- SECURITY DEFINER because ad_serve_log has RLS enabled with no policies at
-- all (migration 000014): the point of that table is that no client role can
-- read it. This function is the single, deliberately narrow server-side
-- aperture onto one publisher's own aggregates, and it is callable by nobody
-- but the service role -- see the grants below. `p_publisher_id` is not
-- client-supplied on any route; it is always the id authenticatePublisher
-- already resolved the request's key to. That ordering is the security
-- property, and it is why this function does not accept a key.
--
-- search_path is pinned for the usual reason: an unqualified name in a
-- SECURITY DEFINER function resolves through whatever the caller's search_path
-- happens to be.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publisher_summary(p_publisher_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_publisher_name TEXT;
    v_full_name      TEXT;
BEGIN
    SELECT p.name, pf.full_name
      INTO v_publisher_name, v_full_name
      FROM public.publishers p
      LEFT JOIN public.profiles pf ON pf.id = p.owner_profile_id
     WHERE p.id = p_publisher_id;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    RETURN jsonb_build_object(
        'publisherName',      v_publisher_name,
        'fullName',           NULLIF(btrim(v_full_name), ''),
        'adsSeen',            (
            SELECT COUNT(*)
              FROM public.ad_serve_log s
             WHERE s.publisher_id = p_publisher_id
               AND s.impression_recorded_at IS NOT NULL
        ),
        'earningsMilliCents', (
            SELECT COALESCE(SUM(s.cost_milli_cents), 0)::BIGINT
              FROM public.ad_serve_log s
             WHERE s.publisher_id = p_publisher_id
        ),
        'slotCount',          (
            SELECT COUNT(*)::BIGINT
              FROM public.placements pl
             WHERE pl.publisher_id = p_publisher_id
        )
    );
END;
$$;

COMMENT ON FUNCTION public.publisher_summary(UUID) IS
  'Self-service summary for one publisher: display name and two aggregates over its own ad_serve_log rows. Returns no email, phone or address. Service-role only; the caller must have authenticated the key first.';

REVOKE ALL ON FUNCTION public.publisher_summary(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publisher_summary(UUID) TO service_role;