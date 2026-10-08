/**
 * The database half of the publisher_keys ownership contract.
 *
 * The Edge Function's bug was a shape error, not a data error: a developer
 * with no publisher row legitimately matches zero publishers. These tests pin
 * that against the real schema so the behaviour is a documented fact rather
 * than a surprise:
 *
 *   1. a developer who has not provisioned owns zero publishers,
 *   2. a publisher with a NULL owner_profile_id is never reachable by an
 *      owner-scoped lookup (it is how unowned and test publishers exist, and
 *      it is why the fix must never "just take the first publisher"),
 *   3. provisioning creates exactly one publisher for exactly that owner and
 *      is idempotent,
 *   4. the partial unique index publishers_owner_profile_id_key (000016)
 *      makes duplicates impossible, so .single() was never the right shape
 *      but a duplicate is also not the failure mode anyone should see,
 *   5. the owner-scoped lookup is a service-role operation only -- an
 *      authenticated browser cannot enumerate publishers at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import { asAnon, asService, asUser, createPublisher, createUser } from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60000)

afterAll(async () => {
  await close(db)
})

const provision = (ownerId, name = 'Contract publisher') =>
  asService(db, tx => tx.query('SELECT public.provision_publisher_slot($1, $2) AS slot', [ownerId, name]))

const ownedBy = (profileId) =>
  asService(db, tx =>
    tx.query('SELECT id, name FROM public.publishers WHERE owner_profile_id = $1 ORDER BY id', [profileId]),
  )

describe('publisher ownership as the Edge Function sees it', () => {
  it('a developer who has not provisioned owns zero publishers', async () => {
    const dev = await createUser(db, { email: 'unprovisioned@test.invalid', role: 'developer' })
    // This is the state that produced PGRST116. The query is empty, not failing.
    const before = await ownedBy(dev.profile_id)
    expect(before.rows).toEqual([])
    expect(before.rowCount).toBe(0)
  })

  it('provisioning creates exactly one publisher owned by that profile', async () => {
    const dev = await createUser(db, { email: 'provision-once@test.invalid', role: 'developer' })
    const slot = await provision(dev.profile_id)
    expect(slot.rows[0].slot.publisher_created).toBe(true)
    expect(slot.rows[0].slot.publisher_id).toBeTruthy()

    const owned = await ownedBy(dev.profile_id)
    expect(owned.rowCount).toBe(1)
    expect(owned.rows[0].id).toBe(slot.rows[0].slot.publisher_id)

    // And a second call adds nothing.
    const again = await provision(dev.profile_id)
    expect(again.rows[0].slot.publisher_created).toBe(false)
    expect(again.rows[0].slot.publisher_id).toBe(slot.rows[0].slot.publisher_id)
    expect((await ownedBy(dev.profile_id)).rowCount).toBe(1)
  })

  it('an unowned publisher is invisible to every owner-scoped lookup', async () => {
    // publisher_keys must never adopt this row. It is the shape of every
    // fixture and orphaned publisher in a shared database.
    const orphan = await createPublisher(db, { name: 'Orphan publisher' })
    const lookup = await asService(db, tx =>
      tx.query('SELECT id FROM public.publishers WHERE owner_profile_id = $1', [orphan.publisherId]),
    )
    expect(lookup.rows).toEqual([])
    expect(lookup.rowCount).toBe(0)

    // A developer provisioned afterwards owns only their own row.
    const dev = await createUser(db, { email: 'after-orphan@test.invalid', role: 'developer' })
    await provision(dev.profile_id)
    const owned = await ownedBy(dev.profile_id)
    expect(owned.rowCount).toBe(1)
    expect(owned.rows[0].id).not.toBe(orphan.publisherId)
  })

  it('the owner-scoped lookup can never return more than one row', async () => {
    // publishers_owner_profile_id_key is a partial unique index over
    // non-null owners (000016). This is the guarantee that makes the
    // .limit(1) in getPublisherId belt-and-braces rather than load-bearing.
    const { rows } = await asService(db, tx =>
      tx.query(`SELECT indexdef FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'publishers_owner_profile_id_key'`),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].indexdef).toMatch(/CREATE UNIQUE INDEX/)
    expect(rows[0].indexdef).toMatch(/\(owner_profile_id\)/)
    expect(rows[0].indexdef).toMatch(/owner_profile_id IS NOT NULL/)
  })

  it('a browser cannot enumerate publishers, so ownership cannot be spoofed', async () => {
    const dev = await createUser(db, { email: 'readonly-dev@test.invalid', role: 'developer' })
    await provision(dev.profile_id)

    // The transaction rolls back on the error, so each rejected promise is
    // the assertion: the query never silently succeeds under a client role.
    await expect(
      asUser(db, dev.userId, tx => tx.query('SELECT id FROM public.publishers')),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asAnon(db, tx => tx.query('SELECT id FROM public.publishers')),
    ).rejects.toThrow(/permission denied/i)

    // And it cannot attach itself to one either.
    await expect(
      asUser(db, dev.userId, tx =>
        tx.query('UPDATE public.publishers SET owner_profile_id = $1', [dev.profile_id]),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})