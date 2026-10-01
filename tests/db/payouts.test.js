/**
 * Payout, settlement and boundary behaviour, executed against a real Postgres.
 *
 * Covers plan cases 18-32. The money path under test is:
 *   click -> reward 'accrued' -> settlement -> 'available' -> payout consumes
 * and every assertion below is about what happens to cents at each step.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, createCampaign,
  applyImpression, applyInteraction, rewardBalance, requestPayout,
  applySettlement, ledgerRows, payoutRows, settleNow, asService,
} from './fixtures.js'

let db
let advertiser

beforeAll(async () => {
  db = (await migrate()).db
  advertiser = await createUser(db, { email: 'payout-adv@test.invalid', role: 'advertiser' })
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

/**
 * A developer with `clicks` clicks already rewarded. `settle` defaults to true
 * because payouts consume only 'available' rewards; the settlement tests pass
 * settle: false so they can observe the accrued state first.
 */
async function fundedDeveloper(email, { clicks, rewardCents = 100, settle = true }) {
  const dev = await createUser(db, { email, role: 'developer' })
  const c = await createCampaign(db, advertiser.advertiser_id, { budgetCents: 1_000_000 })
  for (let i = 0; i < clicks; i++) {
    const session = `sess-${email}-${i}`
    const imp = await applyImpression(db, {
      campaignId: c, developerId: dev.developer_id,
      sessionId: session, idempotencyKey: `imp-${email}-${i}`,
    })
    await applyInteraction(db, {
      campaignId: c, developerId: dev.developer_id,
      sessionId: session, idempotencyKey: `int-${email}-${i}`,
      impressionId: imp.impression_id, rewardCents,
    })
  }
  if (settle) await settleNow(db, dev.developer_id)
  return { dev, devId: dev.developer_id }
}

describe('settlement', () => {
  it('22. settles accrued rewards into available', async () => {
    const { devId } = await fundedDeveloper('settle-ok@test.invalid', { clicks: 2, rewardCents: 50, settle: false })

    const before = await rewardBalance(db, devId)
    expect(before.available_cents).toBe(0)
    expect(before.pending_cents).toBe(100)

    const res = await settleNow(db, devId)
    expect(res.settled_count).toBe(2)
    expect(res.settled_cents).toBe(100)

    const after = await rewardBalance(db, devId)
    expect(after.available_cents).toBe(100)
    expect(after.pending_cents).toBe(0)
    // Lifetime is gross of consumption and must not change on settlement.
    expect(after.lifetime_cents).toBe(100)
  })

  it('23. a repeated settlement settles nothing and does not double-credit', async () => {
    const { devId } = await fundedDeveloper('settle-twice@test.invalid', { clicks: 1, rewardCents: 70, settle: false })
    await settleNow(db, devId)

    const again = await applySettlement(db, { ageMs: 1000, developerId: devId })
    expect(again.settled_count).toBe(0)
    expect(again.settled_cents).toBe(0)

    const bal = await rewardBalance(db, devId)
    expect(bal.available_cents).toBe(70)
  })

  it('22b. settlement leaves consumed rewards alone', async () => {
    const { devId } = await fundedDeveloper('settle-consumed@test.invalid', { clicks: 1, rewardCents: 90, settle: false })
    await settleNow(db, devId)
    await requestPayout(db, devId, 90)

    const res = await applySettlement(db, { ageMs: 1000, developerId: devId })
    expect(res.settled_count).toBe(0)

    const bal = await rewardBalance(db, devId)
    expect(bal.available_cents).toBe(0)
  })
})

