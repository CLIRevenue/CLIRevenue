import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  normalizeCampaign,
  ctrPct,
  conversionRatePct,
  formatCents,
} from '../src/lib/advertiserApi.js'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const DASHBOARDS = {
  Overview: 'src/components/advertiser/AdvertiserOverview.jsx',
  Analytics: 'src/components/advertiser/AdvertiserAnalytics.jsx',
  Billing: 'src/components/advertiser/AdvertiserBilling.jsx',
}

/**
 * The rule this suite exists to keep: a metric the dashboard claims is real
 * must be arithmetic over a campaign row the backend returned. Not a literal,
 * not a placeholder, not a "sample" that looks plausible.
 */
describe('advertiser metrics come from backend rows, not from literals', () => {
  it('reads the real column names the campaigns endpoint returns', () => {
    const c = normalizeCampaign({
      id: 'x',
      name: 'Launch week',
      budget_cents: 150000,
      spend_milli_cents: 42000,
      spend_cents: 42,
      impressions_count: 1200,
      clicks_count: 37,
      conversions_count: 5,
      status: 'active',
      audience_id: 'data',
    })
    expect(c.budgetCents).toBe(150000)
    expect(c.spendCents).toBe(42)
    expect(c.impressions).toBe(1200)
    expect(c.clicks).toBe(37)
    expect(c.conversions).toBe(5)
    expect(c.status).toBe('active')
    expect(c.audienceLabel).toBe('Data & ML')
  })

  it('defaults every metric to zero, never to a plausible-looking number', () => {
    const c = normalizeCampaign({ id: 'empty' })
    expect(c.spendCents).toBe(0)
    expect(c.budgetCents).toBe(0)
    expect(c.impressions).toBe(0)
    expect(c.clicks).toBe(0)
    expect(c.conversions).toBe(0)
    expect(c.remainingBudgetCents).toBe(0)
    expect(c.status).toBe('draft')
  })

  it('ignores a non-numeric metric rather than coercing it', () => {
    // A backend that returned "1,204" as a string must read as zero, not NaN
    // and not a truncation. Zero is honest; a guess is not.
    const c = normalizeCampaign({ impressions_count: '1,204', clicks_count: null })
    expect(c.impressions).toBe(0)
    expect(c.clicks).toBe(0)
    expect(Number.isNaN(c.impressions)).toBe(false)
  })

  it('never lets remaining budget go negative', () => {
    const c = normalizeCampaign({ budget_cents: 100, spend_cents: 250 })
    expect(c.remainingBudgetCents).toBe(0)
  })

  it('rates are zero when the denominator is zero, not NaN', () => {
    expect(ctrPct(0, 0)).toBe(0)
    expect(conversionRatePct(0, 0)).toBe(0)
    expect(Number.isNaN(ctrPct(5, 0))).toBe(false)
    expect(Number.isNaN(conversionRatePct(5, 0))).toBe(false)
  })

  it('formats zero as a real amount rather than blank or dash', () => {
    expect(formatCents(0)).toBe('$0.00')
  })

  for (const [name, path] of Object.entries(DASHBOARDS)) {
    describe(`${name}`, () => {
      const src = read(path)

      it('takes its data from a campaigns prop, not a local fixture', () => {
        expect(src).toMatch(/\(\{\s*campaigns/)
        expect(src).not.toMatch(/useState\(\s*\[\s*\{/)
      })

      it('contains no hardcoded metric literal', () => {
        // A 4+ digit number with no thousands context is a metric someone
        // typed. The only literals allowed are dates/versions in prose.
        const suspicious = src.match(/(?<![\w.$])\d{4,}(?![\w.%])/g) || []
        expect(suspicious).toEqual([])
      })

      it('never invents a row when there is no data', () => {
        expect(src).toMatch(/length === 0|length === 0 \?|AdvEmpty/)
      })

      it('does not simulate, seed, or randomise numbers', () => {
        expect(src).not.toMatch(/Math\.random/)
        expect(src).not.toMatch(/\bsample\b|\bmock\b|\bfake\b|\bfixture\b/i)
      })
    })
  }
})

describe('billing money surface stays honest', () => {
  const src = read('src/components/advertiser/AdvertiserBilling.jsx')

  it('disables the payment action instead of faking a card form', () => {
    // The label text is the button's child, so `disabled` sits before it.
    expect(src).toMatch(/disabled[\s\S]{0,200}Add payment method/)
  })

  it('states that payments are not connected', () => {
    expect(src).toMatch(/aren't connected|not connected/i)
  })

  it('tells the user not to enter real payment details', () => {
    expect(src).toMatch(/Do not enter real payment details/)
  })

  it('derives its transaction list from campaign rows', () => {
    expect(src).toMatch(/campaigns\.reduce/)
    expect(src).toMatch(/rows\.length === 0/)
  })
})