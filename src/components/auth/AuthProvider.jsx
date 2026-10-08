import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/api.js'
import { fetchAuthStatus } from '../../lib/advertiserApi.js'
import { classifyAuthEvent, isOnceOnly, planFor, RESOLUTION } from './authEvents.js'
import { flushPendingProfile, parkPendingProfile } from '../../lib/authPassword.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { readCallbackParams } from './authCallback.js'
import { AuthContext, roleHome } from './authState.js'

/** The single, complete "nobody is signed in" state. Every path that ends
 *  a session writes exactly this object, so the navigation can never be
 *  left showing a half-cleared user. */
const ANONYMOUS = {
  loading: false,
  session: null,
  user: null,
  profile: null,
  role: null,
  advertiser: null,
  developerAccount: null,
  error: '',
}

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

  // Monotonic generation. Every refresh captures the current value and
  // bails out before writing if it moved on. signOut bumps it too, so an
  // in-flight refresh that started before logout can never write a stale
  // session back afterwards — that race is what left the header rendering
  // a dashboard + user chip after the user had already logged out.
  const generation = useRef(0)

  // The boot resolution is once per provider, no matter how many times it
  // is asked for: the mount effect starts it and supabase's INITIAL_SESSION
  // event asks for the same one. Without this flag every page load resolved
  // the session twice — getSession, getUser, the server-side role check and
  // up to three table reads — and, because the two overlapped, the first
  // one's answer was discarded by the generation fence. It also makes a
  // StrictMode double-mount resolve once instead of twice.
  const bootStarted = useRef(false)
  // `loading` gates the resolution, not the result: a caller that must not
  // show the role-check animation (a token rotation) resolves silently.
  // Defaults to the historical behaviour for every direct refresh() call.
  const refresh = useCallback(async ({ loading: mayShowLoading = true } = {}) => {
    const mine = ++generation.current
    const stale = () => generation.current !== mine

    // Enter the loading state only when there is a session to revalidate,
    // and only when this reason is allowed to show it. Re-entering it while
    // already anonymous blanks Login/Signup for one network round trip:
    // signOut fires SIGNED_OUT, the listener calls refresh() again, and a
    // logged-out visitor would briefly have no way back in. The initial
    // mount is unaffected — that state already has loading: true.
    setState((s) => {
      if (!s.session) return { ...s, error: '' }
      if (!mayShowLoading) return s
      return { ...s, loading: true, error: '' }
    })
    try {
      const initial = await supabase.auth.getSession()
      if (stale()) return
      if (initial?.error) throw initial.error
      let session = initial?.data?.session || null

      // The SDK exchanges a PKCE ?code= for a session on client init
      // (detectSessionInUrl). That pass is silent and yields nothing when
      // the link is opened in a browser/device that never stored the code
      // verifier. Retry the exchange explicitly, exactly once, before
      // declaring a valid-looking confirmation link dead.
      let exchangeError = ''
      if (!session) {
        const { code } = readCallbackParams(
          typeof window !== 'undefined' ? window.location.href : '',
        )
        if (code && typeof supabase.auth.exchangeCodeForSession === 'function') {
          const exchanged = await supabase.auth.exchangeCodeForSession(code)
          if (stale()) return
          session = exchanged?.data?.session || null
          exchangeError = exchanged?.error?.message || ''
        }
      }

      if (!session) {
        setState({ ...ANONYMOUS, error: exchangeError })
        return
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (stale()) return
      const uid = user?.id || userIdFromSession(session)
      const resolved = await resolveProfile(uid)
      if (stale()) return
      // Signup can park profile fields (email-confirmation flow leaves the
      // user anonymous at signup time). Now that an authenticated RLS write
      // is possible, flush them once; re-read account rows if anything was
      // written so the dashboards see the data immediately.
      const flush = await flushPendingProfile(uid, user?.email)
      const rows = flush.flushed ? await readAccountRows(uid) : resolved
      if (stale()) return
      setState({
        loading: false,
        session,
        user: user || session.user || null,
        profile: resolved.profile,
        role: resolved.profile?.role || null,
        advertiser: rows.advertiser,
        developerAccount: rows.developerAccount,
        error: flush.errors?.length ? `Profile save failed: ${flush.errors.join('; ')}` : '',
      })
    } catch (e) {
      if (stale()) return
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
    // One flag covers all three ways the boot can be asked for: the mount,
    // INITIAL_SESSION, and a StrictMode double-mount that re-runs this
    // effect while keeping the same refs.
    const startBoot = () => {
      if (bootStarted.current) return
      bootStarted.current = true
      void refresh()
    }
    startBoot()
    const { data } = supabase.auth.onAuthStateChange((event) => {
      const reason = classifyAuthEvent(event)
      const plan = planFor(reason)
      // A client-side route change is not an auth event. Treating it as one
      // is what made every nav click re-read the session.
      if (plan === RESOLUTION.NEVER) return
      if (isOnceOnly(reason)) {
        startBoot()
        return
      }
      // TOKEN_ROTATION lands here as SILENT: the same user, new tokens. The
      // resolution still runs — the token changed, so re-validating is
      // correct — but it may not enter the loading state, so the
      // full-screen role-check animation cannot replay on a page that is
      // already working.
      refresh({ loading: plan === RESOLUTION.FULL })
    })
    return () => {
      data.subscription?.unsubscribe?.()
    }
  }, [refresh])

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    await refresh()
    return data
  }, [refresh])

  const signUp = useCallback(async ({ email, password, role, values, privacyConsent, termsConsent }) => {
    if (!['advertiser', 'developer'].includes(role)) {
      throw new Error('Pick Advertiser or Developer.')
    }
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role },
        // The confirmation email must land back inside the app, on the
        // route that resolves the session and routes by profile role.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
    // Park the profile fields only once signup has succeeded: when email
    // confirmation is on there is no session yet, so the flush happens on
    // first authenticated refresh. The park is email-scoped, so it can
    // never be flushed into a different user's profile. A failed signup
    // (e.g. email already registered) leaves nothing parked — the form
    // itself keeps the values on screen.
    parkPendingProfile({ role, values: values || {}, email })
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
      // Record policy consent if provided.
      if (newUserId && (privacyConsent || termsConsent)) {
        try {
          await supabase.from('profiles').update({
            privacy_policy_version: privacyConsent ? '1.0' : undefined,
            terms_version: termsConsent ? '1.0' : undefined,
            privacy_policy_accepted_at: privacyConsent ? new Date().toISOString() : undefined,
            terms_accepted_at: termsConsent ? new Date().toISOString() : undefined,
          }).eq('id', newUserId)
        } catch {
          // Best-effort: if the columns do not exist yet the update is ignored.
        }
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

  /** Re-send the signup confirmation email. Never re-runs signUp —
   *  calling signUp again with the same address is how duplicate-account
   *  confusion starts; Supabase Auth has a dedicated resend API. */
  const resendConfirmation = useCallback(async (email) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) throw error
  }, [])

  /** End the session and return to the logged-out navigation.
   *
   *  The generation is bumped BEFORE the network round trip and the state
   *  is cleared even when signOut reports an error. Account deletion
   *  deletes the auth user server-side first, so a failure here means the
   *  session is already dead — leaving it in place would strand the user
   *  on a dashboard they can no longer use. */
  const signOut = useCallback(async (next = '/') => {
    generation.current += 1
    let failure = null
    try {
      const { error } = await supabase.auth.signOut()
      if (error) failure = error
    } catch (e) {
      failure = e
    }
    setState(ANONYMOUS)
    navigateApp(next)
    if (failure) throw failure
  }, [])

  const value = useMemo(() => ({
    ...state,
    isAuthenticated: Boolean(state.session),
    homeForRole: roleHome(state.role),
    refresh,
    signIn,
    signUp,
    resendConfirmation,
    signOut,
  }), [state, refresh, signIn, signUp, resendConfirmation, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
