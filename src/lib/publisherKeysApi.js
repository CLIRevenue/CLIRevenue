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
 *
 * The wire shape is `{ key: { ...metadata, publishableKey } }`, and this
 * function returns the INNER object, not the envelope -- so the resolved
 * value is already the row:
 *
 *   { id, key_prefix, key_env, label, created_at, last_used_at, revoked_at,
 *     publishableKey }
 *
 * `publishableKey` is the only time the raw key ever exists outside the
 * server, so read it off this value directly (`created.publishableKey`).
 * Destructuring it as `{ key, rawKey }` yields two `undefined`s -- which is
 * how a successfully minted key used to be displayed as a mask and copied as
 * the string "undefined".
 *
 * Rejects with `err.status === 409` and `err.payload.code === 'KEY_EXISTS'`
 * when this publisher already holds an unrevoked key for its environment
 * (`publisher_keys_active_env_key` allows one per publisher_id + key_env, and
 * key_env is always "test"). `err.payload.existing` carries that row.
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
