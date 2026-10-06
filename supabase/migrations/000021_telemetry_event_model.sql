-- ---------------------------------------------------------------
-- 000021_telemetry_event_model.sql
--
-- The telemetry event model: twelve events describing one ad
-- delivery from request to reward, server-authoritative end to end.
--
-- WHY THIS MIGRATION EXISTS
--
-- Everything the platform bills on is already server-authored. What
-- did not exist was a durable record of *how* a delivery got there:
-- which session asked, which creative was chosen, when the ad became
-- visible, when the server accepted the observation, and when a reward
-- came into existence. Without that, an advertiser asking "why was I
-- charged for this impression" can only be answered by re-deriving
-- state from counters.
--
-- The hard rule this file is built around:
--
--   A REWARD MUST NEVER ORIGINATE FROM AN UNVALIDATED CLIENT EVENT.
--
-- It is enforced in three independent places, so no single mistake
-- opens the door:
--
--   1. `event_validated` and `reward_created` are SERVER-ONLY event
--      types. `record_telemetry_event` — the only entry point a
--      publisher client can reach — refuses them outright.
--   2. A BEFORE INSERT trigger re-checks, independently of the RPC,
--      that any insert of a server-only type carries the internal
--      capability flag. The flag lives in transaction-local GUC that a
--      PostgREST client cannot set.
--   3. The `reward_ledger` insert trigger resolves
--      interaction -> impression -> serve and then REQUIRES an
--      `event_validated` row already recorded for that interaction.
--      A reward whose delivery resolves but whose validation record is
--      missing raises `REWARD_UNVALIDATED` and the whole transaction
--      rolls back. A reward whose delivery does NOT resolve (the
--      legacy direct-SQL accounting path used by the migration and
--      integrity tests, which predates any serve row) is skipped
--      silently — telemetry must never be able to break accounting.
--
-- WHY TRIGGERS AND NOT EDITED RPCs
--
-- Migrations 000011 and 000015 already contain the authoritative
-- accounting functions. They are not edited here. Instead, telemetry
-- hangs off the *state transitions* those functions cause, via
-- triggers:
--
--   ad_serve_log INSERT   -> ad_requested, campaign_selected,
--                             creative_delivered
--   ad_serve_log UPDATE   -> visibility_qualified, impression_qualified
--     (impression_recorded_at null -> set)
--   ad_interactions INSERT-> event_validated
--   reward_ledger INSERT  -> reward_created
--
-- Two consequences, both deliberate. Applied migrations stay
-- immutable, so the accounting SQL that has been audited is not
-- re-audited by this change. And no amount of client input can
-- influence which rows appear, because the trigger fires from inside
-- the same transaction as the accounting write, under the same row
-- lock.
--
-- WHY telemetry_must_never_collect
--
-- The SDK's published privacy contract (packages/sdk/src/index.ts) is
-- that the only publisher context sent is the current URL and the
-- referrer, there is no cross-site identifier, and no fingerprint of
-- any kind. `telemetry_sessions` therefore has no user agent column,
-- no IP column and no device column, and `telemetry_events.metadata`
-- is screened by an immutable allow-list function before any row can
-- be written. Terminal commands, passwords, clipboard contents,
-- private file paths, microphone captures and camera captures have no
-- column to land in and no key that could name them.
--
-- OBSERVED vs ASSERTED
--
-- `session_started`, `page_viewed`, `section_viewed`, `cta_clicked`
-- and `ad_rendered` are observations, and the client is the only party
-- that can make them, so the client asserts them. Their ordering is
-- still enforced against rows the server wrote. Everything that could
-- move money or be counted is server-authored and is refused if it
-- arrives from a client. `visibility_qualified` is server-authored on
-- purpose: the impression endpoint is only reachable through the
-- SDK's 50%-for-1s viewability gate, so the server asserting the fact
-- is a stronger statement than trusting a client flag would be.
-- ---------------------------------------------------------------


