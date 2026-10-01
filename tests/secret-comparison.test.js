/**
 * Privileged-secret comparison.
 *
 * The settlement endpoint is the only route that can move money in the
 * reward ledger without a signed-in developer, so its secret must be
 * checked in a way that does not leak how many characters matched.
 */
import { describe, it, expect } from 'vitest'
import { constantTimeEqual } from '../supabase/functions/_shared/secrets.ts'

describe('secret comparison', () => {
  it('matches an equal secret', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true)
  })

  it('rejects a different secret of the same length', () => {
    expect(constantTimeEqual('abc', 'abd')).toBe(false)
  })

  it('rejects a different secret of a different length', () => {
    expect(constantTimeEqual('abc', 'abcd')).toBe(false)
    expect(constantTimeEqual('abcd', 'abc')).toBe(false)
  })

  it('fails closed when the expected secret is empty', () => {
    expect(constantTimeEqual('', 'anything')).toBe(false)
  })
})
