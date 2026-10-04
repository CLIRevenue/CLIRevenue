/**
 * Confirmation-email (and password-recovery) landing logic.
 *
 * Kept pure and DOM-free so the URL contract is unit testable without a
 * browser: the callback route is the one place where a malformed or
 * consumed link must be reported in plain language instead of leaving
 * "Confirming your email…" on screen forever.
 *
 * Supabase delivers one of two shapes to the redirect target:
 *   PKCE (v2 default)  ?code=<one-time code>       → must be exchanged
 *   implicit           #access_token=…&type=signup  → session is in the URL
 * A static host may additionally route by hash, so both the query and
 * the hash fragment are inspected before deciding anything.
 */

export const AUTH_CALLBACK_PATH = '/auth/callback'

export const CALLBACK_STATE = {
  /** Still exchanging / still waiting on the provider. */
  PENDING: 'pending',
  /** A session exists — route into the role's dashboard. */
  OK: 'ok',
  /** Link consumed, expired, or already used. Recoverable by resending. */
  EXPIRED: 'expired',
  /** Something else went wrong (no verifier, bad redirect, no config). */
  FAILED: 'failed',
}

/**
 * Read the callback parameters out of a full URL.
 *
 * The hash is preferred when it actually carries key=value data, because
 * that is both the implicit-flow location and the hash-routing location.
 * A bare `#/login` fragment holds no data and is ignored so hash routes
 * are never mistaken for auth parameters.
 */
export function readCallbackParams(url) {
  const empty = { code: '', error: '', errorCode: '', errorDescription: '', hasToken: false }
  if (typeof url !== 'string' || !url) return empty

  const hashAt = url.indexOf('#')
  const hash = hashAt === -1 ? '' : url.slice(hashAt + 1)
  const queryAt = url.indexOf('?')

  // Query runs until the hash. Both query and hash are parsed and merged,
  // hash winning, because the PKCE code lives in the query while the
  // implicit tokens live in the hash — and a hash-routed host can put a
  // query after the fragment (#/auth/callback?code=…), where the fragment
  // is the route and the code is still behind a '?'.
  const query = queryAt === -1 ? '' : url.slice(queryAt + 1, hashAt !== -1 && hashAt > queryAt ? hashAt : url.length)
  const hashQuery = hash.includes('?') ? hash.slice(hash.indexOf('?') + 1) : (hash.includes('=') ? hash : '')

  let params
  try {
    params = new URLSearchParams(`${query}&${hashQuery}`)
  } catch {
    return empty
  }
  if (!params) return empty

  return {
    code: params.get('code') || '',
    error: params.get('error') || '',
    errorCode: params.get('error_code') || '',
    errorDescription: (params.get('error_description') || '').replace(/\+/g, ' '),
    hasToken: Boolean(params.get('access_token') || params.get('refresh_token')),
  }
}

/** True when the URL carries evidence that a callback actually happened,
 *  as opposed to a bare visit to /auth/callback. */
export function hasCallbackParams(url) {
  const p = readCallbackParams(url)
  return Boolean(p.code || p.error || p.hasToken)
}

function classify(error, errorCode, errorDescription) {
  // Supabase is inconsistent about where it puts the reason: the query can
  // carry ?error=otp_expired, ?error_code=otp_expired, or only a prose
  // ?error_description=. Fold all three into one haystack so every one of
  // those shapes lands on the recoverable screen instead of a generic
  // failure that tells the user nothing.
  const codes = `${error || ''} ${errorCode || ''}`.toLowerCase()
  const desc = (errorDescription || '').toLowerCase()
  const expired =
    codes.includes('otp_expired') ||
    codes.includes('access_denied') ||
    codes.includes('otp_disabled') ||
    desc.includes('expired') ||
    desc.includes('already been used') ||
    desc.includes('already used') ||
    desc.includes('invalid')
  return expired ? CALLBACK_STATE.EXPIRED : CALLBACK_STATE.FAILED
}

export const EXPIRED_LINK_MESSAGE =
  'This confirmation link has expired or was already used. Confirmation links work once. Sign in, or request a new one.'
export const FAILED_LINK_MESSAGE =
  'We could not complete sign-in from that link. It may have been opened in a different browser or device than the one you signed up on. Sign in with your password, or reset it.'

/** Turn callback URL params into a state + human message pair. */
export function classifyCallback(params) {
  const p = params || {}
  // Implicit flow put a session in the URL: nothing left to exchange.
  if (p.hasToken) return { state: CALLBACK_STATE.OK, message: '', detail: '' }
  // A PKCE code is present and the provider is still exchanging it.
  if (p.code) return { state: CALLBACK_STATE.PENDING, message: '', detail: '' }
  // error_description counts as an error on its own — Supabase sends the
  // prose reason without a machine-readable code surprisingly often.
  if (p.error || p.errorCode || p.errorDescription) {
    const state = classify(p.error, p.errorCode, p.errorDescription)
    return {
      state,
      message: state === CALLBACK_STATE.EXPIRED ? EXPIRED_LINK_MESSAGE : FAILED_LINK_MESSAGE,
      detail: p.errorDescription || p.error || p.errorCode || '',
    }
  }
  return { state: CALLBACK_STATE.PENDING, message: '', detail: '' }
}