describe('payout', () => {
  it('18-19. pays out from available and consumes exactly that many cents', async () => {
    const { devId } = await fundedDeveloper('payout-ok@test.invalid', { clicks: 3, rewardCents: 100 })

    const res = await requestPayout(db, devId, 250)
    expect(res.consumed_cents).toBe(250)
    expect(res.payout.amount_cents).toBe(250)
    expect(res.payout.status).toBe('requested')

    const bal = await rewardBalance(db, devId)
    expect(bal.available_cents).toBe(50)
    expect(bal.lifetime_cents).toBe(300)
    // Reserved mirrors payouts that are requested or in flight.
    expect(bal.reserved_cents).toBe(250)

    // 300 available, 250 taken: two rows fully consumed, one left with 50.
    const rows = (await ledgerRows(db)).filter((r) => r.developer_id === devId)
    const consumed = rows.filter((r) => r.status === 'consumed')
    const partial = rows.filter((r) => r.status === 'available')
    expect(consumed).toHaveLength(2)
    expect(consumed.every((r) => r.remaining_cents === 0)).toBe(true)
    expect(partial).toHaveLength(1)
    expect(partial[0].remaining_cents).toBe(50)
    expect(rows.every((r) => r.payout_id === res.payout.id)).toBe(true)
  })

  it('19b. a partial payout splits across reward rows and leaves a remainder', async () => {
    const { devId } = await fundedDeveloper('payout-partial@test.invalid', { clicks: 2, rewardCents: 100 })
    const res = await requestPayout(db, devId, 150)
    expect(res.consumed_cents).toBe(150)

    const rows = (await ledgerRows(db)).filter((r) => r.developer_id === devId)
    const totalRemaining = rows.reduce((s, r) => s + r.remaining_cents, 0)
    expect(totalRemaining).toBe(50)
    // Part-consumed rows stay 'available' so they can be paid again.
    const statuses = rows.map((r) => r.status).sort()
    expect(statuses).toEqual(['available', 'consumed'])
  })

  it('20. a second payout cannot re-consume already-consumed rewards', async () => {
    const { devId } = await fundedDeveloper('payout-twice@test.invalid', { clicks: 1, rewardCents: 100 })
    await requestPayout(db, devId, 100)

    await expect(requestPayout(db, devId, 50)).rejects.toThrow(/INSUFFICIENT_BALANCE/)

    const payouts = (await payoutRows(db)).filter((p) => p.developer_id === devId)
    expect(payouts).toHaveLength(1)
  })

  it('17. an insufficient payout leaves no partial mutation', async () => {
    const { devId } = await fundedDeveloper('payout-atomic@test.invalid', { clicks: 2, rewardCents: 100 })
    const rowsBefore = (await ledgerRows(db)).filter((r) => r.developer_id === devId)

    // 200 available, asking for 201.
    await expect(requestPayout(db, devId, 201)).rejects.toThrow(/INSUFFICIENT_BALANCE/)

    const rowsAfter = (await ledgerRows(db)).filter((r) => r.developer_id === devId)
    expect(rowsAfter).toEqual(rowsBefore)
    // And no payout row was left behind by the aborted attempt.
    const payouts = (await payoutRows(db)).filter((p) => p.developer_id === devId)
    expect(payouts).toHaveLength(0)
    expect((await rewardBalance(db, devId)).available_cents).toBe(200)
  })

  it('21. sequential double-spend is refused; true concurrency is UNVERIFIED here', async () => {
    // PGlite serves one connection, so two genuinely simultaneous
    // transactions cannot be issued from this suite. What is proven is the
    // sequential invariant the FOR UPDATE lock is there to protect: once the
    // balance is consumed, a second request finds nothing to take. The
    // blocking behaviour under real concurrency still needs a multi-connection
    // Postgres and is deliberately not claimed as passing.
    const { devId } = await fundedDeveloper('payout-double@test.invalid', { clicks: 1, rewardCents: 100 })
    const a = await requestPayout(db, devId, 100)
    expect(a.consumed_cents).toBe(100)
    await expect(requestPayout(db, devId, 100)).rejects.toThrow(/INSUFFICIENT_BALANCE/)
    expect((await rewardBalance(db, devId)).available_cents).toBe(0)
  })
})

