import { supabase } from './api.js'

/**
 * Publisher key management service layer.
 *
 * These functions are called from the developer dashboard and require the
 * developer's own JWT (not a publisher key). They proxy to Edge Functions
 * that authenticate the developer and then operate on their publisher's keys.
 */

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function publisherKeysBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/publisher_keys')
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/publisher_keys`)
    out.push(`${raw}/api/publisher_keys`)
    return out
  }
  if (raw.endsWith('/publisher_keys')) {
    out.push(raw)
    return out
  }
  out.push(`${raw}/api/publisher_keys`)
  out.push(`${raw}/publisher_keys`)
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
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // non-JSON body: keep null and surface the HTTP status below
  }
  if (!res.ok) {
    const msg =
      (json && (json.error?.message || (typeof json.error === 'string' ? json.error : json.message))) ||
      res.statusText ||
      'Publisher keys request failed.'
    const err = new Error(typeof msg === 'string' ? msg : 'Publisher keys request failed.')
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

/**
 * Get the list of keys for the developer's publisher.
 */
export async function listPublisherKeys() {
  let lastErr = null
  for (const url of publisherKeysBaseCandidates()) {
    try {
      const json = await authedFetch(url)
      // We expect { keys: [...] }
      if (json && json.keys) {
        return json.keys
      }
      throw new Error('Unexpected response format')
    } catch (e) {
      lastErr = e
      // Only fall through on routing mismatches; surface auth/validation errors.
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

/**
 * Create a new publisher key for the developer's publisher.
 * Expects an optional label.
 * Returns { key: { ...metadata, publishableKey: string } }
 */
export async function createPublisherKey(label) {
  let lastErr = null
  for (const url of publisherKeysBaseCandidates()) {
    try {
      const json = await authedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      // We expect { key: { ... } }
      if (json && json.key) {
        return json.key
      }
      throw new Error('Unexpected response format')
    } catch (e) {
      lastErr = e
      // Only fall through on routing mismatches; surface auth/validation errors.
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}

/**
 * Revoke a publisher key for the developer's publisher.
 * Expects { key_id: string } in the body.
 * Returns { success: true }
 */
export async function revokePublisherKey(keyId) {
  let lastErr = null
  for (const url of publisherKeysBaseCandidates()) {
    try {
      const json = await authedFetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keyId }),
      })
      // We expect { success: true }
      if (json && json.success === true) {
        return json
      }
      throw new Error('Unexpected response format')
    } catch (e) {
      lastErr = e
      // Only fall through on routing mismatches; surface auth/validation errors.
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}
