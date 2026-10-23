/**
 * Credit wallet behaviour against a real Postgres (PGlite).
 *
 * Every test that needs money state uses its own fresh profile so tests
 * cannot leak balance into each other.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, uuid, asUser,
  walletSnapshot, walletLedger, reconcileWallet,
  createWalletTopup, confirmWalletTopup, rejectWalletTopup,
  grantFreeCredits, freezeAccount, releaseFreezeById, listFreezes,
  walletRow,
} from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

/** Fresh advertiser with a zero-balance wallet. */
async function freshAdv(email = 'wallet-fresh@test.invalid') {
  return createUser(db, { email, role: 'advertiser' })
}

/** Create + confirm a top-up, returning the credited amount. */
async function creditWallet(db, profileId, amountMinor, idemKey) {
  const topup = await createWalletTopup(db, profileId, {
    amountMinor,
    currency: 'INR',
    paymentMethod: 'upi',
    payerName: 'Payer',
    payerEmail: 'payer@example.test',
    payerAddress: '1 Street',
    idempotencyKey: idemKey,
  })
  return confirmWalletTopup(db, topup.topup.id, 'ref', profileId)
}

describe('wallet is created on signup', () => {
  it('auto-creates a wallet for a new profile via the trigger', async () => {
    const adv = await freshAdv('wallet-signup@test.invalid')
    const row = await walletRow(db, adv.userId)
    expect(row).not.toBeNull()
    expect(row.owner_role).toBe('advertiser')
    expect(row.balance_credits).toBe(0)
    expect(row.reserved_credits).toBe(0)
    expect(row.frozen_at).toBeNull()
  })

  it('wallet_snapshot returns the wallet shape', async () => {
    const adv = await freshAdv('wallet-snapshot@test.invalid')
    const snap = await walletSnapshot(db, adv.userId)
    expect(snap.profile_id).toBe(adv.userId)
    expect(snap.owner_role).toBe('advertiser')
    expect(snap.balance_credits).toBe(0)
    expect(snap.pending_topup_count).toBe(0)
    expect(snap.month_grant_limit_credits).toBe(2000)
  })
})

describe('top-up creation credits nothing', () => {
  it('creates a pending top-up without touching the balance', async () => {
    const adv = await freshAdv('wallet-topup-create@test.invalid')
    const before = await walletSnapshot(db, adv.userId)
    const res = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-1',
    })
    expect(res.ok).toBe(true)
    expect(res.duplicate).toBe(false)
    expect(res.topup.status).toBe('pending')
    expect(res.topup.credits).toBe(100)
    expect(res.topup.amount_minor).toBe(10000)

    const after = await walletSnapshot(db, adv.userId)
    expect(after.balance_credits).toBe(before.balance_credits)
    expect(after.pending_topup_count).toBe(before.pending_topup_count + 1)
  })

  it('replaying the same idempotency key returns the original', async () => {
    const adv = await freshAdv('wallet-topup-replay@test.invalid')
    const first = await createWalletTopup(db, adv.userId, {
      amountMinor: 5000,
      currency: 'INR',
      paymentMethod: 'card',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-replay',
    })
    expect(first.duplicate).toBe(false)

    const second = await createWalletTopup(db, adv.userId, {
      amountMinor: 999999,
      currency: 'USD',
      paymentMethod: 'bank_transfer',
      payerName: 'Someone Else',
      payerEmail: 'other@example.test',
      payerAddress: 'Elsewhere',
      idempotencyKey: 'topup-replay',
    })
    expect(second.duplicate).toBe(true)
    expect(second.topup.credits).toBe(first.topup.credits)
  })

  it('rejects amount too small to buy even one credit', async () => {
    const adv = await freshAdv('wallet-topup-small@test.invalid')
    await expect(
      createWalletTopup(db, adv.userId, {
        amountMinor: 50,
        currency: 'INR',
        paymentMethod: 'upi',
        payerName: 'Rahul Sharma',
        payerEmail: 'rahul@example.test',
        payerAddress: '1 MG Road, Bangalore',
        idempotencyKey: 'topup-too-small',
      }),
    ).rejects.toThrow(/AMOUNT_TOO_SMALL/)
  })
})

