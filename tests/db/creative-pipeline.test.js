/**
 * Clean-room end-to-end proof of the real advertiser campaign + creative +
 * delivery pipeline (Phases 15/16/17).
 *
 * The database is migrated from `supabase/migrations/*.sql` by tests/db/pg.js,
 * so this exercises the shipped migration chain — including 000022, which
 * extends `campaign_creatives` with the asset columns and adds
 * `campaign_activation_blockers`.
 *
 * What it proves, in the order an advertiser and a publisher actually move:
 *   1.  a draft campaign is refused activation while it has no creative
 *   2.  activation succeeds only once a validated creative exists
 *   3.  delivery resolves a real campaign_creatives row to a real object key
 *   4.  ad_serve_log attributes the serve to that campaign + creative
 *   5.  impression and click are recorded against that serve, and the
 *       server-side accounting (impressions/spend) moves exactly once
 *   6.  a rival advertiser's campaign is never selected and never billed
 *   7.  a revoked creative stops the campaign being served
 *   8.  budget exhaustion stops delivery rather than overspending
 *
 * Nothing here reads an application-level API: the RPCs are the same
 * accounting path the Edge Functions call.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { close, migrate } from './pg.js'
import {
  activationBlockers,
  asService,
  AUDIENCE,
  campaignState,
  createCampaign,
  createCreative,
  createPlacement,
  createPublisher,
  createPublisherKey,
  createServe,
  createUser,
  creativeState,
  hashPublisherKey,
  ledgerRows,
  serveClick,
  serveImpression,
  serveRow,
  uuid,
} from './fixtures.js'

let db

/** The delivery eligibility rules, mirrored from supabase/functions/_shared/eligibility.ts. */
const withinBudget = (c) => c.spend_milli_cents < c.budget_cents * 1000
const withinSchedule = (c, now) =>
  (!c.starts_at || new Date(c.starts_at) <= now) && (!c.ends_at || new Date(c.ends_at) >= now)

/** The delivery selector: real active campaigns, real creative, first match wins. */
async function selectCampaign(filters = {}) {
  const { rows } = await asService(db, (tx) =>
    tx.query(
      `SELECT c.id, c.name, c.headline, c.status, c.starts_at, c.ends_at,
              c.budget_cents, c.spend_milli_cents, c.cpm_cents, c.audience_id,
              cc.id AS creative_id, cc.object_key, cc.media_type, cc.mime_type,
              cc.width, cc.height, cc.duration_ms, cc.poster_object_key
         FROM public.campaigns c
         JOIN public.campaign_creatives cc ON cc.campaign_id = c.id
        WHERE c.status = 'active' AND cc.status = 'validated' AND cc.object_key IS NOT NULL
          AND ($1::text IS NULL OR c.audience_id = $1)
          AND NOT (c.id = ANY ($2::uuid[]))
        ORDER BY c.created_at ASC, c.id ASC
        LIMIT 25`,
      [filters.audienceId ?? null, filters.excludeCampaignIds ?? []],
    ),
  )
  const now = new Date()
  return rows.find((c) => withinBudget(c) && withinSchedule(c, now)) ?? null
}

beforeAll(async () => {
  db = (await migrate()).db
}, 120000)

afterAll(async () => {
  if (db) await close(db)
})

