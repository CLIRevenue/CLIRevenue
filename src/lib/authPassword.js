import { supabase } from './api.js'
import { buildProfilePayloads } from './authFields.js'

const PENDING_KEY = 'clir_pending_profile'

export function sendPasswordReset(email) {
  // Recovery links land on the same app callback as signup confirmations:
  // the session is established there and the user is routed into the app
  // (account page first, where the password change lives) instead of a
  // dead-end tab.
  return supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: `${window.location.origin}/auth/callback`,
  })
}

/**
 * Signup sometimes completes without a session (email confirmation on).
 * The role and profile fields still need to reach the database, but the
 * user is anonymous at that point — no RLS write is possible. The values
 * are parked in localStorage under a fixed key and flushed on the first
 * authenticated refresh.
 *
 * This is the ONLY thing localStorage is used for in auth, it holds only
 * what the user typed into the signup form, and role/authorization never
 * reads from it — the row's role remains the server-side source of truth.
 */
export function parkPendingProfile({ role, values, email }) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ role, values, email: String(email || '') }))
  } catch {
    // storage unavailable: signup itself still proceeds
  }
}

function readPendingProfile() {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !['advertiser', 'developer'].includes(parsed.role)) return null
    return parsed
  } catch {
    return null
  }
}

function clearPendingProfile() {
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    /* noop */
  }
}

/**
 * Flush any parked signup profile for the signed-in user. Called by
 * AuthProvider after a session exists. Idempotent: the storage key is
 * cleared before writing, and every write is ON CONFLICT DO UPDATE.
 *
 * Email-scoped: a parked entry is only ever flushed for the account whose
 * email was used at signup — never into another user's profile. Failures
 * are collected, never thrown — a partial write is surfaced, not fatal.
 */
export async function flushPendingProfile(userId, email) {
  const pending = readPendingProfile()
  if (!pending) return { flushed: false }
  clearPendingProfile()

  // A parked entry belonging to a different account is discarded, not
  // flushed: the only way it exists is a signup that never completed.
  if (email && pending.email && pending.email.toLowerCase() !== String(email).toLowerCase()) {
    return { flushed: false }
  }

  const payloads = buildProfilePayloads(pending.values || {}, pending.role)
  const errors = []

  const { error: profileError } = await supabase
    .from('profiles')
    .update(payloads.profiles)
    .eq('id', userId)
  if (profileError) errors.push(`profiles: ${profileError.message}`)

  if (pending.role === 'advertiser') {
    // Upsert touches only the columns present in the payload, so columns the
    // trigger/RPC already wrote (contact_email) are never clobbered.
    const { error } = await supabase
      .from('advertisers')
      .upsert({ profile_id: userId, ...payloads.advertisers }, { onConflict: 'profile_id' })
    if (error) errors.push(`advertisers: ${error.message}`)
  } else {
    const { error } = await supabase
      .from('developer_accounts')
      .upsert({ profile_id: userId, ...payloads.developer_accounts }, { onConflict: 'profile_id' })
    if (error) errors.push(`developer_accounts: ${error.message}`)
  }

  return errors.length ? { flushed: true, errors } : { flushed: true, errors: [] }
}
