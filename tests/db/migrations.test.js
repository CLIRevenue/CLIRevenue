/**
 * Do migrations 000001-000012 actually apply, in order, to a real Postgres?
 *
 * Every previous review of this repository inspected the SQL by reading it.
 * This executes it. It is the cheapest possible signal and the one that was
 * entirely missing: if a migration cannot be applied, nothing downstream of it
 * is worth discussing.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { migrate, close, migrationFiles } from './pg.js'

let db
let applied

afterAll(async () => {
  if (db) await close(db)
})

describe('migrations apply to a real Postgres', () => {
  it('applies 000001 through 000012 in filename order', async () => {
    const result = await migrate()
    db = result.db
    applied = result.applied
    expect(applied).toContain('000001_init_schema.sql')
    expect(applied).toContain('000012_remove_global_active_campaign.sql')
  }, 60_000)

  it('applies every migration file present, with none skipped', () => {
    // Derived from the directory rather than hardcoded, so adding a
    // migration cannot silently leave it unapplied.
    expect(applied).toEqual(migrationFiles())
  })

  it('creates the tables the accounting functions depend on', async () => {
    const { rows } = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('campaigns','reward_ledger','payouts',
                           'payout_transactions','ad_impressions',
                           'ad_interactions','profiles','advertisers',
                           'developer_accounts','audiences','platform_settings')
      ORDER BY table_name;
    `)
    expect(rows.map((r) => r.table_name)).toEqual([
      'ad_impressions',
      'ad_interactions',
      'advertisers',
      'audiences',
      'campaigns',
      'developer_accounts',
      'payout_transactions',
      'payouts',
      'platform_settings',
      'profiles',
      'reward_ledger',
    ])
  })

  it("reward_status gained 'consumed' from 000009", async () => {
    const { rows } = await db.query(`
      SELECT e.enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'reward_status' ORDER BY e.enumsortorder;
    `)
    expect(rows.map((r) => r.enumlabel)).toEqual(['accrued', 'available', 'consumed'])
  })

  it('000012 removed the global active_campaign_id column', async () => {
    const { rows } = await db.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='platform_settings'
        AND column_name='active_campaign_id';
    `)
    expect(rows).toHaveLength(0)
  })

  it('000012 removed the advertiser/admin UPDATE path on platform_settings', async () => {
    const { rows } = await db.query(`
      SELECT policyname FROM pg_policies
      WHERE tablename='platform_settings' AND 'UPDATE' = upper(cmd);
    `)
    expect(rows).toHaveLength(0)
  })

  it('defines the four money-moving functions plus the event and provisioning RPCs', async () => {
    const { rows } = await db.query(`
      SELECT p.proname FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('reward_balance','request_payout','apply_settlement',
                          'apply_interaction','apply_impression','ensure_own_profile',
                          'provision_publisher_slot')
      ORDER BY p.proname;
    `)
    expect(rows.map((r) => r.proname)).toEqual([
      'apply_impression',
      'apply_interaction',
      'apply_settlement',
      'ensure_own_profile',
      'provision_publisher_slot',
      'request_payout',
      'reward_balance',
    ])
  })

  it('exposes the provisioning RPC to service_role only', async () => {
    // The browser holds the Supabase anon key, which is public. If this
    // function were callable by anon or authenticated, anyone could provision
    // a publisher for an arbitrary profile id and mint themselves a key.
    const { rows } = await db.query(`
      SELECT has_function_privilege('anon', 'public.provision_publisher_slot(uuid,text)', 'EXECUTE')   AS anon_exec,
             has_function_privilege('authenticated', 'public.provision_publisher_slot(uuid,text)', 'EXECUTE') AS auth_exec,
             has_function_privilege('service_role', 'public.provision_publisher_slot(uuid,text)', 'EXECUTE') AS svc_exec
    `)
    expect(rows[0].anon_exec).toBe(false)
    expect(rows[0].auth_exec).toBe(false)
    expect(rows[0].svc_exec).toBe(true)
  })
})
