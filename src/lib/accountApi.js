import { supabase } from './api.js'
import {
  COMMON_FIELDS,
  ADVERTISER_FIELDS,
  DEVELOPER_FIELDS,
} from './authFields.js'

/**
 * Account service layer. Owner-scoped RLS writes only; no service-role key
 * ever appears in browser code. Money/stats never flow through here.
 */

const PROFILE_FIELDS = COMMON_FIELDS.map((f) => f.name)
const ADVERTISER_COLUMNS = ADVERTISER_FIELDS.map((f) => f.name)
const DEVELOPER_COLUMNS = DEVELOPER_FIELDS.map((f) => f.name)

function cleanStrings(payload) {
  const out = {}
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue
    const s = String(v).trim()
    if (s === '') continue
    out[k] = s
  }
  return out
}

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

/** Fetch everything the account pages render, for the signed-in user only. */
export async function fetchAccountBundle() {
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not signed in.')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role, full_name, phone, address, city, state, country, created_at')
    .eq('id', user.id)
    .maybeSingle()
  if (profileError) throw profileError

  const { data: advertiser, error: advError } = await supabase
    .from('advertisers')
    .select('company_name, company_website, company_description, company_size, industry, hear_about_us')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (advError) throw advError

  const { data: developer, error: devError } = await supabase
    .from('developer_accounts')
    .select('developer_name, developer_type, website, apps_description, app_count, platforms, experience_level, hear_about_us')
    .eq('profile_id', user.id)
    .maybeSingle()
  if (devError) throw devError

  return { user, profile, advertiser, developer }
}

/**
 * Save profile data. Writes ONLY rows the user owns, via owner-scoped RLS
 * UPDATE policies (000004) and the 000007 column grants. Passing null clears
 * a field; omitted keys are left untouched. `role` is never sent — the DB
 * revokes UPDATE on that column outright.
 */
export async function saveAccountProfile({ profilePatch, advertiserPatch, developerPatch }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not signed in.')
  const results = { profile: null, advertiser: null, developer: null }

  if (profilePatch) {
    const { error } = await supabase
      .from('profiles')
      .update(cleanStrings(profilePatch))
      .eq('id', user.id)
    if (error) results.profile = error.message
  }

  if (advertiserPatch) {
    const payload = cleanStrings(advertiserPatch)
    if (Object.keys(payload).length) {
      const { error } = await supabase
        .from('advertisers')
        .update(payload)
        .eq('profile_id', user.id)
      if (error) results.advertiser = error.message
    }
  }

  if (developerPatch) {
    const payload = cleanStrings(developerPatch)
    if ('app_count' in payload && payload.app_count !== undefined) {
      // numeric column: send a number or NULL, never a string
      const n = Number(payload.app_count)
      payload.app_count = Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
    }
    if (Object.keys(payload).length) {
      const { error } = await supabase
        .from('developer_accounts')
        .update(payload)
        .eq('profile_id', user.id)
      if (error) results.developer = error.message
    }
  }

  return results
}

/** Whitelisted column groups, shared with the account page forms. */
export const ACCOUNT_COLUMN_GROUPS = {
  profiles: PROFILE_FIELDS,
  advertisers: ADVERTISER_COLUMNS,
  developer_accounts: DEVELOPER_COLUMNS,
}

/**
 * Authenticated password change. Verifies the current password with
 * signInWithPassword, then writes the new one with updateUser. Passwords
 * are never stored anywhere — both calls go straight to Supabase Auth.
 */
export async function changePassword({ currentPassword, newPassword }) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user?.email) throw new Error('Not signed in.')

  const { error: verifyError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  })
  if (verifyError) {
    const err = new Error('Current password is incorrect.')
    err.code = 'bad_current'
    throw err
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
  if (updateError) throw updateError
}

/**
 * Delete the signed-in user's own account through the delete_account Edge
 * Function. The service-role key lives only inside the function; the
 * browser sends nothing but its own JWT. Local state is cleared by the
 * caller (AuthProvider.signOut) after this resolves.
 */
export async function deleteOwnAccount() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  // Canonical Supabase layout: <project>/functions/v1/delete_account.
  const base = raw.endsWith('/functions/v1') ? raw : raw ? `${raw}/functions/v1` : ''
  const url = base ? `${base}/delete_account` : '/api/delete_account'

  const { data: { session } } = await supabase.auth.getSession()
  const token = session?.access_token
  if (!token) throw new Error('Not signed in.')

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
    throw new Error(json?.error || res.statusText || 'Account deletion failed.')
  }
  return json
}
