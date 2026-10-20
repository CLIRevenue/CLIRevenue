import { supabase } from './api.js'

/**
 * Admin service layer.
 *
 * Every call sends the current session's bearer token. The server is the
 * sole authority for whether the caller is an admin — no isAdmin flag is
 * ever sent by the browser, and no admin password is stored here.
 */

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function adminBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/admin')
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/admin`)
    out.push(`${raw}/api/admin`)
    return out
  }
  if (raw.endsWith('/admin')) {
    out.push(raw)
    return out
  }
  out.push(`${raw}/api/admin`)
  out.push(`${raw}/admin`)
  return out
}

async function authedFetch(url, options = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    const err = new Error('Not signed in.');
    err.status = 401
    throw err
  }
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  }
  headers.Authorization = `Bearer ${token}`

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
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function fetchAdminOverview() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(urls, { method: 'GET' })
  return data
}

export async function fetchAdminCampaigns() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/campaigns`)], { method: 'GET' })
  return data?.campaigns ?? data ?? []
}

export async function fetchAdminAdvertisers() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/advertisers`)], { method: 'GET' })
  return data?.advertisers ?? data ?? []
}

export async function fetchAdminDevelopers() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/developers`)], { method: 'GET' })
  return data?.developers ?? data ?? []
}

export async function fetchAdminPlacements() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/placements`)], { method: 'GET' })
  return data?.placements ?? data ?? []
}

export async function fetchAdminEvents() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/events`)], { method: 'GET' })
  return data
}

export async function fetchAdminSystemStatus() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/system`)], { method: 'GET' })
  return data
}

export async function fetchAdminContacts() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/contacts`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchAdminAccounts() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/accounts`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchAdminModeration() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/moderation`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchAdminHealth() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/health`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchAdminAudit() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/audit`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchAdminOperations() {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates([...urls.map(u => `${u}/operations`)], { method: 'GET' })
  return data ?? {}
}

/**
 * Toggle an advertiser's serving gate (can_run_campaigns).
 *
 * The actor identity is resolved from the bearer token on the server; the
 * body carries only the subject, the desired value, and a human reason.
 */
export async function updateAdvertiserGate(advertiserId, canRunCampaigns, reason) {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map(u => `${u}/accounts/gate`)],
    {
      method: 'PATCH',
      body: JSON.stringify({
        advertiser_id: advertiserId,
        can_run_campaigns: Boolean(canRunCampaigns),
        reason: String(reason || ''),
      }),
    }
  )
  return data ?? {}
}

export async function updateContactStatus(id, status, adminNotes = '') {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map(u => `${u}/contacts/${id}`)],
    { method: 'PATCH', body: JSON.stringify({ status, admin_notes: adminNotes }) }
  )
  return data?.data ?? data
}

export async function deleteContact(id) {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map(u => `${u}/contacts/${id}`)],
    { method: 'DELETE' }
  )
  return data?.data ?? data
}

/**
 * Admin deletes an advertiser account. The route is
 * DELETE /admin/accounts/advertiser/:profileId, which the edge function
 * resolves through the service role and then drops the auth user, so the
 * row-level security on every downstream table can never see it.
 */
export async function deleteAdvertiserAccount(profileId) {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map(u => `${u}/accounts/advertiser/${profileId}`)],
    { method: 'DELETE' }
  )
  return data?.data ?? data
}

/**
 * Admin deletes a developer account. Same shape as the advertiser delete:
 * the function owns the cascade, so the caller never reaches a table
 * directly.
 */
export async function deleteDeveloperAccount(profileId) {
  const urls = adminBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map(u => `${u}/accounts/developer/${profileId}`)],
    { method: 'DELETE' }
  )
  return data?.data ?? data
}
