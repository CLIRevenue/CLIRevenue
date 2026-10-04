import { supabase } from './api.js'
import { PUBLISHABLE_KEY_PATTERN } from './clirevenue.js'

/**
 * Publisher provisioning service layer.
 *
 * The browser never holds a service-role key: the provision_publisher Edge
 * Function derives the owner from the caller's own JWT, so there is no
 * request field that could provision a publisher for somebody else.
 *
 * A publishable key is a capability, not an identifier, and only its sha256
 * is stored server-side. The raw value therefore exists in exactly one
 * response — the one that minted it — and is unrecoverable afterwards. The
 * dashboard must treat `publishableKey` as read-once, and this module is the
 * only place allowed to put one into application state.
 */

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

function provisioningBaseCandidates() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  const out = []
  if (!raw) {
    out.push('/api/provision_publisher')
    return out
  }
  if (raw.endsWith('/functions/v1')) {
    out.push(`${raw}/provision_publisher`)
    out.push(`${raw}/api/provision_publisher`)
    return out
  }
  if (raw.endsWith('/provision_publisher')) {
    out.push(raw)
    return out
  }
  out.push(`${raw}/api/provision_publisher`)
  out.push(`${raw}/provision_publisher`)
  return out
}

async function authedPost(url) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) {
    const err = new Error('Not signed in.')
    err.status = 401
    throw err
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
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
      'Provisioning failed.'
    const err = new Error(typeof msg === 'string' ? msg : 'Provisioning failed.')
    err.status = res.status
    err.payload = json
    throw err
  }
  return json
}

/**
 * Normalise the provision_publisher response into the shape the dashboard
 * renders. A `publishableKey` survives normalisation only when it is a
 * syntactically valid publishable key; anything else is dropped rather than
 * displayed, because this page's promise is that it shows a key it received,
 * not a string it was handed.
 */
export function normalizeProvisioning(payload) {
  const publisher = payload?.publisher || {}
  const key = payload?.key || {}
  const raw =
    typeof key.publishableKey === 'string' && PUBLISHABLE_KEY_PATTERN.test(key.publishableKey)
      ? key.publishableKey
      : null
  return {
    publisher: {
      id: publisher.id || null,
      name: publisher.name || 'Untitled publisher',
      created: publisher.created === true,
    },
    key: {
      env: key.env === 'live' ? 'live' : 'test',
      label: key.label || null,
      // A 12-character fragment kept for display. It is not an authenticator.
      prefix: key.prefix || null,
      createdAt: key.createdAt || null,
      created: key.created === true,
      publishableKey: raw,
    },
  }
}

/**
 * Ask the Edge Function for this developer's publisher and test key.
 *
 * Idempotent by construction: re-running returns the same publisher and the
 * same key metadata, and mints a key only when none exists. It never rotates.
 */
export async function provisionPublisher() {
  let lastErr = null
  for (const url of provisioningBaseCandidates()) {
    try {
      return normalizeProvisioning(await authedPost(url))
    } catch (e) {
      lastErr = e
      // Only fall through on routing mismatches; surface auth/validation errors.
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr
}