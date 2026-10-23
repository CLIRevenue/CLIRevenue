/**
 * Freeze behaviour against a real Postgres (PGlite).
 *
 * Covers: independent scopes (account/wallet/keys), frozen account pauses
 * active campaigns (trigger), unfreeze request links to the freeze, and
 * release restores the previous scope.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, uuid, asService,
  freezeAccount, releaseFreezeById, listFreezes, requestUnfreeze,
  walletRow, walletSnapshot, grantFreeCredits, createWalletTopup,
} from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

async function freezeAndGetId(db, profileId, scope, reason, actorId) {
  await freezeAccount(db, profileId, scope, reason, actorId)
  const freezes = await listFreezes(db, profileId)
  return freezes.find((f) => f.status === 'active')?.id
}

describe('freeze scopes are independent', () => {
  it('wallet freeze blocks credit movement but not sign-in', async () => {
    const subject = await createUser(db, { email: 'freeze-subject-w@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-actor-w@test.invalid', role: 'advertiser' })

    const before = await walletSnapshot(db, subject.userId)
    expect(before.balance_credits).toBe(0)

    await freezeAccount(db, subject.userId, 'wallet', 'suspicious activity', actor.userId)

    const row = await walletRow(db, subject.userId)
    expect(row.frozen_at).not.toBeNull()
    expect(row.frozen_reason).toBe('suspicious activity')

    // A frozen wallet refuses a top-up.
    await expect(
      createWalletTopup(db, subject.userId, {
        amountMinor: 10000,
        currency: 'INR',
        paymentMethod: 'upi',
        payerName: 'Payer',
        payerEmail: 'payer@example.test',
        payerAddress: '1 Street',
        idempotencyKey: 'topup-wallet-frozen',
      }),
    ).rejects.toThrow(/WALLET_FROZEN/)
  })

  it('account freeze blocks credit movement', async () => {
    const subject = await createUser(db, { email: 'freeze-subject-a@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-actor-a@test.invalid', role: 'advertiser' })

    await freezeAccount(db, subject.userId, 'account', 'policy violation', actor.userId)

    await expect(
      grantFreeCredits(db, subject.userId, 100, 'grant to frozen account', actor.userId),
    ).rejects.toThrow(/ACCOUNT_FROZEN/)
  })

  it('keys freeze does not touch credit movement', async () => {
    const subject = await createUser(db, { email: 'freeze-subject-k@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-actor-k@test.invalid', role: 'advertiser' })

    const res = await freezeAccount(db, subject.userId, 'keys', 'abuse', actor.userId)
    expect(res.ok).toBe(true)

    const freezes = await listFreezes(db, subject.userId)
    const keyFreeze = freezes.find((f) => f.scope === 'keys' && f.status === 'active')
    expect(keyFreeze).not.toBeUndefined()
  })
})

describe('frozen account pauses active campaigns', () => {
  it('pauses active campaigns when the account is frozen', async () => {
    const prof = await createUser(db, { email: 'freeze-campaign@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-campaign-actor@test.invalid', role: 'advertiser' })

    // Give the advertiser credits.
    await grantFreeCredits(db, prof.userId, 200, 'campaign budget', actor.userId)

    // Look up the advertiser row for this profile.
    const { rows: advRows } = await asService(db, (tx) =>
      tx.query(`SELECT id FROM public.advertisers WHERE profile_id = $1`, [prof.userId]),
    )
    const advertiserId = advRows[0].id

    const campaignId = uuid()
    await asService(db, (tx) =>
      tx.query(
        `INSERT INTO public.campaigns
           (id, advertiser_id, name, headline, description, cta, audience_id,
            budget_cents, cpm_cents, status, starts_at, ends_at, landing_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          campaignId, advertiserId, 'Test Campaign', 'Test headline', 'desc',
          'Learn more', 'backend', 1000, 10, 'active', null, null,
          'https://example.test/landing',
        ],
      ),
    )

    // Confirm the campaign is active before the freeze.
    const { rows: beforeRows } = await asService(db, (tx) =>
      tx.query(`SELECT status FROM public.campaigns WHERE id = $1`, [campaignId]),
    )
    expect(beforeRows[0].status).toBe('active')

    // Freeze the account: the trigger pauses active campaigns.
    await freezeAccount(db, prof.userId, 'account', 'policy violation', actor.userId)

    const { rows: afterRows } = await asService(db, (tx) =>
      tx.query(`SELECT status FROM public.campaigns WHERE id = $1`, [campaignId]),
    )
    expect(afterRows[0].status).toBe('paused')
  })
})

describe('unfreeze request', () => {
  it('files a support request linked to the freeze', async () => {
    const prof = await createUser(db, { email: 'freeze-unfreeze@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-unfreeze-actor@test.invalid', role: 'advertiser' })
    const freezeId = await freezeAndGetId(db, prof.userId, 'account', 'needs review', actor.userId)
    expect(freezeId).not.toBeUndefined()

    const request = await requestUnfreeze(
      db, prof.userId, freezeId, 'Please unfreeze', 'I did nothing wrong', 'user@example.test',
    )
    expect(request.ok).toBe(true)
    expect(request.request_id).not.toBeNull()

    // The freeze row now carries the unfreeze request link.
    const freezes = await listFreezes(db, prof.userId)
    const fz = freezes.find((f) => f.id === freezeId)
    expect(fz.unfreeze_request_id).toBe(request.request_id)
    expect(fz.unfreeze_requested_at).not.toBeNull()
  })

  it('rejects an unfreeze request for someone else\'s freeze', async () => {
    const prof = await createUser(db, { email: 'freeze-other@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-other-actor@test.invalid', role: 'advertiser' })
    const freezeId = await freezeAndGetId(db, prof.userId, 'account', 'test', actor.userId)

    const attacker = await createUser(db, { email: 'freeze-attacker@test.invalid', role: 'advertiser' })
    await expect(
      requestUnfreeze(db, attacker.userId, freezeId, 'Not yours', 'Give it back', 'attacker@example.test'),
    ).rejects.toThrow(/NOT_YOUR_FREEZE/)
  })

  it('rejects an unfreeze request for an already-released freeze', async () => {
    const prof = await createUser(db, { email: 'freeze-released@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-released-actor@test.invalid', role: 'advertiser' })
    const freezeId = await freezeAndGetId(db, prof.userId, 'account', 'test', actor.userId)

    await releaseFreezeById(db, freezeId, 'released', actor.userId)

    await expect(
      requestUnfreeze(db, prof.userId, freezeId, 'Too late', 'Release it', 'user@example.test'),
    ).rejects.toThrow(/FREEZE_ALREADY_RELEASED/)
  })
})

describe('release restores movement', () => {
  it('releasing an account freeze allows grants again', async () => {
    const prof = await createUser(db, { email: 'freeze-release@test.invalid', role: 'advertiser' })
    const actor = await createUser(db, { email: 'freeze-release-actor@test.invalid', role: 'advertiser' })
    await freezeAccount(db, prof.userId, 'account', 'temp', actor.userId)

    const freezes = await listFreezes(db, prof.userId)
    const active = freezes.filter((f) => f.status === 'active')
    expect(active.length).toBeGreaterThan(0)

    await releaseFreezeById(db, active[0].id, 'reviewed', actor.userId)

    const remaining = await listFreezes(db, prof.userId)
    expect(remaining.filter((f) => f.status === 'active')).toHaveLength(0)

    // Grants work again.
    const grant = await grantFreeCredits(db, prof.userId, 100, 'after release', actor.userId)
    expect(grant.ok).toBe(true)
  })
})
