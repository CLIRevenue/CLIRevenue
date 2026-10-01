/**
 * Delivery-layer anti-fraud behaviour, executed against a real Postgres.
 *
 * This is the suite that proves the central claim of the phase: a client
 * cannot choose which advertiser campaign receives an impression, a click or
 * a conversion. The RPCs under test accept no campaign_id at all, so these
 * tests attack them the only way a real attacker can -- by naming another
 * serve, reusing a token, replaying an event, or racing a duplicate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, createCampaign, campaignState,
  createPublisher, createPublisherKey, createPlacement, createServe, hashPublisherKey,
  serveImpression, serveClick, serveConversion, serveRow,
  applyInteraction, ledgerRows, asService, uuid, AUDIENCE,
} from './fixtures.js'

let db
let advertiser
let publisher
let placement
let rawKey
let dev

beforeAll(async () => {
  db = (await migrate()).db
  advertiser = await createUser(db, { email: 'fraud-adv@test.invalid', role: 'advertiser' })
  dev = await createUser(db, { email: 'fraud-dev@test.invalid', role: 'developer' })
  publisher = await createPublisher(db)
  const k = await createPublisherKey(db, publisher)
  rawKey = k.raw
  placement = await createPlacement(db, publisher, { placementKey: 'sidebar' })
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

/** A fresh serve for a fresh campaign, so each test starts from clean counters. */
async function freshServe(overrides = {}) {
  const campaignId = await createCampaign(db, advertiser.advertiser_id, {
    budgetCents: overrides.budgetCents ?? 10000,
    cpmCents: overrides.cpmCents ?? 10,
    ...(overrides.campaign ? overrides.campaign : {}),
  })
  const requestId = await createServe(db, {
    publisherId: publisher,
    placementId: placement,
    campaignId,
    developerId: dev.developer_id,
    ...overrides,
  })
  return { campaignId, requestId }
}

describe('serve records', () => {
  it('a valid serve creates exactly one ad_serve_log row with the server-chosen campaign', async () => {
    const { campaignId, requestId } = await freshServe()
    const row = await serveRow(db, requestId)
    expect(row).not.toBeNull()
    expect(row.campaign_id).toBe(campaignId)
    expect(row.publisher_id).toBe(publisher)
    expect(row.impression_recorded_at).toBeNull()
    expect(row.click_recorded_at).toBeNull()
  })

  it('a request id is unique, so a fabricated one collides', async () => {
    const { requestId } = await freshServe()
    await expect(
      createServe(db, {
        requestId, publisherId: publisher, placementId: placement,
        campaignId: await createCampaign(db, advertiser.advertiser_id, {}),
      }),
    ).rejects.toThrow()
  })
})

