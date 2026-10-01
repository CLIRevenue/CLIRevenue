/**
 * Route resolution.
 *
 * An Edge Function sees the path it was invoked on, verbatim, so the same
 * handler is reachable as /functions/v1/<fn>, /<fn> and the legacy
 * /api/<fn>. restPath() collapses all three to the same branch. The old
 * parsers assumed a stripped prefix and made every real request 400 or
 * 404.
 */
import { describe, it, expect } from 'vitest'
import { restPath } from '../supabase/functions/_shared/http.ts'

describe('route resolution', () => {
  it('strips the /functions/v1 prefix', () => {
    expect(restPath('/functions/v1/campaigns/abc/select', 'campaigns')).toEqual([
      'abc', 'select',
    ])
  })

  it('strips the bare function name', () => {
    expect(restPath('/campaigns/abc', 'campaigns')).toEqual(['abc'])
  })

  it('strips the legacy /api prefix', () => {
    expect(restPath('/api/campaigns/abc', 'campaigns')).toEqual(['abc'])
  })

  it('strips the legacy /api/<fn> layout', () => {
    expect(restPath('/campaigns/api/campaigns/abc', 'campaigns')).toEqual(['abc'])
  })

  it("handles the events function's multi-segment routes", () => {
    expect(restPath('/events/impression', 'events')).toEqual(['impression'])
    expect(restPath('/events/interaction', 'events')).toEqual(['interaction'])
    expect(restPath('/events/conversion', 'events')).toEqual(['conversion'])
    expect(restPath('/api/events/impression', 'events')).toEqual(['impression'])
    expect(restPath('/functions/v1/events/impression', 'events')).toEqual([
      'impression',
    ])
  })

  it('handles the payouts function accepting /request as well as bare', () => {
    expect(restPath('/payouts', 'payouts')).toEqual([])
    expect(restPath('/payouts/request', 'payouts')).toEqual(['request'])
    expect(restPath('/payouts/foo', 'payouts')).toEqual(['foo'])
  })
})