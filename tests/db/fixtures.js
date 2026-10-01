/**
 * Fixtures and role helpers for the accounting tests.
 *
 * Two things make these faithful rather than convenient:
 *
 * 1. Users are created by INSERTing into auth.users, which fires the real
 *    `handle_new_user` trigger. The profile and the advertiser/developer
 *    account are therefore created by the same code path production uses, so
 *    a broken bootstrap shows up here instead of being papered over.
 *
 * 2. Role switching uses SET LOCAL ROLE. PGlite's default role is a
 *    superuser, which BYPASSes RLS, so any test that just queries directly
 *    would be testing nothing. Calling as `authenticated` makes RLS real;
 *    calling the money RPCs as `service_role` matches how PostgREST invokes
 *    them with the service key, and those functions are revoked from
 *    anon/authenticated precisely so only that path can reach them.
 */

export const uuid = () => globalThis.crypto.randomUUID()

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
          budget_cents, cpm_cents, status, starts_at, ends_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        id,
        advertiserId,
        overrides.name ?? 'Test Campaign',
        overrides.headline ?? 'Test headline',
        overrides.description ?? 'desc',
        overrides.cta ?? 'Learn more',
        overrides.audienceId ?? AUDIENCE,
        overrides.budgetCents ?? 10000,
        // Cost per impression in MILLI-cents: budget_cents*1000 total milli.
        overrides.cpmCents ?? 10,
        overrides.status ?? 'active',
        overrides.startsAt ?? null,
        overrides.endsAt ?? null,
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
              spend_milli_cents, budget_cents, cpm_cents, status
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

/** Settle rewards that accrued more than `ageMs` ago. */
export function applySettlement(db, { ageMs = 5000, developerId = null } = {}) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT public.apply_settlement($1,$2) AS result`,
      [ageMs, developerId],
    )
    return rows[0].result
  })
}

export function ledgerRows(db) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT developer_id, campaign_id, interaction_id, amount_cents, remaining_cents, status, payout_id
       FROM public.reward_ledger ORDER BY created_at, id`,
    )
    return rows
  })
}

export function payoutRows(db) {
  return asService(db, async (tx) => {
    const { rows } = await tx.query(
      `SELECT developer_id, amount_cents, status, provider_id
       FROM public.payouts ORDER BY created_at, id`,
    )
    return rows
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

import { createHash, randomBytes } from 'node:crypto'

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
  const raw = generatePublisherKey()
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