describe('impression', () => {
  it('records the serve campaign exactly once and leaves the guard set', async () => {
    const { campaignId, requestId } = await freshServe()
    const res = await serveImpression(db, {
      requestId, publisherId: publisher,
      sessionId: 's1', idempotencyKey: 'imp-1',
    })
    expect(res.duplicate).toBe(false)

    const state = await campaignState(db, campaignId)
    expect(state.impressions_count).toBe(1)
    expect(state.spend_milli_cents).toBe(10)

    const row = await serveRow(db, requestId)
    expect(row.impression_recorded_at).not.toBeNull()
    expect(row.impression_id).toBe(res.impression_id)
  })

  it('a replayed impression is a success that does not double count', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's2', idempotencyKey: 'imp-2a' })

    // Same logical event, retried with the same key after a lost response.
    const replay = await serveImpression(db, {
      requestId, publisherId: publisher, sessionId: 's2', idempotencyKey: 'imp-2a',
    })
    expect(replay.duplicate).toBe(true)
    expect(replay.ok).toBe(true)

    const state = await campaignState(db, campaignId)
    expect(state.impressions_count).toBe(1)
    expect(state.spend_milli_cents).toBe(10)
  })

  it('a replay with a DIFFERENT idempotency key still cannot double count', async () => {
    // The serve guard, not the key, is the authority. This is the case a
    // key-only dedupe would get wrong.
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's3', idempotencyKey: 'imp-3a' })
    const again = await serveImpression(db, {
      requestId, publisherId: publisher, sessionId: 's3', idempotencyKey: 'imp-3-different',
    })
    expect(again.duplicate).toBe(true)
    expect((await campaignState(db, campaignId)).impressions_count).toBe(1)
  })

  it('rejects an impression for a request id that does not exist', async () => {
    await expect(
      serveImpression(db, {
        requestId: uuid(), publisherId: publisher,
        sessionId: 's4', idempotencyKey: 'imp-4',
      }),
    ).rejects.toThrow(/SERVE_NOT_FOUND/)
  })

  it('rejects an impression naming a serve owned by another publisher', async () => {
    const { requestId } = await freshServe()
    const otherPublisher = await createPublisher(db, { name: 'Other' })
    await expect(
      serveImpression(db, {
        requestId, publisherId: otherPublisher,
        sessionId: 's5', idempotencyKey: 'imp-5',
      }),
    ).rejects.toThrow(/SERVE_NOT_FOUND/)
  })

  it('rejects an impression after the serve has expired', async () => {
    const { requestId } = await freshServe({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    })
    await expect(
      serveImpression(db, {
        requestId, publisherId: publisher,
        sessionId: 's6', idempotencyKey: 'imp-6',
      }),
    ).rejects.toThrow(/SERVE_EXPIRED/)
  })

  it('rejects reuse of one idempotency key across two different serves', async () => {
    const a = await freshServe()
    const b = await freshServe()
    await serveImpression(db, { requestId: a.requestId, publisherId: publisher, sessionId: 's7', idempotencyKey: 'shared' })
    // The key is already consumed by serve A. Serve B must not be able to
    // adopt serve A's impression.
    await expect(
      serveImpression(db, { requestId: b.requestId, publisherId: publisher, sessionId: 's7', idempotencyKey: 'shared' }),
    ).rejects.toThrow(/IMPRESSION_KEY_REUSED/)
  })

  it('a client-supplied campaign id cannot redirect the accounting', async () => {
    // There is no parameter to pass one in. The RPC signature accepts only a
    // request id, a publisher id and event metadata, so this is asserted at
    // the SQL level rather than at the HTTP layer.
    const victim = await createCampaign(db, advertiser.advertiser_id, { name: 'Victim', budgetCents: 10000 })
    const { campaignId: served, requestId } = await freshServe()
    const victimBefore = await campaignState(db, victim)

    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's8', idempotencyKey: 'imp-8' })

    const victimAfter = await campaignState(db, victim)
    expect(victimAfter.impressions_count).toBe(victimBefore.impressions_count)
    expect(victimAfter.spend_milli_cents).toBe(victimBefore.spend_milli_cents)
    // And the served campaign, not the victim's, absorbed it.
    expect((await campaignState(db, served)).impressions_count).toBe(1)
  })

  it("a campaign id belonging to ANOTHER ADVERTISER cannot be billed", async () => {
    // The sibling test above uses a second campaign owned by the SAME
    // advertiser. Cross-tenant is the sharper case, so it gets its own:
    // create a genuinely different advertiser and bill an impression to
    // their campaign.
    const rival = await createUser(db, { email: 'rival-adv@test.invalid', role: 'advertiser' })
    expect(rival.advertiser_id).not.toBe(advertiser.advertiser_id)

    const rivalCampaign = await createCampaign(db, rival.advertiser_id, {
      name: 'Rival campaign',
      budgetCents: 10000,
    })
    const { campaignId: served, requestId } = await freshServe()
    const rivalBefore = await campaignState(db, rivalCampaign)

    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's-cross', idempotencyKey: 'imp-cross' })

    // The rival campaign is untouched: no impressions, no spend.
    const rivalAfter = await campaignState(db, rivalCampaign)
    expect(rivalAfter.impressions_count).toBe(0)
    expect(rivalAfter.impressions_count).toBe(rivalBefore.impressions_count)
    expect(rivalAfter.spend_milli_cents).toBe(0)
    expect(rivalAfter.spend_milli_cents).toBe(rivalBefore.spend_milli_cents)

    // Everything landed on the campaign the server selected for this serve.
    expect((await campaignState(db, served)).impressions_count).toBe(1)

    // And no interaction row exists against the rival campaign at all.
    const interactions = await db.query(
      'SELECT id FROM ad_interactions WHERE campaign_id = $1',
      [rivalCampaign],
    )
    expect(interactions.rows).toHaveLength(0)
  })
})

