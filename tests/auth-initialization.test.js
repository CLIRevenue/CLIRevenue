/**
 * Auth initialisation: one resolution per page load, and never an animation
 * that the user did not ask for.
 *
 * The defects this suite exists to prevent:
 *
 *   1. The provider subscribed with
 *        supabase.auth.onAuthStateChange(() => { refresh() })
 *      — it never looked at *which* event arrived. A routine access-token
 *      rotation therefore re-entered `loading: true`, replaying the
 *      full-screen "Checking session and role…" animation about once an
 *      hour, and again whenever a backgrounded tab woke and refreshed
 *      ahead of schedule, on a page that was already working.
 *   2. INITIAL_SESSION asks for exactly the resolution the mount effect
 *      had already started, so every single page load resolved the session
 *      twice: getSession, getUser, the server-side role check and up to
 *      three table reads — twice, for one answer.
 *   3. economyStore refetched all three of its datasets on every auth
 *      event, including TOKEN_REFRESHED. Every field it holds is
 *      user-scoped, so a rotation produced byte-identical JSON at the cost
 *      of three round trips.
 *
 * The rule those three all reduce to: *a token rotation is not a session
 * change*. A rotation swaps the access and refresh tokens for the SAME
 * user, so the role cannot have changed because a string got longer.
 *
 * `authEvents.js` is the pure vocabulary for that rule and is tested
 * directly. The wiring that depends on React effects or a live
 * supabase.auth client cannot run here — this suite has neither a DOM nor a
 * project — so it is asserted at the module boundary and labelled as
 * source-level, the same way tests/auth-callback-nav.test.js does it.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  AUTH_EVENT,
  AUTH_REASON,
  RESOLUTION,
  classifyAuthEvent,
  isOnceOnly,
  mayShowLoading,
  planFor,
} from '../src/components/auth/authEvents.js'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const REASONS = Object.values(AUTH_REASON)
const PLANS = Object.values(RESOLUTION)

describe('auth event classification', () => {
  it('names a situation for every event the SDK emits', () => {
    // A missing entry would silently degrade to SESSION_CHANGE below, which
    // is safe but is not a decision anybody made on purpose. Assert the
    // whole documented set so an SDK upgrade that adds one is noticed here.
    expect(Object.values(AUTH_EVENT).sort()).toEqual([
      'INITIAL_SESSION',
      'MFA_CHALLENGE_VERIFIED',
      'PASSWORD_RECOVERY',
      'SIGNED_IN',
      'SIGNED_OUT',
      'TOKEN_REFRESHED',
      'USER_UPDATED',
    ])
    for (const event of Object.values(AUTH_EVENT)) {
      expect(REASONS).toContain(classifyAuthEvent(event))
    }
  })

  it('treats the first resolution after a page load as its own situation', () => {
    // BOOT is once-per-provider: the mount starts it and INITIAL_SESSION
    // asks for the same one. Collapsing it into SESSION_CHANGE is what
    // brought the double-resolution back.
    expect(classifyAuthEvent(AUTH_EVENT.INITIAL_SESSION)).toBe(AUTH_REASON.BOOT)
  })

  it('treats every identity change as a session change', () => {
    for (const event of [
      AUTH_EVENT.SIGNED_IN,
      AUTH_EVENT.USER_UPDATED,
      AUTH_EVENT.PASSWORD_RECOVERY,
      AUTH_EVENT.MFA_CHALLENGE_VERIFIED,
    ]) {
      expect(classifyAuthEvent(event)).toBe(AUTH_REASON.SESSION_CHANGE)
    }
  })

  it('separates a token rotation from a session change', () => {
    // The distinction the whole module exists for.
    expect(classifyAuthEvent(AUTH_EVENT.TOKEN_REFRESHED)).toBe(AUTH_REASON.TOKEN_ROTATION)
    expect(classifyAuthEvent(AUTH_EVENT.TOKEN_REFRESHED)).not.toBe(
      classifyAuthEvent(AUTH_EVENT.SIGNED_IN),
    )
  })

  it('keeps the end of a session distinguishable', () => {
    expect(classifyAuthEvent(AUTH_EVENT.SIGNED_OUT)).toBe(AUTH_REASON.SIGN_OUT)
    expect(classifyAuthEvent(AUTH_EVENT.SIGNED_OUT)).not.toBe(AUTH_REASON.TOKEN_ROTATION)
  })

  it('assumes a session change when the event is unrecognised', () => {
    // Failing toward validation. Assuming "no change" for something new
    // would skip a re-validation the user needed; assuming "change" only
    // costs one redundant round trip.
    for (const event of ['SOMETHING_NEW', '', 'token_refreshed', null, undefined, 42, {}, []]) {
      expect(classifyAuthEvent(event)).toBe(AUTH_REASON.SESSION_CHANGE)
    }
  })
})

describe('auth event resolution plan', () => {
  it('answers every reason, so an unmapped reason is a visible FULL', () => {
    for (const reason of REASONS) {
      expect(PLANS).toContain(planFor(reason))
    }
    expect(planFor('something-new')).toBe(RESOLUTION.FULL)
  })

  it('is total: a token rotation is the only silent reason', () => {
    const silent = REASONS.filter((r) => planFor(r) === RESOLUTION.SILENT)
    expect(silent).toEqual([AUTH_REASON.TOKEN_ROTATION])
  })

  it('treats a client-side navigation as no auth work at all', () => {
    const never = REASONS.filter((r) => planFor(r) === RESOLUTION.NEVER)
    expect(never).toEqual([AUTH_REASON.NAVIGATION])
    // A navigation carries no auth event, so naming it is how "navigation
    // never re-resolves" becomes part of the vocabulary rather than an
    // omission someone could reintroduce.
    expect(planFor(AUTH_REASON.NAVIGATION)).not.toBe(RESOLUTION.FULL)
  })

  it('lets only the reasons that genuinely changed something animate', () => {
    const animating = REASONS.filter(mayShowLoading)
    expect(animating.sort()).toEqual(
      [AUTH_REASON.BOOT, AUTH_REASON.MANUAL, AUTH_REASON.SESSION_CHANGE, AUTH_REASON.SIGN_OUT].sort(),
    )
  })

  it('never lets a token rotation into the loading state', () => {
    // This is the regression in one assertion. If this fails, the
    // full-screen role check replays on a page that is already working.
    expect(mayShowLoading(AUTH_REASON.TOKEN_ROTATION)).toBe(false)
    expect(planFor(AUTH_REASON.TOKEN_ROTATION)).toBe(RESOLUTION.SILENT)
  })

  it('still resolves on a token rotation — silence is not ignorance', () => {
    // SILENT means "do the work without animating", not "skip the work".
    // The token changed, so re-validating against the server stays correct.
    expect(planFor(AUTH_REASON.TOKEN_ROTATION)).not.toBe(RESOLUTION.NEVER)
    expect(mayShowLoading(AUTH_REASON.SIGN_OUT)).toBe(true)
  })

  it('marks only the boot as once-per-provider', () => {
    const once = REASONS.filter(isOnceOnly)
    expect(once).toEqual([AUTH_REASON.BOOT])
    expect(isOnceOnly(AUTH_REASON.SESSION_CHANGE)).toBe(false)
    expect(isOnceOnly(AUTH_REASON.SIGN_OUT)).toBe(false)
  })
})

// --- source-level checks -------------------------------------------------
// The provider's effect cannot be executed here (no DOM, no live
// supabase.auth). These pin the specific wiring so the regressions above
// cannot return silently.

describe('auth provider initialisation (source-level)', () => {
  it('classifies before it acts — the listener receives the event', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    expect(src).toMatch(/onAuthStateChange\(\(event\) => \{/)
    expect(src).toMatch(/const reason = classifyAuthEvent\(event\)/)
    expect(src).toMatch(/const plan = planFor\(reason\)/)
    // The old form ignored the event entirely.
    expect(src).not.toMatch(/onAuthStateChange\(\(\) => \{/)
  })

  it('never animates a reason that may not enter the loading state', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    // The loading flag is derived from the plan, not hardcoded to true.
    expect(src).toMatch(/refresh\(\{ loading: plan === RESOLUTION\.FULL \}\)/)
    // ...and refresh() honours it, including when a session already exists.
    expect(src).toMatch(/if \(!mayShowLoading\) return s/)
    expect(src).toMatch(/if \(!s\.session\) return \{ \.\.\.s, error: '' \}/)
    // A bare refresh() from the listener would reintroduce the animation.
    expect(src).not.toMatch(/onAuthStateChange\([\s\S]{0,400}?\n\s*refresh\(\)\s*\n\s*\}/)
  })

  it('does nothing at all for a reason that plans NEVER', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    const listener = src.slice(src.indexOf('supabase.auth.onAuthStateChange'))
    const early = listener.indexOf('plan === RESOLUTION.NEVER')
    const resolve = listener.indexOf('refresh({')
    expect(early).toBeGreaterThan(-1)
    expect(resolve).toBeGreaterThan(early)
    expect(listener.slice(early, early + 80)).toMatch(/return/)
  })

  it('boots once per provider, not once per event', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    // One flag covers the mount, INITIAL_SESSION, and a StrictMode
    // double-mount that re-runs the effect while keeping the same refs.
    expect(src).toMatch(/const bootStarted = useRef\(false\)/)
    expect(src).toMatch(/if \(bootStarted\.current\) return/)
    expect(src).toMatch(/bootStarted\.current = true/)
    expect(src).toMatch(/if \(isOnceOnly\(reason\)\) \{\s*\n?\s*startBoot\(\)/)
    // The mount must actually request the boot.
    const effect = src.slice(src.indexOf('useEffect(() => {', src.indexOf('const refresh')))
    expect(effect).toMatch(/\n\s+startBoot\(\)\n/)
  })

  it('does not re-resolve on ordinary client-side navigation', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    // Route changes arrive as popstate/hashchange. A provider that listens
    // for them re-reads the session on every nav click.
    expect(src).not.toMatch(/popstate/)
    expect(src).not.toMatch(/hashchange/)
    // The only navigation helper it may use is the post-sign-out redirect.
    expect(src).toMatch(/navigateApp/)
  })

  it('unsubscribes cleanly', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    expect(src).toMatch(/data\.subscription\?\.unsubscribe\?\.\(\)/)
    // A dead "alive" flag was removed with the old unconditional refresh;
    // its absence is the point, so assert it did not come back.
    expect(src).not.toMatch(/let alive = true/)
  })

  it('preserves the session validation itself', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    // Silencing the animation must not mean trusting the client. The
    // server-side role check and the token read both survive.
    expect(src).toMatch(/supabase\.auth\.getSession\(\)/)
    expect(src).toMatch(/supabase\.auth\.getUser\(\)/)
    expect(src).toMatch(/fetchAuthStatus/)
    expect(src).toMatch(/from\('profiles'\)/)
    // The race fence that stops a late refresh resurrecting a signed-out
    // session is still in place.
    expect(src).toMatch(/const stale = \(\) => generation\.current !== mine/)
    const refresh = src.slice(src.indexOf('const refresh ='), src.indexOf('const signOut ='))
    const fences = refresh.match(/if \(stale\(\)\) return/g) || []
    expect(fences.length).toBeGreaterThanOrEqual(4)
  })

  it('caches no authorization decision in web storage', () => {
    // The brief forbids it, and it would be a real hole: a cached role is a
    // role the server never confirmed.
    for (const file of ['src/components/auth/AuthProvider.jsx', 'src/components/auth/authEvents.js']) {
      const src = read(file)
      expect(src).not.toMatch(/localStorage/)
      expect(src).not.toMatch(/sessionStorage/)
      expect(src).not.toMatch(/\bindexedDB\b/)
    }
  })

  it('keeps the one legitimate localStorage use a signup draft, not an authorization cache', () => {
    const src = read('src/lib/authPassword.js')
    expect(src).toMatch(/localStorage\.setItem/)
    // It may only park what the user typed, and it can never carry admin.
    const readPending = src.slice(src.indexOf('function readPendingProfile'))
    expect(readPending).toMatch(/!parsed \|\| !\['advertiser', 'developer'\]\.includes\(parsed\.role\)/)
    // The parked role must not be written into the profile row: the
    // server-side signup trigger owns that column.
    const payload = src.slice(src.indexOf('const payloads = buildProfilePayloads'))
    expect(payload).not.toMatch(/role:\s*pending\.role/)
    // It is cleared before it is flushed, so it cannot be replayed.
    expect(src.indexOf('clearPendingProfile()')).toBeLessThan(
      src.indexOf('buildProfilePayloads(pending.values'),
    )
  })
})

describe('economy store refetch policy (source-level)', () => {
  it('refetches only for reasons that may actually have changed the data', () => {
    const src = read('src/lib/economyStore.js')
    // Every field it holds is user-scoped, so a rotation would produce
    // byte-identical JSON at the cost of three round trips.
    expect(src).toMatch(/onAuthStateChange\(\(event\) => \{/)
    expect(src).toMatch(/if \(planFor\(classifyAuthEvent\(event\)\) !== RESOLUTION\.FULL\) return/)
    expect(src).toMatch(/initializeStore\(\)/)
  })

  it('never refetches on a silent or skipped reason', () => {
    // If this assertion ever needs loosening, the right answer is to add a
    // reason to REASON_PLAN and explain it — not to loosen the gate.
    expect(planFor(AUTH_REASON.TOKEN_ROTATION)).not.toBe(RESOLUTION.FULL)
    expect(planFor(AUTH_REASON.NAVIGATION)).not.toBe(RESOLUTION.FULL)
  })
})
