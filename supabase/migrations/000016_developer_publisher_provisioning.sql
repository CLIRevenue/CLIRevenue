-- 000016_developer_publisher_provisioning.sql
--
-- Why this migration exists
-- ------------------------
-- A developer who signs up should end up holding a usable publishable key
-- without an operator, a SQL console or an approval step. The tables that
-- make that possible already exist. What was missing was the database-level
-- guarantee that provisioning it twice cannot produce two publishers or two
-- active test keys.
--
-- Until now the provisioning logic was "look up my publisher, and if there is
-- none create one" followed by "look up my active test key, and if there is
-- none create one". Both are read-then-write sequences, and both are races.
-- Two browser tabs opened at once after signup could each observe an empty
-- result and each insert. Deciding idempotency in application code means
-- every future caller has to remember to be careful; the same repository
-- already established the opposite preference in 000015, where "at most one
-- impression per serve" is enforced under a row lock so that uniqueness is a
-- property of the database rather than of the caller behaving.
--
-- Two invariants are therefore added here:
--
--   1. One publisher per owning profile. publishers.owner_profile_id was an
--      ordinary nullable column with a plain index. The column stays nullable
--      on purpose - a publisher may be created by staff or seed data before
--      any account claims it - so the guarantee is a *partial* unique index
--      over the non-null values.
--
--   2. At most one unrevoked key per environment per publisher. key_env is
--      new: the environment is currently only inferable from the stored
--      12-character key_prefix, and a unique index cannot be built over a
--      fragment the application has to remember to supply consistently. It is
--      nullable because rows written before this migration, and rows written
--      by tooling that does not know about environments, still have no value;
--      the partial index ignores them rather than forcing a guess.
--
-- provision_publisher_slot() then performs the read-then-create for both in
-- one transaction, taking a row lock on the owning developer_accounts row
-- before its first read so concurrent callers queue instead of racing.
--
-- It deliberately does NOT mint the key. Key generation and hashing live in
-- supabase/functions/_shared/publisherAuth.ts and must not grow a second
-- implementation in SQL - two implementations of "make a publisher key" is
-- exactly the kind of divergence this repository avoids. The function reports
-- whether a key is needed; the Edge Function generates, hashes and inserts,
-- and the partial unique index is what makes a lost race fail loudly instead
-- of silently creating a second key.
-- ---------------------------------------------------------------

-- ---------------------------------------------------------------
-- publishers.owner_profile_id: one publisher per owner
-- ---------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS publishers_owner_profile_id_key
    ON public.publishers (owner_profile_id)
    WHERE owner_profile_id IS NOT NULL;

-- ---------------------------------------------------------------
-- publisher_keys.key_env
--
-- Backfilled from key_prefix, which already carries the environment as its
-- third underscore-separated segment ("pk_test_…", "pk_live_…"). Any row whose
-- prefix matches neither keeps NULL rather than being guessed into an
-- environment it might not belong to.
-- ---------------------------------------------------------------
ALTER TABLE public.publisher_keys
    ADD COLUMN IF NOT EXISTS key_env TEXT;

UPDATE public.publisher_keys
   SET key_env = CASE
         WHEN starts_with(key_prefix, 'pk_live_') THEN 'live'
         WHEN starts_with(key_prefix, 'pk_test_') THEN 'test'
         ELSE NULL
       END
 WHERE key_env IS NULL
   AND (starts_with(key_prefix, 'pk_live_') OR starts_with(key_prefix, 'pk_test_'));

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'publisher_keys_key_env_check'
    ) THEN
        ALTER TABLE public.publisher_keys
            ADD CONSTRAINT publisher_keys_key_env_check
            CHECK (key_env IS NULL OR key_env IN ('test', 'live'));
    END IF;
END
$$;

-- Revoked rows are excluded so a revoked key does not block issuing a
-- replacement; the replacement becomes the one active key for that
-- environment. key_env IS NULL is excluded because two environment-less rows
-- say nothing about how many test keys exist.
CREATE UNIQUE INDEX IF NOT EXISTS publisher_keys_active_env_key
    ON public.publisher_keys (publisher_id, key_env)
    WHERE revoked_at IS NULL
      AND key_env IS NOT NULL;

-- ---------------------------------------------------------------
-- provision_publisher_slot
--
-- Returns the caller's publisher, creating it only if it does not exist, and
-- reports the environment-less facts about their active test key. It never
-- returns key_hash and never returns a raw key: the caller cannot recover a
-- key from this function, only learn whether it has to mint one.
--
-- Grant posture matches the rest of the privileged surface: PUBLIC, anon and
-- authenticated are all revoked, so the browser cannot reach this even with
-- the anon key. The only caller is the Edge Function, acting as service_role
-- with an owner id it took from the verified JWT rather than from a request
-- body.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_publisher_slot(
    p_owner_profile_id UUID,
    p_publisher_name TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_publisher_id UUID;
    v_publisher_name TEXT;
    v_publisher_created BOOLEAN := FALSE;
    v_key_id UUID;
    v_key_prefix TEXT;
    v_key_env TEXT;
    v_key_label TEXT;
    v_key_created_at TIMESTAMPTZ;
BEGIN
    IF p_owner_profile_id IS NULL THEN
        RAISE EXCEPTION 'PUBLISHER_OWNER_REQUIRED' USING ERRCODE = '22023';
    END IF;

    -- Serialise on the owning developer row. This is the first statement that
    -- touches a table so concurrent provisioning requests for the same
    -- developer queue here rather than both observing an empty result below.
    -- SELECT ... FOR UPDATE is a statement, so PERFORM is the right way to
    -- take the lock and discard the value. The caller has already proved the
    -- developer_accounts row exists via requireDeveloper().
    PERFORM 1
      FROM public.developer_accounts
     WHERE profile_id = p_owner_profile_id
       FOR UPDATE;

    SELECT id, name
      INTO v_publisher_id, v_publisher_name
      FROM public.publishers
     WHERE owner_profile_id = p_owner_profile_id
     LIMIT 1;

    IF v_publisher_id IS NULL THEN
        INSERT INTO public.publishers (owner_profile_id, name)
        VALUES (
            p_owner_profile_id,
            COALESCE(NULLIF(BTRIM(p_publisher_name), ''), 'Untitled publisher')
        )
        RETURNING id, name INTO v_publisher_id, v_publisher_name;

        v_publisher_created := TRUE;
    END IF;

    SELECT k.id, k.key_prefix, k.key_env, k.label, k.created_at
      INTO v_key_id, v_key_prefix, v_key_env, v_key_label, v_key_created_at
      FROM public.publisher_keys k
     WHERE k.publisher_id = v_publisher_id
       AND k.revoked_at IS NULL
       AND k.key_env = 'test'
     ORDER BY k.created_at ASC
     LIMIT 1;

    RETURN jsonb_build_object(
        'publisher_id', v_publisher_id,
        'publisher_name', v_publisher_name,
        'publisher_created', v_publisher_created,
        'needs_key', v_key_id IS NULL,
        'key_id', v_key_id,
        'key_prefix', v_key_prefix,
        'key_env', v_key_env,
        'key_label', v_key_label,
        'key_created_at', v_key_created_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.provision_publisher_slot(UUID, TEXT)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.provision_publisher_slot(UUID, TEXT)
    TO service_role;