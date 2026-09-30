/**
 * Map campaign/event API error codes to UI copy.
 * Never surface raw Postgres/PostgREST strings.
 */

const MESSAGES = {
  UNAUTHENTICATED: 'Session expired. Please sign in again.',
  FORBIDDEN: 'You do not have access to this campaign.',
  CAMPAIGN_NOT_FOUND: 'Campaign not found.',
  INVALID_AUDIENCE: 'Select an audience.',
  INVALID_STATUS: 'That campaign status is not supported.',
  INVALID_STATUS_TRANSITION: 'That status change is not allowed.',
  INVALID_BUDGET: 'Budget must be greater than $0.',
  BUDGET_EXCEEDED: 'This campaign has no remaining budget.',
  CAMPAIGN_NOT_SERVABLE: 'This campaign is not live, so it cannot record delivery.',
  DUPLICATE_EVENT: 'This event was already recorded.',
  INVALID_EVENT: 'The event could not be recorded.',
  INVALID_ID: 'That campaign id is not valid.',
  UNKNOWN_FIELDS: 'Some fields cannot be updated.',
  MISSING_FIELDS: 'Please complete the required fields.',
  NOT_FOUND: 'Campaigns endpoint not found. Check Edge Function deployment.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
  METHOD_NOT_ALLOWED: 'That action is not supported.',
}

export function campaignErrorCode(err) {
  const payload = err?.payload
  return (
    payload?.error?.code ||
    payload?.code ||
    (typeof payload?.error === 'string' ? payload.error : null)
  )
}

export function campaignErrorMessage(err, fallback = 'Campaign could not be saved.') {
  const code = campaignErrorCode(err)
  if (code && MESSAGES[code]) return MESSAGES[code]
  const raw = err?.message
  if (raw && !/postgres|pgrst|permission denied|column/i.test(raw)) {
    if (MESSAGES[raw]) return MESSAGES[raw]
    if (raw === 'Campaign name is required.') return raw
    if (raw === 'Headline is required.') return raw
    if (raw === 'Select an audience.') return raw
  }
  if (err?.status === 401) return MESSAGES.UNAUTHENTICATED
  if (err?.status === 403) return MESSAGES.FORBIDDEN
  if (err?.status === 404) return MESSAGES.CAMPAIGN_NOT_FOUND
  return fallback
}
