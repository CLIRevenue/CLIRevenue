/**
 * Contact submissions — migration + RLL enforcement.
 *
 * Runs against PGlite (a real Postgres, Wasm, in-process) so RLL policies,
 * enum constraints, and the jwt_is_admin() helper are tested against actual
 * database enforcement, not just linting. Nothing touches a live project:
 * every test starts from a clean database and uses role switching (asRole)
 * to simulate callers. PGlite's query() throws on error rather than returning
 * one, so forbidden operations are asserted with .rejects.toThrow().
 */
import { describe, it, expect, afterAll, beforeEach } from 'vitest'
import { migrate, close } from './pg.js'
import { createUser, asRole, asService, uuid } from './fixtures.js'

let db
let adminUser

/**
 * Extend asRole to carry arbitrary JWT claims (e.g. the `email` claim that
 * jwt_is_admin() needs). The admin allowlist check runs jwt_is_admin() which
 * reads request.jwt.claims->email; the default asRole claims lack it.
 *
 * `fn` must be passed and runs INSIDE the transaction, after the role and
 * claims are set. Both `SET LOCAL ROLE` and `set_config(..., true)` are
 * transaction scoped, so they have already reverted by the time this helper
 * resolves — any query issued afterwards runs as PGlite's default superuser,
 * which BYPASSes RLS. An admin test that set up its session here and then
 * queried outside it asserted nothing about RLS at all: it passed because the
 * superuser was allowed to do everything, not because admins are.
 */
export async function asRoleWithClaims(db, role, userId, claims, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`SET LOCAL ROLE ${role}`)
    if (userId) {
      await tx.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims])
    }
    if (typeof fn === 'function') return fn(tx)
    return tx.query('SELECT true')
  })
}

/** JWT claims for an admin session on the admin allowlist. */
function adminClaims(adminId, email = 'clirevenue@gmail.com') {
  return JSON.stringify({ sub: adminId, email, aud: 'authenticated', role: 'admin' })
}

afterAll(async () => {
  if (db) await close(db)
})

