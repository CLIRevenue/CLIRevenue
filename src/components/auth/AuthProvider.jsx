import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/api.js'
import { fetchAuthStatus } from '../../lib/advertiserApi.js'
import { AuthContext, roleHome } from './authState.js'

function userIdFromSession(session) {
  return session?.user?.id || null
}

async function resolveProfile(userId) {
  if (!userId) return { profile: null, advertiser: null, developerAccount: null }

  // 1) Prefer the existing secure Edge Function (service-role side, no secret in browser).
  try {
    const status = await fetchAuthStatus()
    if (status?.user && status.user.id === userId) {
      // status only contains role; still need account rows via RLS-safe direct reads below.
      const role = status.user.role || null
      if (role) {
        const extra = await readAccountRows(userId)
        return { profile: { id: userId, role }, ...extra }
      }
    }
  } catch {
    // fall through to direct RLS reads
  }

  // 2) Direct RLS-safe read: users can SELECT their own profile row.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  if (!profile) return { profile: null, advertiser: null, developerAccount: null }
  const extra = await readAccountRows(userId)
  return { profile, ...extra }
}

async function readAccountRows(userId) {
  let advertiser = null
  let developerAccount = null
  try {
    const { data, error } = await supabase
      .from('advertisers')
      .select('id, company_name, contact_email')
      .eq('profile_id', userId)
      .maybeSingle()
    if (!error) advertiser = data
  } catch {
    advertiser = null
  }
  try {
    const { data, error } = await supabase
      .from('developer_accounts')
      .select('id, payout_preferences')
      .eq('profile_id', userId)
      .maybeSingle()
    if (!error) developerAccount = data
  } catch {
    developerAccount = null
  }
  return { advertiser, developerAccount }
}

export function AuthProvider({ children }) {
  const [state, setState] = useState({
    loading: true,
    session: null,
    user: null,
    profile: null,
    role: null,
    advertiser: null,
    developerAccount: null,
    error: '',
  })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) throw sessionError
      if (!session) {
        setState({
          loading: false,
          session: null,
          user: null,
          profile: null,
          role: null,
          advertiser: null,
          developerAccount: null,
          error: '',
        })
        return
      }
      const { data: { user } } = await supabase.auth.getUser()
      const resolved = await resolveProfile(user?.id || userIdFromSession(session))
      setState({
        loading: false,
        session,
        user: user || session.user || null,
        profile: resolved.profile,
        role: resolved.profile?.role || null,
        advertiser: resolved.advertiser,
        developerAccount: resolved.developerAccount,
        error: '',
      })
    } catch (e) {
      // Keep any existing session so refresh does not flash the public site,
      // but surface the resolver error for onboarding/missing-role states.
      setState((s) => ({
        ...s,
        loading: false,
        error: e.message || 'Could not load profile.',
      }))
    }
  }, [])

  useEffect(() => {
    let alive = true
    async function initial() {
      await refresh()
      if (!alive) return
    }
    initial()
    const { data } = supabase.auth.onAuthStateChange(() => {
      refresh()
    })
    return () => {
      alive = false
      data.subscription?.unsubscribe?.()
    }
  }, [refresh])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const signUp = useCallback(async ({ email, password, role }) => {
    if (!['advertiser', 'developer'].includes(role)) {
      throw new Error('Pick Advertiser or Developer.')
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { role } },
    })
    if (error) throw error
    const newUserId = data.user?.id || data.session?.user?.id || null
    // Create the profile row through RLS-safe paths only (never service-role in browser):
    // 1) DB trigger (handle_new_user) usually already created it.
    // 2) else secure RPC ensure_own_profile (SECURITY DEFINER, fixed role whitelist).
    if (newUserId) {
      try {
        await supabase.rpc('ensure_own_profile', { requested_role: role })
      } catch {
        // Best-effort: trigger may have already handled it; role resolution will surface status.
      }
      // Ensure role-side account row exists for advertiser UX (RLS insert allowed for own row).
      try {
        if (role === 'advertiser') {
          await supabase.from('advertisers').insert({
            profile_id: newUserId,
            contact_email: email,
          })
        } else if (role === 'developer') {
          await supabase.from('developer_accounts').insert({
            profile_id: newUserId,
            payout_preferences: { preferred_provider: 'demo-ledger' },
          })
        }
      } catch {
        // Row may already exist via trigger/RPC; ignore unique conflicts here.
      }
    }
    await refresh()
    return data
  }, [refresh])

  const signOut = useCallback(async (next = '/') => {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
    const { navigateApp: go } = await import('../../hooks/useAppRoute.js')
    setState({
      loading: false,
      session: null,
      user: null,
      profile: null,
      role: null,
      advertiser: null,
      developerAccount: null,
      error: '',
    })
    go(next)
  }, [])

  const value = useMemo(() => ({
    ...state,
    isAuthenticated: Boolean(state.session),
    homeForRole: roleHome(state.role),
    refresh,
    signIn,
    signUp,
    signOut,
  }), [state, refresh, signIn, signUp, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