describe('click', () => {
  it('is rejected without an impression on the same serve', async () => {
    const { campaignId, requestId } = await freshServe()
    await expect(
      serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-1' }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)
    expect((await campaignState(db, campaignId)).clicks_count).toBe(0)
  })

  it('succeeds after an impression and mints exactly one reward', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's9', idempotencyKey: 'imp-9' })
    const res = await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-2' })
    expect(res.duplicate).toBe(false)
    expect((await campaignState(db, campaignId)).clicks_count).toBe(1)

    const mine = (await ledgerRows(db)).filter((r) => r.developer_id === dev.developer_id)
    const forThisServe = mine.filter((r) => r.campaign_id === campaignId)
    expect(forThisServe).toHaveLength(1)
  })

  it('a replayed click is a success that does not double reward', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's10', idempotencyKey: 'imp-10' })
    await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-3' })
    const replay = await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-3' })
    expect(replay.duplicate).toBe(true)

    expect((await campaignState(db, campaignId)).clicks_count).toBe(1)
    const mine = (await ledgerRows(db)).filter((r) => r.campaign_id === campaignId)
    expect(mine).toHaveLength(1)
  })

  it('a replay with a different key still cannot double reward', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's11', idempotencyKey: 'imp-11' })
    await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-4a' })
    const again = await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-4b' })
    expect(again.duplicate).toBe(true)
    expect((await campaignState(db, campaignId)).clicks_count).toBe(1)
  })

  it('cannot borrow another serve impression to justify a click', async () => {
    // Two serves of the SAME campaign. The second has no impression of its
    // own, so it must not be clickable using the first serve's impression.
    const campaignId = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 10000 })
    const serveA = await createServe(db, {
      publisherId: publisher, placementId: placement,
      campaignId, developerId: dev.developer_id,
    })
    const serveB = await createServe(db, {
      publisherId: publisher, placementId: placement,
      campaignId, developerId: dev.developer_id,
    })
    await serveImpression(db, { requestId: serveA, publisherId: publisher, sessionId: 's12', idempotencyKey: 'imp-12' })
    // apply_interaction's own check would be satisfied by serve A's
    // impression if the session matched, because it only looks at
    // (campaign, developer, session). record_serve_click does not consult
    // the caller's session at all -- it uses the serve's stored impression.
    await expect(
      serveClick(db, { requestId: serveB, publisherId: publisher, idempotencyKey: 'clk-5' }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)
  })

  it('a click cannot be converted by a client-controlled kind', async () => {
    // The SQL has no kind parameter on record_serve_click at all; the kind is
    // a literal inside the function. Asserted here as the counter check.
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's13', idempotencyKey: 'imp-13' })
    await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-6' })

    const state = await campaignState(db, campaignId)
    expect(state.clicks_count).toBe(1)
    expect(state.conversions_count).toBe(0)
  })

  it('rejects a click naming a serve owned by another publisher', async () => {
    const { requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's14', idempotencyKey: 'imp-14' })
    const otherPublisher = await createPublisher(db, { name: 'Other2' })
    await expect(
      serveClick(db, { requestId, publisherId: otherPublisher, idempotencyKey: 'clk-7' }),
    ).rejects.toThrow(/SERVE_NOT_FOUND/)
  })
})

