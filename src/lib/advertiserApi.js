import { supabase } from './api.js'
import { validateAdText } from './adText.js'
import {
  CAMPAIGN_STATUSES as RULE_STATUSES,
  MAX_BUDGET_CENTS,
  parseCpmCents,
  parseLandingUrl,
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

import { DEFAULT_INTERNAL_BACKEND } from './backendBase.js'

const AUDIENCE_LABELS = Object.fromEntries(ADVERTISER_AUDIENCES.map((a) => [a.id, a.label]))

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function campaignsBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    // Same-origin first for a host that proxies /api/*, then the internal
    // backend for a host that does not. The walker falls through only on a
    // routing miss, so the first candidate that answers wins.
    out.push('/api/campaigns')
    out.push(`${DEFAULT_INTERNAL_BACKEND}/campaigns`)
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
  if (!raw) return ['/api/auth/status', `${DEFAULT_INTERNAL_BACKEND}/auth`]
  if (raw.endsWith('/functions/v1')) {
    return [`${raw}/auth`, `${raw}/api/auth/status`]
  }
  return [`${raw}/api/auth/status`]
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

export function validateCampaignInput(input, base = null) {
  const errors = {}
  if (!String(input.name || '').trim()) errors.name = 'Campaign name is required.'
  const headline = validateAdText(input.headline)
  if (!headline.ok) errors.headline = headline.message
  if (!ADVERTISER_AUDIENCES.some((a) => a.id === input.audienceId)) {
    errors.audienceId = 'Select an audience.'
  }
  const budgetCents = Math.round(Number(input.budgetCredits) * 100)
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) {
    errors.budgetCredits = 'Budget must be greater than 0 credits.'
  } else if (budgetCents > MAX_BUDGET_CENTS) {
    errors.budgetCredits = 'Budget must be 1,000,000 credits or less in this prototype.'
  }
  if (input.status && !CAMPAIGN_STATUSES.includes(input.status)) {
    errors.status = 'Invalid status.'
  }
  const landing = parseLandingUrl(input.landingUrl)
  if (!landing.ok) errors.landingUrl = landing.message
  const starts = input.startsAt ? Date.parse(input.startsAt) : null
  const ends = input.endsAt ? Date.parse(input.endsAt) : null
  if (starts !== null && ends !== null && !Number.isNaN(starts) && !Number.isNaN(ends) && starts >= ends) {
    errors.endsAt = 'The end date must come after the start date.'
  }
  // A campaign cannot be scheduled in the past. The server stores TIMESTAMPTZ
  // and happily accepts a backdated row, but a backdated campaign is dead on
  // arrival: delivery only looks forward from "now" and the advertiser gets a
  // draft that can never activate. Catch it here so the form says why.
  //
  // In edit mode the check only applies to fields the advertiser actually
  // changed. Otherwise opening an existing campaign whose start date has
  // already passed would make the form refuse every other edit — the dates
  // are not wrong, they are just old, and the advertiser is not proposing to
  // move them.
  const now = Date.now()
  // Compare by resolved timestamp rather than by string. The form feeds
  // `YYYY-MM-DDTHH:mm` while the campaign row carries a full ISO string, so a
  // naive string comparison would always read the dates as changed and the
  // past-date check would fire on every edit of an already-started campaign.
  const baseStartMs = base && base.startsAt ? Date.parse(base.startsAt) : null
  const baseEndMs = base && base.endsAt ? Date.parse(base.endsAt) : null
  const startsChanged = !base || starts === null || baseStartMs === null || starts !== baseStartMs
  const endsChanged = !base || ends === null || baseEndMs === null || ends !== baseEndMs
  if (starts !== null && !Number.isNaN(starts) && starts < now && startsChanged) {
    errors.startsAt = 'The start date cannot be in the past.'
  }
  if (ends !== null && !Number.isNaN(ends) && ends < now && endsChanged) {
    errors.endsAt = 'The end date cannot be in the past.'
  }
  return errors
}

/**
 * Budget-and-schedule warnings, separate from validation. These do not block
 * anything; they tell the advertiser they are about to run out of room.
 *   - spend has crossed 80% of budget
 *   - the end date is within seven days
 * Returns an array of human strings, empty when there is nothing to say.
 */
export function campaignWarnings(campaign) {
  if (!campaign) return []
  const warnings = []
  const budgetCredits = Number(campaign.budgetCents || 0) / 100
  const spendCredits = Number(campaign.spendCents || 0) / 100
  if (budgetCredits > 0 && spendCredits >= budgetCredits * 0.8) {
    warnings.push(
      `You have spent ${formatCredits(spendCredits * 100)} of your ${formatCredits(budgetCredits * 100)} budget — ${formatCredits(Math.max(0, budgetCredits - spendCredits) * 100)} remains.`,
    )
  }
  const endsAt = campaign.endsAt ? Date.parse(campaign.endsAt) : null
  if (endsAt && !Number.isNaN(endsAt)) {
    const daysLeft = Math.ceil((endsAt - Date.now()) / 86_400_000)
    if (daysLeft <= 7) {
      warnings.push(
        `This campaign ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Extend the end date or let it finish.`,
      )
    }
  }
  return warnings
}

/** ISO or null. The API stores TIMESTAMPTZ; an empty input clears the date. */
function toIsoOrNull(value) {
  if (value === undefined || value === null || value === '') return null
  const ms = typeof value === 'number' ? value : Date.parse(value)
  return Number.isNaN(ms) ? null : new Date(ms).toISOString()
}

export async function createAdvertiserCampaign(input) {
  const budgetCents = Math.round(Number(input.budgetCredits) * 100)
  const landing = parseLandingUrl(input.landingUrl)
  const cpm = parseCpmCents(input.cpmCents)
  const body = {
    name: String(input.name).trim(),
    headline: String(input.headline).trim(),
    description: String(input.description || ''),
    cta: String(input.cta || 'Learn more'),
    audience_id: input.audienceId,
    budget_cents: budgetCents,
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
  if (patch.budgetCredits !== undefined) {
    body.budget_cents = Math.round(Number(patch.budgetCredits) * 100)
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

/**
 * Delete a campaign. The campaigns Edge Function answers DELETE on
 * `/:id` by archiving it (status -> archived), which keeps the accounting
 * rows intact rather than cascading through every impression and click.
 * The advertiser sees "Delete"; the row becomes archived.
 */
export async function deleteAdvertiserCampaign(id) {
  return archiveAdvertiserCampaign(id)
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

export function formatCredits(credits) {
  const n = Number(credits || 0)
  const abs = Math.abs(n)
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}${formatted} credits`
}

export function formatCents(cents) {
  const n = Number(cents || 0)
  const abs = Math.abs(n)
  const body = `${Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(abs % 100).toString().padStart(2, '0')}`
  return `${n < 0 ? '-' : ''}$${body}`
}

export async function fetchAdvertiserWallet() {
  const urls = campaignsBaseCandidates()
  const walletUrls = urls.map(u => u.replace('/campaigns', '/wallet/snapshot'))
  const { data } = await tryCandidates(walletUrls, { method: 'GET' })
  return data?.wallet ?? data ?? null
}

export function ctrPct(clicks, impressions) {
  if (!impressions) return 0
  return (clicks / impressions) * 100
}

export function conversionRatePct(conversions, clicks) {
  if (!clicks) return 0
  return (conversions / clicks) * 100
}
