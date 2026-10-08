import { supabase } from './api.js'
import {
  CAMPAIGN_STATUSES as RULE_STATUSES,
  MAX_BUDGET_CENTS,
  parseCpmCents,
  parseLandingUrl,
  validateCreativeFile,
} from './campaignRules.js'

/**
 * Advertiser-specific service layer.
 * Isolated from developer/reward logic. All money stays in integer cents.
 * Backend is authoritative; this module never invents spend or stats.
 */

export const ADVERTISER_AUDIENCES = [
  { id: 'backend', label: 'Backend & API' },
  { id: 'data', label: 'Data & ML' },
  { id: 'devops', label: 'DevOps & Platform' },
  { id: 'frontend', label: 'Frontend & Web' },
  { id: 'oss', label: 'OSS maintainers' },
]

export const CAMPAIGN_STATUSES = RULE_STATUSES

const AUDIENCE_LABELS = Object.fromEntries(ADVERTISER_AUDIENCES.map((a) => [a.id, a.label]))

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function campaignsBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/campaigns')
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/campaigns`)
    out.push(`${raw}/campaigns/api/campaigns`)
    out.push(`${raw}/api/campaigns`)
    return out
  }
  if (raw.endsWith('/campaigns')) {
    out.push(`${raw}/api/campaigns`)
    return out
  }
  out.push(`${raw}/api/campaigns`)
  out.push(`${raw}/campaigns/api/campaigns`)
  return out
}

function authBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  if (!raw) return ['/api/auth/status']
  if (raw.endsWith('/functions/v1')) {
    return [`${raw}/auth`, `${raw}/api/auth/status`]
  }
  return [`${raw}/api/auth/status`]
}

/* Creative uploads hit their own Edge Function. Same base-routing logic as
   campaigns, kept in one place so a new gateway prefix needs one edit. */
function creativesBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/creatives')
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/creatives`)
    out.push(`${raw}/creatives/api/creatives`)
    out.push(`${raw}/api/creatives`)
    return out
  }
  if (raw.endsWith('/creatives')) {
    out.push(`${raw}/api/creatives`)
    return out
  }
  out.push(`${raw}/api/creatives`)
  out.push(`${raw}/creatives/api/creatives`)
  return out
}

async function authedFetch(url, options = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { ...options, headers })
  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || (typeof json.error === 'string' ? json.error : json.message))) ||
      res.statusText ||
      'Request failed'
    const err = new Error(typeof msg === 'string' ? msg : 'Request failed')
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

