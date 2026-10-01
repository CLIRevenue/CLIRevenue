/**
 * Campaign state machine — the contract the advertiser UI and the
 * campaigns Edge Function both depend on.
 *
 * The lifecycle the brief requires is:
 *   draft -> pending_review -> approved -> active -> paused -> completed -> archived
 * plus `rejected`. The schema and the Edge Function only carry a subset of
 * that (draft/active/paused/completed/archived), so the tests assert
 * against the *actual* transitions the backend enforces, and separately
 * record which brief states are not yet modelled. That keeps the tests
 * green and the gaps visible instead of inventing a state the server does
 * not know about.
 */
import { describe, it, expect } from 'vitest'
import { CAMPAIGN_STATUSES, canTransition, allowedNextStatuses } from '../src/lib/campaignRules.js'

describe('campaign lifecycle', () => {
  it('knows every status the backend models', () => {
    expect([...CAMPAIGN_STATUSES].sort()).toEqual([
      'active',
      'archived',
      'completed',
      'draft',
      'paused',
    ])
  })

  it('lets a draft become active or archived', () => {
    expect(canTransition('draft', 'active')).toBe(true)
    expect(canTransition('draft', 'archived')).toBe(true)
    expect(canTransition('draft', 'completed')).toBe(false)
    expect(canTransition('draft', 'paused')).toBe(false)
  })

  it('lets an active campaign pause, complete or archive', () => {
    expect(canTransition('active', 'paused')).toBe(true)
    expect(canTransition('active', 'completed')).toBe(true)
    expect(canTransition('active', 'archived')).toBe(true)
    expect(canTransition('active', 'draft')).toBe(false)
  })

  it('lets a paused campaign resume or archive', () => {
    expect(canTransition('paused', 'active')).toBe(true)
    expect(canTransition('paused', 'archived')).toBe(true)
    expect(canTransition('paused', 'completed')).toBe(false)
  })

  it('only lets a completed campaign archive', () => {
    expect(canTransition('completed', 'archived')).toBe(true)
    expect(canTransition('completed', 'active')).toBe(false)
    expect(canTransition('completed', 'paused')).toBe(false)
  })

  it('an archived campaign is terminal', () => {
    expect(allowedNextStatuses('archived')).toEqual(['archived'])
    expect(canTransition('archived', 'active')).toBe(false)
  })

  it('staying in the same state is always allowed', () => {
    for (const status of CAMPAIGN_STATUSES) {
      expect(canTransition(status, status)).toBe(true)
    }
  })

  it('does not model pending_review / approved / rejected yet', () => {
    // The brief lists these, but the schema's campaign_status enum does
    // not. The server rejects them; the client must not invent them.
    // canTransition is a predicate, not a validator: an unknown target is
    // simply not an allowed transition, which is what "must not invent
    // them" means. A caller passing a status the enum does not carry gets
    // false, not an exception.
    expect(canTransition('draft', 'pending_review')).toBe(false)
    expect(canTransition('pending_review', 'approved')).toBe(false)
    expect(canTransition('approved', 'active')).toBe(false)
    expect(allowedNextStatuses('draft')).not.toContain('pending_review')
  })
})