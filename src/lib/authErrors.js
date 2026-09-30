/**
 * Auth error normalisation.
 *
 * Supabase Auth error strings vary across versions and project
 * configurations ("User already registered", "A user with this email
 * address has already been registered", rate-limit JSON bodies, …).
 * Components must never match on raw provider strings, so every auth
 * call site maps its error through here first and renders only the
 * stable UI categories this module returns.
 *
 * The message strings returned are final user-facing copy: they never
 * include error.stack, provider internals, or database details.
 */

export const AUTH_ERROR = {
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  INVALID_EMAIL: 'INVALID_EMAIL',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_NOT_CONFIRMED: 'EMAIL_NOT_CONFIRMED',
  WEAK_PASSWORD: 'WEAK_PASSWORD',
  RATE_LIMITED: 'RATE_LIMITED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  UNKNOWN: 'UNKNOWN_AUTH_ERROR',
}

const MESSAGES = {
  [AUTH_ERROR.EMAIL_ALREADY_REGISTERED]:
    'Email already in use. An account with this email already exists.',
  [AUTH_ERROR.INVALID_EMAIL]: 'Enter a valid email address.',
  [AUTH_ERROR.INVALID_CREDENTIALS]:
    'Incorrect email or password.',
  [AUTH_ERROR.EMAIL_NOT_CONFIRMED]:
    'This email has not been confirmed yet. Check your inbox for the confirmation link.',
  [AUTH_ERROR.WEAK_PASSWORD]:
    'Password is too weak. Use at least 6 characters.',
  [AUTH_ERROR.RATE_LIMITED]:
    'Too many attempts. Please wait a minute and try again.',
  [AUTH_ERROR.NETWORK_ERROR]:
    'Could not reach the server. Check your connection and try again.',
  [AUTH_ERROR.NOT_CONFIGURED]:
    'Authentication is not configured in this environment.',
  [AUTH_ERROR.UNKNOWN]:
    'Something went wrong. Please try again.',
}

/** Human-readable message for a normalised auth error. */
export function authErrorMessage(kind) {
  return MESSAGES[kind] || MESSAGES[AUTH_ERROR.UNKNOWN]
}

/**
 * Map any thrown auth error to a stable UI category. `context` narrows
 * the heuristic for ambiguous providers: 'signup' treats several
 * provider wordings as duplicate-email even where they read like
 * validation errors, because the signup form is the one flow where an
 * existing account is the dominant cause.
 */
export function normalizeAuthError(err, context = 'signup') {
  if (!err) return AUTH_ERROR.UNKNOWN

  const raw = `${err.code || ''} ${err.status || ''} ${err.name || ''} ${err.message || ''}`
  const status = typeof err.status === 'number' ? err.status : Number(err.status) || 0
  const code = String(err.code || '').toLowerCase()
  const msg = String(err.message || '').toLowerCase()

  if (status === 0 || /fetch|network|failed to fetch/i.test(raw)) {
    return AUTH_ERROR.NETWORK_ERROR
  }
  if (code === 'user_already_exists' || code === 'email_exists') {
    return AUTH_ERROR.EMAIL_ALREADY_REGISTERED
  }
  if (code === 'invalid_credentials' || code === 'invalid_login_credentials') {
    // On signup this wording usually still means the email is taken.
    return context === 'signup' ? AUTH_ERROR.EMAIL_ALREADY_REGISTERED : AUTH_ERROR.INVALID_CREDENTIALS
  }
  if (code === 'email_address_invalid' || /email address .* is invalid|invalid email|invalid format/.test(msg)) {
    return AUTH_ERROR.INVALID_EMAIL
  }
  if (status === 422 && context === 'signup' && /already|exists|registered/.test(msg)) {
    return AUTH_ERROR.EMAIL_ALREADY_REGISTERED
  }
  if (/already|exist|registered|in use/.test(msg) && (context === 'signup' || status === 422)) {
    return AUTH_ERROR.EMAIL_ALREADY_REGISTERED
  }
  if (code === 'email_not_confirmed' || /not confirmed|confirm your email/.test(msg)) {
    return AUTH_ERROR.EMAIL_NOT_CONFIRMED
  }
  if (code === 'weak_password' || /password.*(weak|short|at least)/.test(msg)) {
    return AUTH_ERROR.WEAK_PASSWORD
  }
  if (status === 429 || /rate.?limit|too many/.test(msg)) {
    return AUTH_ERROR.RATE_LIMITED
  }
  if (/not configured/i.test(msg)) {
    return AUTH_ERROR.NOT_CONFIGURED
  }
  if (status === 400 && context === 'login') {
    return AUTH_ERROR.INVALID_CREDENTIALS
  }
  return AUTH_ERROR.UNKNOWN
}
