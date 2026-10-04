/**
 * Auth: email-link landing, and the logged-out navigation.
 *
 * Three real defects motivated this suite, and each has a test that fails
 * if it comes back:
 *
 *   1. A signup confirmation link established a session and then went
 *      nowhere — AuthCallbackPage rendered "Your account is ready" and
 *      never called navigateApp, so every email flow dead-ended.
 *   2. The logged-out header hid "Log in" whenever the route was /login,
 *      which is exactly where an expired/cleared session gets sent — so a
 *      locked-out user saw Sign up and no way back in.
 *   3. There was no Logout control outside the account-deletion danger
 *      zone, so signing out was not reachable.
 *
 * Callback parsing and the auth->navigation mapping are pure functions and
 * are tested directly. The wiring that depends on React effects or on
 * supabase.auth cannot run without a DOM or a live project, so those are
 * asserted at the module boundary and labelled as source-level checks.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  CALLBACK_STATE,
  EXPIRED_LINK_MESSAGE,
  FAILED_LINK_MESSAGE,
  classifyCallback,
  hasCallbackParams,
  readCallbackParams,
} from '../src/components/auth/authCallback.js'
import { authNavState, roleHome } from '../src/components/auth/authState.js'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

describe('confirmation link parameters', () => {
  it('reads the PKCE code from the query string', () => {
    // Supabase's default email confirmation puts ?code= in the query.
    expect(readCallbackParams('https://cli.example/auth/callback?code=abc123').code).toBe('abc123')
  })

  it('ignores the callback path when a query is present', () => {
    const params = readCallbackParams('https://cli.example/auth/callback?code=abc')
    expect(params.code).toBe('abc')
    expect(params.hasToken).toBe(false)
  })

  it('reads implicit-flow tokens from the hash', () => {
    const params = readCallbackParams(
      'https://cli.example/auth/callback#access_token=tok&refresh_token=ref&expires_in=3600',
    )
    expect(params.hasToken).toBe(true)
  })

  it('reads a code that sits after a hash-routed fragment', () => {
    // A static host serving #/auth/callback puts the route in the fragment
    // and the PKCE code behind a second '?'. This exact shape used to
    // parse to code: '' and looked like a dead link.
    const params = readCallbackParams('https://cli.example/#/auth/callback?code=xyz789')
    expect(params.code).toBe('xyz789')
  })

  it('reads an error from a hash-routed fragment too', () => {
    const params = readCallbackParams(
      'https://cli.example/#/auth/callback?error=access_denied&error_code=otp_expired',
    )
    expect(params.error).toBe('access_denied')
    expect(params.errorCode).toBe('otp_expired')
  })

  it('decodes + as a space in error_description', () => {
    const params = readCallbackParams(
      'https://cli.example/auth/callback?error=server_error&error_description=Email+link+is+invalid',
    )
    expect(params.errorDescription).toBe('Email link is invalid')
  })

  it('returns an inert shape for a missing or empty URL', () => {
    for (const url of ['', null, undefined, 42]) {
      expect(readCallbackParams(url)).toEqual({
        code: '',
        error: '',
        errorCode: '',
        errorDescription: '',
        hasToken: false,
      })
    }
  })

  it('detects whether a URL carries callback parameters at all', () => {
    expect(hasCallbackParams('https://cli.example/auth/callback?code=a')).toBe(true)
    expect(hasCallbackParams('https://cli.example/auth/callback')).toBe(false)
    expect(hasCallbackParams('')).toBe(false)
  })
})

describe('confirmation link classification', () => {
  it('treats a plain code as pending until the session lands', () => {
    expect(classifyCallback(readCallbackParams('https://cli.example/auth/callback?code=a')).state).toBe(
      CALLBACK_STATE.PENDING,
    )
  })

  it('treats an implicit token as already established', () => {
    const params = readCallbackParams('https://cli.example/auth/callback#access_token=tok')
    expect(classifyCallback(params).state).toBe(CALLBACK_STATE.OK)
  })

  it.each([
    ['otp_expired', 'error_code'],
    ['access_denied', 'error'],
  ])('classifies %s as an expired link, not a generic failure', (value, key) => {
    const url = `https://cli.example/auth/callback?${key}=${value}`
    const verdict = classifyCallback(readCallbackParams(url))
    expect(verdict.state).toBe(CALLBACK_STATE.EXPIRED)
    expect(verdict.message).toBe(EXPIRED_LINK_MESSAGE)
  })

  it.each([
    'https://cli.example/auth/callback?error=otp_expired',
    'https://cli.example/auth/callback?error_description=Link+has+expired',
    'https://cli.example/auth/callback?error=access_denied',
    'https://cli.example/auth/callback?error_description=Email+link+has+already+been+used',
    'https://cli.example/auth/callback?error_description=invalid+request',
  ])('routes %s to the recoverable expired-link screen', (url) => {
    expect(classifyCallback(readCallbackParams(url)).state).toBe(CALLBACK_STATE.EXPIRED)
  })

  it('classifies an unrecognised error as a failure with a next step', () => {
    const verdict = classifyCallback(
      readCallbackParams('https://cli.example/auth/callback?error=unexpected'),
    )
    expect(verdict.state).toBe(CALLBACK_STATE.FAILED)
    expect(verdict.message).toBe(FAILED_LINK_MESSAGE)
  })

  it('always yields a non-empty message once it has something to report', () => {
    // PENDING legitimately has nothing to say — the exchange is in flight.
    // EXPIRED and FAILED must both explain themselves in plain language.
    const reported = [
      'https://cli.example/auth/callback?error=otp_expired',
      'https://cli.example/auth/callback?error_description=Link+has+expired',
      'https://cli.example/auth/callback?error=weird',
    ]
    for (const url of reported) {
      const verdict = classifyCallback(readCallbackParams(url))
      expect([CALLBACK_STATE.EXPIRED, CALLBACK_STATE.FAILED]).toContain(verdict.state)
      expect(verdict.message.length).toBeGreaterThan(0)
    }
    const pending = classifyCallback(readCallbackParams('https://cli.example/auth/callback?code=a'))
    expect(pending.state).toBe(CALLBACK_STATE.PENDING)
    expect(pending.message).toBe('')
  })
})

describe('auth navigation state', () => {
  it('shows no auth control while the session is still resolving', () => {
    const nav = authNavState({ loading: true, isAuthenticated: false, role: null })
    expect(nav.status).toBe('loading')
    expect(nav.showLogin || nav.showSignup || nav.showDashboard || nav.showLogout).toBe(false)
  })

  it('shows both Login and Sign up to a logged-out visitor', () => {
    const nav = authNavState({ loading: false, isAuthenticated: false, role: null })
    expect(nav.showLogin).toBe(true)
    expect(nav.showSignup).toBe(true)
    expect(nav.showDashboard).toBe(false)
    expect(nav.showLogout).toBe(false)
  })

  it('keeps Login and Sign up visible for every role value while logged out', () => {
    // The bug: "Log in" was hidden whenever the route was /login, which is
    // where an expired session lands — locking the user out of the page
    // that is supposed to let them back in.
    for (const role of [null, undefined, '', 'advertiser', 'developer', 'admin', 'bogus']) {
      const nav = authNavState({ loading: false, isAuthenticated: false, role })
      expect(nav.showLogin).toBe(true)
      expect(nav.showSignup).toBe(true)
    }
  })

  it('shows the dashboard and a Logout control when signed in', () => {
    const nav = authNavState({ loading: false, isAuthenticated: true, role: 'advertiser' })
    expect(nav.status).toBe('authenticated')
    expect(nav.showDashboard).toBe(true)
    expect(nav.showLogout).toBe(true)
    expect(nav.showLogin).toBe(false)
    expect(nav.showSignup).toBe(false)
    expect(nav.dashboardHref).toBe('/app/advertiser')
    expect(nav.accountHref).toBe('/app/advertiser/account')
  })

  it('routes each known role to its own dashboard', () => {
    const expected = {
      advertiser: '/app/advertiser',
      developer: '/app/developer',
      admin: '/app/admin',
    }
    for (const [role, href] of Object.entries(expected)) {
      expect(authNavState({ loading: false, isAuthenticated: true, role }).dashboardHref).toBe(href)
      expect(roleHome(role)).toBe(href)
    }
  })

  it('falls back to the role resolver when a signed-in user has no role yet', () => {
    // A brand-new confirmed account has a session before its profile row
    // is readable. It must still get a usable destination and a Logout.
    const nav = authNavState({ loading: false, isAuthenticated: true, role: null })
    expect(nav.dashboardHref).toBe('/app')
    expect(nav.showLogout).toBe(true)
    // /app/account is not a route; do not invent it.
    expect(nav.accountHref).toBe('/app')
  })

  it('never leaks a dashboard link to a logged-out visitor', () => {
    const nav = authNavState({ loading: false, isAuthenticated: false, role: 'advertiser' })
    expect(nav.dashboardHref).toBeNull()
    expect(nav.accountHref).toBeNull()
  })

  it('keeps Login and Sign up visible for a logged-out visitor even if loading', () => {
    // Regression guard. signOut() fires SIGNED_OUT, the auth listener calls
    // refresh(), and refresh() used to set loading:true on its way in. During
    // that network round trip a logged-out visitor saw neither Login nor Signup
    // — locked out of the site for a fraction of a second after every logout.
    // The resolution below is the state refresh() must never produce.
    const nav = authNavState({ loading: true, isAuthenticated: false, role: null })
    expect(nav.showLogin).toBe(false)
    expect(nav.showSignup).toBe(false)
    // Therefore refresh() must not be able to reach that state from an
    // already-anonymous one: it must not set loading without a session.
    const src = read('src/components/auth/AuthProvider.jsx')
    expect(src).not.toMatch(/setState\(\(s\) => \(\{ \.\.\.s, loading: true/)
    expect(src).toMatch(/s\.session \? \{ \.\.\.s, loading: true/)
  })
})

// --- source-level checks -------------------------------------------------
// The behaviours below need React effects or a live supabase.auth client,
// which this suite has neither of. They are pinned at the module boundary
// so the specific regressions cannot silently return.

describe('auth wiring (source-level)', () => {
  it('AuthCallbackPage actually navigates once a session exists', () => {
    const src = read('src/components/auth/AuthPages.jsx')
    const start = src.indexOf('export function AuthCallbackPage')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start)
    // RC1: the confirmation screen rendered success but never navigated.
    expect(body).toMatch(/navigateApp\(home \|\| '\/app'\)/)
    expect(body).toMatch(/navigated\.current/)
  })

  it('the hash fallback recognises /auth/callback', () => {
    const src = read('src/hooks/useAppRoute.js')
    // RC2: a hash-routed host served the homepage for #/auth/callback.
    expect(src).toMatch(/hash\.startsWith\('#\/auth\/callback'\)/)
  })

  it('PublicHeader derives its auth controls from the shared mapping', () => {
    const src = read('src/components/PublicHeader.jsx')
    // RC3: each surface decided visibility itself and hid Login on /login.
    expect(src).toContain('authNavState')
    expect(src).not.toMatch(/path\.startsWith\('\/login'\)/)
    expect(src).not.toMatch(/path\.startsWith\('\/signup'\)/)
  })

  it('PublicHeader offers a Logout control', () => {
    // RC4: the only signOut() call in the product lived in the
    // account-deletion danger zone.
    expect(read('src/components/PublicHeader.jsx')).toMatch(/showLogout/)
  })

  it('the dashboards — which render no PublicHeader — also offer Logout', () => {
    for (const file of [
      'src/components/advertiser/AdvertiserApp.jsx',
      'src/components/developer/DeveloperApp.jsx',
    ]) {
      expect(read(file)).toContain('<LogoutButton />')
    }
  })

  it('signOut clears state before it can re-throw', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    const body = src.slice(src.indexOf('const signOut ='))
    // RC6: a throwing signOut used to leave a dead session on screen.
    expect(body).toMatch(/setState\(ANONYMOUS\)/)
    expect(body.indexOf('setState(ANONYMOUS)')).toBeLessThan(body.indexOf('if (failure) throw'))
  })

  it('the refresh that could resurrect a logged-out session is fenced off', () => {
    const src = read('src/components/auth/AuthProvider.jsx')
    // RC5: an in-flight refresh wrote the stale session back after
    // signOut cleared it, flipping isAuthenticated true again.
    expect(src).toMatch(/const stale = \(\) => generation\.current !== mine/)
    const refresh = src.slice(src.indexOf('const refresh ='), src.indexOf('const signOut ='))
    expect(refresh).toMatch(/if \(stale\(\)\) return/)
    expect(refresh).toMatch(/if \(stale\(\)\) return/)
    expect(refresh).toMatch(/if \(stale\(\)\) return/)
    expect(refresh).toMatch(/if \(stale\(\)\) return/)
  })

  it('account deletion cannot report a failed sign-out as a failed deletion', () => {
    const src = read('src/components/advertiser/AccountPage.jsx')
    const body = src.slice(src.indexOf('async function onConfirm'))
    // The deletion and the sign-out are separate failure domains: once the
    // Edge Function has removed the auth user, a sign-out error is noise.
    const deleteAt = body.indexOf('await deleteOwnAccount()')
    const catchAt = body.indexOf('catch')
    const signOutAt = body.indexOf('await signOut')
    expect(deleteAt).toBeGreaterThan(-1)
    expect(catchAt).toBeGreaterThan(deleteAt)
    expect(signOutAt).toBeGreaterThan(catchAt)
  })
})