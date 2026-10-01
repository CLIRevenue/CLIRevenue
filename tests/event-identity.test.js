/**
 * Event identity helpers.
 *
 * The backend keys every impression/interaction on campaign_id +
 * session_id + idempotency_key, so those three values have to be real
 * before a request is allowed to leave the browser:
 *   - isCampaignUuid: only a genuine database id is billable. The seeded
 *     demo campaigns (cmp_atlas, …) are page-local fixtures and must
 *     never be attributed against a real campaign row.
 *   - eventSessionId: one stable identifier per browser session.
 */
import { describe, it, expect } from 'vitest'
import { isCampaignUuid, eventSessionId } from '../src/lib/economyStore.js'

describe('event identity', () => {
  it('accepts a real database uuid', () => {
    expect(isCampaignUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('rejects the seeded demo campaign ids', () => {
    expect(isCampaignUuid('cmp_atlas')).toBe(false)
    expect(isCampaignUuid('cmp_quill')).toBe(false)
    expect(isCampaignUuid('cmp_beacon')).toBe(false)
  })

  it('rejects anything that is not a uuid', () => {
    expect(isCampaignUuid(null)).toBe(false)
    expect(isCampaignUuid(undefined)).toBe(false)
    expect(isCampaignUuid(12345)).toBe(false)
    expect(isCampaignUuid('not-a-uuid')).toBe(false)
    expect(isCampaignUuid('550e8400-e29b-41d4-a716-44665544000')).toBe(false)
  })

  it('produces a stable session id', () => {
    expect(typeof eventSessionId).toBe('string')
    expect(eventSessionId.length).toBeGreaterThan(0)
    expect(eventSessionId.startsWith('sess_')).toBe(true)
  })
})