import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { migrate, close } from './pg.js'
import {
  asAnon,
  asService,
  asUser,
  createPublisher,
  createPublisherKey,
  createUser,
  generatePublisherKey,
  hashPublisherKey,
  uuid,
} from './fixtures.js'

/**
 * Signup → usable publishable key, with no operator.
 *
 * These tests exercise the SQL, not the Edge Function: the function is the
 * only thing that mints a key, and it does so by asking this RPC whether a
 * key exists and inserting when one does not. So the invariants that make
 * "refresh the page" safe have to hold here, against a real Postgres, or
 * they hold nowhere.
 */
let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60_000)

afterAll(async () => {
  await close(db)
})

/** Call the provisioning RPC the way the Edge Function does. */
function provision(ownerId, name = 'Test publisher') {
  return asService(db, (tx) =>
    tx.query('SELECT public.provision_publisher_slot($1, $2) AS slot', [ownerId, name]),
  ).then((res) => res.rows[0].slot)
}

describe('publisher provisioning RPC', () => {
  test('creates one publisher for a developer who has none', async () => {
    const { userId } = await createUser(db, { email: 'fresh-dev@example.com', role: 'developer' })

    const slot = await provision(userId, 'fresh-dev')

    expect(slot.publisher_created).toBe(true)
    expect(slot.publisher_name).toBe('fresh-dev')
    expect(slot.needs_key).toBe(true)

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT id, name, owner_profile_id FROM public.publishers WHERE owner_profile_id = $1', [userId]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(slot.publisher_id)
    expect(rows[0].owner_profile_id).toBe(userId)
  })

  test('is idempotent: a second call reuses the publisher and reports no key need', async () => {
    const { userId } = await createUser(db, { email: 'repeat-dev@example.com', role: 'developer' })

    const first = await provision(userId, 'repeat-dev')
    const second = await provision(userId, 'a different name that must be ignored')

    expect(second.publisher_id).toBe(first.publisher_id)
    expect(second.publisher_created).toBe(false)
    expect(second.publisher_name).toBe('repeat-dev')

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT count(*)::int AS n FROM public.publishers WHERE owner_profile_id = $1', [userId]),
    )
    expect(rows[0].n).toBe(1)
  })

  test('reports the existing key instead of asking for a second one', async () => {
    const { userId } = await createUser(db, { email: 'keyed-dev@example.com', role: 'developer' })
    const slot = await provision(userId, 'keyed-dev')
    const rawKey = generatePublisherKey()

    await createPublisherKey(db, slot.publisher_id, { label: 'signup' })
    // The fixture predates key_env, so stamp it the way the function does.
    await asService(db, (tx) =>
      tx.query('UPDATE public.publisher_keys SET key_env = $2 WHERE publisher_id = $1', [
        slot.publisher_id,
        'test',
      ]),
    )

    const after = await provision(userId, 'keyed-dev')
    expect(after.needs_key).toBe(false)
    expect(after.key_id).toBeTruthy()
    expect(after.key_env).toBe('test')
    expect(rawKey).not.toBe(after.key_prefix)

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT count(*)::int AS n FROM public.publisher_keys WHERE publisher_id = $1', [slot.publisher_id]),
    )
    expect(rows[0].n).toBe(1)
  })

  test('never returns a key hash, whatever the state', async () => {
    const { userId } = await createUser(db, { email: 'quiet-dev@example.com', role: 'developer' })
    const slot = await provision(userId, 'quiet-dev')
    const rawKey = `pk_test_${'a'.repeat(43)}`
    await createPublisherKey(db, slot.publisher_id, { label: 'signup' })
    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.publisher_keys
            SET key_hash = $2, key_prefix = $3, key_env = 'test'
          WHERE publisher_id = $1`,
        [slot.publisher_id, hashPublisherKey(rawKey), rawKey.slice(0, 12)],
      ),
    )

    const after = await provision(userId, 'quiet-dev')
    const serialised = JSON.stringify(after)

    expect(after.key_prefix).toBe(rawKey.slice(0, 12))
    expect(serialised).not.toContain(rawKey)
    expect(serialised).not.toContain(hashPublisherKey(rawKey))
    expect(Object.keys(after)).not.toContain('key_hash')
  })

  test('refuses a null owner', async () => {
    await expect(provision(null, 'nobody')).rejects.toThrow(/PUBLISHER_OWNER_REQUIRED/)
  })

  test('gives two developers two separate publishers', async () => {
    const a = await createUser(db, { email: 'iso-a@example.com', role: 'developer' })
    const b = await createUser(db, { email: 'iso-b@example.com', role: 'developer' })

    const slotA = await provision(a.userId, 'iso-a')
    const slotB = await provision(b.userId, 'iso-b')

    expect(slotA.publisher_id).not.toBe(slotB.publisher_id)

    // A's slot never mentions B's rows.
    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT owner_profile_id FROM public.publishers WHERE id = $1', [slotA.publisher_id]),
    )
    expect(rows[0].owner_profile_id).toBe(a.userId)
  })
})

describe('provisioning invariants live in the database', () => {
  test('one publisher per owner profile', async () => {
    const { userId } = await createUser(db, { email: 'uniq-dev@example.com', role: 'developer' })
    const slot = await provision(userId, 'uniq-dev')

    await expect(
      asService(db, (tx) =>
        tx.query('INSERT INTO public.publishers (owner_profile_id, name) VALUES ($1, $2)', [
          userId,
          'second publisher',
        ]),
      ),
    ).rejects.toThrow(/duplicate key value|unique/i)
    expect(slot.publisher_id).toBeTruthy()
  })

  test('an unowned publisher is still allowed, because seed and staff rows are', async () => {
    const publisherId = await createPublisher(db, { name: 'Unowned seed publisher' })
    expect(publisherId).toBeTruthy()
    const otherId = await createPublisher(db, { name: 'Another unowned seed publisher' })
    expect(otherId).not.toBe(publisherId)
  })

  test('only one active key per publisher per environment', async () => {
    const { userId } = await createUser(db, { email: 'env-dev@example.com', role: 'developer' })
    const slot = await provision(userId, 'env-dev')
    const publisherId = slot.publisher_id

    const insertKey = (env) =>
      asService(db, (tx) =>
        tx.query(
          `INSERT INTO public.publisher_keys (id, publisher_id, key_hash, key_prefix, key_env, label)
           VALUES ($1, $2, $3, $4, $5, 'signup')`,
          [uuid(), publisherId, hashPublisherKey(`${env}-${Math.random()}`), `pk_${env}_abcdefgh`, env],
        ),
      )

    await insertKey('test')
    await expect(insertKey('test')).rejects.toThrow(/duplicate key value|unique/i)
    // A different environment is a different slot, so this must not collide.
    await expect(insertKey('live')).resolves.toBeTruthy()
  })

  test('a revoked key frees its slot for a replacement', async () => {
    const { userId } = await createUser(db, { email: 'revoke-dev@example.com', role: 'developer' })
    const slot = await provision(userId, 'revoke-dev')

    const revokedAt = new Date().toISOString()
    await createPublisherKey(db, slot.publisher_id, { revokedAt, label: 'first' })
    await asService(db, (tx) =>
      tx.query('UPDATE public.publisher_keys SET key_env = $2 WHERE publisher_id = $1', [
        slot.publisher_id,
        'test',
      ]),
    )

    // Revoked, so the active-key slot is free again.
    const rawKey = generatePublisherKey()
    await asService(db, (tx) =>
      tx.query(
        `INSERT INTO public.publisher_keys (id, publisher_id, key_hash, key_prefix, key_env, label)
         VALUES ($1, $2, $3, $4, 'test', 'replacement')`,
        [uuid(), slot.publisher_id, hashPublisherKey(rawKey), rawKey.slice(0, 12)],
      ),
    )

    const after = await provision(userId, 'revoke-dev')
    expect(after.needs_key).toBe(false)
    expect(after.key_label).toBe('replacement')
  })

  test('key_env is backfilled from an existing prefix and then constrained', async () => {
    const publisherId = await createPublisher(db, { name: 'Backfill publisher' })
    const liveRaw = `pk_live_${'L'.repeat(43)}`
    const testRaw = `pk_test_${'T'.repeat(43)}`
    await asService(db, (tx) =>
      tx.query(
        `INSERT INTO public.publisher_keys (id, publisher_id, key_hash, key_prefix, label)
         VALUES ($1, $2, $3, $4, 'legacy'),
                ($5, $2, $6, $7, 'legacy')`,
        [
          uuid(),
          publisherId,
          hashPublisherKey(liveRaw),
          liveRaw.slice(0, 12),
          uuid(),
          hashPublisherKey(testRaw),
          testRaw.slice(0, 12),
        ],
      ),
    )
    // Re-run only the backfill statement, exactly as 000016 states it.
    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.publisher_keys
            SET key_env = CASE WHEN starts_with(key_prefix, 'pk_live_') THEN 'live'
                               WHEN starts_with(key_prefix, 'pk_test_') THEN 'test'
                               ELSE NULL END
          WHERE key_env IS NULL
            AND (starts_with(key_prefix, 'pk_live_') OR starts_with(key_prefix, 'pk_test_'))`,
      ),
    )

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT key_prefix, key_env FROM public.publisher_keys WHERE publisher_id = $1 ORDER BY key_prefix', [
        publisherId,
      ]),
    )
    expect(rows.map((r) => r.key_env).sort()).toEqual(['live', 'test'])

    await expect(
      asService(db, (tx) =>
        tx.query('UPDATE public.publisher_keys SET key_env = $2 WHERE publisher_id = $1', [
          publisherId,
          'staging',
        ]),
      ),
    ).rejects.toThrow(/publisher_keys_key_env_check/)
  })

  test('a key inserted without an environment does not block a real test key', async () => {
    const publisherId = await createPublisher(db, { name: 'Null-env publisher' })
    await createPublisherKey(db, publisherId, { label: 'fixture-style' })

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT key_env FROM public.publisher_keys WHERE publisher_id = $1', [publisherId]),
    )
    expect(rows[0].key_env).toBeNull()

    const rawKey = generatePublisherKey()
    await asService(db, (tx) =>
      tx.query(
        `INSERT INTO public.publisher_keys (id, publisher_id, key_hash, key_prefix, key_env, label)
         VALUES ($1, $2, $3, $4, 'test', 'real')`,
        [uuid(), publisherId, hashPublisherKey(rawKey), rawKey.slice(0, 12)],
      ),
    )
  })
})

describe('the RPC is not reachable from a browser', () => {
  test('service_role may execute it', async () => {
    const { userId } = await createUser(db, { email: 'grant-dev@example.com', role: 'developer' })
    await expect(provision(userId, 'grant-dev')).resolves.toBeTruthy()
  })

  test('anon may not', async () => {
    const { userId } = await createUser(db, { email: 'anon-dev@example.com', role: 'developer' })
    await expect(
      asAnon(db, (tx) => tx.query('SELECT public.provision_publisher_slot($1, $2)', [userId, 'anon'])),
    ).rejects.toThrow(/permission denied/i)
  })

  test('authenticated may not, even for their own account', async () => {
    const { userId } = await createUser(db, { email: 'self-dev@example.com', role: 'developer' })
    await expect(
      asUser(db, userId, (tx) =>
        tx.query('SELECT public.provision_publisher_slot($1, $2)', [userId, 'self']),
      ),
    ).rejects.toThrow(/permission denied/i)

    // And nothing was created by the attempt.
    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT count(*)::int AS n FROM public.publishers WHERE owner_profile_id = $1', [userId]),
    )
    expect(rows[0].n).toBe(0)
  })
})