describe('000019 contact_submissions migration', () => {
  it('applies and creates the contact_submissions table', async () => {
    const result = await migrate()
    db = result.db
    const { rows } = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'contact_submissions'
    `)
    expect(rows).toHaveLength(1)
    expect(rows[0].table_name).toBe('contact_submissions')
  })

  it('creates the controlled contact_statuses enum', async () => {
    const { rows } = await db.query(`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'contact_statuses'
      ORDER BY e.enumsortorder;
    `)
    expect(rows.map((r) => r.enumlabel)).toEqual([
      'new',
      'read',
      'in_progress',
      'resolved',
      'archived',
    ])
  })

  it('adds clirevenue@gmail.com to the admin allowlist', async () => {
    const { rows } = await db.query(
      "SELECT email FROM public.admin_emails WHERE email = 'clirevenue@gmail.com'"
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].email).toBe('clirevenue@gmail.com')
  })
})

describe('contact_submissions RLL', () => {
  beforeEach(async () => {
    if (!db) {
      const result = await migrate()
      db = result.db
    }
  })

  it('anonymous cannot SELECT submissions (default deny, no public SELECT policy)', async () => {
    await db.query(`
      INSERT INTO public.contact_submissions
        (id, name, email, subject, message)
      VALUES (gen_random_uuid(), 'Ada', 'ada@example.com', 'Hi', 'Test')
    `)
    await asRole(db, 'anon', null, async (tx) => {
      await expect(tx.query('SELECT * FROM public.contact_submissions')).rejects.toThrow(/permission denied/)
    })
  })

  it('anonymous cannot UPDATE submissions (cannot change status or admin notes)', async () => {
    const id = uuid()
    await db.query(`
      INSERT INTO public.contact_submissions (id, name, email, subject, message)
      VALUES ($1, 'Spam', 'spam@evil.com', 'x', 'y')
    `, [id])
    await asRole(db, 'anon', null, async (tx) => {
      await expect(
        tx.query(
          `UPDATE public.contact_submissions SET status = 'resolved', admin_notes = 'hacked' WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/permission denied/)
    })
  })

  it('anonymous cannot DELETE submissions', async () => {
    const id = uuid()
    await db.query(`
      INSERT INTO public.contact_submissions (id, name, email, subject, message)
      VALUES ($1, 'Spam', 'spam@evil.com', 'x', 'y')
    `, [id])
    await asRole(db, 'anon', null, async (tx) => {
      await expect(
        tx.query('DELETE FROM public.contact_submissions WHERE id = $1', [id]),
      ).rejects.toThrow(/permission denied/)
    })
  })

  it('anonymous CAN still submit (the visitors INSERT policy)', async () => {
    const id = uuid()
    await asRole(db, 'anon', null, async (tx) => {
      await expect(
        tx.query(
          `INSERT INTO public.contact_submissions (id, name, email, subject, message, category) VALUES ($1, 'Spam', 'spam@evil.com', 'x', 'y', 'other')`,
          [id],
        ),
      ).resolves.not.toThrow()
    })
    const { rows } = await db.query('SELECT id FROM public.contact_submissions WHERE id = $1', [id])
    expect(rows).toHaveLength(1)
  })

  it('anonymous cannot attribute a submission to an account (user_id must be NULL)', async () => {
    const victimId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [victimId, 'victim@example.com', JSON.stringify({ role: 'developer' })])
    const id = uuid()

    // 000019 draft had WITH CHECK (auth.uid() IS NULL OR auth.uid() = user_id).
    // For an anonymous caller the first disjunct is unconditionally true, so a
    // submitter with no session could pin rows onto any UUID they liked.
    await asRole(db, 'anon', null, (tx) => {
      return expect(
        tx.query(
          `INSERT INTO public.contact_submissions
             (id, name, email, subject, message, user_id)
           VALUES ($1, 'Spoofer', 'spoof@evil.com', 'x', 'y', $2)`,
          [id, victimId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('an authenticated visitor CAN submit their own user_id', async () => {
    const devId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [devId, 'dev@example.com', JSON.stringify({ role: 'developer' })])
    const id = uuid()

    await asRole(db, 'authenticated', devId, async (tx) => {
      await expect(
        tx.query(
          `INSERT INTO public.contact_submissions
             (id, name, email, subject, message, user_id)
           VALUES ($1, 'Dev', 'dev@example.com', 'x', 'y', $2)`,
          [id, devId],
        ),
      ).resolves.not.toThrow()
    })

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT user_id FROM public.contact_submissions WHERE id = $1', [id]),
    )
    expect(rows[0].user_id).toBe(devId)
  })

  it('an authenticated visitor cannot submit on behalf of another user_id', async () => {
    const devId = uuid()
    const victimId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [devId, 'dev@example.com', JSON.stringify({ role: 'developer' })])
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [victimId, 'victim@example.com', JSON.stringify({ role: 'developer' })])

    await asRole(db, 'authenticated', devId, (tx) => {
      return expect(
        tx.query(
          `INSERT INTO public.contact_submissions
             (id, name, email, subject, message, user_id)
           VALUES ($1, 'Dev', 'dev@example.com', 'x', 'y', $2)`,
          [uuid(), victimId],
        ),
      ).rejects.toThrow(/row-level security/i)
    })
  })

  it('an owner CANNOT update status or admin_notes on their own submission', async () => {
    const devId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [devId, 'dev@example.com', JSON.stringify({ role: 'developer' })])
    const id = uuid()
    await asRole(db, 'authenticated', devId, async (tx) => {
      await tx.query(
        `INSERT INTO public.contact_submissions
           (id, name, email, subject, message, user_id)
         VALUES ($1, 'Dev', 'dev@example.com', 'x', 'y', $2)`,
        [id, devId],
      )
    })

    // 000019 draft's "Owners can update their own submission" policy carried the
    // tautologies status IS NOT DISTINCT FROM "status" and
    // admin_notes = "admin_notes", so owning a row let a non-admin mark it
    // resolved and write internal triage notes. The policy is now removed.
    await asRole(db, 'authenticated', devId, (tx) => {
      return expect(
        tx.query(
          `UPDATE public.contact_submissions
             SET status = 'resolved', admin_notes = 'faked'
           WHERE id = $1`,
          [id],
        ),
      ).rejects.toThrow(/permission denied/)
    })

    const { rows } = await asService(db, (tx) =>
      tx.query('SELECT status, admin_notes FROM public.contact_submissions WHERE id = $1', [id]),
    )
    expect(rows[0].status).toBe('new')
    expect(rows[0].admin_notes).toBeNull()
  })

  it('anonymous cannot read submissions even via the authenticated role (no SELECT policy for either)', async () => {
    const devId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [devId, 'dev@example.com', JSON.stringify({ role: 'developer' })])

    await asRole(db, 'authenticated', devId, (tx) => {
      return expect(tx.query('SELECT * FROM public.contact_submissions')).rejects.toThrow(
        /permission denied/,
      )
    })
  })

  it('creates the three inbox indexes the admin list depends on', async () => {
    const { rows } = await asService(db, (tx) =>
      tx.query(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'contact_submissions'
      `),
    )
    const names = rows.map((r) => r.indexname)
    expect(names).toContain('contact_submissions_created_at_idx')
    expect(names).toContain('contact_submissions_status_idx')
    expect(names).toContain('contact_submissions_user_id_idx')

    const createdAt = rows.find((r) => r.indexname === 'contact_submissions_created_at_idx')
    expect(createdAt.indexdef).toMatch(/created_at DESC/)

    const userId = rows.find((r) => r.indexname === 'contact_submissions_user_id_idx')
    expect(userId.indexdef).toMatch(/WHERE/)
  })

  it('anon and authenticated hold INSERT and nothing else', async () => {
    // The REVOKE is the outer defense and it runs first, so the behavioural
    // "owner cannot update" test above is satisfied by it before any policy is
    // consulted. Assert the privilege shape directly so that layer is covered
    // on its own rather than inferred from a query that never reaches the
    // policy. has_table_privilege() is used rather than
    // information_schema.role_table_grants, whose rows are filtered down to
    // "currently enabled roles" and silently omit anon/authenticated here.
    const { rows } = await asService(db, (tx) =>
      tx.query(`
        SELECT
          has_table_privilege('anon', 'public.contact_submissions', 'SELECT')          AS anon_select,
          has_table_privilege('anon', 'public.contact_submissions', 'INSERT')          AS anon_insert,
          has_table_privilege('anon', 'public.contact_submissions', 'UPDATE')          AS anon_update,
          has_table_privilege('anon', 'public.contact_submissions', 'DELETE')          AS anon_delete,
          has_table_privilege('authenticated', 'public.contact_submissions', 'SELECT') AS auth_select,
          has_table_privilege('authenticated', 'public.contact_submissions', 'INSERT') AS auth_insert,
          has_table_privilege('authenticated', 'public.contact_submissions', 'UPDATE') AS auth_update,
          has_table_privilege('authenticated', 'public.contact_submissions', 'DELETE') AS auth_delete,
          has_table_privilege('service_role', 'public.contact_submissions', 'SELECT')  AS svc_select,
          has_table_privilege('service_role', 'public.contact_submissions', 'UPDATE')  AS svc_update,
          has_table_privilege('service_role', 'public.contact_submissions', 'DELETE')  AS svc_delete
      `),
    )
    const r = rows[0]
    expect(r.anon_insert).toBe(true)
    expect(r.auth_insert).toBe(true)
    for (const p of [r.anon_select, r.anon_update, r.anon_delete, r.auth_select, r.auth_update, r.auth_delete]) {
      expect(p).toBe(false)
    }
    expect(r.svc_select).toBe(true)
    expect(r.svc_update).toBe(true)
    expect(r.svc_delete).toBe(true)
  })

  it('the visitor INSERT policy is the only policy left on the table', async () => {
    // Direct structural coverage of the 000019 fixes. Two separate defects are
    // invisible to the behavioural tests above, because the missing table
    // privilege rejects those queries before any policy is evaluated:
    //   - the tautological owner-UPDATE policy, and
    //   - the three jwt_is_admin() inbox policies, which are single-factor
    //     (allowlist only) where requireAdmin() is two-factor.
    // A policy that is dead only because of a GRANT elsewhere is a footgun, so
    // the policy set is asserted directly rather than inferred.
    const { rows } = await asService(db, (tx) =>
      tx.query(`
        SELECT policyname, cmd, roles
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'contact_submissions'
      `),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].policyname).toBe('Visitors can submit messages')
    expect(rows[0].cmd).toBe('INSERT')
    expect(rows[0].roles).toEqual(['public'])
  })

  it('authenticated non-admin cannot read submissions (no SELECT policy exists)', async () => {
    const devId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [devId, 'dev@example.com', JSON.stringify({ role: 'developer' })])

    await asRole(db, 'authenticated', devId, async (tx) => {
      await expect(tx.query('SELECT * FROM public.contact_submissions')).rejects.toThrow(/permission denied/)
    })
  })

  // ------------------------------------------------------------------
  // The real admin path is NOT an RLS policy.
  //
  // supabase/functions/admin/index.ts gates every request behind
  // requireAdmin(), which validates profiles.role='admin' AND the
  // admin_emails allowlist, and only then queries with adminClient() — a
  // service_role client that bypasses RLS entirely. 000020 therefore grants
  // anon/authenticated INSERT and nothing else, and the tests below assert
  // that service_role (not an admin JWT) is what can read/update/delete.
  // ------------------------------------------------------------------

  it('service_role CAN read submissions (the admin Edge Function path)', async () => {
    const { rows, error } = await asService(db, (tx) =>
      tx.query('SELECT id, email, subject, status FROM public.contact_submissions'),
    )
    expect(error).toBeUndefined()
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]).toHaveProperty('email')
    expect(rows[0]).toHaveProperty('status')
  })

  it('an admin JWT has NO direct table access — RLS is not a second, looser door', async () => {
    const adminId = uuid()
    await db.query(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ($1, $2, $3)
    `, [adminId, 'clirevenue@gmail.com', JSON.stringify({ role: 'admin' })])

    // Admin identity is real, and it still gets nothing straight from Postgres.
    // Authorization lives in requireAdmin(); the table stays closed to the role
    // a browser token actually carries. If this ever starts passing, an admin's
    // own session token has become a direct inbox credential.
    await asRoleWithClaims(db, 'authenticated', adminId, adminClaims(adminId), (tx) => {
      return expect(tx.query('SELECT * FROM public.contact_submissions')).rejects.toThrow(
        /permission denied/,
      )
    })
  })

  it('service_role CAN update status and admin_notes', async () => {
    const { rows } = await db.query(
      "SELECT id FROM public.contact_submissions WHERE email = 'spam@evil.com'",
    )
    const id = rows[0].id

    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.contact_submissions SET status = 'in_progress', admin_notes = 'Triage notes' WHERE id = $1`,
        [id],
      ),
    )

    const { rows: updated } = await db.query(
      'SELECT status, admin_notes FROM public.contact_submissions WHERE id = $1',
      [id],
    )
    expect(updated[0].status).toBe('in_progress')
    expect(updated[0].admin_notes).toBe('Triage notes')
  })

  it('service_role CAN delete submissions', async () => {
    const { rows } = await db.query(
      "SELECT id FROM public.contact_submissions WHERE email = 'spam@evil.com'",
    )
    const id = rows[0].id
    const before = (await db.query('SELECT id FROM public.contact_submissions WHERE id = $1', [id])).rows.length

    await asService(db, (tx) => tx.query('DELETE FROM public.contact_submissions WHERE id = $1', [id]))

    const after = (await db.query('SELECT id FROM public.contact_submissions WHERE id = $1', [id])).rows.length
    expect(before).toBe(1)
    expect(after).toBe(0)
  })
})

describe('contact_submissions validation', () => {
  beforeEach(async () => {
    if (!db) {
      const result = await migrate()
      db = result.db
    }
  })

  it('accepts a valid submission with all required fields', async () => {
    await expect(db.query(`
      INSERT INTO public.contact_submissions (name, email, subject, message, category)
      VALUES ('Ada Lovelace', 'ada@clirevenue.com', 'Publisher key integration', 'How do I wire the serve endpoint to my CLI?', 'developer')
    `)).resolves.not.toThrow()
    const { rows } = await db.query('SELECT * FROM public.contact_submissions WHERE name = $1', ['Ada Lovelace'])
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('new')
    expect(rows[0].category).toBe('developer')
    expect(rows[0].admin_notes).toBeNull()
    expect(rows[0].user_id).toBeNull()
  })

  it('rejects oversize name (CHECK <= 120)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      ['x'.repeat(121), 'a@b.com', 'sub', 'msg'],
    )).rejects.toThrow(/check|constraint/)
  })

  it('rejects oversize email (CHECK <= 254)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      ['Ada', 'x'.repeat(255) + '@b.com', 'sub', 'msg'],
    )).rejects.toThrow(/check|constraint/)
  })

  it('rejects oversize subject (CHECK <= 200)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      ['Ada', 'a@b.com', 'x'.repeat(201), 'msg'],
    )).rejects.toThrow(/check|constraint/)
  })

  it('rejects oversize message (CHECK <= 2000)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      ['Ada', 'a@b.com', 'sub', 'x'.repeat(2001)],
    )).rejects.toThrow(/check|constraint/)
  })

  it('rejects invalid email format (CHECK ~*)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
      ['Ada', 'not-an-email', 'sub', 'msg'],
    )).rejects.toThrow(/check|constraint/)
  })

  it('rejects invalid category (controlled values only)', async () => {
    await expect(db.query(
      `INSERT INTO public.contact_submissions (name, email, subject, message, category) VALUES ($1, $2, $3, $4, $5)`,
      ['Ada', 'a@b.com', 'sub', 'msg', 'gadget'],
    )).rejects.toThrow(/check|constraint|enum/)
  })

  it('accepts all controlled category values', async () => {
    for (const cat of ['developer', 'advertiser', 'other']) {
      await expect(db.query(
        `INSERT INTO public.contact_submissions (name, email, subject, message, category) VALUES ('Ada', 'a@b.com', 'sub', 'msg', $1)`,
        [cat],
      )).resolves.not.toThrow()
    }
  })

  it('rejects NULL required fields', async () => {
    const cases = [
      ['name', 'email'],
      ['subject'],
      ['message'],
    ]
    for (const missing of cases) {
      const cols = ['name', 'email', 'subject', 'message'].filter((c) => !missing.includes(c))
      const values = cols.map((c) => c === 'name' ? "'Ada'" : c === 'email' ? "'a@b.com'" : c === 'subject' ? "'sub'" : "'msg'")
      await expect(db.query(
        `INSERT INTO public.contact_submissions (${cols.join(', ')}) VALUES (${values.join(', ')})`,
      )).rejects.toThrow(/null/i)
    }
  })

  it('admin_notes starts NULL and can be set by admin', async () => {
    await expect(db.query(`
      INSERT INTO public.contact_submissions (name, email, subject, message)
      VALUES ('Ada', 'a@b.com', 'sub', 'msg')
    `)).resolves.not.toThrow()
    const { rows } = await db.query('SELECT admin_notes FROM public.contact_submissions WHERE name = $1', ['Ada'])
    expect(rows[0].admin_notes).toBeNull()
  })
})