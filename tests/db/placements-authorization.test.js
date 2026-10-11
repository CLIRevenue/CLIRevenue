/**
 * The database half of the placement-creation contract.
 *
 * `POST /cli/placements` is the first thing in this repository that WRITES a
 * placement row. Everything about its safety is decided by the schema, not by
 * the Edge Function, so the schema facts are pinned here against a real
 * Postgres engine:
 *
 *   1. `UNIQUE (publisher_id, placement_key)` is scoped to one publisher.
 *      A publisher cannot take another publisher's key -- which is what makes
 *      the "create" path idempotent without exposing anything -- but two
 *      publishers may each hold the same readable key, because the key is only
 *      ever meaningful inside the publisher that owns it.
 *   2. The same constraint is what a duplicate request collides with, and the
 *      error a client can observe is a unique violation, not a permission
 *      error. `handleCreatePlacement` reads exactly that code.
 *   3. `anon` and `authenticated` are REVOKEd from `placements` entirely, so a
 *      browser can neither insert a placement nor read one. A publisher
 *      therefore cannot create or enumerate a placement by talking to
 *      PostgREST with its own session -- the only path is the publisher key
 *      exchanged at the Edge Function.
 *   4. `service_role` retains INSERT, which is the role the Edge Function
 *      uses. That is not a bypass invented for this feature: migration
 *      000014 granted it before any create path existed.
 *
 * No migration is required for placement creation. The table already carries
 * `publisher_id` and `UNIQUE (publisher_id, placement_key)`; geometry is
 * deliberately NOT stored server-side and lives in the user's project config.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import { asAnon, asService, asUser, createPublisher, createUser, uuid } from './fixtures.js'

let db

beforeAll(async () => {
  db = (await migrate()).db
}, 60000)

afterAll(async () => {
  await close(db)
})

/** Insert a placement as the service role -- the only role the function runs as. */
function insertAsService(publisherId, placementKey, overrides = {}) {
  const id = uuid()
  return asService(db, (tx) =>
    tx.query(
      `INSERT INTO public.placements (id, publisher_id, placement_key, name, enabled)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, publisher_id, placement_key, name, enabled`,
      [
        id,
        publisherId,
        placementKey,
        overrides.name ?? 'Home',
        overrides.enabled ?? true,
      ],
    ).then((result) => ({ ...result.rows[0], id })),
  )
}

describe('placement creation as the schema sees it', () => {
  it('the service role can create a placement for a publisher', async () => {
    const publisher = await createPublisher(db, { name: 'Creator' })

    const created = await insertAsService(publisher, 'home', { name: 'Home hero' })

    expect(created.publisher_id).toBe(publisher)
    expect(created.placement_key).toBe('home')
    expect(created.name).toBe('Home hero')
    expect(created.enabled).toBe(true)
  })

  it('one publisher cannot create the same placement key twice', async () => {
    const publisher = await createPublisher(db, { name: 'Duplicate target' })
    const first = await insertAsService(publisher, 'sidebar')

    // The rejected promise IS the assertion: the row is never written, and the
    // client-visible failure is a unique violation -- which is precisely the
    // code handleCreatePlacement classifies as a duplicate.
    await expect(
      insertAsService(publisher, 'sidebar', { name: 'Second attempt' }),
    ).rejects.toThrow(/duplicate key/i)

    // The original row is untouched -- a duplicate never renames or replaces
    // what is already there, which is what makes a retried create safe.
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT id, name FROM public.placements WHERE publisher_id = $1`, [publisher]),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(first.id)
    expect(rows[0].name).toBe('Home')
  })

  it('two publishers may each hold the same placement key', async () => {
    // The constraint is scoped to (publisher_id, placement_key). A placement
    // key is only meaningful to the publisher that owns it -- the delivery
    // path always resolves one inside the publisher's own scope -- so two
    // publishers using "home" is a normal state, not a collision. This is
    // also why cross-publisher creation is a 403 in the function and not a
    // unique violation: nothing about the other publisher is even consulted.
    const alice = await createPublisher(db, { name: 'Alice' })
    const bob = await createPublisher(db, { name: 'Bob' })

    const a = await insertAsService(alice, 'home', { name: 'Alice home' })
    const b = await insertAsService(bob, 'home', { name: 'Bob home' })

    expect(a.publisher_id).toBe(alice)
    expect(b.publisher_id).toBe(bob)
    expect(a.id).not.toBe(b.id)
  })

  it('a browser cannot create a placement', async () => {
    const dev = await createUser(db, { email: 'placement-writer@test.invalid', role: 'developer' })
    const publisher = await createPublisher(db, { name: 'Not the browser' })

    // Each rejected promise is the assertion: no INSERT reaches the table
    // under a client role, so a publisher's session can never mint a row.
    await expect(
      asUser(db, dev.userId, (tx) =>
        tx.query(
          `INSERT INTO public.placements (publisher_id, placement_key) VALUES ($1, 'hijack')`,
          [publisher],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asAnon(db, (tx) =>
        tx.query(
          `INSERT INTO public.placements (publisher_id, placement_key) VALUES ($1, 'anon')`,
          [publisher],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)

    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT placement_key FROM public.placements WHERE publisher_id = $1`, [publisher]),
    )
    expect(rows).toEqual([])
  })

  it('a browser cannot read placements either, so nothing can be enumerated', async () => {
    const dev = await createUser(db, { email: 'placement-reader@test.invalid', role: 'developer' })
    const publisher = await createPublisher(db, { name: 'Private inventory' })
    await insertAsService(publisher, 'private-home')

    await expect(
      asUser(db, dev.userId, (tx) =>
        tx.query(`SELECT placement_key FROM public.placements`),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asAnon(db, (tx) => tx.query(`SELECT placement_key FROM public.placements`)),
    ).rejects.toThrow(/permission denied/i)

    // The Edge Function -- and only the Edge Function -- reads them, scoped to
    // the publisher derived from the key hash.
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT placement_key FROM public.placements WHERE publisher_id = $1`, [publisher]),
    )
    expect(rows.map((row) => row.placement_key)).toEqual(['private-home'])
  })

  it('a placement is removed with its publisher, so creation cannot outlive ownership', async () => {
    const publisher = await createPublisher(db, { name: 'Short lived' })
    const placement = await insertAsService(publisher, 'home')

    await asService(db, (tx) => tx.query(`DELETE FROM public.publishers WHERE id = $1`, [publisher]))

    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT id FROM public.placements WHERE id = $1`, [placement.id]),
    )
    expect(rows).toEqual([])
  })

  it('placements carry no geometry columns, because geometry is a client-side concern', async () => {
    // Requirement: do not add geometry columns unless inspection proves they
    // are necessary. Inspection proved they are not -- the SDK resolves a
    // layout from an anchor plus an offset inside its host element, so the
    // editor persists width/height/anchor/offset in the user's
    // clirevenue.config.json, and the server needs only to know WHICH
    // placement to serve. This test fails loudly if someone later adds them,
    // so the decision stays a documented one instead of a silent drift.
    const { rows } = await asService(db, (tx) =>
      tx.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'placements'
         ORDER BY column_name`,
      ),
    )
    const columns = rows.map((row) => row.column_name)
    expect(columns).toEqual([
      'allowed_audience_id',
      'created_at',
      'enabled',
      'id',
      'name',
      'placement_key',
      'publisher_id',
      'updated_at',
    ])
  })
})