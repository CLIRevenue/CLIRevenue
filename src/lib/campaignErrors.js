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
  INVALID_CPM: 'CPM must be a positive number of milli-cents.',
  INVALID_LANDING_URL: 'Landing URL must be a full http(s) URL.',
  CAMPAIGN_NOT_ACTIVATABLE: 'This campaign is not ready to go live yet.',
  BUDGET_EXCEEDED: 'This campaign has no remaining budget.',
  CAMPAIGN_NOT_SERVABLE: 'This campaign is not live, so it cannot record delivery.',
  DUPLICATE_EVENT: 'This event was already recorded.',
  INVALID_EVENT: 'The event could not be recorded.',
  INVALID_ID: 'That campaign id is not valid.',
  UNKNOWN_FIELDS: 'Some fields cannot be updated.',
  MISSING_FIELDS: 'Please complete the required fields.',
  NOT_FOUND: 'Campaigns endpoint not found. Check Edge Function deployment.',
  // Creative pipeline (Phase 3)
  STORAGE_NOT_CONFIGURED: 'Creative storage is not configured on the server yet.',
  INVALID_FILE: 'Choose a file to upload.',
  INVALID_MEDIA_TYPE: 'Creative type must be image or video.',
  UNSUPPORTED_MIME_TYPE: 'That file format is not supported.',
  INVALID_FILE_SIZE: 'Report a file size before uploading.',
  FILE_TOO_LARGE: 'That file is larger than the allowed limit.',
  MIME_MISMATCH: 'The stored file type does not match the declared type.',
  SIZE_MISMATCH: 'The stored file size does not match the declared size.',
  INVALID_DIMENSIONS: 'Width and height must be positive whole numbers.',
  UPLOAD_NOT_STARTED: 'Start an upload before confirming it.',
  UPLOAD_NOT_FOUND: 'The uploaded object was not found in storage.',
  CREATIVE_NOT_UPLOADED: 'Upload the file before validating it.',
  CREATIVE_OBJECT_MISSING: 'The stored creative is gone. Upload it again.',
  CREATIVE_UPLOAD_FAILED: 'Creative upload failed.',
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