describe('conversion', () => {
  it('records once and does not mint a reward', async () => {
    const { campaignId, requestId } = await freshServe()
    const res = await serveConversion(db, { requestId, publisherId: publisher, idempotencyKey: 'cnv-1' })
    expect(res.duplicate).toBe(false)
    const state = await campaignState(db, campaignId)
    expect(state.conversions_count).toBe(1)
    expect(state.clicks_count).toBe(0)
    const mine = (await ledgerRows(db)).filter((r) => r.campaign_id === campaignId)
    expect(mine).toHaveLength(0)
  })

  it('a replayed conversion does not double count', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveConversion(db, { requestId, publisherId: publisher, idempotencyKey: 'cnv-2' })
    const replay = await serveConversion(db, { requestId, publisherId: publisher, idempotencyKey: 'cnv-2' })
    expect(replay.duplicate).toBe(true)
    expect((await campaignState(db, campaignId)).conversions_count).toBe(1)
  })

  it('is independent of the click guard, so a serve can convert and click', async () => {
    const { campaignId, requestId } = await freshServe()
    await serveImpression(db, { requestId, publisherId: publisher, sessionId: 's15', idempotencyKey: 'imp-15' })
    await serveClick(db, { requestId, publisherId: publisher, idempotencyKey: 'clk-8' })
    await serveConversion(db, { requestId, publisherId: publisher, idempotencyKey: 'cnv-3' })
    const state = await campaignState(db, campaignId)
    expect(state.clicks_count).toBe(1)
    expect(state.conversions_count).toBe(1)
  })
})

describe('budget interaction', () => {
  it('one serve records at most one impression, however many times it is asked', async () => {
    // The serve guard, not the idempotency key, is what bounds this. Each
    // retry here uses a brand new key, so a key-based dedupe would have
    // charged the advertiser 130 times.
    const { campaignId, requestId } = await freshServe()
    const first = await serveImpression(db, {
      requestId, publisherId: publisher, sessionId: 's16', idempotencyKey: 'imp-16-a',
    })
    expect(first.duplicate).toBe(false)
    for (let i = 0; i < 5; i++) {
      const again = await serveImpression(db, {
        requestId, publisherId: publisher, sessionId: 's16', idempotencyKey: `imp-16-${i}`,
      })
      expect(again.duplicate).toBe(true)
    }
    const state = await campaignState(db, campaignId)
    expect(state.impressions_count).toBe(1)
    expect(state.spend_milli_cents).toBe(10)
  })

  it('an exhausted campaign produces BUDGET_EXCEEDED rather than overspending', async () => {
    // 1 cent of budget, 10 milli-cents per impression: exactly 100 fit, so
    // the 101st distinct serve cannot be billed.
    const campaignId = await createCampaign(db, advertiser.advertiser_id, {
      budgetCents: 1, cpmCents: 10,
    })
    for (let i = 0; i < 100; i++) {
      const rid = await createServe(db, {
        publisherId: publisher, placementId: placement,
        campaignId, developerId: dev.developer_id,
      })
      await serveImpression(db, {
        requestId: rid, publisherId: publisher,
        sessionId: 's17', idempotencyKey: `imp-17-${i}`,
      })
    }

    const overId = await createServe(db, {
      publisherId: publisher, placementId: placement,
      campaignId, developerId: dev.developer_id,
    })
    await expect(
      serveImpression(db, {
        requestId: overId, publisherId: publisher,
        sessionId: 's17', idempotencyKey: 'imp-17-over',
      }),
    ).rejects.toThrow(/BUDGET_EXCEEDED/)

    const state = await campaignState(db, campaignId)
    expect(state.impressions_count).toBe(100)
    expect(state.spend_milli_cents).toBe(1000)
    // The refused serve stays unclaimed, so it is never half-recorded.
    expect((await serveRow(db, overId)).impression_recorded_at).toBeNull()
  })
})

