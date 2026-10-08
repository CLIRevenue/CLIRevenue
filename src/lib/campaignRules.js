export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived']

export const TRANSITIONS = {
  draft: ['active', 'archived'],
  active: ['paused', 'completed', 'archived'],
  paused: ['active', 'archived'],
  completed: ['archived'],
  archived: [],
}

export const MAX_BUDGET_CENTS = 10_000_000

/* Mirror of `campaigns.cpm_cents`. The column stores MILLI-cents (10 = $0.01),
   so a CPM is an integer of thousandths of a cent, not dollars. */
export const MAX_CPM_CENTS = 10_000

/* The landing URL is the advertised destination only. It is never signed and
   never carries attribution — keep the client rule identical to the server's
   `parseLandingUrl` so the form never shows an error the API will not produce. */
const LANDING_URL_RE = /^https?:\/\/[^\s]+$/
export const MAX_LANDING_URL_LENGTH = 2048

export const CREATIVE_STATUSES = ['pending', 'uploaded', 'validated', 'failed', 'revoked']
export const CREATIVE_MEDIA_TYPES = ['image', 'video']

/* SVG is deliberately absent: it is an executable document and would turn the
   ad slot into stored XSS. Server allowlist lives in
   `supabase/functions/_shared/filebase.ts`. */
export const CREATIVE_MIME_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'],
  video: ['video/mp4', 'video/webm'],
}

export const MAX_CREATIVE_BYTES = {
  image: 5 * 1024 * 1024,
  video: 25 * 1024 * 1024,
}

export function maxCreativeBytes(mediaType) {
  return MAX_CREATIVE_BYTES[mediaType] || MAX_CREATIVE_BYTES.image
}

export function acceptForMediaType(mediaType) {
  return (CREATIVE_MIME_TYPES[mediaType] || []).join(',')
}

/** Best-effort client-side gate. The server re-validates on upload-intent. */
export function validateCreativeFile(file, mediaType) {
  if (!file) return { ok: false, code: 'INVALID_FILE', message: 'Choose a file to upload.' }
  if (!CREATIVE_MEDIA_TYPES.includes(mediaType)) {
    return { ok: false, code: 'INVALID_MEDIA_TYPE', message: 'Only image and video creatives are supported.' }
  }
  const mime = String(file.type || '').toLowerCase()
  if (!CREATIVE_MIME_TYPES[mediaType].includes(mime)) {
    return {
      ok: false,
      code: 'UNSUPPORTED_MIME_TYPE',
      message: `${mediaType} creatives must be one of: ${CREATIVE_MIME_TYPES[mediaType].join(', ')}.`,
    }
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, code: 'INVALID_FILE_SIZE', message: 'The file is empty.' }
  }
  const limit = maxCreativeBytes(mediaType)
  if (file.size > limit) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: `Creative must be ${formatBytes(limit)} or smaller.`,
    }
  }
  return { ok: true, mimeType: mime, fileSizeBytes: file.size, maxBytes: limit }
}

export function formatBytes(bytes) {
  const n = Number(bytes || 0)
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

export function parseLandingUrl(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  if (typeof raw !== 'string') {
    return { ok: false, code: 'INVALID_LANDING_URL', message: 'Landing URL must be a string.' }
  }
  const value = raw.trim()
  if (!value) return { ok: true, value: null }
  if (value.length > MAX_LANDING_URL_LENGTH || !LANDING_URL_RE.test(value)) {
    return {
      ok: false,
      code: 'INVALID_LANDING_URL',
      message: 'Landing URL must start with http:// or https:// and contain no spaces.',
    }
  }
  return { ok: true, value }
}

export function parseCpmCents(raw) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  const value = typeof raw === 'string' ? Number(raw) : raw
  if (!Number.isInteger(value) || value <= 0 || value > MAX_CPM_CENTS) {
    return { ok: false, code: 'INVALID_CPM', message: 'CPM must be a whole number of milli-cents.' }
  }
  return { ok: true, value }
}

/* Blocker codes come from the `campaign_activation_blockers` SQL function, which
   is the single authority on whether a campaign may go live. The client keeps a
   mirror only so the form can explain a refusal; it never decides activation. */
export const ACTIVATION_BLOCKER_MESSAGES = {
  CAMPAIGN_NOT_FOUND: 'That campaign no longer exists.',
  ADVERTISER_NOT_ELIGIBLE: 'Your advertiser account is not allowed to run campaigns.',
  INVALID_AUDIENCE: 'Choose an audience the server recognises.',
  INVALID_BUDGET: 'Budget must be greater than $0.',
  INVALID_CPM: 'CPM must be greater than 0.',
  INVALID_SCHEDULE: 'The end date must come after the start date.',
  SCHEDULE_NOT_STARTED: 'This campaign has not started yet. Move the start date into the past to deliver now.',
  SCHEDULE_ENDED: 'This campaign has already ended. Extend the end date to deliver again.',
  INVALID_LANDING_URL: 'Set a valid http(s) landing URL before activating.',
  BUDGET_EXCEEDED: 'This campaign has spent its full budget.',
  CREATIVE_MISSING: 'Upload and validate a creative before activating this campaign.',
}

export function activationBlockerMessage(code) {
  return ACTIVATION_BLOCKER_MESSAGES[code] || 'This campaign is not ready to go live yet.'
}

/** Advisory only — mirrors the server rules so the UI can hint before a round trip. */
export function advisoryBlockers(campaign = {}, { nowMs = Date.now() } = {}) {
  const out = []
  if (!campaign.budgetCents || campaign.budgetCents <= 0) out.push('INVALID_BUDGET')
  if (!campaign.audienceId) out.push('INVALID_AUDIENCE')
  const url = parseLandingUrl(campaign.landingUrl)
  if (!url.ok) out.push('INVALID_LANDING_URL')
  const starts = campaign.startsAt ? Date.parse(campaign.startsAt) : null
  const ends = campaign.endsAt ? Date.parse(campaign.endsAt) : null
  if (starts !== null && ends !== null && !Number.isNaN(starts) && !Number.isNaN(ends) && starts >= ends) {
    out.push('INVALID_SCHEDULE')
  }
  if (starts !== null && !Number.isNaN(starts) && starts > nowMs) out.push('SCHEDULE_NOT_STARTED')
  if (ends !== null && !Number.isNaN(ends) && ends <= nowMs) out.push('SCHEDULE_ENDED')
  if (!campaign.creative || campaign.creative.status !== 'validated') out.push('CREATIVE_MISSING')
  return out
}

export function canTransition(from, to) {
  if (from === to) return true
  return (TRANSITIONS[from] || []).includes(to)
}

export function allowedNextStatuses(from) {
  const next = TRANSITIONS[from] || []
  return [from, ...next.filter((s) => s !== from)]
}

export function parseBudgetCents(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { ok: false, code: 'INVALID_BUDGET', message: 'Budget must be a non-negative integer (cents).' }
  }
  if (value > MAX_BUDGET_CENTS) {
    return { ok: false, code: 'INVALID_BUDGET', message: 'Budget exceeds the maximum allowed for this environment.' }
  }
  return { ok: true, value }
}
