/**
 * Schema integrity invariants.
 *
 * The payout_transactions bug this file exists for was invisible to every
 * source-reading review: 000001 and 000005 both attach a BEFORE UPDATE
 * trigger calling update_updated_at_column(), which assigns NEW.updated_at,
 * but the table was never given an updated_at column. Reading the SQL looks
 * fine; running it fails on the first UPDATE. The assertion below is written
 * generally, so any future table/trigger mismatch of the same shape is caught
 * rather than just this one instance.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import { createUser, asService, asRole } from './fixtures.js'

let db
let developer
let payoutId

beforeAll(async () => {
  db = (await migrate()).db
  developer = await createUser(db, { email: 'integrity-dev@test.invalid', role: 'developer' })
  // A payout row is needed to exercise a real UPDATE on payout_transactions.
  payoutId = await asService(db, async (tx) => {
    const { rows } = await tx.query(
      `INSERT INTO public.payouts (developer_id, amount_cents, provider_id, status)
       VALUES ($1, 100, 'integrity-rail', 'requested') RETURNING id`,
      [developer.developer_id],
    )
    await tx.query(
      `INSERT INTO public.payout_transactions (payout_id, type, amount_cents, provider_id, status)
       VALUES ($1,'payout',100,'integrity-rail','requested')`,
      [rows[0].id],
    )
    return rows[0].id
  })
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

describe('updated_at trigger consistency', () => {
  it('every table with an update_updated_at_column trigger actually has updated_at', async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query(`
        SELECT c.relname AS table_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_proc p ON p.oid = t.tgfoid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE p.proname = 'update_updated_at_column'
          AND n.nspname = 'public'
          AND NOT t.tgisinternal
          AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'updated_at'
          );
      `),
    )
    // Empty means no trigger points at a missing column.
    expect(rows).toEqual([])
  })

  it('payout_transactions can actually be updated', async () => {
    // Before the fix this raised: record "new" has no field "updated_at".
    const res = await asService(db, (tx) =>
      tx.query(
        `UPDATE public.payout_transactions SET status = 'sent' WHERE payout_id = $1`,
        [payoutId],
      ),
    )
    expect(res.affectedRows).toBe(1)

    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT status FROM public.payout_transactions WHERE payout_id = $1`, [payoutId]),
    )
    expect(rows[0].status).toBe('sent')
  })
})

describe('money function reachability', () => {
  it('the money RPCs are not executable by an authenticated client', async () => {
    // They bypass RLS, so anon/authenticated must not be able to call them
    // even directly. A client that could call request_payout itself could
    // move its own money without the Edge Function's checks.
    for (const call of [
      `SELECT public.request_payout($1, 1, 'x')`,
      `SELECT public.reward_balance($1)`,
      `SELECT public.apply_settlement(0, $1)`,
      `SELECT public.apply_impression($1, $1, 'cli', 'sess', 'k')`,
      `SELECT public.apply_interaction($1, $1, 'cli', 'sess', 'k2', NULL, 'click', 1)`,
    ]) {
      const res = await asRole(db, 'authenticated', developer.userId, async (tx) => {
        try {
          await tx.query(call, [developer.developer_id])
          return null
        } catch (err) {
          return err
        }
      })
      expect(res, `expected ${call} to be refused`).not.toBeNull()
      expect(String(res.message)).toMatch(/permission denied/i)
    }
  })
})
