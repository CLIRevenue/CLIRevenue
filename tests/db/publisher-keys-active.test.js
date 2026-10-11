/**
 * The one-active-key-per-environment contract, against the real schema.
 *
 * `supabase/functions/publisher_keys` now answers a duplicate POST with 409
 * `KEY_EXISTS` and the existing row's metadata. That is only honest if the
 * database really does refuse the second key — so this file pins the constraint
 * the Edge Function depends on, rather than trusting the comment above it:
 *
 *   1. a second active key for the same (publisher, environment) is rejected
 *      with 23505, which is exactly the condition `isUniqueViolation` matches,
 *   2. the rejected insert leaves the original row byte-for-byte intact, so a
 *      client that reads `existingKey` back is looking at the row that is
 *      really there,
 *   3. revoking the first key frees the slot, so the documented recovery
 *      ("revoke it before creating a replacement") actually works,
 *   4. the index is partial in the three ways its name suggests: revoked rows
 *      are excluded, NULL environments are excluded, and other publishers are
 *      unaffected. Without those, a publisher could only ever have had one key
 *      ever, which is not the design.
 *
 * LIMITATION, stated rather than hidden: these are sequential transactions.
 * PGlite runs one in-memory Postgres per test file and cannot reproduce two
 * concurrent inserts, so the racing-insert case is NOT covered here. What is
 * covered is that the constraint exists and behaves, which is what determines
 * the Edge Function's answer. The true race belongs in staging.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import { asService, createPublisher } from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60000)

afterAll(async () => {
  await close(db)
})

/**
 * Inserts an active key with an explicit `key_env`, which
 * `createPublisherKey` from the fixtures deliberately does not do (it leaves
 * the column NULL, which the partial index excludes).
 *
 * `RETURNING id` so a successful insert is observable as one row; without it
 * PostgREST-shaped callers get an empty result and cannot tell a silent insert
 * from a no-op.
 */
const insertActiveKey = (publisherId, keyEnv, label) =>
  asService(db, tx =>
    tx.query(
      `INSERT INTO public.publisher_keys (publisher_id, key_hash, key_prefix, key_env, label)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [publisherId, `hash-${label}-${keyEnv}`, `pk_live_${label.slice(0, 8)}`, keyEnv, label],
    ),
  )

const activeKeyRows = publisherId =>
  asService(db, tx =>
    tx.query(
      `SELECT key_prefix, key_env, label FROM public.publisher_keys
       WHERE publisher_id = $1 AND revoked_at IS NULL ORDER BY created_at, key_prefix`,
      [publisherId],
    ),
  ).then(r => r.rows)

const indexDefinition = () =>
  asService(db, tx =>
    tx.query(`SELECT indexdef FROM pg_indexes WHERE indexname = 'publisher_keys_active_env_key'`),
  ).then(r => r.rows[0]?.indexdef ?? '')

describe('one active key per publisher per environment', () => {
  it('rejects a second active key for the same environment with 23505', async () => {
    const publisherId = await createPublisher(db, { name: 'One key per env' })
    const first = await insertActiveKey(publisherId, 'test', 'first')
    expect(first.rows.length).toBe(1)

    await expect(insertActiveKey(publisherId, 'test', 'second')).rejects.toThrow(/duplicate key/i)

    const rows = await activeKeyRows(publisherId)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('first')
  })

  it('leaves the original row untouched when a duplicate is rejected', async () => {
    /* The 409 response tells the client to revoke `existingKey`. That is only
       safe if the row the client is shown is the row that will actually be
       revoked, so nothing about the first key may change on a failed insert. */
    const publisherId = await createPublisher(db, { name: 'Original survives' })
    await insertActiveKey(publisherId, 'test', 'keeper')
    const before = await activeKeyRows(publisherId)

    await expect(insertActiveKey(publisherId, 'test', 'impostor')).rejects.toThrow(/duplicate key/i)

    expect(await activeKeyRows(publisherId)).toEqual(before)
  })

  it('lets a replacement be created once the active key is revoked', async () => {
    /* This is the recovery the 409 message names. If revocation did not free
       the slot, the message would be telling users to do something that
       cannot work. */
    const publisherId = await createPublisher(db, { name: 'Revoke then replace' })
    const first = await insertActiveKey(publisherId, 'test', 'original')
    expect(first.rows.length).toBe(1)

    await asService(db, tx =>
      tx.query(`UPDATE public.publisher_keys SET revoked_at = now() WHERE publisher_id = $1`, [publisherId]),
    )

    const replacement = await insertActiveKey(publisherId, 'test', 'replacement')
    expect(replacement.rows).toHaveLength(1)

    const rows = await activeKeyRows(publisherId)
    expect(rows).toHaveLength(1)
    expect(rows[0].label).toBe('replacement')
  })

  it('scopes the constraint to the environment', async () => {
    /* `key_env` is part of the index, so a live key and a test key coexist.
       If this ever stopped holding, a publisher could never hold both, which
       is not what the column means. */
    const publisherId = await createPublisher(db, { name: 'Live and test' })
    expect((await insertActiveKey(publisherId, 'test', 'testkey')).rows).toHaveLength(1)
    expect((await insertActiveKey(publisherId, 'live', 'livekey')).rows).toHaveLength(1)
    expect(await activeKeyRows(publisherId)).toHaveLength(2)
  })

  it('scopes the constraint to the publisher', async () => {
    const a = await createPublisher(db, { name: 'Publisher A' })
    const b = await createPublisher(db, { name: 'Publisher B' })
    expect((await insertActiveKey(a, 'test', 'froma')).rows).toHaveLength(1)
    expect((await insertActiveKey(b, 'test', 'fromb')).rows).toHaveLength(1)
    expect(await activeKeyRows(a)).toHaveLength(1)
    expect(await activeKeyRows(b)).toHaveLength(1)
  })

  it('excludes keys with no environment, so fixtures and tooling are unaffected', async () => {
    /* Several test fixtures insert keys with key_env left NULL. If the index
       did not exclude NULL, every one of them would collide with every other
       one and unrelated suites would start failing for no visible reason. */
    const publisherId = await createPublisher(db, { name: 'Unscoped keys' })
    for (const label of ['one', 'two', 'three']) {
      await asService(db, tx =>
        tx.query(
          `INSERT INTO public.publisher_keys (publisher_id, key_hash, key_prefix, key_env, label)
           VALUES ($1, $2, $3, NULL, $4)`,
          [publisherId, `nullhash-${label}`, `pk_live_null${label.slice(0, 4)}`, label],
        ),
      )
    }
    expect((await activeKeyRows(publisherId))).toHaveLength(3)
    /* And an unscoped key does not collide with a scoped one either. */
    expect((await insertActiveKey(publisherId, 'test', 'scoped')).rows).toHaveLength(1)
  })

  it('keeps the index partial on revoked_at IS NULL', async () => {
    const def = await indexDefinition()
    expect(def).toMatch(/CREATE UNIQUE INDEX/)
    expect(def).toMatch(/publisher_id/)
    expect(def).toMatch(/key_env/)
    expect(def).toMatch(/revoked_at IS NULL/)
    expect(def).toMatch(/key_env IS NOT NULL/)
  })
})