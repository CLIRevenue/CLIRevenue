/**
 * GET /functions/v1/publisher_keys answered 500 "get publisher: Cannot coerce
 * the result to a single JSON object" for developers who had never opened the
 * SDK page first.
 *
 * Why it happened, and why these assertions exist:
 *
 * publishers.owner_profile_id is nullable (000014) and is written only by
 * provision_publisher_slot() (000016, SECURITY DEFINER, service_role only).
 * A developer who has not provisioned yet therefore owns NO publisher row,
 * which is a normal state -- not a fault. The lookup used `.single()`, and
 * PostgREST's `.single()` means *exactly* one row: zero rows comes back as
 * error PGRST116 "Cannot coerce the result to a single JSON object". The
 * `?? null` fallthrough could never fire, the call sat outside every
 * try/catch in the handler, and the throw escaped as
 * SB-Error-Code: EDGE_FUNCTION_ERROR with an HTTP 500 instead of the 404 the
 * code already contained three lines further down.
 *
 * Regression is loud for four reasons: a zero-row lookup must not raise, the
 * 404 guard must be reachable, the lookup must stay scoped to the caller's
 * own profile (never adopting a NULL-owner or another owner's publisher), and
 * the dashboard must provision before it lists so a first-time visitor is
 * never 404'd by a race.
 *
 * These are source-shape assertions, like tests/admin-settings.test.js: the
 * function needs a live Supabase to run, and the two failure modes above are
 * pure source decisions. The database side of the same rule -- that a
 * developer with no publisher yields zero rows, that an unowned publisher is
 * never matched, and that provisioning creates exactly one -- is asserted
 * against the real schema in tests/db/publisher-ownership.test.js.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const fn = () => readFileSync(join(ROOT, 'supabase/functions/publisher_keys/index.ts'), 'utf8')

/**
 * Strip block and line comments before asserting on a body, so prose that
 * names an API (".single() would raise PGRST116") is not mistaken for a call
 * to it. The assertions below are about what the code executes.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The body of getPublisherId alone. Bounded at the next handler so assertions
 * about the lookup cannot be satisfied -- or violated -- by unrelated code in
 * the rest of the file.
 */
const lookupBody = () => {
  const source = code(fn())
  const start = source.indexOf('async function getPublisherId')
  const end = source.indexOf('async function listKeys', start)
  return source.slice(start, end > start ? end : source.length)
}
const keys = () => readFileSync(join(ROOT, 'src/components/developer/PublisherKeys.jsx'), 'utf8')