-- ---------------------------------------------------------------
-- Creative identity
--
-- A campaign is the pricing and targeting unit; a creative is the
-- thing a reader actually saw. They are separate concepts because a
-- campaign row is edited in place — a new headline is the same
-- campaign. Giving every campaign exactly one creative identity, minted
-- by a trigger, means a delivery can be attributed to a stable
-- creative id even after the copy behind it has been rewritten, and it
-- means existing campaigns gain one retroactively with no backfill
-- script and no change to delivery selection logic.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.campaign_creatives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL UNIQUE REFERENCES public.campaigns(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.campaign_creatives IS
    'Stable creative identity per campaign, minted by trigger. Survives in-place campaign edits so delivery attribution does not drift when copy changes.';

CREATE OR REPLACE FUNCTION public.tg_campaign_creative_mint() RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.campaign_creatives (campaign_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaign_creative_mint ON public.campaigns;
CREATE TRIGGER campaign_creative_mint
    AFTER INSERT ON public.campaigns
    FOR EACH ROW EXECUTE FUNCTION public.tg_campaign_creative_mint();

-- Campaigns created before this migration.
INSERT INTO public.campaign_creatives (campaign_id)
SELECT c.id FROM public.campaigns c
ON CONFLICT (campaign_id) DO NOTHING;


-- ---------------------------------------------------------------
-- Serve log additions
--
-- `creative_id` is populated by a BEFORE INSERT trigger so the
-- delivery handler does not have to change at all: a serve written by
-- the existing handler gets its creative identity automatically.
--
-- `telemetry_session_id` is the publisher session that asked for the
-- ad. It is a client-supplied string the SDK already generates per
-- page load; it is not an identifier that leaves the origin.
-- ---------------------------------------------------------------
ALTER TABLE public.ad_serve_log
    ADD COLUMN IF NOT EXISTS creative_id UUID REFERENCES public.campaign_creatives(id) ON DELETE SET NULL;

ALTER TABLE public.ad_serve_log
    ADD COLUMN IF NOT EXISTS telemetry_session_id TEXT;

COMMENT ON COLUMN public.ad_serve_log.creative_id IS
    'Creative actually served. Resolved server-side from the campaign; never taken from a request body.';
COMMENT ON COLUMN public.ad_serve_log.telemetry_session_id IS
    'Publisher page-load session that requested this serve. Nullable: a synthetic per-serve session is used for the delivery-chain events when absent.';

CREATE OR REPLACE FUNCTION public.tg_ad_serve_log_set_creative() RETURNS TRIGGER AS $$
DECLARE
    v_creative_id UUID;
BEGIN
    IF NEW.creative_id IS NULL THEN
        SELECT id INTO v_creative_id
        FROM public.campaign_creatives WHERE campaign_id = NEW.campaign_id;

        IF v_creative_id IS NULL THEN
            INSERT INTO public.campaign_creatives (campaign_id)
            VALUES (NEW.campaign_id)
            ON CONFLICT (campaign_id) DO NOTHING
            RETURNING id INTO v_creative_id;

            IF v_creative_id IS NULL THEN
                SELECT id INTO v_creative_id
                FROM public.campaign_creatives WHERE campaign_id = NEW.campaign_id;
            END IF;
        END IF;

        NEW.creative_id := v_creative_id;
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ad_serve_log_set_creative ON public.ad_serve_log;
CREATE TRIGGER ad_serve_log_set_creative
    BEFORE INSERT ON public.ad_serve_log
    FOR EACH ROW EXECUTE FUNCTION public.tg_ad_serve_log_set_creative();


-- ---------------------------------------------------------------
-- Sessions
--
-- A session is a publisher page load. Deliberately thin: no user
-- agent, no IP, no device fingerprint, no cross-site key. The only
-- identity is the session id the caller already supplied.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_sessions (
    session_id TEXT PRIMARY KEY,
    publisher_id UUID REFERENCES public.publishers(id) ON DELETE SET NULL,
    placement_id UUID REFERENCES public.placements(id) ON DELETE SET NULL,
    sdk_version TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0)
);

COMMENT ON TABLE public.telemetry_sessions IS
    'Publisher page-load session aggregate. No user agent, no IP, no device fingerprint — see the SDK privacy contract.';

CREATE INDEX IF NOT EXISTS telemetry_sessions_last_event_idx
    ON public.telemetry_sessions (last_event_at DESC);


-- ---------------------------------------------------------------
-- Events
--
-- `event_type` is TEXT with a CHECK rather than an ENUM on purpose:
-- widening the catalogue later is then a plain migration that drops
-- and re-adds a constraint, instead of an ALTER TYPE that cannot run
-- inside a transaction with dependent objects.
--
-- `recorded_at` is authoritative. `occurred_at` is what the client
-- says happened and is advisory only — it is never used for ordering,
-- billing or expiry.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.telemetry_events (
    -- Server-minted. A client never chooses an event id.
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN (
        'session_started',
        'page_viewed',
        'section_viewed',
        'cta_clicked',
        'ad_requested',
        'campaign_selected',
        'creative_delivered',
        'ad_rendered',
        'visibility_qualified',
        'impression_qualified',
        'event_validated',
        'reward_created'
    )),
    session_id TEXT NOT NULL,
    -- Client-supplied, scoped to the session. Replaying the same key
    -- for the same session is the same event, by definition.
    idempotency_key TEXT NOT NULL,
    -- The delivery this event belongs to. A foreign key onto the
    -- serve log's UNIQUE request_id, so "this event is about that
    -- delivery" is a database fact rather than a convention.
    delivery_id UUID REFERENCES public.ad_serve_log(request_id) ON DELETE SET NULL,
    -- Self-reference for lifecycle chaining. Set by the server from
    -- the predecessor event it found, never by the caller.
    parent_event_id UUID REFERENCES public.telemetry_events(id) ON DELETE SET NULL,
    -- Monotonic within a session, assigned under a row lock on
    -- telemetry_sessions so concurrent emitters cannot interleave.
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    -- Client-observed time. Advisory.
    occurred_at TIMESTAMPTZ,
    -- Server-observed time. Authoritative.
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Linkage. campaign_id / creative_id / developer_id are resolved
    -- from the serve row whenever delivery_id is present; a body can
    -- never redirect them.
    publisher_id UUID REFERENCES public.publishers(id) ON DELETE SET NULL,
    placement_id UUID REFERENCES public.placements(id) ON DELETE SET NULL,
    campaign_id UUID REFERENCES public.campaigns(id) ON DELETE SET NULL,
    creative_id UUID REFERENCES public.campaign_creatives(id) ON DELETE SET NULL,
    developer_id UUID REFERENCES public.developer_accounts(id) ON DELETE SET NULL,
    sdk_version TEXT,
    interaction_id UUID REFERENCES public.ad_interactions(id) ON DELETE SET NULL,
    reward_id UUID REFERENCES public.reward_ledger(id) ON DELETE SET NULL,
    -- Risk hooks. Populated server-side from observable signals only.
    risk_score SMALLINT NOT NULL DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
    risk_flags TEXT[] NOT NULL DEFAULT '{}',
    validation_state TEXT NOT NULL DEFAULT 'accepted'
        CHECK (validation_state IN ('accepted', 'quarantined', 'rejected')),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT telemetry_events_session_key UNIQUE (session_id, idempotency_key)
);

