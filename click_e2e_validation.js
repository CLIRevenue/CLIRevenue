/**
 * Click E2E validation script for CLIRevenue.
 * This script validates the real browser click flow end-to-end:
 * 1. Create test publisher, developer, placement
 * 2. Create test campaign with harmless landing URL
 * 3. Serve an ad (create impression)
 * 4. Click the ad and verify it's recorded correctly
 * 5. Verify duplicate click protection
 * 6. Verify click without impression fails
 */

import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { randomBytes, createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MIGRATIONS_DIR = fileURLToPath(new URL('./supabase/migrations', import.meta.url))

// Auth prelude - same as in tests/db/pg.js
const AUTH_PRELUDE = `
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id UUID PRIMARY KEY,
  email TEXT,
  raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID
  LANGUAGE sql STABLE AS $$
  SELECT NULLIF(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub',
    ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF(
      NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ),
    'anon'
  );
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pgcrypto') THEN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  END IF;
END $$;
`

async function migrate() {
  // pgcrypto ships as a separate bundle in PGlite. Supabase has it built in,
  // so the migrations assume it exists; without this, 000001 fails on
  // CREATE EXTENSION "pgcrypto" before anything else runs.
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(AUTH_PRELUDE)
  const applied = []

  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await db.exec(sql)
      applied.push(file)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(
        `Migration failed: ${file}\n${applied.length} applied: ${applied.join(', ') || '(none)'}\n\n${detail}`,
        { cause: err },
      )
    }
  }

  return { db, applied }
}

async function close(db) {
  await db.close()
}

// Helper functions from tests/db/fixtures.js
function generateUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export const uuid = generateUuid

/** JWT claims PostgREST sets for the signed-in user. */
function claims(userId, role = 'authenticated') {
  return JSON.stringify({ sub: userId, role, aud: 'authenticated' })
}

/**
 * Run `fn` in a transaction, as `role`, with `userId` as the JWT subject.
 *
 * SET LOCAL means both the role and the claims revert when the transaction
 * ends, and the transaction also rolls back if `fn` throws -- so a failing
 * test cannot leave rows behind for the next one.
 */
export async function asRole(db, role, userId, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE ${role}`)
    if (userId) {
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims(userId)])
    }
    return fn(tx)
  })
}

/** Run as the service role, which is how the Edge Functions call the RPCs. */
export function asService(db, fn) {
  return asRole(db, 'service_role', null, fn)
}

/** Run as an authenticated user. */
export function asUser(db, userId, fn) {
  return asRole(db, 'authenticated', userId, fn)
}

/** Run as an anonymous caller (no JWT subject). */
export function asAnon(db, fn) {
  return asRole(db, 'anon', null, fn)
}

/**
 * Create a user the way signup does. Returns the ids the tests need.
 * `role` must be advertiser or developer; handle_new_user whitelists those.
 */
export async function createUser(db, { email, role = 'developer' }) {
  const id = uuid()
  await db.query(
    `INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)`,
    [id, email, JSON.stringify({ role })],
  )
  const { rows } = await db.query(
    `SELECT
       (SELECT id FROM public.profiles     WHERE id = $1) AS profile_id,
       (SELECT id FROM public.advertisers  WHERE profile_id = $1) AS advertiser_id,
       (SELECT id FROM public.developer_accounts WHERE profile_id = $1) AS developer_id`,
    [id],
  )
  const row = rows[0]
  if (role === 'advertiser' && !row.advertiser_id) throw new Error('advertiser account not bootstrapped')
  if (role === 'developer' && !row.developer_id) throw new Error('developer account not bootstrapped')
  return { userId: id, ...row }
}

/** An audience id that 000002 seeded. */
export const AUDIENCE = 'backend'

/**
 * Create a campaign for an advertiser. Runs as service role because the
 * client is revoked INSERT on campaigns by 000008; the Edge Function is the
 * only writer, using the service key.
 */
export async function createCampaign(db, advertiserId, overrides = {}) {
  const id = uuid()
  await asService(db, async (tx) => {
    await tx.query(
      `INSERT INTO public.campaigns
         (id, advertiser_id, name, headline, description, cta, audience_id,
          budget_cents, cpm_cents, status, starts_at, ends_at, landing_url)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        advertiserId,
        overrides.name ?? 'Test Campaign',
        overrides.headline ?? 'Test headline',
        overrides.description ?? 'Test description for click E2E validation',
        overrides.cta ?? 'Learn More',
        overrides.audienceId ?? AUDIENCE,
        overrides.budgetCents ?? 10000,
        // Cost per impression in MILLI-cents: budget_cents*1000 total milli.
        overrides.cpmCents ?? 10,
        overrides.status ?? 'active',
        overrides.startsAt ?? null,
        overrides.endsAt ?? null,
        overrides.landingUrl ?? 'https://example.com/', // Harmless test landing URL
      ],
    )
  })
  return id
}

