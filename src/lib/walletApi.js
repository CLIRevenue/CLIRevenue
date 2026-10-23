import { supabase } from './api.js'
import { DEFAULT_INTERNAL_BACKEND } from './backendBase.js'

/**
 * Credit wallet service layer.
 *
 * Every call sends the current session's bearer token. The wallet Edge
 * Function resolves the caller's own profile id from the JWT, so the
 * browser never sends a profile id it could lie about.
 */

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function walletBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/wallet')
    out.push(`${DEFAULT_INTERNAL_BACKEND}/wallet`)
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/wallet`)
    out.push(`${raw}/wallet/api/wallet`)
    out.push(`${raw}/api/wallet`)
    return out
  }
  if (raw.endsWith('/wallet')) {
    out.push(`${raw}/api/wallet`)
    return out
  }
  out.push(`${raw}/api/wallet`)
  out.push(`${raw}/wallet`)
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
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

export async function fetchWalletSnapshot() {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates([...urls.map((u) => `${u}/snapshot`)], { method: 'GET' })
  return data ?? {}
}

export async function fetchWalletLedger({ limit = 50 } = {}) {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/transactions?limit=${limit}`)],
    { method: 'GET' }
  )
  return data ?? { transactions: [], count: 0 }
}

export async function fetchWalletTopups({ limit = 25 } = {}) {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/topups?limit=${limit}`)],
    { method: 'GET' }
  )
  return data ?? { topups: [], count: 0 }
}

export async function fetchWalletNotifications() {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates([...urls.map((u) => `${u}/notifications`)], { method: 'GET' })
  return data ?? { notifications: [], unreadCount: 0 }
}

export async function createWalletTopup(payload) {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/topups`)],
    { method: 'POST', body: JSON.stringify(payload) }
  )
  return data ?? {}
}

export async function markWalletNotificationsRead(ids) {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/notifications`)],
    { method: 'POST', body: JSON.stringify({ ids }) }
  )
  return data ?? { marked: 0 }
}

export async function requestWalletUnfreeze({ freezeId, subject, body, userEmail }) {
  const urls = walletBaseCandidates()
  const { data } = await tryCandidates(
    [...urls.map((u) => `${u}/unfreeze-request`)],
    { method: 'POST', body: JSON.stringify({ freeze_id: freezeId, subject, body, user_email: userEmail }) }
  )
  return data ?? {}
}

export const PAYMENT_METHODS = ['upi', 'card', 'bank_transfer', 'manual', 'promo']
export const TOPUP_CURRENCIES = ['INR', 'USD', 'EUR', 'GBP']
export const MIN_TOPUP_AMOUNT = '1.00'