COMMENT ON TABLE public.telemetry_events IS
    'Append-only telemetry lifecycle. Event ids, delivery linkage and validation state are server-assigned. Never read by an end user: RLS is enabled with zero policies.';

COMMENT ON COLUMN public.telemetry_events.validation_state IS
    'accepted | quarantined | rejected. Quarantine is an analytics signal only — it has no effect on billing, which is decided by the accounting RPCs.';

CREATE INDEX IF NOT EXISTS telemetry_events_session_seq_idx
    ON public.telemetry_events (session_id, sequence);
CREATE INDEX IF NOT EXISTS telemetry_events_delivery_seq_idx
    ON public.telemetry_events (delivery_id, sequence);
CREATE INDEX IF NOT EXISTS telemetry_events_type_recorded_idx
    ON public.telemetry_events (event_type, recorded_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_recorded_idx
    ON public.telemetry_events (recorded_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_events_delivery_interaction_idx
    ON public.telemetry_events (delivery_id, interaction_id);

-- Once per delivery. A second `ad_rendered` for the same serve is a
-- replay even when the client invents a fresh idempotency key, so the
-- partial unique index does the deduplication that a key alone cannot.
--
-- `event_validated` is deliberately absent: one per validated event,
-- so an impression and the click that follows it each get one.
-- `reward_created` is absent for the same reason, and is instead
-- unique per interaction below.
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_events_once_per_delivery_idx
    ON public.telemetry_events (delivery_id, event_type)
    WHERE delivery_id IS NOT NULL
      AND event_type IN (
          'ad_requested',
          'campaign_selected',
          'creative_delivered',
          'ad_rendered',
          'visibility_qualified',
          'impression_qualified'
      );

-- A reward is a single fact about a single interaction. This index is
-- what stops a retried accounting path from minting two reward events
-- for one reward row.
CREATE UNIQUE INDEX IF NOT EXISTS telemetry_events_reward_once_per_interaction_idx
    ON public.telemetry_events (interaction_id)
    WHERE event_type = 'reward_created';


-- ---------------------------------------------------------------
-- Privacy screen
--
-- IMMUTABLE so it can back a CHECK constraint as well as the trigger.
--
-- The key allow-list is the whole story for keys: a name that is not on
-- it has nowhere to go, so there is no need to enumerate every
-- dangerous word. Values are screened separately, because an
-- allow-listed key can still be handed a payload — `ctaId` carrying a
-- pasted command line is the shape of accident this guards against.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telemetry_metadata_is_allowed(p_metadata JSONB) RETURNS BOOLEAN AS $$
DECLARE
    v_key TEXT;
    v_value JSONB;
    v_text TEXT;
    v_count INTEGER;
BEGIN
    IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object' THEN
        RETURN FALSE;
    END IF;

    -- Postgres has json_object_length but no jsonb_object_length, so the
    -- key count comes from counting jsonb_object_keys.
    SELECT count(*) INTO v_count FROM jsonb_object_keys(p_metadata);

    IF v_count > 8 THEN
        RETURN FALSE;
    END IF;

    FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_metadata) LOOP
        IF v_key NOT IN (
            'sectionId', 'ctaId', 'placementKey',
            'visiblePercent', 'dwellMs', 'adSize', 'trigger'
        ) THEN
            RETURN FALSE;
        END IF;

        IF length(v_key) > 40 THEN
            RETURN FALSE;
        END IF;

        CASE jsonb_typeof(v_value)
            WHEN 'number', 'boolean' THEN
                NULL;
            WHEN 'string' THEN
                v_text := v_value #>> '{}';
                IF length(v_text) > 120 THEN
                    RETURN FALSE;
                END IF;
                IF v_text ~* '(pass|secret|token|api[_-]?key|bearer|clipboard|terminal|command|shell|\.ssh|\.env|/etc/|/home/|/root/|/var/|private|mic|camera|capture|keylog|@|mailto:|[0-9]{9,}|(^|[^a-z])(sudo|rm|curl|wget|npx|chmod)([^a-z]|$))' THEN
                    RETURN FALSE;
                END IF;
            ELSE
                -- Arrays, objects and nulls are not accepted: nothing
                -- legitimate needs a structure here, and a structure is
                -- how a payload gets smuggled.
                RETURN FALSE;
        END CASE;
    END LOOP;

    RETURN TRUE;
END $$ LANGUAGE plpgsql IMMUTABLE;

ALTER TABLE public.telemetry_events
    DROP CONSTRAINT IF EXISTS telemetry_events_metadata_is_allowed_chk;
ALTER TABLE public.telemetry_events
    ADD CONSTRAINT telemetry_events_metadata_is_allowed_chk
    CHECK (public.telemetry_metadata_is_allowed(metadata));


-- ---------------------------------------------------------------
-- Server-only event guard
--
-- The internal emitters announce themselves with a transaction-local
-- GUC. PostgREST exposes no way to set one, so a client cannot forge
-- it, and a SECURITY DEFINER function cannot be tricked into setting
-- it on the client's behalf because the emitters are revoked from
-- anon and authenticated.
--
-- This trigger is the second of the three reward gates. Even if
-- `record_telemetry_event` were edited to forward a server-only type,
-- the write still fails here.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_telemetry_events_server_only_guard() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.event_type IN ('event_validated', 'reward_created')
       AND current_setting('clirevenue.telemetry_internal', true) IS DISTINCT FROM '1' THEN
        RAISE EXCEPTION 'SERVER_ONLY_EVENT: % cannot be asserted by a client', NEW.event_type
            USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_events_server_only_guard ON public.telemetry_events;
CREATE TRIGGER telemetry_events_server_only_guard
    BEFORE INSERT ON public.telemetry_events
    FOR EACH ROW EXECUTE FUNCTION public.tg_telemetry_events_server_only_guard();


-- ---------------------------------------------------------------
-- Internal emitter
--
-- The single writer used by every server-side trigger. It resolves all
-- linkage from the serve row, assigns the sequence under a lock,
-- dedupes, and links the parent event when one exists.
--
-- `p_parent_event_type` is best effort on purpose. If the predecessor
-- row is absent — an SDK that rendered without reporting it, a
-- conversion with no qualifying impression — the event is still
-- recorded, unlinked, because a missing telemetry row must never be
-- able to fail an accounting transaction.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.telemetry_emit(
    p_event_type TEXT,
    p_session_id TEXT,
    p_delivery_id UUID,
    p_idempotency_key TEXT,
    p_sdk_version TEXT DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_interaction_id UUID DEFAULT NULL,
    p_reward_id UUID DEFAULT NULL,
    p_parent_event_type TEXT DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_serve public.ad_serve_log%ROWTYPE;
    v_session TEXT := p_session_id;
    v_parent UUID;
    v_event_id UUID;
    v_sequence INTEGER;
    v_risk TEXT[] := '{}';
BEGIN
    PERFORM set_config('clirevenue.telemetry_internal', '1', true);

    IF p_delivery_id IS NOT NULL THEN
        SELECT * INTO v_serve FROM public.ad_serve_log WHERE request_id = p_delivery_id;
        IF NOT FOUND THEN
            RETURN NULL;
        END IF;
        -- The delivery owns the session identity. A caller cannot put an
        -- event about a delivery into a session of its own choosing.
        v_session := COALESCE(v_serve.telemetry_session_id, 'serve:' || v_serve.request_id::text);
    END IF;

    IF NOT public.telemetry_metadata_is_allowed(COALESCE(p_metadata, '{}'::jsonb)) THEN
        RETURN NULL;
    END IF;

    -- Idempotent: an emitter that runs twice for one logical fact
    -- returns the existing id instead of writing a second row.
    SELECT id INTO v_event_id
    FROM public.telemetry_events
    WHERE session_id = v_session AND idempotency_key = p_idempotency_key;

    IF v_event_id IS NOT NULL THEN
        RETURN v_event_id;
    END IF;

    IF p_parent_event_type IS NOT NULL THEN
        SELECT id INTO v_parent
        FROM public.telemetry_events
        WHERE delivery_id = p_delivery_id AND event_type = p_parent_event_type
        ORDER BY sequence ASC
        LIMIT 1;
    END IF;

    IF v_serve.telemetry_session_id IS NULL AND v_serve.publisher_id IS NOT NULL THEN
        v_risk := array_append(v_risk, 'SYNTHETIC_SESSION');
    END IF;

    IF v_serve.request_id IS NOT NULL AND v_serve.expires_at < now() THEN
        v_risk := array_append(v_risk, 'STALE_DELIVERY');
    END IF;

    IF p_sdk_version IS NULL OR length(trim(p_sdk_version)) = 0 THEN
        v_risk := array_append(v_risk, 'NO_SDK_VERSION');
    END IF;

    IF p_occurred_at IS NOT NULL
       AND (p_occurred_at > now() + interval '5 minutes' OR p_occurred_at < now() - interval '1 hour') THEN
        v_risk := array_append(v_risk, 'CLOCK_SKEW');
    END IF;

    -- event_count starts at 1 on the insert, because the increment only
    -- happens on the conflict branch. Forgetting that makes the count
    -- permanently one short for every session.
    INSERT INTO public.telemetry_sessions
        (session_id, publisher_id, placement_id, sdk_version, started_at, last_event_at, event_count)
    VALUES (
        v_session,
        v_serve.publisher_id,
        v_serve.placement_id,
        COALESCE(p_sdk_version, v_serve.sdk_version),
        now(), now(), 1
    )
    ON CONFLICT (session_id) DO UPDATE SET
        last_event_at = now(),
        event_count = public.telemetry_sessions.event_count + 1,
        sdk_version = COALESCE(EXCLUDED.sdk_version, public.telemetry_sessions.sdk_version),
        publisher_id = COALESCE(EXCLUDED.publisher_id, public.telemetry_sessions.publisher_id),
        placement_id = COALESCE(EXCLUDED.placement_id, public.telemetry_sessions.placement_id);

    SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_sequence
    FROM public.telemetry_events WHERE session_id = v_session;

    BEGIN
        INSERT INTO public.telemetry_events (
            event_type, session_id, idempotency_key, delivery_id, parent_event_id,
            sequence, occurred_at, publisher_id, placement_id, campaign_id,
            creative_id, developer_id, sdk_version, interaction_id, reward_id,
            risk_score, risk_flags, validation_state, metadata
        ) VALUES (
            p_event_type,
            v_session,
            p_idempotency_key,
            p_delivery_id,
            v_parent,
            v_sequence,
            p_occurred_at,
            v_serve.publisher_id,
            v_serve.placement_id,
            v_serve.campaign_id,
            v_serve.creative_id,
            v_serve.developer_id,
            COALESCE(p_sdk_version, v_serve.sdk_version),
            p_interaction_id,
            p_reward_id,
            LEAST(100, COALESCE(cardinality(v_risk), 0) * 10),
            v_risk,
            CASE WHEN COALESCE(cardinality(v_risk), 0) * 10 >= 40 THEN 'quarantined' ELSE 'accepted' END,
            COALESCE(p_metadata, '{}'::jsonb)
        )
        RETURNING id INTO v_event_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_event_id
        FROM public.telemetry_events
        WHERE session_id = v_session AND idempotency_key = p_idempotency_key;
    END;

    RETURN v_event_id;
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.telemetry_emit(TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_emit(TEXT, TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, JSONB, UUID, UUID, TEXT) TO service_role;


-- ---------------------------------------------------------------
-- Delivery-chain emission
--
-- The delivery handler in supabase/functions/ads is unchanged: it
-- inserts into ad_serve_log exactly as before. The three events that
-- describe a served ad are emitted here, inside that same
-- transaction, chained by parent_event_id in lifecycle order.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_telemetry_serve_inserted() RETURNS TRIGGER AS $$
DECLARE
    v_session TEXT := COALESCE(NEW.telemetry_session_id, 'serve:' || NEW.request_id::text);
BEGIN
    PERFORM public.telemetry_emit(
        'ad_requested', v_session, NEW.request_id,
        'serve:' || NEW.request_id::text || ':ad_requested',
        NEW.sdk_version, NEW.served_at
    );
    PERFORM public.telemetry_emit(
        'campaign_selected', v_session, NEW.request_id,
        'serve:' || NEW.request_id::text || ':campaign_selected',
        NEW.sdk_version, NEW.served_at,
        p_parent_event_type := 'ad_requested'
    );
    PERFORM public.telemetry_emit(
        'creative_delivered', v_session, NEW.request_id,
        'serve:' || NEW.request_id::text || ':creative_delivered',
        NEW.sdk_version, NEW.served_at,
        p_parent_event_type := 'campaign_selected'
    );
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_serve_inserted ON public.ad_serve_log;
CREATE TRIGGER telemetry_serve_inserted
    AFTER INSERT ON public.ad_serve_log
    FOR EACH ROW EXECUTE FUNCTION public.tg_telemetry_serve_inserted();


-- ---------------------------------------------------------------
-- Impression-chain emission
--
-- Fires on the null -> set transition of impression_recorded_at, so
-- it runs exactly once per serve and only for an impression the
-- server already accepted through record_serve_impression. A replay
-- leaves the column set, so a retry produces nothing.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_telemetry_serve_impression() RETURNS TRIGGER AS $$
BEGIN
    IF OLD.impression_recorded_at IS NULL AND NEW.impression_recorded_at IS NOT NULL THEN
        PERFORM public.telemetry_emit(
            'visibility_qualified',
            COALESCE(NEW.telemetry_session_id, 'serve:' || NEW.request_id::text),
            NEW.request_id,
            'serve:' || NEW.request_id::text || ':visibility_qualified',
            NEW.sdk_version, NEW.impression_recorded_at,
            p_parent_event_type := 'ad_rendered'
        );
        PERFORM public.telemetry_emit(
            'impression_qualified',
            COALESCE(NEW.telemetry_session_id, 'serve:' || NEW.request_id::text),
            NEW.request_id,
            'serve:' || NEW.request_id::text || ':impression_qualified',
            NEW.sdk_version, NEW.impression_recorded_at,
            p_parent_event_type := 'visibility_qualified'
        );
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_serve_impression ON public.ad_serve_log;
CREATE TRIGGER telemetry_serve_impression
    AFTER UPDATE ON public.ad_serve_log
    FOR EACH ROW EXECUTE FUNCTION public.tg_telemetry_serve_impression();


-- ---------------------------------------------------------------
-- Validation emission
--
-- One `event_validated` per interaction the server accepted, linked
-- to the interaction it validated. It is written before the reward
-- row exists, which is the point: the reward trigger that runs next
-- looks for exactly this row.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_telemetry_interaction_inserted() RETURNS TRIGGER AS $$
DECLARE
    v_serve public.ad_serve_log%ROWTYPE;
    v_session TEXT;
BEGIN
    IF NEW.impression_id IS NOT NULL THEN
        SELECT * INTO v_serve
        FROM public.ad_serve_log WHERE impression_id = NEW.impression_id;
    END IF;

    IF NOT FOUND OR v_serve.request_id IS NULL THEN
        -- No delivery resolves. Accounting paths that predate the serve
        -- log still work; they simply have no telemetry lifecycle.
        RETURN NEW;
    END IF;

    v_session := COALESCE(v_serve.telemetry_session_id, 'serve:' || v_serve.request_id::text);

    PERFORM public.telemetry_emit(
        'event_validated',
        v_session,
        v_serve.request_id,
        'serve:' || v_serve.request_id::text || ':validated:' || NEW.id::text,
        v_serve.sdk_version,
        NEW.timestamp,
        p_interaction_id := NEW.id,
        p_parent_event_type := 'impression_qualified'
    );

    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_interaction_inserted ON public.ad_interactions;
CREATE TRIGGER telemetry_interaction_inserted
    AFTER INSERT ON public.ad_interactions
    FOR EACH ROW EXECUTE FUNCTION public.tg_telemetry_interaction_inserted();


-- ---------------------------------------------------------------
-- Reward gate
--
-- Third and last reward gate. Resolves the reward to its delivery; if
-- the delivery exists, an `event_validated` for that interaction must
-- already exist or the transaction fails with REWARD_UNVALIDATED. If
-- the delivery does not exist the trigger returns quietly, so the
-- pre-serve accounting path in the migration and integrity tests keeps
-- minting rewards exactly as before and telemetry can never be the
-- reason an accounting test fails.
--
-- No amount is read, checked or altered here. This trigger only writes
-- a telemetry row.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tg_telemetry_reward_created() RETURNS TRIGGER AS $$
DECLARE
    v_serve public.ad_serve_log%ROWTYPE;
    v_validated UUID;
    v_session TEXT;
BEGIN
    IF NEW.interaction_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT s.* INTO v_serve
    FROM public.ad_interactions i
    JOIN public.ad_serve_log s ON s.impression_id = i.impression_id
    WHERE i.id = NEW.interaction_id
    LIMIT 1;

    IF NOT FOUND OR v_serve.request_id IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT id INTO v_validated
    FROM public.telemetry_events
    WHERE delivery_id = v_serve.request_id
      AND event_type = 'event_validated'
      AND interaction_id = NEW.interaction_id
    LIMIT 1;

    IF v_validated IS NULL THEN
        RAISE EXCEPTION 'REWARD_UNVALIDATED: no validated event for interaction %', NEW.interaction_id
            USING ERRCODE = '22023';
    END IF;

    v_session := COALESCE(v_serve.telemetry_session_id, 'serve:' || v_serve.request_id::text);

    PERFORM public.telemetry_emit(
        'reward_created',
        v_session,
        v_serve.request_id,
        'serve:' || v_serve.request_id::text || ':reward:' || NEW.id::text,
        v_serve.sdk_version,
        NEW.created_at,
        p_interaction_id := NEW.interaction_id,
        p_reward_id := NEW.id,
        p_parent_event_type := 'event_validated'
    );

    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS telemetry_reward_created ON public.reward_ledger;
CREATE TRIGGER telemetry_reward_created
    AFTER INSERT ON public.reward_ledger
    FOR EACH ROW EXECUTE FUNCTION public.tg_telemetry_reward_created();


-- ---------------------------------------------------------------
-- Client entry point
--
-- The only path a publisher client can take into telemetry. It takes no
-- campaign, no creative, no developer, no amount, no risk score, no
-- validation state, no sequence and no event id: everything that could
-- be used to influence billing or attribution is assigned here, from
-- the serve row or from server-side computation.
--
-- Ordering is enforced against rows the server wrote, so an
-- out-of-order client event is rejected rather than silently recorded:
--
--   page_viewed / section_viewed / cta_clicked
--       require a session_started in the same session
--   ad_rendered
--       requires a creative_delivered for the same delivery, which the
--       serve-log trigger wrote before the SDK could possibly render
--
-- Replay is a success, not an error: the SDK retries with the same key
-- after a timeout or a 5xx and needs to be told "already recorded".
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_telemetry_event(
    p_event_type TEXT,
    p_session_id TEXT,
    p_idempotency_key TEXT,
    p_delivery_id UUID DEFAULT NULL,
    p_occurred_at TIMESTAMPTZ DEFAULT NULL,
    p_sdk_version TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_publisher_id UUID DEFAULT NULL,
    p_surface TEXT DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_serve public.ad_serve_log%ROWTYPE;
    v_session TEXT;
    v_existing UUID;
    v_parent UUID;
    v_event_id UUID;
    v_sequence INTEGER;
    v_risk TEXT[] := '{}';
    v_result JSONB;
    v_recent INTEGER;
BEGIN
    -- 1. Only the five client-assertable types may arrive here.
    IF p_event_type NOT IN (
        'session_started', 'page_viewed', 'section_viewed', 'cta_clicked', 'ad_rendered'
    ) THEN
        RAISE EXCEPTION 'SERVER_ONLY_EVENT: % cannot be asserted by a client', p_event_type
            USING ERRCODE = '22023';
    END IF;

    IF p_session_id IS NULL OR length(trim(p_session_id)) = 0
       OR length(p_session_id) > 200 OR p_session_id !~ '^[A-Za-z0-9._:-]+$' THEN
        RAISE EXCEPTION 'INVALID_EVENT: session_id is missing or malformed'
            USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0
       OR length(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'INVALID_EVENT: idempotency_key is missing or too long'
            USING ERRCODE = '22023';
    END IF;

    IF p_surface IS NOT NULL AND (length(p_surface) > 64 OR p_surface !~ '^[A-Za-z0-9._:-]+$') THEN
        RAISE EXCEPTION 'INVALID_EVENT: surface is malformed'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.telemetry_metadata_is_allowed(COALESCE(p_metadata, '{}'::jsonb)) THEN
        RAISE EXCEPTION 'INVALID_METADATA: telemetry metadata is not on the allow-list'
            USING ERRCODE = '22023';
    END IF;

    -- 2. Resolve the delivery. Linkage comes from the serve row only.
    IF p_delivery_id IS NOT NULL THEN
        SELECT * INTO v_serve FROM public.ad_serve_log WHERE request_id = p_delivery_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'SERVE_NOT_FOUND: no delivery for this event'
                USING ERRCODE = 'P0002';
        END IF;
        v_session := COALESCE(v_serve.telemetry_session_id, 'serve:' || v_serve.request_id::text);
    ELSE
        v_session := p_session_id;
    END IF;

    -- 3. Replay is success.
    SELECT id INTO v_existing
    FROM public.telemetry_events
    WHERE session_id = v_session AND idempotency_key = p_idempotency_key;

    IF v_existing IS NOT NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'event_id', v_existing,
            'event_type', p_event_type,
            'sequence', (SELECT sequence FROM public.telemetry_events WHERE id = v_existing),
            'delivery_id', p_delivery_id
        );
    END IF;

    -- 4. Ordering, measured against rows the server already wrote.
    IF p_event_type IN ('page_viewed', 'section_viewed', 'cta_clicked') THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.telemetry_events
            WHERE session_id = v_session AND event_type = 'session_started'
        ) THEN
            RAISE EXCEPTION 'OUT_OF_ORDER: % arrived before session_started', p_event_type
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_event_type = 'ad_rendered' THEN
        SELECT id INTO v_parent
        FROM public.telemetry_events
        WHERE delivery_id = p_delivery_id AND event_type = 'creative_delivered'
        LIMIT 1;

        IF v_parent IS NULL THEN
            RAISE EXCEPTION 'OUT_OF_ORDER: ad_rendered arrived before creative_delivered'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- 5. Rate limiting hook.
    --
    -- The Edge token bucket in _shared/publisherAuth.ts is per-isolate,
    -- so a burst spread across isolates slips past it. This count is
    -- read from the table, so it holds no matter how many isolates are
    -- running. Checked after the replay check so a client retrying its
    -- own event is never rate limited for it.
    SELECT count(*) INTO v_recent
    FROM public.telemetry_events
    WHERE session_id = v_session AND recorded_at > now() - interval '1 minute';

    IF v_recent >= 120 THEN
        RAISE EXCEPTION 'RATE_LIMITED: session % exceeded 120 events per minute', v_session
            USING ERRCODE = '22023';
    END IF;

    -- 6. Risk scoring, from observable signals only.
    IF p_sdk_version IS NULL OR length(trim(p_sdk_version)) = 0 THEN
        v_risk := array_append(v_risk, 'NO_SDK_VERSION');
    ELSIF p_sdk_version !~ '^[A-Za-z0-9@._+-]{1,40}$' THEN
        v_risk := array_append(v_risk, 'UNRECOGNISED_SDK_VERSION');
    END IF;

    IF p_occurred_at IS NOT NULL
       AND (p_occurred_at > now() + interval '5 minutes' OR p_occurred_at < now() - interval '1 hour') THEN
        v_risk := array_append(v_risk, 'CLOCK_SKEW');
    END IF;

    IF p_delivery_id IS NOT NULL THEN
        IF v_serve.publisher_id IS DISTINCT FROM p_publisher_id THEN
            v_risk := array_append(v_risk, 'PUBLISHER_MISMATCH');
        END IF;
        IF v_serve.expires_at < now() THEN
            v_risk := array_append(v_risk, 'STALE_DELIVERY');
        END IF;
    END IF;

    -- 7. Session row first: taking it gives the sequence a lock, so two
    -- concurrent events cannot claim the same ordinal.
    INSERT INTO public.telemetry_sessions
        (session_id, publisher_id, placement_id, sdk_version, started_at, last_event_at, event_count)
    VALUES (
        v_session,
        COALESCE(v_serve.publisher_id, p_publisher_id),
        v_serve.placement_id,
        p_sdk_version,
        now(), now(), 1
    )
    ON CONFLICT (session_id) DO UPDATE SET
        last_event_at = now(),
        event_count = public.telemetry_sessions.event_count + 1,
        sdk_version = COALESCE(EXCLUDED.sdk_version, public.telemetry_sessions.sdk_version),
        publisher_id = COALESCE(EXCLUDED.publisher_id, public.telemetry_sessions.publisher_id),
        placement_id = COALESCE(EXCLUDED.placement_id, public.telemetry_sessions.placement_id);

    SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_sequence
    FROM public.telemetry_events WHERE session_id = v_session;

    BEGIN
        INSERT INTO public.telemetry_events (
            event_type, session_id, idempotency_key, delivery_id, parent_event_id,
            sequence, occurred_at, publisher_id, placement_id, campaign_id,
            creative_id, developer_id, sdk_version, risk_score, risk_flags,
            validation_state, metadata
        ) VALUES (
            p_event_type,
            v_session,
            p_idempotency_key,
            p_delivery_id,
            v_parent,
            v_sequence,
            p_occurred_at,
            COALESCE(v_serve.publisher_id, p_publisher_id),
            v_serve.placement_id,
            v_serve.campaign_id,
            v_serve.creative_id,
            v_serve.developer_id,
            p_sdk_version,
            LEAST(100, COALESCE(cardinality(v_risk), 0) * 10),
            v_risk,
            CASE WHEN COALESCE(cardinality(v_risk), 0) * 10 >= 40 THEN 'quarantined' ELSE 'accepted' END,
            COALESCE(p_metadata, '{}'::jsonb)
        )
        RETURNING id INTO v_event_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT id, sequence INTO v_event_id, v_sequence
        FROM public.telemetry_events
        WHERE session_id = v_session AND idempotency_key = p_idempotency_key;

        -- A replay that invented a fresh idempotency key is caught by the
        -- once-per-delivery index instead, so look the existing row up by
        -- delivery and type rather than reporting a null id back to the
        -- caller.
        IF v_event_id IS NULL AND p_delivery_id IS NOT NULL THEN
            SELECT id, sequence INTO v_event_id, v_sequence
            FROM public.telemetry_events
            WHERE delivery_id = p_delivery_id AND event_type = p_event_type
            ORDER BY sequence ASC
            LIMIT 1;
        END IF;

        v_result := jsonb_build_object(
            'ok', true, 'duplicate', true, 'event_id', v_event_id,
            'event_type', p_event_type, 'sequence', v_sequence, 'delivery_id', p_delivery_id
        );
        RETURN v_result;
    END;

    RETURN jsonb_build_object(
        'ok', true,
        'duplicate', false,
        'event_id', v_event_id,
        'event_type', p_event_type,
        'sequence', v_sequence,
        'delivery_id', p_delivery_id,
        'risk_score', LEAST(100, COALESCE(cardinality(v_risk), 0) * 10),
        'risk_flags', to_jsonb(v_risk),
        'validation_state', CASE WHEN COALESCE(cardinality(v_risk), 0) * 10 >= 40 THEN 'quarantined' ELSE 'accepted' END
    );
END $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

COMMENT ON FUNCTION public.record_telemetry_event(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, JSONB, UUID, TEXT) IS
    'Client entry point for the five client-assertable telemetry events. Resolves all campaign/publisher/creative linkage from the serve row; refuses server-only types.';

REVOKE ALL ON FUNCTION public.record_telemetry_event(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, JSONB, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_telemetry_event(TEXT, TEXT, TEXT, UUID, TIMESTAMPTZ, TEXT, JSONB, UUID, TEXT) TO service_role;


-- ---------------------------------------------------------------
-- Row level security
--
-- Two independent layers, matching the pattern established by 000014:
-- RLS enabled with no policies at all, and the table privileges
-- revoked from anon and authenticated outright. Telemetry is not
-- readable by publishers or developers yet — that needs a JWT path
-- distinct from the publishable capability key, and shipping an
-- unauthenticated read of a full event stream would be worse than
-- shipping none.
-- ---------------------------------------------------------------
ALTER TABLE public.telemetry_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_creatives ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.telemetry_sessions FROM anon, authenticated;
REVOKE ALL ON public.telemetry_events FROM anon, authenticated;
REVOKE ALL ON public.campaign_creatives FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telemetry_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.campaign_creatives TO service_role;

REVOKE ALL ON FUNCTION public.telemetry_metadata_is_allowed(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.telemetry_metadata_is_allowed(JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.tg_telemetry_events_server_only_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_telemetry_serve_inserted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_telemetry_serve_impression() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_telemetry_interaction_inserted() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_telemetry_reward_created() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_ad_serve_log_set_creative() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_campaign_creative_mint() FROM PUBLIC, anon, authenticated;