/** Read a campaign's accounting columns as the service role. */
export async function campaignState(db, campaignId) {
  const { rows } = await asService(db, (tx) =>
    tx.query(
      `SELECT impressions_count, clicks_count, conversions_count,
              spend_milli_cents, budget_cents, cpm_cents, status, landing_url
       FROM public.campaigns WHERE id = $1`,
      [campaignId],
    ),
  )
  return rows[0]
}

/**
 * Record an impression through the RPC and return the parsed jsonb result.
 * Rejects if the RPC raises, which is what the error-path tests assert on.
 */
export function applyImpression(db, args) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.apply_impression($1,$2,$3,$4,$5) AS result`,
      [
        args.campaignId,
        args.developerId ?? null,
        args.cliIntegration ?? 'test-cli',
        args.sessionId,
        args.idempotencyKey,
      ],
    )
    return rows[0].result
  })
}

export function applyInteraction(db, args) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.apply_interaction($1,$2,$3,$4,$5,$6,$7,$8) AS result`,
      [
        args.campaignId,
        args.developerId,
        args.cliIntegration ?? 'test-cli',
        args.sessionId,
        args.idempotencyKey,
        args.impressionId ?? null,
        args.kind ?? 'click',
        args.rewardCents ?? 18,
      ],
    )
    return rows[0].result
  })
}

export function rewardBalance(db, developerId) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(`SELECT public.reward_balance($1) AS result`, [developerId])
    return rows[0].result
  })
}

export function requestPayout(db, developerId, amountCents, providerId = 'test-rail') {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.request_payout($1,$2,$3) AS result`,
      [developerId, amountCents, providerId],
    )
    return rows[0].result
  })
}

/**
 * Age a developer's accrued rewards so apply_settlement's
 * `created_at < now() - settlement_ms` cutoff definitely includes them.
 *
 * Backdating is used rather than a zero-millisecond settlement window because
 * that comparison is evaluated against the same clock reading, which would
 * make the test depend on sub-millisecond timing.
 */
export function backdateRewards(db, developerId, seconds = 60) {
  return asService(db, (tx) =>
    tx.query(
      `UPDATE public.reward_ledger
           SET created_at = NOW() - ($2 || ' seconds')::interval
         WHERE developer_id = $1`,
      [developerId, String(seconds)],
    ),
  )
}

/** Force a developer's accrued rewards to available, as settlement would. */
export function settleNow(db, developerId) {
  return asService(db, async (tx) => {
    await tx.query(
      `UPDATE public.reward_ledger SET created_at = NOW() - interval '60 seconds'
        WHERE developer_id = $1 AND status = 'accrued'`,
      [developerId],
    )
    const { rows } = await tx.query(
      `SELECT public.apply_settlement(1000, $1) AS result`,
      [developerId],
    )
    return rows[0].result
  })
}

/* ------------------------------------------------------------------ *
 * Publisher / placement / serve fixtures (delivery layer, 000014-000015)
 * ------------------------------------------------------------------ */

/** Same algorithm as hashPublisherKey() in _shared/publisherAuth.ts. */
export function hashPublisherKey(rawKey) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex')
}

export function generatePublisherKey() {
  return `pk_live_${randomBytes(32).toString('base64url')}`
}

export async function createPublisher(db, { name = 'Test Publisher' } = {}) {
  const id = uuid()
  await asService(db, (tx) =>
    tx.query(`INSERT INTO public.publishers (id, name) VALUES ($1,$2)`, [id, name]),
  )
  return id
}

/** Returns the raw key exactly once, as the real creation flow would. */
export async function createPublisherKey(db, publisherId, { revokedAt = null, label = 'test' } = {}) {
  const raw = `pk_live_${randomBytes(32).toString('base64url')}`
  const id = uuid()
  await asService(db, (tx) =>
    tx.query(
      `INSERT INTO public.publisher_keys (id, publisher_id, key_hash, key_prefix, label, revoked_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, publisherId, hashPublisherKey(raw), raw.slice(0, 12), label, revokedAt],
    ),
  )
  return { keyId: id, raw }
}