describe('boundaries', () => {
  it('27-32. a developer with no rewards has a zeroed balance', async () => {
    const dev = await createUser(db, { email: 'empty-dev@test.invalid', role: 'developer' })
    const bal = await rewardBalance(db, dev.developer_id)
    expect(bal).toMatchObject({
      available_cents: 0, pending_cents: 0, lifetime_cents: 0, reserved_cents: 0,
    })
  })

  it('27. a payout against a zero balance is refused', async () => {
    const dev = await createUser(db, { email: 'zero-dev@test.invalid', role: 'developer' })
    await expect(requestPayout(db, dev.developer_id, 1)).rejects.toThrow(/INSUFFICIENT_BALANCE/)
  })

  it('28. an exact-balance payout succeeds and empties the balance', async () => {
    const { devId } = await fundedDeveloper('exact@test.invalid', { clicks: 2, rewardCents: 100 })
    const res = await requestPayout(db, devId, 200)
    expect(res.consumed_cents).toBe(200)
    expect((await rewardBalance(db, devId)).available_cents).toBe(0)
  })

  it('29. one cent above the available balance is refused', async () => {
    const { devId } = await fundedDeveloper('over@test.invalid', { clicks: 1, rewardCents: 100 })
    await expect(requestPayout(db, devId, 101)).rejects.toThrow(/INSUFFICIENT_BALANCE/)
    expect((await rewardBalance(db, devId)).available_cents).toBe(100)
  })

  it('30. one cent below the available balance succeeds', async () => {
    const { devId } = await fundedDeveloper('under@test.invalid', { clicks: 1, rewardCents: 100 })
    const res = await requestPayout(db, devId, 99)
    expect(res.consumed_cents).toBe(99)
    expect((await rewardBalance(db, devId)).available_cents).toBe(1)
  })

  it('31. large integer amounts are handled without overflow', async () => {
    const { devId } = await fundedDeveloper('large@test.invalid', { clicks: 20, rewardCents: 1_000_000 })
    const bal = await rewardBalance(db, devId)
    expect(bal.available_cents).toBe(20_000_000)

    const res = await requestPayout(db, devId, 19_999_999)
    expect(res.consumed_cents).toBe(19_999_999)
    expect((await rewardBalance(db, devId)).available_cents).toBe(1)
  })

  it('31b. a payout beyond INTEGER range is refused rather than wrapped', async () => {
    const { devId } = await fundedDeveloper('overflow@test.invalid', { clicks: 1, rewardCents: 100 })
    await expect(
      requestPayout(db, devId, 2_147_483_648), // INT4 max + 1
    ).rejects.toThrow()
    expect((await rewardBalance(db, devId)).available_cents).toBe(100)
  })

  it('32. settlement over an empty reward set settles nothing', async () => {
    const dev = await createUser(db, { email: 'norewards-dev@test.invalid', role: 'developer' })
    const res = await applySettlement(db, { ageMs: 1000, developerId: dev.developer_id })
    expect(res).toMatchObject({ settled_count: 0, settled_cents: 0 })
  })

  it('refuses a zero or negative payout amount', async () => {
    const { devId } = await fundedDeveloper('amount@test.invalid', { clicks: 1, rewardCents: 100 })
    await expect(requestPayout(db, devId, 0)).rejects.toThrow(/INVALID_AMOUNT/)
    await expect(requestPayout(db, devId, -50)).rejects.toThrow(/INVALID_AMOUNT/)
    expect((await rewardBalance(db, devId)).available_cents).toBe(100)
  })

  it('refuses a payout with a blank provider id', async () => {
    const { devId } = await fundedDeveloper('provider@test.invalid', { clicks: 1, rewardCents: 100 })
    await expect(requestPayout(db, devId, 10, '   ')).rejects.toThrow(/INVALID_PROVIDER/)
  })

  it('reward_balance rejects a null developer rather than reporting zeroes', async () => {
    const res = await asService(db, async (tx) => {
      try {
        await tx.query(`SELECT public.reward_balance(NULL)`)
        return null
      } catch (err) {
        return err
      }
    })
    expect(res).not.toBeNull()
    expect(String(res.message)).toMatch(/INVALID_PAYOUT/)
  })
})
