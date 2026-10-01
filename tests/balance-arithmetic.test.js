/**
 * Balance arithmetic.
 *
 * The payout path must never double-spend a settled reward, and the wallet
 * must show what the server actually holds. summarizeRewards() is the
 * single definition of "spendable" the store uses, so the accounting
 * rules are testable without a live backend.
 */
import { describe, it, expect } from 'vitest'
import { summarizeRewards } from '../src/lib/economyStore.js'

const available = (amount, remaining = amount) => ({
  id: 'r1', amountCents: amount, remainingCents: remaining, status: 'available',
})
const accrued = (amount, remaining = amount) => ({
  id: 'r2', amountCents: amount, remainingCents: remaining, status: 'accrued',
})
const consumed = (amount, remaining = 0) => ({
  id: 'r3', amountCents: amount, remainingCents: remaining, status: 'consumed',
})
const payout = (amount, status = 'requested') => ({
  id: 'p1', amountCents: amount, status,
})

describe('balance arithmetic', () => {
  it('spendable cents are the server remaining_cents, not amount_cents', () => {
    const rewards = [available(100, 40)]
    const b = summarizeRewards(rewards, [])
    expect(b.availableCents).toBe(40)
    expect(b.lifetimeCents).toBe(100)
  })

  it('a fully consumed reward is not spendable and not pending', () => {
    const b = summarizeRewards([consumed(18)], [])
    expect(b.availableCents).toBe(0)
    expect(b.pendingCents).toBe(0)
    // Lifetime still counts it: it was minted.
    expect(b.lifetimeCents).toBe(18)
  })

  it('pending rewards are not spendable', () => {
    const b = summarizeRewards([accrued(18)], [])
    expect(b.availableCents).toBe(0)
    expect(b.pendingCents).toBe(18)
  })

  it('reserved is informational and never subtracted from available', () => {
    const rewards = [available(100)]
    const payouts = [payout(50)]
    const b = summarizeRewards(rewards, payouts)
    // available is the spendable reward, NOT available minus reserved.
    expect(b.availableCents).toBe(100)
    expect(b.reservedCents).toBe(50)
  })

  it('a partially consumed reward nets out', () => {
    const b = summarizeRewards([available(100, 30), available(200, 200)], [])
    expect(b.availableCents).toBe(230)
  })

  it('money is integer cents only', () => {
    const rewards = [available(1), available(2)]
    const b = summarizeRewards(rewards, [])
    expect(Number.isInteger(b.availableCents)).toBe(true)
    expect(b.availableCents).toBe(3)
  })
})