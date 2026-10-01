/**
 * Accounting and click-security behaviour, executed against a real Postgres.
 *
 * Covers plan cases 1-17: impression accounting, budget ceiling, client-write
 * refusal, idempotency of both event types, the mandatory-impression rule for
 * clicks, and reward minting.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, createCampaign, campaignState,
  applyImpression, applyInteraction, rewardBalance, ledgerRows,
  asUser, asService, uuid,
} from './fixtures.js'

let db
let advertiser
let developer
let campaign

beforeAll(async () => {
  db = (await migrate()).db
  advertiser = await createUser(db, { email: 'acct-adv@test.invalid', role: 'advertiser' })
  developer = await createUser(db, { email: 'acct-dev@test.invalid', role: 'developer' })
  campaign = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 100, cpmCents: 10 })
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

describe('impression accounting', () => {
  it('1-4. records an impression and charges exactly cpm_cents of spend', async () => {
    const before = await campaignState(db, campaign)
    const res = await applyImpression(db, {
      campaignId: campaign,
      developerId: developer.developer_id,
      sessionId: 'sess-a',
      idempotencyKey: 'imp-a',
    })
    expect(res.ok).toBe(true)
    expect(res.duplicate).toBe(false)

    const after = await campaignState(db, campaign)
    // cpm_cents is the cost per impression in MILLI-cents.
    expect(after.impressions_count).toBe(before.impressions_count + 1)
    expect(after.spend_milli_cents).toBe(before.spend_milli_cents + 10)
  })

  it('5. refuses the impression that would cross the budget ceiling', async () => {
    // 1 cent = 1000 milli-cents of budget, 10 milli-cents per impression,
    // so exactly 100 impressions fit and the 101st must be refused.
    const tight = await createCampaign(db, advertiser.advertiser_id, {
      budgetCents: 1, cpmCents: 10,
    })
    let accepted = 0
    let lastErr = null
    for (let i = 0; i < 150; i++) {
      try {
        await applyImpression(db, {
          campaignId: tight,
          developerId: developer.developer_id,
          sessionId: 'sess-budget',
          idempotencyKey: `imp-budget-${i}`,
        })
        accepted++
      } catch (err) {
        lastErr = err
        break
      }
    }
    expect(accepted).toBe(100)
    expect(String(lastErr.message)).toMatch(/BUDGET_EXCEEDED/)

    const after = await campaignState(db, tight)
    // The refused impression must not have been charged or counted.
    expect(after.impressions_count).toBe(100)
    expect(after.spend_milli_cents).toBe(1000)
  })

  it('6. refuses a client-side write to accounting counters', async () => {
    // The Edge Function uses the service key, but an authenticated
    // advertiser reaching PostgREST directly must not be able to inflate
    // their own counters or set spend.
    await expect(
      asUser(db, advertiser.userId, async (tx) => {
        await tx.query(
          `UPDATE public.campaigns
             SET impressions_count = 999999, spend_milli_cents = 0
           WHERE id = $1`,
          [campaign],
        )
      }),
    ).rejects.toThrow()

    const after = await campaignState(db, campaign)
    expect(after.impressions_count).toBeLessThan(999999)
  })
})

describe('idempotency', () => {
  it('7-8. a repeated impression key does not double-count', async () => {
    const fresh = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const args = {
      campaignId: fresh,
      developerId: developer.developer_id,
      sessionId: 'sess-idem',
      idempotencyKey: 'imp-idem',
    }
    const first = await applyImpression(db, args)
    const second = await applyImpression(db, args)

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)
    expect(second.code).toBe('DUPLICATE_EVENT')
    expect(second.impression_id).toBe(first.impression_id)

    const state = await campaignState(db, fresh)
    expect(state.impressions_count).toBe(1)
    expect(state.spend_milli_cents).toBe(10)
  })

  it('9. a repeated interaction key mints no second reward', async () => {
    const dev = await createUser(db, { email: 'idem-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const imp = await applyImpression(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-int-idem',
      idempotencyKey: 'imp-int-idem',
    })
    const args = {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-int-idem',
      idempotencyKey: 'int-idem',
      impressionId: imp.impression_id,
    }
    const first = await applyInteraction(db, args)
    const second = await applyInteraction(db, args)

    expect(first.duplicate).toBe(false)
    expect(second.duplicate).toBe(true)

    const state = await campaignState(db, c)
    expect(state.clicks_count).toBe(1)
  })
})

describe('click security', () => {
  it('10. rejects a click with no prior impression for that session', async () => {
    const dev = await createUser(db, { email: 'noimp-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    await expect(
      applyInteraction(db, {
        campaignId: c,
        developerId: dev.developer_id,
        sessionId: 'sess-without-impression',
        idempotencyKey: 'int-noimp',
      }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)

    const state = await campaignState(db, c)
    expect(state.clicks_count).toBe(0)
    // Scoped to this developer: earlier tests in this file minted rewards.
    const mine = (await ledgerRows(db)).filter((r) => r.developer_id === dev.developer_id)
    expect(mine).toHaveLength(0)
  })

  it("10b. rejects a click whose impression belongs to a different session", async () => {
    const dev = await createUser(db, { email: 'xsess-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    await applyImpression(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-A',
      idempotencyKey: 'imp-xsess',
    })
    await expect(
      applyInteraction(db, {
        campaignId: c,
        developerId: dev.developer_id,
        sessionId: 'sess-B',
        idempotencyKey: 'int-xsess',
      }),
    ).rejects.toThrow(/CLICK_WITHOUT_IMPRESSION/)
  })

  it('11. accepts a click that follows a genuine impression', async () => {
    const dev = await createUser(db, { email: 'ok-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const imp = await applyImpression(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-ok',
      idempotencyKey: 'imp-ok',
    })
    const res = await applyInteraction(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-ok',
      idempotencyKey: 'int-ok',
      impressionId: imp.impression_id,
    })
    expect(res.ok).toBe(true)
    expect(res.kind).toBe('click')
    expect((await campaignState(db, c)).clicks_count).toBe(1)
  })

  it('11b. rejects an impression_id that belongs to a different campaign', async () => {
    const dev = await createUser(db, { email: 'mismatch-dev@test.invalid', role: 'developer' })
    const c1 = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const c2 = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    // A real impression for this session on c2, so the click passes the
    // mandatory-impression check and reaches the cross-check on impression_id.
    await applyImpression(db, {
      campaignId: c2,
      developerId: dev.developer_id,
      sessionId: 'sess-mismatch',
      idempotencyKey: 'imp-mismatch-ok',
    })
    const other = await applyImpression(db, {
      campaignId: c1,
      developerId: dev.developer_id,
      sessionId: 'sess-mismatch',
      idempotencyKey: 'imp-mismatch-other',
    })
    await expect(
      applyInteraction(db, {
        campaignId: c2,
        developerId: dev.developer_id,
        sessionId: 'sess-mismatch',
        idempotencyKey: 'int-mismatch',
        impressionId: other.impression_id,
      }),
    ).rejects.toThrow(/INVALID_EVENT/)
  })

  it('12. refuses an interaction whose kind is not click or conversion', async () => {
    const dev = await createUser(db, { email: 'kind-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    // interaction_kind is a real enum, so an unknown kind is rejected by the
    // type system before the function body runs. The contract that matters is
    // fail-closed, so the exact mechanism is deliberately not pinned.
    await expect(
      applyInteraction(db, {
        campaignId: c,
        developerId: dev.developer_id,
        sessionId: 'sess-kind',
        idempotencyKey: 'int-kind',
        kind: 'admin',
      }),
    ).rejects.toThrow()

    const state = await campaignState(db, c)
    expect(state.clicks_count).toBe(0)
    expect(state.conversions_count).toBe(0)
  })
})

describe('reward accounting', () => {
  it('13-14. a click mints an accrued reward whose remaining_cents equals its amount', async () => {
    const dev = await createUser(db, { email: 'reward-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const imp = await applyImpression(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-reward',
      idempotencyKey: 'imp-reward',
    })
    const res = await applyInteraction(db, {
      campaignId: c,
      developerId: dev.developer_id,
      sessionId: 'sess-reward',
      idempotencyKey: 'int-reward',
      impressionId: imp.impression_id,
      rewardCents: 18,
    })
    expect(res.reward_accrued.amount_cents).toBe(18)

    const rows = await asService(db, (tx) =>
      tx.query(`SELECT amount_cents, remaining_cents, status FROM public.reward_ledger WHERE developer_id=$1`, [dev.developer_id]),
    )
    expect(rows.rows).toHaveLength(1)
    expect(rows.rows[0].amount_cents).toBe(18)
    expect(rows.rows[0].remaining_cents).toBe(18)
    // Accrued, not available: settlement must run before it can be paid out.
    expect(rows.rows[0].status).toBe('accrued')
  })

  it('accrued rewards are pending, not available, until settled', async () => {
    const dev = await createUser(db, { email: 'pend-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const imp = await applyImpression(db, {
      campaignId: c, developerId: dev.developer_id,
      sessionId: 'sess-pend', idempotencyKey: 'imp-pend',
    })
    await applyInteraction(db, {
      campaignId: c, developerId: dev.developer_id,
      sessionId: 'sess-pend', idempotencyKey: 'int-pend',
      impressionId: imp.impression_id, rewardCents: 25,
    })

    const bal = await rewardBalance(db, dev.developer_id)
    expect(bal.pending_cents).toBe(25)
    expect(bal.available_cents).toBe(0)
    expect(bal.lifetime_cents).toBe(25)
  })

  it('a conversion increments conversions without minting a reward', async () => {
    const dev = await createUser(db, { email: 'conv-dev@test.invalid', role: 'developer' })
    const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1000 })
    const res = await applyInteraction(db, {
      campaignId: c, developerId: dev.developer_id,
      sessionId: 'sess-conv', idempotencyKey: 'int-conv', kind: 'conversion',
    })
    expect(res.kind).toBe('conversion')
    const state = await campaignState(db, c)
    expect(state.conversions_count).toBe(1)
    expect(state.clicks_count).toBe(0)

    const bal = await rewardBalance(db, dev.developer_id)
    expect(bal.lifetime_cents).toBe(0)
  })

  it('refuses impressions and interactions on a paused campaign', async () => {
    const c = await createCampaign(db, advertiser.advertiser_id, {
      budgetCents: 1000, status: 'paused',
    })
    await expect(
      applyImpression(db, { campaignId: c, sessionId: 'sess-paused', idempotencyKey: 'imp-paused' }),
    ).rejects.toThrow(/CAMPAIGN_NOT_SERVABLE/)
  })

  it('refuses a click for a campaign that does not exist', async () => {
    const dev = await createUser(db, { email: 'nope-dev@test.invalid', role: 'developer' })
    await expect(
      applyInteraction(db, {
        campaignId: uuid(), developerId: dev.developer_id,
        sessionId: 'sess-nope', idempotencyKey: 'int-nope',
      }),
    ).rejects.toThrow(/CAMPAIGN_NOT_FOUND/)
  })
})
