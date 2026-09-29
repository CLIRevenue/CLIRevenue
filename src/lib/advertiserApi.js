import { supabase } from './api.js'

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

export const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived']

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
    // Canonical Supabase layout from the task:
    // /functions/v1/campaigns/api/campaigns
    out.push(`${raw}/campaigns/api/campaigns`)
    // Legacy / alternative gateway layout used by src/lib/api.js:
    // /functions/v1/api/campaigns
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
      (json && (json.error?.message || json.error || json.message)) ||
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

export function normalizeCampaign(raw = {}) {
  const audienceId =
    raw.audience_id || raw.audienceId || raw.audience || 'backend'
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
    impressions,
    clicks,
    conversions,
    status: raw.status || 'draft',
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
    errors.audienceId = 'Pick a valid audience.'
  }
  const budgetCents = Math.round(Number(input.budgetDollars) * 100)
  if (!Number.isFinite(budgetCents) || budgetCents <= 0) {
    errors.budgetDollars = 'Budget must be greater than $0.'
  } else if (budgetCents > 100_000_00) {
    errors.budgetDollars = 'Budget must be $100,000 or less in this prototype.'
  }
  if (input.status && !CAMPAIGN_STATUSES.includes(input.status)) {
    errors.status = 'Invalid status.'
  }
  return errors
}

export async function createAdvertiserCampaign(input) {
  const budgetCents = Math.round(Number(input.budgetDollars) * 100)
  const body = {
    name: String(input.name).trim(),
    headline: String(input.headline).trim(),
    description: String(input.description || ''),
    cta: String(input.cta || 'Learn more'),
    audience_id: input.audienceId,
    audience: input.audienceId,
    budget_cents: budgetCents,
    budgetCents,
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