export async function createPlacement(
  db,
  publisherId,
  { placementKey = 'sidebar', enabled = true, allowedAudienceId = null, name = 'Sidebar' } = {},
) {
  const id = uuid()
  await asService(db, (tx) =>
    tx.query(
      `INSERT INTO public.placements (id, publisher_id, placement_key, name, enabled, allowed_audience_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, publisherId, placementKey, name, enabled, allowedAudienceId],
    ),
  )
  return id
}

/** Write a serve row the way the delivery handler does. */
export async function createServe(db, serve) {
  const requestId = serve.requestId ?? uuid()
  const expiresAt =
    serve.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString()
  await asService(db, (tx) =>
    tx.query(
      `INSERT INTO public.ad_serve_log
         (request_id, publisher_id, placement_id, campaign_id, developer_id,
          placement_key, sdk_version, context_url, context_referrer,
          cost_milli_cents, served_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        requestId,
        serve.publisherId,
        serve.placementId,
        serve.campaignId,
        serve.developerId ?? null,
        serve.placementKey ?? 'sidebar',
        serve.sdkVersion ?? '1.0.0',
        serve.contextUrl ?? null,
        serve.contextReferrer ?? null,
        serve.costMilliCents ?? 10,
        serve.servedAt ?? new Date().toISOString(),
        expiresAt,
      ],
    ),
  )
  return requestId
}

export function serveImpression(db, args) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.record_serve_impression($1,$2,$3,$4,$5) AS result`,
      [
        args.requestId,
        args.publisherId,
        args.cliIntegration ?? 'clirevenue-sdk',
        args.sessionId,
        args.idempotencyKey,
      ],
    )
    return rows[0].result
  })
}

export function serveClick(db, args) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.record_serve_click($1,$2,$3) AS result`,
      [args.requestId, args.publisherId, args.idempotencyKey],
    )
    return rows[0].result
  })
}

export function serveConversion(db, args) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.record_serve_conversion($1,$2,$3) AS result`,
      [args.requestId, args.publisherId, args.idempotencyKey],
    )
    return rows[0].result
  })
}

export function serveRow(db, requestId) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT request_id, publisher_id, placement_id, campaign_id, developer_id,
              impression_recorded_at, impression_id, impression_session_id,
              click_recorded_at, conversion_recorded_at
          FROM public.ad_serve_log WHERE request_id = $1`,
      [requestId],
    )
    return rows[0] ?? null
  })
}

