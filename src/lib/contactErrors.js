/**
 * Map contact-submission failures to copy a visitor can act on.
 *
 * Same rule as campaignErrors.js, and for the same reason: the contact form is
 * the one surface a complete stranger can reach, so it is the surface where
 * leaking a database detail does the most damage. A PostgREST error arrives
 * carrying strings like `permission denied for table contact_submissions` or
 * `PGRST205`, and those say more about the inside of the platform than any
 * visitor needs to know.
 *
 * So this module decides what a visitor is told, and Contact.jsx logs only the
 * code it resolved. The raw message stays out of both the DOM and the console.
 */

/**
 * Copy keyed by the failure the visitor can actually do something about.
 *
 * Deliberately not keyed by HTTP status alone: `unavailable` covers the case
 * where the backend is simply not deployed yet, which is a state the platform
 * is genuinely in (migration 000019 has not been applied in production), and a
 * visitor deserves "try again later" rather than a technical refusal.
 */
const MESSAGES = {
  UNAUTHENTICATED: 'Please sign in before sending a message.',
  FORBIDDEN: 'This message could not be sent.',
  NOT_FOUND: 'Messaging is unavailable right now. Please try again later.',
  NOT_CONFIGURED: 'Messaging is unavailable right now. Please try again later.',
  INVALID_EVENT: 'Please check the form and try again.',
  RATE_LIMITED: 'Too many messages. Please wait a moment and try again.',
  UNAVAILABLE: 'Messaging is unavailable right now. Please try again later.',
}

/** The copy shown when nothing more specific applies. */
export const CONTACT_FALLBACK = "Couldn't send your message. Please try again."

/**
 * Resolve a failure to a short code, without ever returning a database string.
 *
 * PostgREST puts its own codes in `code` (`PGRST205`, `42501`) and Postgres
 * puts its own in `message`. Both are collapsed to `unavailable` here, because
 * neither tells a visitor anything actionable.
 */
export function contactErrorCode(err) {
  if (err?.contactCode) return err.contactCode

  // Two error shapes reach this function. The fetch helpers in adminApi.js
  // build `{ status, payload }`; the supabase-js client hands back
  // `{ message, details, hint, code }` with `code` at the top level. Both are
  // read, because a PostgREST code on the client is the authoritative signal
  // and the message beside it is not guaranteed to name the failure.
  const payload = err?.payload
  const code = payload?.error?.code || payload?.code || err?.code
  if (code && MESSAGES[code]) return code

  // A database-shaped code or message is not a visitor-facing code.
  if (code) return 'unavailable'

  if (err?.status === 401) return 'unauthenticated'
  if (err?.status === 403) return 'forbidden'
  if (err?.status === 404 || err?.status === 503) return 'unavailable'
  if (err?.status === 429) return 'rate_limited'

  const raw = String(err?.message ?? err ?? '')
  if (/permission denied|row-level security|pgrst|postgres|column|relation/i.test(raw)) {
    return 'unavailable'
  }
  if (raw) return 'unknown'
  return 'unknown'
}

const LOWERCASE_MESSAGES = Object.fromEntries(
  Object.entries(MESSAGES).map(([code, text]) => [code.toLowerCase(), text]),
)

/**
 * The line a visitor sees.
 *
 * Never derived from the error's own message: a raw Postgres or PostgREST
 * string must not be able to reach the DOM through this function.
 */
export function contactErrorMessage(err, fallback = CONTACT_FALLBACK) {
  const code = contactErrorCode(err)
  return LOWERCASE_MESSAGES[code.toLowerCase()] ?? fallback
}

/**
 * What is safe to write to the browser console.
 *
 * The code only. Not the message, because the message is the part that names
 * tables and policies.
 */
export function contactErrorLog(err) {
  return contactErrorCode(err)
}