describe('top-up confirmation', () => {
  it('confirms a pending top-up and credits the wallet', async () => {
    const adv = await freshAdv('wallet-confirm@test.invalid')
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 20000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-confirm-1',
    })
    expect(topup.topup.status).toBe('pending')

    const before = await walletSnapshot(db, adv.userId)
    const res = await confirmWalletTopup(db, topup.topup.id, 'ref-123', adv.userId)
    expect(res.ok).toBe(true)
    expect(res.duplicate).toBe(false)
    expect(res.topup.status).toBe('confirmed')
    expect(res.topup.payment_reference).toBe('ref-123')
    expect(res.transaction.direction).toBe('credit')
    expect(res.transaction.credits).toBe(200)

    const after = await walletSnapshot(db, adv.userId)
    expect(after.balance_credits).toBe(before.balance_credits + 200)
  })

  it('confirming an already-confirmed top-up is a duplicate', async () => {
    const adv = await freshAdv('wallet-confirm-dup@test.invalid')
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-confirm-dup',
    })
    await confirmWalletTopup(db, topup.topup.id, 'ref-dup', adv.userId)

    const before = await walletSnapshot(db, adv.userId)
    const res = await confirmWalletTopup(db, topup.topup.id, 'ref-dup-again', adv.userId)
    expect(res.duplicate).toBe(true)

    const after = await walletSnapshot(db, adv.userId)
    expect(after.balance_credits).toBe(before.balance_credits)
  })

  it('rejecting a pending top-up leaves the balance untouched', async () => {
    const adv = await freshAdv('wallet-reject@test.invalid')
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-reject-1',
    })
    const before = await walletSnapshot(db, adv.userId)
    const res = await rejectWalletTopup(db, topup.topup.id, 'insufficient funds', adv.userId)
    expect(res.ok).toBe(true)
    expect(res.topup.status).toBe('rejected')

    const after = await walletSnapshot(db, adv.userId)
    expect(after.balance_credits).toBe(before.balance_credits)
  })
})

describe('ledger', () => {
  it('records every credit movement', async () => {
    const adv = await freshAdv('wallet-ledger@test.invalid')
    await creditWallet(db, adv.userId, 10000, 'topup-ledger-1')
    await creditWallet(db, adv.userId, 20000, 'topup-ledger-2')

    const ledger = await walletLedger(db, adv.userId)
    expect(ledger.transactions).toHaveLength(2)
    expect(ledger.count).toBe(2)
    const credits = ledger.transactions.map((t) => t.credits).sort((a, b) => b - a)
    expect(credits).toEqual([200, 100])
    ledger.transactions.forEach((t) => {
      expect(t.kind).toBe('topup')
      expect(t.direction).toBe('credit')
    })
  })
})

describe('admin grant monthly cap', () => {
  it('grants credits within the monthly cap', async () => {
    const adv = await freshAdv('wallet-grant-cap@test.invalid')
    const res = await grantFreeCredits(db, adv.userId, 500, 'test grant', adv.userId)
    expect(res.ok).toBe(true)
    expect(res.granted_credits).toBe(500)
    expect(res.month_used_credits).toBe(500)
    expect(res.month_remaining_credits).toBe(1500)

    const snap = await walletSnapshot(db, adv.userId)
    expect(snap.balance_credits).toBe(500)
    expect(snap.month_grant_remaining_credits).toBe(1500)
  })

  it('refuses a grant that would exceed the 2000-credit monthly cap', async () => {
    const adv = await freshAdv('wallet-grant-over@test.invalid')
    await grantFreeCredits(db, adv.userId, 500, 'first grant', adv.userId)

    await expect(
      grantFreeCredits(db, adv.userId, 1501, 'over cap', adv.userId),
    ).rejects.toThrow(/MONTHLY_GRANT_LIMIT/)

    const snap = await walletSnapshot(db, adv.userId)
    expect(snap.balance_credits).toBe(500)
    expect(snap.month_grant_remaining_credits).toBe(1500)
  })

  it('allows exactly the remaining headroom', async () => {
    const adv = await freshAdv('wallet-grant-exact@test.invalid')
    await grantFreeCredits(db, adv.userId, 500, 'first grant', adv.userId)

    const res = await grantFreeCredits(db, adv.userId, 1500, 'exact cap', adv.userId)
    expect(res.ok).toBe(true)
    expect(res.month_used_credits).toBe(2000)
    expect(res.month_remaining_credits).toBe(0)

    const snap = await walletSnapshot(db, adv.userId)
    expect(snap.balance_credits).toBe(2000)
  })
})