describe('publisher_keys lookup', () => {
  it('does not use .single() for a lookup that may legitimately find nothing', () => {
    // .single() is fine where the row must exist -- the create path's
    // insert(...).single() and the revoke path's delete(...).single() are
    // both correct and must stay. Only the ownership lookup is forbidden.
    const source = code(fn())
    const lookup = lookupBody()
    expect(lookup).toMatch(/\.eq\("owner_profile_id",\s*profileId\)/)
    expect(lookup).not.toMatch(/\.single\(\)/)
    expect(lookup).toMatch(/\.limit\(1\)/)
    expect(lookup).toMatch(/\.maybeSingle\(\)/)
    // The create insert's .single() is correct -- it is the row just written,
    // and it must keep its guarantee.
    const create = source.slice(source.indexOf('async function createKey'))
    expect(create).toMatch(/\.insert\([\s\S]*?\)\s*\.select\(KEY_COLUMNS\)\s*\.single\(\)/)

    // The revoke ownership lookup has the same zero-row hazard, so it must not
    // use .single() either -- and the handler already maps "Key not found" to
    // a 404, which was unreachable behind a PGRST116 throw.
    const revoke = source.slice(source.indexOf('async function revokeKey'))
    expect(revoke).not.toMatch(/\.single\(\)/)
    expect(revoke).toMatch(/\.maybeSingle\(\)/)
    expect(revoke).toMatch(/\.eq\("publisher_id",\s*publisherId\)/)
    expect(source).toMatch(/err\.message === "Key not found or does not belong to this publisher"/)
  })

  it('returns null rather than throwing when the developer owns no publisher', () => {
    const lookup = lookupBody()
    // A genuine query failure may still throw; an empty result must not.
    expect(lookup).toMatch(/if \(error\)/)
    expect(lookup).toMatch(/\?\? null/)
  })

  it('answers 404 instead of letting the lookup error escape the handler', () => {
    const source = code(fn())
    const call = source.slice(source.lastIndexOf('let publisherId'))
    // The call is wrapped, and the 404 guard sits after the catch block and is
    // therefore reachable. Before the fix there was no try/catch at all and the
    // throw outranked the guard three lines below it.
    expect(call).toMatch(/try \{\s*publisherId = await getPublisherId\(admin, profileId\);\s*\}\s*catch \(/)
    expect(call).toMatch(/if \(!publisherId\)/)
    expect(call.indexOf('catch (')).toBeLessThan(call.indexOf('if (!publisherId)'))
  })

  it('never falls back to an unfiltered publisher lookup', () => {
    // The fix must not become "take whatever publisher exists". The
    // ownership filter is the whole security model: unowned test publishers
    // carry owner_profile_id = NULL and must stay invisible.
    const lookup = lookupBody()
    // The filter is the security model. An owner-scoped lookup is the only
    // shape allowed: no ownerless fallback, no "any publisher will do", and no
    // ordering that could steer the choice when more than one ever existed.
    expect(lookup).toMatch(/\.eq\("owner_profile_id",\s*profileId\)/)
    expect(lookup).not.toMatch(/\.is\(\s*"owner_profile_id"\s*,\s*null\s*\)/)
    expect(lookup).not.toMatch(/\.order\(/)
    expect(lookup).not.toMatch(/\.is\(\s*null\s*\)/)
  })

  it('still requires an authenticated developer before any lookup', () => {
    const source = fn()
    expect(source).toMatch(/getJwtUser\(req\)/)
    expect(source).toMatch(/requireDeveloper\(/)
    // adminClient() is the service-role client and stays server-side only.
    expect(source).toMatch(/adminClient\(\)/)
    expect(source).not.toMatch(/process\.env/)
    expect(source).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/)
  })
})

describe('the dashboard provisions before it lists', () => {
  it('provisions the publisher before requesting the key list', () => {
    const source = code(keys())
    const load = source.slice(source.indexOf('const load = useCallback'), source.indexOf('const fetchKeys'))
    expect(load).toMatch(/await provisionPublisher\(\)/)
    expect(load).toMatch(/await listPublisherKeys\(\)/)
    expect(load.indexOf('await provisionPublisher()')).toBeLessThan(
      load.indexOf('await listPublisherKeys()'),
    )
  })

  it('does not let a provisioning failure mask the real list error', () => {
    // provisionPublisher is best-effort here: if it is unavailable the list
    // call still runs and reports the accurate 404 rather than standing in
    // for it with a provisioning error.
    const source = code(keys())
    const load = source.slice(source.indexOf('const load = useCallback'), source.indexOf('const fetchKeys'))
    const provisionTry = load.slice(load.indexOf('await provisionPublisher()'), load.indexOf('await listPublisherKeys()'))
    expect(provisionTry).toMatch(/catch \(/)
  })

  it('never renders the raw publishable key on this page', () => {
    // The raw key exists in exactly one response and belongs to SdkSetup.
    // PublisherKeys only ever shows metadata.
    const source = keys()
    expect(source).toMatch(/import \{ provisionPublisher \} from '\.\.\/\.\.\/lib\/publisherApi\.js'/)
    // The provisioning result is awaited and discarded -- not destructured,
    // not stored. This page renders key metadata only.
    const load = code(source.slice(source.indexOf('const load = useCallback'), source.indexOf('const fetchKeys')))
    expect(load).toMatch(/await provisionPublisher\(\)/)
    expect(load).not.toMatch(/publishableKey/)
    expect(load).not.toMatch(/rawKey|\bkey\b\s*=/)
  })

  it('does not sync-subscribe: the loader is still a [] callback driven by the effect', () => {
    // The effect must not have been turned back into a synchronous setState,
    // which is a lint error in this codebase (react-hooks/set-state-in-effect).
    const source = code(keys())
    expect(source).toMatch(/const load = useCallback\(async \(\) => \{/)
    expect(source).toMatch(/\}, \[\]\)/)
    expect(source).toMatch(/useEffect\(\(\) => \{[\s\S]*?await load\(\)[\s\S]*?\}, \[load\]\)/)
  })
})