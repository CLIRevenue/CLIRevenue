/**
 * Source-text contract tests for the credit wallet.
 *
 * These read src/** and supabase/** as strings and assert that the
 * wallet surface exists with the expected shape. They do not mount
 * anything and need no DOM.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const REPO_ROOT = new URL('..', import.meta.url)

const src = (p) => readFileSync(new URL(p, REPO_ROOT), 'utf8')

describe('credit wallet surface exists', () => {
  it('migration 000000 creates wallets, topups, transactions, rates, freezes', () => {
    const sql = src('supabase/migrations/20261021120000_credit_wallets.sql')
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallets/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallet_transactions/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallet_topups/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.credit_rates/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.account_freezes/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.user_notifications/)
    expect(sql).toMatch(/ALTER TABLE public\.profiles[\s\S]*frozen_at/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.wallets[\s\S]*frozen_at/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.post_wallet_transaction/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.create_wallet_topup/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.confirm_wallet_topup/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.grant_free_credits/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.freeze_account/)
    expect(sql).toMatch(/CHECK \(balance_credits >= 0\)/)
    expect(sql).toMatch(/idempotency_key.*UNIQUE/)
  })

  it('migration 000001 widens advertiser_queries for unfreeze', () => {
    const sql = src('supabase/migrations/20261021120100_wallet_governance_campaign_credits.sql')
    expect(sql).toMatch(/'unfreeze'/)
    expect(sql).toMatch(/related_freeze_id/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.reserve_campaign_credits/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.settle_campaign_credit_hold/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.request_unfreeze/)
    expect(sql).toMatch(/INSUFFICIENT_CREDITS/)
    expect(sql).toMatch(/ACCOUNT_FROZEN/)
    expect(sql).toMatch(/on_profile_frozen_pause_campaigns/)
  })

  it('wallet Edge Function exposes snapshot, topups, notifications, unfreeze', () => {
    const code = src('supabase/functions/wallet/index.ts')
    expect(/case ["']snapshot["']/.test(code) || /\/wallet\/snapshot/.test(code)).toBe(true)
    expect(/case ["']transactions["']/.test(code) || /\/wallet\/transactions/.test(code)).toBe(true)
    expect(/case ["']topups["']/.test(code) || /\/wallet\/topups/.test(code)).toBe(true)
    expect(/case ["']notifications["']/.test(code) || /\/wallet\/notifications/.test(code)).toBe(true)
    expect(/case ["']topups["']/.test(code) || /\/wallet\/topups/.test(code)).toBe(true)
    expect(/case ["']unfreeze-request["']/.test(code) || /\/unfreeze-request/.test(code)).toBe(true)
  })

  it('admin Edge Function exposes credits and freeze routes', () => {
    const code = src('supabase/functions/admin/index.ts')
    expect(/case ["']credits["']/.test(code) || /"credits"/.test(code)).toBe(true)
    expect(/case ["']freeze["']/.test(code) || /"freeze"/.test(code)).toBe(true)
    expect(/case ["']freezes["']/.test(code) || /"freezes"/.test(code)).toBe(true)
  })

  it('publisher auth rejects frozen keys and frozen accounts', () => {
    const code = src('supabase/functions/_shared/publisherAuth.ts')
    expect(code).toMatch(/frozen_at/)
    expect(code).toMatch(/FROZEN_KEY|frozen.*key|key.*frozen/i)
    expect(code).toMatch(/ACCOUNT_FROZEN|account.*frozen/i)
  })

  it('wallet rules validate amounts, topups, grants, freezes', () => {
    const code = src('supabase/functions/_shared/walletRules.ts')
    expect(code).toMatch(/parseAmountToMinor/)
    expect(code).toMatch(/parseTopupRequest/)
    expect(code).toMatch(/parseGrantRequest/)
    expect(code).toMatch(/parseFreezeRequest/)
    expect(code).toMatch(/creditsForAmount/)
    expect(code).toMatch(/MONTHLY_GRANT_LIMIT/)
    expect(code).toMatch(/MIN_TOPUP_MINOR/)
    expect(code).toMatch(/MAX_TOPUP_MINOR/)
  })

  it('wallet API module exposes fetch and write functions', () => {
    const code = src('src/lib/walletApi.js')
    expect(code).toMatch(/fetchWalletSnapshot/)
    expect(code).toMatch(/fetchWalletLedger/)
    expect(code).toMatch(/fetchWalletTopups/)
    expect(code).toMatch(/fetchWalletNotifications/)
    expect(code).toMatch(/createWalletTopup/)
    expect(code).toMatch(/markWalletNotificationsRead/)
    expect(code).toMatch(/requestWalletUnfreeze/)
    expect(code).toMatch(/MIN_TOPUP_AMOUNT/)
  })

  it('wallet format module exists', () => {
    const code = src('src/lib/walletFormat.js')
    expect(code).toMatch(/formatCredits/)
    expect(code).toMatch(/formatCreditDelta/)
  })

  it('admin API module exposes grant/freeze/topup calls', () => {
    const code = src('src/lib/adminApi.js')
    expect(code).toMatch(/grantCredits/)
    expect(code).toMatch(/confirmTopup/)
    expect(code).toMatch(/rejectTopup/)
    expect(code).toMatch(/applyFreeze/)
    expect(code).toMatch(/releaseFreeze/)
    expect(code).toMatch(/listFreezes/)
  })

  it('advertiser billing uses wallet API, no simulated values', () => {
    const code = src('src/components/advertiser/AdvertiserBilling.jsx')
    expect(code).not.toMatch(/mock|sample|fixture/i)
    expect(code).toMatch(/fetchWalletSnapshot/)
    expect(code).toMatch(/createWalletTopup/)
    expect(code).toMatch(/balance_credits/)
    expect(code).not.toMatch(/placeholder=["']\d{4}/)
  })

  it('developer wallet mirrors advertiser wallet', () => {
    const code = src('src/components/developer/DeveloperWallet.jsx')
    expect(code).toMatch(/fetchWalletSnapshot/)
    expect(code).toMatch(/createWalletTopup/)
    expect(code).toMatch(/balance_credits/)
    expect(code).not.toMatch(/mock|sample|fixture/i)
  })

  it('admin wallet drawer has grant/freeze/release sections', () => {
    const code = src('src/components/admin/AdminWalletDrawer.jsx')
    expect(code).toMatch(/grantCredits/)
    expect(code).toMatch(/applyFreeze/)
    expect(code).toMatch(/releaseFreeze/)
    expect(code).toMatch(/listFreezes/)
    expect(code).not.toMatch(/style\s*=\s*\{\{/)
  })

  it('admin advertisers and developers expose wallet buttons', () => {
    const adv = src('src/components/admin/AdminAdvertisers.jsx')
    const dev = src('src/components/admin/AdminDevelopers.jsx')
    expect(adv).toMatch(/AdminWalletDrawer/)
    expect(dev).toMatch(/AdminWalletDrawer/)
    expect(adv).not.toMatch(/class\s*=/)
    expect(dev).not.toMatch(/class\s*=/)
  })

  it('developer app and sidebar include wallet tab', () => {
    const app = src('src/components/developer/DeveloperApp.jsx')
    const sidebar = src('src/components/developer/DeveloperSidebar.jsx')
    expect(app).toMatch(/wallet/)
    expect(sidebar).toMatch(/wallet/)
  })

  it('no console.log in wallet-related source files', () => {
    const files = [
      'src/lib/walletApi.js',
      'src/lib/walletFormat.js',
      'src/components/advertiser/AdvertiserBilling.jsx',
      'src/components/developer/DeveloperWallet.jsx',
      'src/components/admin/AdminWalletDrawer.jsx',
      'src/components/admin/AdminAdvertisers.jsx',
      'src/components/admin/AdminDevelopers.jsx',
      'src/lib/adminApi.js',
    ]
    for (const f of files) {
      const code = src(f)
      expect(code).not.toMatch(/console\.log/)
    }
  })
})
