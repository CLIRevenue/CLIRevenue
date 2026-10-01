/**
 * Authorization and RLS behaviour, executed against a real Postgres.
 *
 * These assertions only mean something because the harness switches to
 * SET LOCAL ROLE. PGlite's default role is a superuser and superusers
 * BYPASS RLS, so querying directly would pass no matter what the policies
 * said. Every test here runs as `authenticated`, `anon` or `service_role`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { migrate, close } from './pg.js'
import {
  createUser, createCampaign, campaignState,
  asUser, asAnon, asService, uuid,
} from './fixtures.js'

let db
let alice
let bob
let aliceCampaign
let bobCampaign
let devA
let devB

beforeAll(async () => {
  db = (await migrate()).db
  alice = await createUser(db, { email: 'alice@test.invalid', role: 'advertiser' })
  bob = await createUser(db, { email: 'bob@test.invalid', role: 'advertiser' })
  aliceCampaign = await createCampaign(db, alice.advertiser_id, { name: 'Alice campaign' })
  bobCampaign = await createCampaign(db, bob.advertiser_id, { name: 'Bob campaign' })
  devA = await createUser(db, { email: 'deva@test.invalid', role: 'developer' })
  devB = await createUser(db, { email: 'devb@test.invalid', role: 'developer' })
}, 60_000)

afterAll(async () => {
  if (db) await close(db)
})

describe('advertiser isolation', () => {
  it('1. an advertiser sees only their own campaigns', async () => {
    const { rows } = await asUser(db, alice.userId, (tx) =>
      tx.query(`SELECT id, name FROM public.campaigns ORDER BY name`),
    )
    // RLS filters rather than erroring, so the other tenant's row is absent.
    expect(rows.map((r) => r.name)).toEqual(['Alice campaign'])
  })

  it('2. an advertiser cannot see a specific rival campaign by id', async () => {
    const { rows } = await asUser(db, alice.userId, (tx) =>
      tx.query(`SELECT id FROM public.campaigns WHERE id = $1`, [bobCampaign]),
    )
    expect(rows).toHaveLength(0)
  })

  it('3. an advertiser cannot update any campaign through PostgREST', async () => {
    // UPDATE is revoked from `authenticated` outright by 000008, so this is
    // blocked by privilege before RLS is even consulted.
    await expect(
      asUser(db, alice.userId, (tx) =>
        tx.query(`UPDATE public.campaigns SET name = 'hijacked' WHERE id = $1`, [bobCampaign]),
      ),
    ).rejects.toThrow(/permission denied/i)

    const state = await asService(db, (tx) =>
      tx.query(`SELECT name FROM public.campaigns WHERE id = $1`, [bobCampaign]),
    )
    expect(state.rows[0].name).toBe('Bob campaign')
  })

  it('4. an advertiser cannot insert a campaign', async () => {
    await expect(
      asUser(db, alice.userId, (tx) =>
        tx.query(
          `INSERT INTO public.campaigns
             (advertiser_id, name, headline, audience_id, budget_cents)
           VALUES ($1,'Injected','x','backend',1)`,
          [bob.advertiser_id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('5. an anonymous caller cannot read campaigns at all', async () => {
    await expect(
      asAnon(db, (tx) => tx.query(`SELECT id FROM public.campaigns`)),
    ).rejects.toThrow(/permission denied/i)
  })
})

describe('accounting integrity', () => {
  it('6. the service role can still write accounting, so the Edge Function path works', async () => {
    // Positive counterpart to test 3. The trigger freezes accounting columns
    // only for anon/authenticated, so if this ever broke, every impression
    // would silently stop being billed.
    await asService(db, (tx) =>
      tx.query(
        `UPDATE public.campaigns
            SET spend_milli_cents = 777, impressions_count = 3
          WHERE id = $1`,
        [aliceCampaign],
      ),
    )
    const state = await campaignState(db, aliceCampaign)
    expect(state.spend_milli_cents).toBe(777)
    expect(state.impressions_count).toBe(3)
  })

  it('7. an authenticated caller cannot write the ledger', async () => {
    await expect(
      asUser(db, devA.userId, (tx) =>
        tx.query(
          `INSERT INTO public.reward_ledger
             (developer_id, campaign_id, interaction_id, amount_cents, remaining_cents, status)
           VALUES ($1,$2,$3,999999,999999,'available')`,
          [devA.developer_id, aliceCampaign, uuid()],
        ),
      ),
    ).rejects.toThrow(/permission denied|null value|foreign key/i)
  })

  it('8. an authenticated caller cannot create payouts', async () => {
    await expect(
      asUser(db, devA.userId, (tx) =>
        tx.query(
          `INSERT INTO public.payouts (developer_id, amount_cents, provider_id, status)
           VALUES ($1, 1000, 'forged', 'requested')`,
          [devA.developer_id],
        ),
      ),
    ).rejects.toThrow(/permission denied/i)
  })

  it('9. a developer cannot read another developer account', async () => {
    const { rows } = await asUser(db, devA.userId, (tx) =>
      tx.query(`SELECT id FROM public.developer_accounts`),
    )
    expect(rows.map((r) => r.id)).toEqual([devA.developer_id])
  })

  it('10. a developer cannot escalate their own role to admin', async () => {
    // 000007 revoked table-level UPDATE from `authenticated` and granted only
    // the six self-reported columns, so `role` is not writable at all: the
    // statement is refused at the privilege layer, before RLS is consulted.
    await expect(
      asUser(db, devA.userId, (tx) =>
        tx.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [devA.userId]),
      ),
    ).rejects.toThrow(/permission denied/i)

    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT role FROM public.profiles WHERE id = $1`, [devA.userId]),
    )
    expect(rows[0].role).toBe('developer')
  })

  it('10b. the column-level grant still lets a user edit their own name', async () => {
    // Counterpart to test 10: the restriction is least privilege, not a blanket
    // lock. If this broke, profile editing in the app would break.
    await asUser(db, devA.userId, (tx) =>
      tx.query(`UPDATE public.profiles SET full_name = 'Renamed' WHERE id = $1`, [devA.userId]),
    )
    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT full_name FROM public.profiles WHERE id = $1`, [devA.userId]),
    )
    expect(rows[0].full_name).toBe('Renamed')
  })

  it('10c. a user cannot edit another user profile', async () => {
    // RLS filters the target rows out, so this is a silent no-op with
    // rowCount 0 rather than an error. Asserted on the effect, not the shape.
    const res = await asUser(db, devA.userId, (tx) =>
      tx.query(`UPDATE public.profiles SET full_name = 'Hacked' WHERE id = $1`, [devB.userId]),
    )
    expect(res.affectedRows).toBe(0)

    const { rows } = await asService(db, (tx) =>
      tx.query(`SELECT full_name FROM public.profiles WHERE id = $1`, [devB.userId]),
    )
    expect(rows[0].full_name).toBeNull()
  })
})

describe('audience definitions', () => {
  it('11. audiences are readable by anyone', async () => {
    const { rows } = await asAnon(db, (tx) =>
      tx.query(`SELECT id FROM public.audiences ORDER BY id LIMIT 3`),
    )
    expect(rows.length).toBeGreaterThan(0)
  })

  it('12. an authenticated caller cannot redefine an audience', async () => {
    // A client that could rewrite audiences could re-point every campaign
    // that targets one and change who sees which ad.
    await expect(
      asUser(db, devA.userId, (tx) =>
        tx.query(`UPDATE public.audiences SET label = 'hijacked' WHERE id = 'backend'`),
      ),
    ).rejects.toThrow(/permission denied/i)

    await expect(
      asUser(db, devA.userId, (tx) =>
        tx.query(`INSERT INTO public.audiences (id, label) VALUES ('forged','Forged')`),
      ),
    ).rejects.toThrow(/permission denied/i)
  })
})
