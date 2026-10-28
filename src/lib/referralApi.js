import { supabase } from './api.js'
import { DEFAULT_INTERNAL_BACKEND } from './backendBase.js'

/**
 * Referral service layer.
 *
 * Every call sends the current session's bearer token. The referral Edge
 * Function resolves the caller's own profile from the JWT, so the browser
 * never sends a profile id it could lie about. Admin-only routes (qualify,
 * reverse, config writes) are rejected server-side unless the caller's role
 * is admin.
 */

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function referralBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/referral')
    out.push(`${DEFAULT_INTERNAL_BACKEND}/referral`)
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/referral`)
    out.push(`${raw}/api/referral`)
    return out
  }
  if (raw.endsWith('/referral')) {
    out.push(`${raw}/api/referral`)
    return out
  }
  out.push(`${raw}/api/referral`)
  out.push(`${raw}/referral`)
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
      if (e.status != null && e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function fetchReferralCode() {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates([...urls.map((u) => `${u}/code`)], { method: 'GET' })
  return data ?? {}
}

export async function resolveReferralToken(token) {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/resolve?token=${encodeURIComponent(token)}`)],
    { method: 'GET' },
  )
  return data ?? {}
}

export async function attributeReferral(token) {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/attribute`)],
    { method: 'POST', body: JSON.stringify({ token }) },
  )
  return data ?? {}
}

export async function fetchReferralDashboard() {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates([...urls.map((u) => `${u}/dashboard`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchReferralConfig() {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates([...urls.map((u) => `${u}/config`)], { method: 'GET' })
  return data ?? {}
}

/** Admin-only: qualify a referral from a confirmed wallet top-up. */
export async function qualifyReferral(topupId) {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/qualify`)],
    { method: 'POST', body: JSON.stringify({ topup_id: topupId }) },
  )
  return data ?? {}
}

/** Admin-only: reverse a rewarded referral. */
export async function reverseReferral(referralId, reason) {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/reverse`)],
    { method: 'POST', body: JSON.stringify({ referral_id: referralId, reason }) },
  )
  return data ?? {}
}

/** Admin-only: update referral config. */
export async function updateReferralConfig(key, value) {
  const urls = referralBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/config`)],
    { method: 'POST', body: JSON.stringify({ key, value }) },
  )
  return data ?? {}
}

/** Admin-only: list referrals with optional filters. */
export async function fetchReferralAdminList({ status, referrerId, referredId, limit = 50 } = {}) {
  const urls = referralBaseCandidates()
  const params = new URLSearchParams({ limit: String(limit) })
  if (status) params.set('status', status)
  if (referrerId) params.set('referrer_id', referrerId)
  if (referredId) params.set('referred_id', referredId)
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/admin?${params.toString()}`)],
    { method: 'GET' },
  )
  return data ?? {}
}

export const REFERRAL_MINOR_THRESHOLD = 100000 // ₹1,000 eligible funding