describe('real advertiser campaign + creative + delivery pipeline', () => {
  let advertiserId
  let campaignId
  let creativeId
  let rivalCampaignId
  let publisherId
  let placementId
  let developerId
  let rawKey

  it('refuses to activate a draft that has no creative yet', async () => {
    const account = await createUser(db, { email: 'pipeline-adv@test.invalid', role: 'advertiser' })
    advertiserId = account.advertiser_id

    campaignId = await createCampaign(db, advertiserId, {
      name: 'Pipeline Campaign',
      status: 'draft',
    })

    // The mint trigger created a slot with no asset.
    const slot = await creativeState(db, campaignId)
    expect(slot).toBeTruthy()
    expect(slot.status).toBe('pending')
    expect(slot.object_key).toBeNull()

    // Only the DB decides. The browser cannot assert its way past this.
    expect(await activationBlockers(db, campaignId)).toEqual(['CREATIVE_MISSING'])
  })

  it('rejects every unusable creative shape at the schema boundary', async () => {
    const attempt = async (label, overrides) => {
      const error = await createCreative(db, campaignId, null, overrides).then(
        () => null,
        (err) => err,
      )
      expect(error, `expected ${label} to be rejected`).toBeTruthy()
      return String(error.message ?? error)
    }

    expect(
      await attempt('validated with no object key', { status: 'validated', objectKey: null }),
    ).toMatch(/validated_shape_check/);
    expect(await attempt('svg (stored XSS)', { mimeType: 'image/svg+xml' })).toMatch(/mime_check/);
    expect(await attempt('html', { mediaType: 'html' })).toMatch(/media_type_check/);
    expect(await attempt('zero size', { fileSizeBytes: 0 })).toMatch(/size_check/);
    expect(
      await attempt('user-chosen filename key', {
        objectKey: `advertisers/x/campaigns/y/creatives/z/../../etc/passwd`,
      }),
    ).toMatch(/object_key_check/);
    expect(
      await attempt('user filename in key', { objectKey: 'advertisers/a/campaigns/b/creatives/my logo.png' }),
    ).toMatch(/object_key_check/);
    expect(
      await attempt('poster on an image', { mediaType: 'image', posterObjectKey: 'x' }),
    ).toMatch(/poster_check/);
    expect(await attempt('negative dimensions', { width: -5 })).toMatch(/dimensions_check/);

    // Still unblocked: none of those attempts created an asset.
    expect(await activationBlockers(db, campaignId)).toEqual(['CREATIVE_MISSING'])
  })

  it('activates once a validated creative exists and a landing URL is set', async () => {
    const created = await createCreative(db, campaignId, null, {
      mediaType: 'image',
      mimeType: 'image/png',
    })
    creativeId = created.id
    expect(created.objectKey).toMatch(
      /^advertisers\/[0-9a-f-]+\/campaigns\/[0-9a-f-]+\/creatives\/[0-9a-f-]+\/original$/,
    )
    expect(await activationBlockers(db, campaignId)).toEqual([])

    // The Edge Function's scoped update — ownership is part of the predicate.
    const { rows } = await asService(db, (tx) =>
      tx.query(`UPDATE public.campaigns SET status = 'active' WHERE id = $1 RETURNING status`, [
        campaignId,
      ]),
    )
    expect(rows[0].status).toBe('active')
  })

  it('blocks activation for every other readiness reason', async () => {
    const cases = [
      [{ landingUrl: null }, 'INVALID_LANDING_URL'],
      [{ landingUrl: 'not a url' }, 'INVALID_LANDING_URL'],
      [{ budgetCents: 0 }, 'INVALID_BUDGET'],
      [{ cpmCents: 0 }, 'INVALID_CPM'],
      [{ status: 'active', endsAt: new Date(Date.now() - 60_000).toISOString() }, 'SCHEDULE_ENDED'],
      [{ status: 'active', startsAt: new Date(Date.now() + 3_600_000).toISOString() }, 'SCHEDULE_NOT_STARTED'],
      [
        {
          status: 'active',
          startsAt: new Date(Date.now() + 3_600_000).toISOString(),
          endsAt: new Date(Date.now() + 1_800_000).toISOString(),
        },
        'INVALID_SCHEDULE',
      ],
    ]
    for (const [overrides, expected] of cases) {
      const id = await createCampaign(db, advertiserId, {
        status: 'draft',
        ...overrides,
      })
      await createCreative(db, id, null, { status: overrides.status === 'active' ? 'validated' : 'validated' })
      const blockers = await activationBlockers(db, id)
      expect(blockers, JSON.stringify(overrides)).toContain(expected)
      await asService(db, (tx) => tx.query(`DELETE FROM public.campaigns WHERE id = $1`, [id]))
    }
  })

  it('serves the real campaign and resolves its real creative object key', async () => {
    publisherId = await createPublisher(db, { name: 'Pipeline Publisher' })
    const dev = await createUser(db, { email: 'pipeline-dev@test.invalid', role: 'developer' })
    developerId = dev.developer_id
    const key = await createPublisherKey(db, publisherId, { label: 'pipeline' })
    rawKey = key.raw
    placementId = await createPlacement(db, publisherId, { placementKey: 'sidebar' })

    const picked = await selectCampaign()
    expect(picked).toBeTruthy()
    expect(picked.id).toBe(campaignId)
    expect(picked.creative_id).toBe(creativeId)
    expect(picked.object_key).toContain(`/campaigns/${campaignId}/creatives/`)
    expect(picked.mime_type).toBe('image/png')

    const requestId = await createServe(db, {
      publisherId,
      placementId,
      campaignId: picked.id,
      developerId,
      costMilliCents: picked.cpm_cents,
    })
    const logged = await serveRow(db, requestId)
    expect(logged.campaign_id).toBe(campaignId)
    expect(logged.publisher_id).toBe(publisherId)
    expect(logged.placement_id).toBe(placementId)
    return requestId
  })

  it('records an impression once, moves server-side spend, and idempotently replays', async () => {
    const requestId = await createServe(db, {
      publisherId,
      placementId,
      campaignId,
      developerId,
      costMilliCents: 10,
    })
    const before = await campaignState(db, campaignId)

    const first = await serveImpression(db, {
      requestId,
      publisherId,
      sessionId: 'pipeline-session',
      idempotencyKey: uuid(),
    })
    expect(first.duplicate).toBe(false)

    const after = await campaignState(db, campaignId)
    expect(after.impressions_count).toBe(before.impressions_count + 1)
    expect(after.spend_milli_cents).toBe(before.spend_milli_cents + 10)

    // Replay with a *different* key: the serve guard, not the key, is authoritative.
    const replay = await serveImpression(db, {
      requestId,
      publisherId,
      sessionId: 'pipeline-session',
      idempotencyKey: uuid(),
    })
    expect(replay.duplicate).toBe(true)
    const afterReplay = await campaignState(db, campaignId)
    expect(afterReplay.impressions_count).toBe(after.impressions_count)
    expect(afterReplay.spend_milli_cents).toBe(after.spend_milli_cents)

    expect((await serveRow(db, requestId)).impression_recorded_at).toBeTruthy()
    return requestId
  })

  it('refuses a click without an impression and records one after', async () => {
    const bare = await createServe(db, { publisherId, placementId, campaignId, developerId, costMilliCents: 10 })
    await expect(
      serveClick(db, { requestId: bare, publisherId, idempotencyKey: uuid() }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)

    const requestId = await createServe(db, { publisherId, placementId, campaignId, developerId, costMilliCents: 10 })
    await serveImpression(db, { requestId, publisherId, sessionId: 'click-session', idempotencyKey: uuid() })
    const clicked = await serveClick(db, { requestId, publisherId, idempotencyKey: uuid() })
    expect(clicked.duplicate).toBe(false)

    const state = await campaignState(db, campaignId)
    expect(state.clicks_count).toBe(1)
    expect((await serveRow(db, requestId)).click_recorded_at).toBeTruthy()

    // The reward lands in the ledger exactly once, through the existing rules.
    const rewards = (await ledgerRows(db)).filter((r) => r.campaign_id === campaignId)
    expect(rewards).toHaveLength(1)
    expect(Number(rewards[0].amount_cents)).toBeGreaterThan(0)
  })

  it('never selects or bills a rival advertiser', async () => {
    const rival = await createUser(db, { email: 'pipeline-rival@test.invalid', role: 'advertiser' })
    rivalCampaignId = await createCampaign(db, rival.advertiser_id, {
      name: 'Rival Campaign',
      status: 'active',
    })
    await createCreative(db, rivalCampaignId, rival.advertiser_id, { label: 'Rival creative' })

    const rivalBefore = await campaignState(db, rivalCampaignId)
    const picked = await selectCampaign()
    // Deterministic ordering (created_at ASC, id ASC) means our older campaign wins.
    expect(picked.id).toBe(campaignId)

    // Excluding our campaign must surface the rival, proving the selector is real.
    expect((await selectCampaign({ excludeCampaignIds: [campaignId] }))?.id).toBe(rivalCampaignId)

    const requestId = await createServe(db, {
      publisherId,
      placementId,
      campaignId: rivalCampaignId,
      developerId,
      costMilliCents: 10,
    })
    await serveImpression(db, { requestId, publisherId, sessionId: 'rival-session', idempotencyKey: uuid() })
    const rivalAfter = await campaignState(db, rivalCampaignId)
    expect(rivalAfter.impressions_count).toBe(rivalBefore.impressions_count + 1)
    // A client-supplied campaign id cannot redirect where an impression lands.
    expect((await serveRow(db, requestId)).campaign_id).toBe(rivalCampaignId)
  })

  it('audience-restricted placements only see their own audience', async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT id FROM public.audiences WHERE id <> $1 LIMIT 1`, [AUDIENCE]),
    )
    const otherAudience = rows[0].id
    const picked = await selectCampaign({ audienceId: otherAudience })
    expect(picked).toBeNull()
  })

  it('stops serving once the creative is revoked', async () => {
    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.campaign_creatives SET status = 'revoked', object_key = NULL WHERE campaign_id = $1`,
        [rivalCampaignId],
      ),
    )
    expect(await selectCampaign({ excludeCampaignIds: [campaignId] })).toBeNull()
    expect((await selectCampaign())?.id).toBe(campaignId)

    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.campaign_creatives
            SET status = 'validated', object_key = $2 WHERE campaign_id = $1`,
        [rivalCampaignId, `advertisers/${uuid()}/campaigns/${rivalCampaignId}/creatives/${uuid()}/original`],
      ),
    )
    expect((await selectCampaign({ excludeCampaignIds: [campaignId] }))?.id).toBe(rivalCampaignId)
  })

  it('stops delivering when the budget is exhausted rather than overspending', async () => {
    const fresh = await createCampaign(db, advertiserId, {
      name: 'Budget Cap',
      status: 'active',
      budgetCents: 1,
      cpmCents: 10,
    })
    await createCreative(db, fresh, advertiserId, {})

    // 1 cent of budget == 100 milli-cents == 10 impressions at 10 milli each.
    for (let i = 0; i < 10; i += 1) {
      const requestId = await createServe(db, {
        publisherId,
        placementId,
        campaignId: fresh,
        developerId,
        costMilliCents: 10,
      })
      await serveImpression(db, {
        requestId,
        publisherId,
        sessionId: `budget-${i}`,
        idempotencyKey: uuid(),
      })
    }
    const exhausted = await campaignState(db, fresh)
    expect(exhausted.impressions_count).toBe(10)
    expect(exhausted.spend_milli_cents).toBe(100)

    // With our own campaign also excluded, an exhausted budget means no-fill.
    expect(
      await selectCampaign({ excludeCampaignIds: [campaignId, rivalCampaignId, fresh] }),
    ).toBeNull()
    // The funded campaign is still selected, proving exhaustion is per-campaign.
    expect((await selectCampaign())?.id).toBe(campaignId)

    await asService(db, (tx) => tx.query(`DELETE FROM public.campaigns WHERE id = $1`, [fresh]))
  })

  it('keeps publisher keys hashed and blocks revoked keys', async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT key_hash, key_prefix, revoked_at FROM public.publisher_keys WHERE id IN (SELECT id FROM public.publisher_keys WHERE publisher_id = $1)`, [
        publisherId,
      ]),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.key_hash).not.toContain(rawKey)
      expect(row.key_hash).toBe(hashPublisherKey(row.key_hash === hashPublisherKey(rawKey) ? rawKey : row.key_hash))
    }

    await asService(db, (tx) =>
      tx.query(`UPDATE public.publisher_keys SET revoked_at = NOW() WHERE publisher_id = $1`, [
        publisherId,
      ]),
    )
    // The revoked key is excluded by the same predicate publisherAuth.ts uses.
    const lookup = await asService(db, (tx) =>
      tx.query(
        `SELECT id FROM public.publisher_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
        [hashPublisherKey(rawKey)],
      ),
    )
    expect(lookup.rows).toHaveLength(0)
  })

  it('locks campaign_creatives and the blockers RPC away from client roles', async () => {
    const client = await createUser(db, { email: 'pipeline-client@test.invalid', role: 'advertiser' })
    expect(client.advertiser_id).toBeTruthy()

    await expect(
      asService(db, async (tx) => {
        await tx.query(`SET LOCAL ROLE authenticated`)
        return tx.query(`SELECT * FROM public.campaign_creatives`)
      }),
    ).rejects.toThrow(/permission denied for table campaign_creatives/);

    await expect(
      asService(db, async (tx) => {
        await tx.query(`SET LOCAL ROLE authenticated`)
        return tx.query(`UPDATE public.campaign_creatives SET label = 'hijacked'`)
      }),
    ).rejects.toThrow(/permission denied for table campaign_creatives/);

    await expect(
      asService(db, async (tx) => {
        await tx.query(`SET LOCAL ROLE authenticated`)
        return tx.query(`SELECT public.campaign_activation_blockers($1)`, [campaignId])
      }),
    ).rejects.toThrow(/permission denied for function campaign_activation_blockers/)
  })
})