import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { validateCampaignInput } from '../src/lib/advertiserApi.js'
import { advisoryBlockers, activationBlockerMessage } from '../src/lib/campaignRules.js'
import { campaignErrorMessage } from '../src/lib/campaignErrors.js'
import { MAX_AD_TEXT_LENGTH, countAdTextLength } from '../src/lib/adText.js'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const CAMPAIGN = {
  name: 'Launch week',
  audienceId: 'backend',
  budgetDollars: '1500',
  landingUrl: 'https://advertiser.example/landing',
}

/**
 * The dashboard is the only place the advertiser sees the 60 character limit
 * before the server refuses the ad. These assertions pin the three things
 * that make that promise true:
 *
 *   1. The form measures the headline the way the server measures it.
 *   2. The form refuses to submit a headline the server would refuse.
 *   3. The counter on screen is the same number, not a near neighbour of it.
 */
describe('the ad text the dashboard sends is the ad text the server accepts', () => {
  it('accepts a headline of exactly 60 characters', () => {
    const errors = validateCampaignInput({
      ...CAMPAIGN,
      headline: 'x'.repeat(MAX_AD_TEXT_LENGTH),
    })
    expect(errors.headline).toBeUndefined()
  })

  it('refuses a headline of 61 characters', () => {
    const errors = validateCampaignInput({
      ...CAMPAIGN,
      headline: 'x'.repeat(MAX_AD_TEXT_LENGTH + 1),
    })
    expect(errors.headline).toBeTruthy()
    expect(errors.headline).toContain(String(MAX_AD_TEXT_LENGTH))
  })

  it('refuses an empty headline', () => {
    const errors = validateCampaignInput({ ...CAMPAIGN, headline: '   ' })
    expect(errors.headline).toBeTruthy()
  })

  it('counts code points, so 60 emoji are 60 characters and not 120', () => {
    const emoji = '\u{1F600}'.repeat(MAX_AD_TEXT_LENGTH)
    expect(emoji.length).toBe(MAX_AD_TEXT_LENGTH * 2)
    expect(countAdTextLength(emoji)).toBe(MAX_AD_TEXT_LENGTH)
    expect(validateCampaignInput({ ...CAMPAIGN, headline: emoji }).headline).toBeUndefined()
  })

  it('accepts 61 characters that normalise down to 60', () => {
    const decomposed = 'e\u0301' + 'x'.repeat(MAX_AD_TEXT_LENGTH - 1)
    expect(countAdTextLength(decomposed)).toBe(MAX_AD_TEXT_LENGTH)
    expect(validateCampaignInput({ ...CAMPAIGN, headline: decomposed }).headline).toBeUndefined()
  })
})

describe('a campaign that cannot be served is reported before it is submitted', () => {
  it('advises on an over-long headline with the code the server uses', () => {
    const blockers = advisoryBlockers({
      budgetCents: 1000,
      audienceId: 'backend',
      headline: 'x'.repeat(MAX_AD_TEXT_LENGTH + 1),
      landingUrl: 'https://advertiser.example/landing',
    })
    expect(blockers).toContain('AD_TEXT_TOO_LONG')
    expect(activationBlockerMessage('AD_TEXT_TOO_LONG')).toContain('60')
  })

  it('advises on a missing headline with the code the server uses', () => {
    const blockers = advisoryBlockers({
      budgetCents: 1000,
      audienceId: 'backend',
      headline: '',
      landingUrl: 'https://advertiser.example/landing',
    })
    expect(blockers).toContain('AD_TEXT_REQUIRED')
  })

  it('has copy for the server error codes rather than a blank refusal', () => {
    const err = { payload: { error: { code: 'AD_TEXT_TOO_LONG' } } }
    expect(campaignErrorMessage(err, 'fallback')).not.toBe('fallback')
    const missing = { payload: { error: { code: 'AD_TEXT_REQUIRED' } } }
    expect(campaignErrorMessage(missing, 'fallback')).not.toBe('fallback')
  })
})

describe('the counter on screen is the number the server computes', () => {
  const source = read('src/components/advertiser/AdvertiserCampaigns.jsx')

  it('renders the live count against the limit', () => {
    expect(source).toContain('countAdTextLength')
    expect(source).toContain('MAX_AD_TEXT_LENGTH')
    expect(source).toMatch(/field__counter/)
  })

  it('does not use a UTF-16 length, which would disagree with the server', () => {
    expect(source).not.toMatch(/form\.headline\.length/)
  })
})