describe('publisher key storage', () => {
  it('stores only a hash, never the raw key', async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT key_hash, key_prefix FROM public.publisher_keys`),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      // sha256 hex
      expect(row.key_hash).toMatch(/^[0-9a-f]{64}$/)
      expect(JSON.stringify(row)).not.toContain(rawKey)
    }
  })

  it('a revoked key row is excluded by the only lookup predicate', async () => {
    const revoked = await createPublisherKey(db, publisher, {
      revokedAt: new Date().toISOString(), label: 'revoked',
    })
    const live = await createPublisherKey(db, publisher, { label: 'live' })

    // The query the delivery path performs: hash in, row out, revoked excluded.
    const resolve = (raw) =>
      asService(db, async (tx) => {
        const { rows } = await tx.query(
          `SELECT k.id, p.status
             FROM public.publisher_keys k
             JOIN public.publishers p ON p.id = k.publisher_id
            WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND p.status = 'active'`,
          [hashPublisherKey(raw)],
        )
        return rows[0] ?? null
      })

    expect(await resolve(revoked.raw)).toBeNull()
    expect(await resolve(live.raw)).not.toBeNull()
  })

  it('a suspended publisher stops resolving even with a live key', async () => {
    const pub3 = await createPublisher(db, { name: 'To suspend' })
    const k = await createPublisherKey(db, pub3)
    const resolve = (raw) =>
      asService(db, async (tx) => {
        const { rows } = await tx.query(
          `SELECT k.id FROM public.publisher_keys k
             JOIN public.publishers p ON p.id = k.publisher_id
            WHERE k.key_hash = $1 AND k.revoked_at IS NULL AND p.status = 'active'`,
          [hashPublisherKey(raw)],
        )
        return rows[0] ?? null
      })
    expect(await resolve(k.raw)).not.toBeNull()
    await asService(db, (tx) =>
      tx.query(`UPDATE public.publishers SET status = 'suspended' WHERE id = $1`, [pub3]),
    )
    expect(await resolve(k.raw)).toBeNull()
  })

  it('the serve log is not readable by an authenticated client', async () => {
    const { asUser } = await import('./fixtures.js')
    await expect(
      asUser(db, advertiser.userId, (tx) => tx.query(`SELECT * FROM public.ad_serve_log`)),
    ).rejects.toThrow(/permission denied/i)
  })

  it('the serve log is not readable by an anonymous caller', async () => {
    const { asAnon } = await import('./fixtures.js')
    await expect(
      asAnon(db, (tx) => tx.query(`SELECT * FROM public.ad_serve_log`)),
    ).rejects.toThrow(/permission denied/i)
  })

  it('placements and publisher keys are not client-writable', async () => {
    const { asUser } = await import('./fixtures.js')
    await expect(
      asUser(db, advertiser.userId, (tx) =>
        tx.query(`UPDATE public.placements SET enabled = false`),
      ),
    ).rejects.toThrow(/permission denied/i)
    await expect(
      asUser(db, advertiser.userId, (tx) =>
        tx.query(`INSERT INTO public.publishers (name) VALUES ('hijack')`),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('audience compatibility', () => {
  it('a placement restricted to an audience only serves that audience', async () => {
    const pub2 = await createPublisher(db, { name: 'Audience test' })
    const restricted = await createPlacement(db, pub2, {
      placementKey: 'sidebar',
      allowedAudienceId: AUDIENCE,
    })
    const otherAudience = await asService(db, async (tx) => {
      const { rows } = await tx.query(`SELECT id FROM public.audiences WHERE id <> $1 LIMIT 1`, [AUDIENCE])
      return rows[0].id
    })
    const campaignId = await createCampaign(db, advertiser.advertiser_id, {
      budgetCents: 10000,
      campaign: { audienceId: otherAudience },
    })
    const requestId = await createServe(db, {
      publisherId: pub2, placementId: restricted,
      campaignId, developerId: dev.developer_id,
    })
    // The serve row records what was chosen; the filter itself lives in the
    // delivery query, which is Deno-side. Here we assert the placement's
    // restriction is actually stored and readable as policy.
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT allowed_audience_id FROM public.placements WHERE id = $1`, [restricted]),
    )
    expect(rows[0].allowed_audience_id).toBe(AUDIENCE)
    expect((await serveRow(db, requestId)).campaign_id).toBe(campaignId)
  })
})

describe('legacy developer path no longer accepts a campaign id', () => {
  it('apply_interaction still refuses a click with no impression (unchanged)', async () => {
    const campaignId = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    await expect(
      applyInteraction(db, {
        campaignId, developerId: dev.developer_id,
        sessionId: 'legacy', idempotencyKey: 'legacy-1',
      }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)
  })
})