describe('freeze blocks movement', () => {
  it('a frozen wallet refuses top-up creation', async () => {
    const adv = await freshAdv('wallet-frozen-wallet@test.invalid')
    await freezeAccount(db, adv.userId, 'wallet', 'test freeze', adv.userId)

    await expect(
      createWalletTopup(db, adv.userId, {
        amountMinor: 10000,
        currency: 'INR',
        paymentMethod: 'upi',
        payerName: 'Rahul Sharma',
        payerEmail: 'rahul@example.test',
        payerAddress: '1 MG Road, Bangalore',
        idempotencyKey: 'topup-frozen-wallet',
      }),
    ).rejects.toThrow(/WALLET_FROZEN/)
  })

  it('a frozen account refuses admin grant', async () => {
    const adv = await freshAdv('wallet-frozen-account@test.invalid')
    await freezeAccount(db, adv.userId, 'account', 'test freeze', adv.userId)

    await expect(
      grantFreeCredits(db, adv.userId, 100, 'grant to frozen', adv.userId),
    ).rejects.toThrow(/ACCOUNT_FROZEN/)
  })

  it('release restores movement', async () => {
    const adv = await freshAdv('wallet-frozen-release@test.invalid')
    const res = await freezeAccount(db, adv.userId, 'wallet', 'temp', adv.userId)
    expect(res.ok).toBe(true)

    const freezes = await listFreezes(db, adv.userId)
    const active = freezes.filter((f) => f.status === 'active')
    expect(active.length).toBeGreaterThan(0)

    await releaseFreezeById(db, active[0].id, 'reviewed', adv.userId)

    const remaining = await listFreezes(db, adv.userId)
    expect(remaining.filter((f) => f.status === 'active')).toHaveLength(0)

    // Movement works again.
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-after-release',
    })
    expect(topup.ok).toBe(true)
  })
})

describe('reconcile', () => {
  it('reports zero drift when projection matches the log', async () => {
    const adv = await freshAdv('wallet-recon@test.invalid')
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Rahul Sharma',
      payerEmail: 'rahul@example.test',
      payerAddress: '1 MG Road, Bangalore',
      idempotencyKey: 'topup-recon-1',
    })
    await confirmWalletTopup(db, topup.topup.id, 'ref-recon', adv.userId)

    const result = await reconcileWallet(db, adv.userId)
    expect(result.balanced).toBe(true)
    expect(result.drift_credits).toBe(0)
    expect(result.balance_credits).toBe(result.computed_credits)
  })
})

describe('client cannot write money', () => {
  it('rejects an authenticated user calling confirm_wallet_topup', async () => {
    const adv = await freshAdv('wallet-client-confirm@test.invalid')
    const topup = await createWalletTopup(db, adv.userId, {
      amountMinor: 10000,
      currency: 'INR',
      paymentMethod: 'upi',
      payerName: 'Payer',
      payerEmail: 'payer@example.test',
      payerAddress: '1 Street',
      idempotencyKey: 'topup-client-confirm',
    })
    await expect(
      asUser(db, adv.userId, async (tx) => {
        await tx.query(`SELECT public.confirm_wallet_topup($1::uuid,$2::text,$3::uuid) AS result`, [
          topup.topup.id, null, adv.userId,
        ])
      }),
    ).rejects.toThrow()
  })

  it('rejects an authenticated user inserting into wallet_transactions', async () => {
    const adv = await freshAdv('wallet-client-insert@test.invalid')
    await expect(
      asUser(db, adv.userId, async (tx) => {
        await tx.query(
          `INSERT INTO public.wallet_transactions
             (wallet_id, profile_id, kind, direction, credits, balance_after,
              idempotency_key, description)
           VALUES ($1,$2,'topup','credit',1,1,'client-write','client attempt')`,
          [uuid(), adv.userId],
        )
      }),
    ).rejects.toThrow()
  })
})