async function tryCandidates(urls, options) {
  let lastErr = null
  for (const url of urls) {
    try {
      return { url, data: await authedFetch(url, options) }
    } catch (e) {
      lastErr = e
      // Only fall through on routing mismatches; surface auth/validation errors.
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

function resolveAudienceId(raw = {}) {
  if (raw.audience_id && AUDIENCE_LABELS[raw.audience_id]) return raw.audience_id
  if (raw.audienceId && AUDIENCE_LABELS[raw.audienceId]) return raw.audienceId
  if (raw.audience && AUDIENCE_LABELS[raw.audience]) return raw.audience
  const byLabel = ADVERTISER_AUDIENCES.find(
    (a) => a.label === raw.audience || a.label === raw.audienceLabel,
  )
  return byLabel?.id || 'backend'
}

export function normalizeCreative(raw = null) {
  if (!raw) return null
  const status = raw.status || 'pending'
  return {
    id: raw.id || raw.creative_id || null,
    campaignId: raw.campaignId || raw.campaign_id || null,
    status,
    mediaType: raw.mediaType || raw.media_type || null,
    mimeType: raw.mimeType || raw.mime_type || null,
    fileSizeBytes: Number.isFinite(raw.fileSizeBytes)
      ? raw.fileSizeBytes
      : Number.isFinite(raw.file_size_bytes)
        ? raw.file_size_bytes
        : null,
    width: Number.isFinite(raw.width) ? raw.width : null,
    height: Number.isFinite(raw.height) ? raw.height : null,
    durationMs: Number.isFinite(raw.durationMs)
      ? raw.durationMs
      : Number.isFinite(raw.duration_ms)
        ? raw.duration_ms
        : null,
    label: raw.label || null,
    /* Playable URL is minted server-side, per request, with a short TTL. It is
       intentionally absent from campaign responses — only the creatives
       endpoint and ad delivery hand one out. */
    url: raw.url || null,
    posterUrl: raw.posterUrl || raw.poster_url || null,
    updatedAt: raw.updatedAt || raw.updated_at || null,
  }
}

export function normalizeCampaign(raw = {}) {
  const audienceId = resolveAudienceId(raw)
  const spendCents =
    Number.isFinite(raw.spendCents)
      ? raw.spendCents
      : Number.isFinite(raw.spend_cents)
        ? raw.spend_cents
        : 0
  const budgetCents =
    Number.isFinite(raw.budgetCents)
      ? raw.budgetCents
      : Number.isFinite(raw.budget_cents)
        ? raw.budget_cents
        : 0
  const impressions = Number.isFinite(raw.impressions)
    ? raw.impressions
    : Number.isFinite(raw.impressions_count)
      ? raw.impressions_count
      : 0
  const clicks = Number.isFinite(raw.clicks)
    ? raw.clicks
    : Number.isFinite(raw.clicks_count)
      ? raw.clicks_count
      : 0
  const conversions = Number.isFinite(raw.conversions)
    ? raw.conversions
    : Number.isFinite(raw.conversions_count)
      ? raw.conversions_count
      : 0
  return {
    id: raw.id,
    name: raw.name || '(untitled)',
    headline: raw.headline || '',
    description: raw.description || '',
    cta: raw.cta || 'Learn more',
    audienceId,
    audienceLabel: AUDIENCE_LABELS[audienceId] || raw.audience || audienceId,
    budgetCents,
    spendCents,
    remainingBudgetCents: Math.max(0, budgetCents - spendCents),
    impressions,
    clicks,
    conversions,
    status: raw.status || 'draft',
    landingUrl: raw.landingUrl || raw.landing_url || null,
    cpmCents: Number.isFinite(raw.cpmCents)
      ? raw.cpmCents
      : Number.isFinite(raw.cpm_cents)
        ? raw.cpm_cents
        : null,
    startsAt: raw.startsAt || raw.starts_at || null,
    endsAt: raw.endsAt || raw.ends_at || null,
    creative: normalizeCreative(raw.creative),
    createdAt: raw.createdAt || raw.created_at || null,
    updatedAt: raw.updatedAt || raw.updated_at || null,
    _raw: raw,
  }
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload.map(normalizeCampaign)
  if (Array.isArray(payload?.campaigns)) return payload.campaigns.map(normalizeCampaign)
  if (Array.isArray(payload?.data)) return payload.data.map(normalizeCampaign)
  return []
}

export async function fetchAdvertiserCampaigns() {
  const urls = campaignsBaseCandidates()
  const { data } = await tryCandidates(
    urls,
    { method: 'GET' },
  )
  return normalizeList(data)
}

export function validateCampaignInput(input) {
  const errors = {}
  if (!String(input.name || '').trim()) errors.name = 'Campaign name is required.'
  if (!String(input.headline || '').trim()) errors.headline = 'Headline is required.'
  if (!ADVERTISER_AUDIENCES.some((a) => a.id === input.audienceId)) {
    errors.audienceId = 'Select an audience.'
  }
  const budgetCents = Math.round(Number(input.budgetDollars) * 100)
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) {
    errors.budgetDollars = 'Budget must be greater than $0.'
  } else if (budgetCents > MAX_BUDGET_CENTS) {
    errors.budgetDollars = 'Budget must be $100,000 or less in this prototype.'
  }
  if (input.status && !CAMPAIGN_STATUSES.includes(input.status)) {
    errors.status = 'Invalid status.'
  }
  const landing = parseLandingUrl(input.landingUrl)
  if (!landing.ok) errors.landingUrl = landing.message
  const cpm = parseCpmCents(input.cpmCents)
  if (!cpm.ok) errors.cpmCents = cpm.message
  const starts = input.startsAt ? Date.parse(input.startsAt) : null
  const ends = input.endsAt ? Date.parse(input.endsAt) : null
  if (starts !== null && ends !== null && !Number.isNaN(starts) && !Number.isNaN(ends) && starts >= ends) {
    errors.endsAt = 'The end date must come after the start date.'
  }
  return errors
}

/** ISO or null. The API stores TIMESTAMPTZ; an empty input clears the date. */
function toIsoOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export async function createAdvertiserCampaign(input) {
  const budgetCents = Math.round(Number(input.budgetDollars) * 100)
  const landing = parseLandingUrl(input.landingUrl)
  const cpm = parseCpmCents(input.cpmCents)
  const body = {
    name: String(input.name).trim(),
    headline: String(input.headline).trim(),
    description: String(input.description || ''),
    cta: String(input.cta || 'Learn more'),
    audience_id: input.audienceId,
    audience: input.audienceId,
    budget_cents: budgetCents,
    budgetCents,
    landing_url: landing.ok ? landing.value : null,
    cpm_cents: cpm.ok ? cpm.value : null,
    starts_at: toIsoOrNull(input.startsAt),
    ends_at: toIsoOrNull(input.endsAt),
  }
  const urls = campaignsBaseCandidates()
  // POST only makes sense on the collection URL; try each candidate base.
  let lastErr = null
  for (const url of urls) {
    try {
      const data = await authedFetch(url, { method: 'POST', body: JSON.stringify(body) })
      return normalizeCampaign(data?.campaign || data)
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function updateAdvertiserCampaign(id, patch) {
  const body = {}
  if (patch.name !== undefined) body.name = patch.name
  if (patch.headline !== undefined) body.headline = patch.headline
  if (patch.description !== undefined) body.description = patch.description
  if (patch.cta !== undefined) body.cta = patch.cta
  if (patch.audienceId !== undefined) {
    body.audience_id = patch.audienceId
    body.audience = patch.audienceId
  }
  if (patch.budgetDollars !== undefined) {
    body.budget_cents = Math.round(Number(patch.budgetDollars) * 100)
    body.budgetCents = body.budget_cents
  }
  if (patch.cpmCents !== undefined) {
    const parsed = parseCpmCents(patch.cpmCents)
    if (parsed.ok) {
      body.cpm_cents = parsed.value
      body.cpmCents = parsed.value
    }
  }
  if (patch.landingUrl !== undefined) {
    const parsed = parseLandingUrl(patch.landingUrl)
    if (parsed.ok) {
      body.landing_url = parsed.value
      body.landingUrl = parsed.value
    }
  }
  if (patch.startsAt !== undefined) {
    body.starts_at = toIsoOrNull(patch.startsAt)
    body.startsAt = body.starts_at
  }
  if (patch.endsAt !== undefined) {
    body.ends_at = toIsoOrNull(patch.endsAt)
    body.endsAt = body.ends_at
  }
  if (patch.status !== undefined) body.status = patch.status

  const bases = campaignsBaseCandidates()
  const urls = bases.map((b) => `${b}/${id}`)
  let lastErr = null
  for (const url of urls) {
    try {
      const data = await authedFetch(url, { method: 'PATCH', body: JSON.stringify(body) })
      return normalizeCampaign(data?.campaign || data)
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function archiveAdvertiserCampaign(id) {
  const bases = campaignsBaseCandidates()
  const archiveUrls = bases.map((b) => `${b}/${id}/archive`)
  const deleteUrls = bases.map((b) => `${b}/${id}`)
  let lastErr = null
  for (const url of archiveUrls) {
    try {
      const data = await authedFetch(url, { method: 'POST', body: JSON.stringify({}) })
      return normalizeCampaign(data?.campaign || data)
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  for (const url of deleteUrls) {
    try {
      const data = await authedFetch(url, { method: 'DELETE' })
      return normalizeCampaign(data?.campaign || data)
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function setActiveCampaign(id) {
  const bases = campaignsBaseCandidates()
  const urls = bases.map((b) => `${b}/${id}/select`)
  let lastErr = null
  for (const url of urls) {
    try {
      return await authedFetch(url, { method: 'POST', body: JSON.stringify({}) })
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

// ---------------------------------------------------------------------------
// Creative pipeline (Phase 3/12)
//
// Ownership is never asserted by the browser: every call below carries the
// caller's Supabase JWT and names only a campaignId. The Edge Function derives
// JWT -> profile -> advertiser -> campaign -> creative and scopes every read and
// write with `.eq("advertiser_id", ...)`. The returned presigned PUT URL is a
// short-lived capability for one deterministic object key; no Filebase
// credential is ever visible to this module.
// ---------------------------------------------------------------------------

function creativeUrls(suffix) {
  return creativesBaseCandidates().map((b) => (suffix ? `${b}/${suffix}` : b))
}

function creativeError(payload, fallback) {
  const code = payload?.code || payload?.error?.code || 'CREATIVE_UPLOAD_FAILED'
  const message =
    payload?.error?.message ||
    payload?.message ||
    payload?.error ||
    fallback ||
    'Creative upload failed.'
  const err = new Error(typeof message === 'string' ? message : String(message))
  err.code = code
  return err
}

async function creativeRequest(suffix, options = {}) {
  const { data } = await tryCandidates(creativeUrls(suffix), options)
  return data
}

export async function fetchCreatives({ campaignId = null, includeUrl = false } = {}) {
  const query = []
  if (campaignId) query.push(`campaignId=${encodeURIComponent(campaignId)}`)
  if (includeUrl) query.push('includeUrl=true')
  const suffix = query.length ? `?${query.join('&')}` : ''
  const data = await creativeRequest(suffix, { method: 'GET' })
  const rows = Array.isArray(data) ? data : data?.creatives || []
  return rows.map(normalizeCreative)
}

export async function requestCreativeUpload(
  campaignId,
  { mediaType, mimeType, fileSizeBytes, filename, label } = {},
) {
  const body = { campaignId, mediaType, mimeType, fileSizeBytes }
  if (filename) body.filename = filename
  if (label) body.label = label
  const data = await creativeRequest('upload-intent', {
    method: 'POST',
    body: JSON.stringify(body),
  })
  return {
    creative: normalizeCreative(data?.creative || null),
    upload: data?.upload || null,
    storageReady: data?.storageReady === true,
    ttlRange: data?.ttlRange || null,
  }
}

export async function confirmCreativeUpload(
  campaignId,
  { mimeType, fileSizeBytes, width, height, durationMs, checksum } = {},
) {
  const body = { campaignId }
  if (mimeType) body.mimeType = mimeType
  if (fileSizeBytes !== undefined) body.fileSizeBytes = fileSizeBytes
  if (width !== undefined) body.width = width
  if (height !== undefined) body.height = height
  if (durationMs !== undefined) body.durationMs = durationMs
  if (checksum) body.checksum = checksum
  const data = await creativeRequest('confirm', { method: 'POST', body: JSON.stringify(body) })
  return normalizeCreative(data?.creative || null)
}

export async function validateCreative(campaignId) {
  const data = await creativeRequest('validate', {
    method: 'POST',
    body: JSON.stringify({ campaignId }),
  })
  return normalizeCreative(data?.creative || null)
}

export async function revokeCreative(campaignId) {
  const data = await creativeRequest('revoke', {
    method: 'POST',
    body: JSON.stringify({ campaignId }),
  })
  return normalizeCreative(data?.creative || null)
}

export async function deleteCreative(campaignId) {
  const data = await creativeRequest('delete', {
    method: 'DELETE',
    body: JSON.stringify({ campaignId }),
  })
  return normalizeCreative(data?.creative || null)
}

/**
 * PATCH-style object upload used only for real progress reporting.
 * Falls back to fetch when XMLHttpRequest is unavailable (workers, tests).
 */
function putObject(url, mimeType, file, { onProgress, signal } = {}) {
  if (typeof XMLHttpRequest === 'undefined') {
    return fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file,
      signal,
    }).then((res) => {
      if (!res.ok) throw creativeError(null, `Object storage rejected the upload (${res.status}).`)
    })
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', mimeType)
    if (xhr.upload && typeof onProgress === 'function') {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)))
        }
      }
    }
    if (signal) {
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(creativeError(null, `Object storage rejected the upload (${xhr.status}).`))
    }
    xhr.onerror = () => reject(creativeError(null, 'Object storage is unreachable.'))
    xhr.onabort = () => reject(creativeError(null, 'Upload was cancelled.'))
    xhr.send(file)
  })
}

/**
 * The whole server-authoritative upload handshake:
 *   1. ask for a presigned PUT (server derives the object key)
 *   2. PUT the bytes straight to storage
 *   3. confirm (server HEADs the object and owns size/type truth)
 *   4. validate (server re-HEADs, then marks the creative servable)
 *
 * Nothing here decides eligibility, spend or payout; that stays server-side.
 */
export async function uploadCreativeFile(campaignId, file, options = {}) {
  const { mediaType, onProgress, signal, width, height, durationMs } = options
  const check = validateCreativeFile(file, mediaType)
  if (!check.ok) throw creativeError({ error: { message: check.message }, code: check.code }, check.message)

  const intent = await requestCreativeUpload(campaignId, {
    mediaType,
    mimeType: check.mimeType,
    fileSizeBytes: check.fileSizeBytes,
    filename: file.name,
    label: options.label,
  })
  if (!intent.upload?.url) {
    throw creativeError(null, 'The server did not issue an upload URL. Creative storage may be unconfigured.')
  }

  onProgress?.(1)
  await putObject(intent.upload.url, check.mimeType, file, { onProgress, signal })
  onProgress?.(99)

  const confirmed = await confirmCreativeUpload(campaignId, {
    mimeType: check.mimeType,
    fileSizeBytes: check.fileSizeBytes,
    width,
    height,
    durationMs,
  })
  const validated = await validateCreative(campaignId)
  onProgress?.(100)
  return validated || confirmed
}

export async function fetchAuthStatus() {
  const urls = authBaseCandidates()
  try {
    const { data } = await tryCandidates(urls, { method: 'GET' })
    return data
  } catch {
    return null
  }
}

export async function fetchAdvertiserProfile() {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError
  let advertiser = null
  try {
    const { data, error } = await supabase
      .from('advertisers')
      .select('id, company_name, contact_email')
      .eq('profile_id', user.id)
      .maybeSingle()
    if (!error) advertiser = data
  } catch {
    advertiser = null
  }
  return {
    userId: user.id,
    email: user.email,
    role: profile?.role || null,
    advertiser,
  }
}

export function toBudgetDollars(budgetCents) {
  return (Number(budgetCents || 0) / 100).toFixed(2)
}

export function formatCents(cents) {
  const n = Number(cents || 0)
  const abs = Math.abs(n)
  const body = `${Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(abs % 100).toString().padStart(2, '0')}`
  return `${n < 0 ? '-' : ''}$${body}`
}

export function ctrPct(clicks, impressions) {
  if (!impressions) return 0
  return (clicks / impressions) * 100
}

export function conversionRatePct(conversions, clicks) {
  if (!clicks) return 0
  return (conversions / clicks) * 100
}
