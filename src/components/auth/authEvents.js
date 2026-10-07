/**
 * Why the auth state is being re-resolved — and how hard.
 *
 * The provider used to call refresh() for every event
 * supabase.auth.onAuthStateChange emits, without looking at which event it
 * was. Two things went wrong from that:
 *
 *  1. A routine access-token rotation re-entered the loading state, so the
 *     full-screen "Checking session and role…" animation replayed roughly
 *     hourly — and again whenever a backgrounded tab woke up and the SDK
 *     refreshed ahead of schedule — on a page that was already working.
 *  2. INITIAL_SESSION asks for exactly the resolution the mount effect has
 *     already started, so every page load resolved the session twice:
 *     getSession, getUser, the server-side role check and up to three table
 *     reads, twice, for one answer.
 *
 * A token rotation is not a session change. supabase swaps the access and
 * refresh tokens for the SAME user, so the role cannot have changed because
 * a string in local storage got longer. Naming that distinction is the
 * whole point of this module — it is pure and exported so the rule can be
 * tested directly instead of being re-derived from the provider's plumbing.
 *
 * The vocabulary deliberately distinguishes four situations:
 *
 *   BOOT             first resolution after a page load, started by the
 *                    mount effect. Shows the loading screen, exactly once.
 *   SESSION_CHANGE   the identity itself changed — sign-in, profile update,
 *                    password recovery, MFA verification. Must re-validate
 *                    against the server and may show loading.
 *   SIGN_OUT         the session ended, here or in another tab.
 *   TOKEN_ROTATION   same user, new tokens. Re-validate, silently: no
 *                    loading screen, so the animation cannot replay.
 *   NAVIGATION       a client-side route change. Carries no auth event at
 *                    all; named here so "navigation never re-resolves" is
 *                    part of the vocabulary rather than an omission.
 *   MANUAL           an explicit refresh() — the Retry button on the
 *                    missing-role screen.
 *
 * An unrecognised event is classified as SESSION_CHANGE. Assuming "no
 * change" for something new would silently skip validation; assuming
 * "change" only costs one redundant round trip.
 */

export const AUTH_EVENT = {
  INITIAL_SESSION: 'INITIAL_SESSION',
  SIGNED_IN: 'SIGNED_IN',
  SIGNED_OUT: 'SIGNED_OUT',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  USER_UPDATED: 'USER_UPDATED',
  PASSWORD_RECOVERY: 'PASSWORD_RECOVERY',
  MFA_CHALLENGE_VERIFIED: 'MFA_CHALLENGE_VERIFIED',
}

export const AUTH_REASON = {
  BOOT: 'boot',
  SESSION_CHANGE: 'session-change',
  SIGN_OUT: 'sign-out',
  TOKEN_ROTATION: 'token-rotation',
  NAVIGATION: 'navigation',
  MANUAL: 'manual',
}

/**
 * How much work one reason justifies.
 *
 *   FULL    resolve, and the resolution may enter the loading state. Only
 *           these reasons are allowed to replay the full-screen role-check
 *           animation, and only a FULL reason may make a data store refetch.
 *   SILENT  resolve without entering the loading state. The answer can
 *           genuinely have changed (the token did), so the resolution still
 *           runs and still re-validates against the server — the user just
 *           never sees it happen.
 *   NEVER   do nothing. A client-side navigation is not an auth event, and
 *           treating it as one is what made ordinary link clicks refetch.
 */
export const RESOLUTION = {
  FULL: 'full',
  SILENT: 'silent',
  NEVER: 'never',
}

const EVENT_REASON = {
  [AUTH_EVENT.INITIAL_SESSION]: AUTH_REASON.BOOT,
  [AUTH_EVENT.SIGNED_IN]: AUTH_REASON.SESSION_CHANGE,
  [AUTH_EVENT.SIGNED_OUT]: AUTH_REASON.SIGN_OUT,
  [AUTH_EVENT.TOKEN_REFRESHED]: AUTH_REASON.TOKEN_ROTATION,
  [AUTH_EVENT.USER_UPDATED]: AUTH_REASON.SESSION_CHANGE,
  [AUTH_EVENT.PASSWORD_RECOVERY]: AUTH_REASON.SESSION_CHANGE,
  [AUTH_EVENT.MFA_CHALLENGE_VERIFIED]: AUTH_REASON.SESSION_CHANGE,
}

const REASON_PLAN = {
  [AUTH_REASON.BOOT]: RESOLUTION.FULL,
  [AUTH_REASON.SESSION_CHANGE]: RESOLUTION.FULL,
  [AUTH_REASON.SIGN_OUT]: RESOLUTION.FULL,
  [AUTH_REASON.MANUAL]: RESOLUTION.FULL,
  [AUTH_REASON.TOKEN_ROTATION]: RESOLUTION.SILENT,
  [AUTH_REASON.NAVIGATION]: RESOLUTION.NEVER,
}

/** Which situation this SDK event represents. */
export function classifyAuthEvent(event) {
  const name = typeof event === 'string' ? event : ''
  return EVENT_REASON[name] || AUTH_REASON.SESSION_CHANGE
}

/**
 * How hard to work for a reason. Total over every AUTH_REASON, so an
 * unknown reason is answered as a real session change rather than silently
 * resolving to nothing.
 */
export function planFor(reason) {
  return REASON_PLAN[reason] || RESOLUTION.FULL
}

/** Only the boot is once-per-provider: the mount starts it and
 *  INITIAL_SESSION asks for the same one. */
export function isOnceOnly(reason) {
  return reason === AUTH_REASON.BOOT
}

/**
 * True when the reason may put the app back into its loading state. A token
 * rotation must never: that is the replayed role-check animation.
 */
export function mayShowLoading(reason) {
  return planFor(reason) === RESOLUTION.FULL
}