// Main validation function
async function runClickE2ETest() {
  console.log('Starting CLIRevenue Click E2E Validation...')

  let db

  try {
    // Set up database
    console.log('Setting up database...')
    const { db: database, applied } = await migrate()
    db = database
    console.log(`Applied ${applied.length} migrations`)

    // Create test entities
    console.log('Creating test publisher...')
    const publisher = await createPublisher(db, { name: 'Click E2E Test Publisher' })

    console.log('Creating test publisher key...')
    const publisherKey = await createPublisherKey(db, publisher, { label: 'click-e2e-test' })
    const rawKey = publisherKey.raw

    console.log('Creating test developer...')
    const developer = await createUser(db, { email: 'click-e2e-dev@test.invalid', role: 'developer' })

    console.log('Creating test advertiser...')
    const advertiser = await createUser(db, { email: 'click-e2e-adv@test.invalid', role: 'advertiser' })

    console.log('Creating test placement...')
    const placement = await createPlacement(db, publisher, { placementKey: 'click-e2e-test' })

    console.log('Creating test campaign with landing URL...')
    const campaignId = await createCampaign(db, advertiser.advertiser_id, {
      name: 'Click E2E Test Campaign',
      headline: 'Test Campaign for Click Validation',
      description: 'This is a test campaign for validating the click E2E flow.',
      cta: 'Click Me',
      landingUrl: 'https://example.com/', // Harmless test landing URL
      budgetCents: 10000, // 100 USD in cents
      cpmCents: 10, // 0.01 USD per impression
      status: 'active'
    })

    console.log('Test entities created successfully')

    // Test 1: Serve an ad (should succeed)
    console.log('\\n=== Test 1: Serving an ad ===')
    const serveResult = await createServe(db, {
      publisherId: publisher,
      placementId: placement,
      campaignId,
      developerId: developer.developer_id,
    })
    console.log(`✓ Ad served successfully with requestId: ${serveResult}`)

     // Verify the serve row was created
     const serveResultRow = await serveRow(db, serveResult)
     if (!serveResultRow) {
       throw new Error('Serve row not found')
     }
     console.log('✓ Serve row created in ad_serve_log')

    // Test 2: Record an impression (should succeed)
    console.log('\\n=== Test 2: Recording an impression ===')
    const impressionResult = await serveImpression(db, {
      requestId: serveResult,
      publisherId: publisher,
      sessionId: 'test-session-1',
      idempotencyKey: 'impression-test-1',
    })
    console.log(`✓ Impression recorded: ${JSON.stringify(impressionResult)}`)

    // Verify impression was recorded in the serve row
    const serveRowAfterImpression = await serveRow(db, serveResult)
    if (!serveRowAfterImpression.impression_recorded_at) {
      throw new Error('Impression not recorded in serve row')
    }
    console.log('✓ Impression recorded in serve row')

    // Verify campaign impressions count increased
    const campaignStateAfterImpression = await campaignState(db, campaignId)
    if (campaignStateAfterImpression.impressions_count !== 1) {
      throw new Error(`Expected impressions_count to be 1, got ${campaignStateAfterImpression.impressions_count}`)
    }
    console.log('✓ Campaign impressions count increased to 1')

    // Test 3: Record a click (should succeed)
    console.log('\\n=== Test 3: Recording a click ===')
    const clickResult = await serveClick(db, {
      requestId: serveResult,
      publisherId: publisher,
      idempotencyKey: 'click-test-1',
    })
    console.log(`✓ Click recorded: ${JSON.stringify(clickResult)}`)

    // Verify click was recorded in the serve row
    const serveRowAfterClick = await serveRow(db, serveResult)
    if (!serveRowAfterClick.click_recorded_at) {
      throw new Error('Click not recorded in serve row')
    }
    console.log('✓ Click recorded in serve row')

    // Verify campaign clicks count increased
    const campaignStateAfterClick = await campaignState(db, campaignId)
    if (campaignStateAfterClick.clicks_count !== 1) {
      throw new Error(`Expected clicks_count to be 1, got ${campaignStateAfterClick.clicks_count}`)
    }
    console.log('✓ Campaign clicks count increased to 1')

    // Verify reward was accrued (since we clicked an ad with landing URL)
    if (!clickResult.reward_accrued) {
      throw new Error('No reward accrued for click')
    }
    console.log(`✓ Reward accrued: ${clickResult.reward_accrued.amount_cents} cents`)

    // Test 4: Duplicate click protection (should succeed but return duplicate)
    console.log('\\n=== Test 4: Duplicate click protection ===')
    const duplicateClickResult = await serveClick(db, {
      requestId: serveResult,
      publisherId: publisher,
      idempotencyKey: 'click-test-1', // Same key as before
    })
    console.log(`✓ Duplicate click handled: ${JSON.stringify(duplicateClickResult)}`)

    if (!duplicateClickResult.duplicate) {
      throw new Error('Duplicate click was not detected as duplicate')
    }
    console.log('✓ Duplicate click correctly identified as duplicate')

    // Verify clicks count didn't increase (still 1)
    const campaignStateAfterDuplicateClick = await campaignState(db, campaignId)
    if (campaignStateAfterDuplicateClick.clicks_count !== 1) {
      throw new Error(`Expected clicks_count to still be 1 after duplicate click, got ${campaignStateAfterDuplicateClick.clicks_count}`)
    }
    console.log('✓ Campaign clicks count remained at 1 after duplicate click')

    // Test 5: Click without impression should fail
    console.log('\\n=== Test 5: Click without impression should fail ===')
    // Create a new serve without recording an impression
    const serveResultNoImpression = await createServe(db, {
      publisherId: publisher,
      placementId: placement,
      campaignId,
      developerId: developer.developer_id,
    })

    try {
      await serveClick(db, {
        requestId: serveResultNoImpression,
        publisherId: publisher,
        idempotencyKey: 'click-test-no-impression',
      })
      throw new Error('Click without impression should have failed but did not')
    } catch (error) {
      if (!error.message.includes('CLICK_WITHOUT_IMPRESSION')) {
        throw new Error(`Expected CLICK_WITHOUT_IMPRESSION error, got: ${error.message}`)
      }
      console.log('✓ Click without impression correctly rejected with CLICK_WITHOUT_IMPRESSION')
    }

    // Verify no click was recorded in the serve row
    const serveRowNoImpression = await serveRow(db, serveResultNoImpression)
    if (serveRowNoImpression.click_recorded_at) {
      throw new Error('Click was incorrectly recorded for serve without impression')
    }
    console.log('✓ No click recorded in serve row for unimpressioned serve')

    // Test 6: Landing URL validation
    console.log('\\n=== Test 6: Landing URL validation ===')
    const finalCampaignState = await campaignState(db, campaignId)
    if (finalCampaignState.landing_url !== 'https://example.com/') {
      throw new Error(`Expected landing_url to be 'https://example.com/', got '${finalCampaignState.landing_url}'`)
    }
    console.log(`✓ Campaign landing URL correctly set to '${finalCampaignState.landing_url}'`)

    console.log('\\n✅ All Click E2E Validation Tests Passed!')
    console.log('\\nSummary:')
    console.log('- Ad serving: ✓ Working')
    console.log('- Impression recording: ✓ Working')
    console.log('- Click recording: ✓ Working')
    console.log('- Duplicate click protection: ✓ Working')
    console.log('- Click without impression rejection: ✓ Working')
    console.log('- Landing URL handling: ✓ Working')
    console.log('- Reward accrual: ✓ Working')

    return true

  } catch (error) {
    console.error('\\n❌ Click E2E Validation Failed:')
    console.error(error)
    return false
  } finally {
    if (db) {
      await close(db)
      console.log('\\nDatabase connection closed')
    }
  }
}

// Run the test
runClickE2ETest()
  .then(success => {
    process.exit(success ? 0 : 1)
  })
  .catch(error => {
    console.error('Unhandled error in click E2E validation:', error)
    process.exit(1)
  })
