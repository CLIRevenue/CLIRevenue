import { createContext, useCallback, useEffect, useMemo, useState } from 'react'
import { signIn as apiSignIn, signOut as apiSignOut, signUp as apiSignUp, supabase } from '../../lib/api.js'

/*
  Shared application authentication — extends the existing src/lib/api.js
  Supabase client; never creates a second client.

  Source of truth:
    - session  → supabase.auth (authenticated user)
    - role     → public.profiles.role fetched from the database with the
                 user's own JWT (RLS: profiles SELECT own). Never localStorage,
                 never client-provided.

  NOTE: this module is NOT wired into the app (src/App.jsx uses
  src/components/auth/AuthProvider.jsx). Kept only to satisfy lint on
  unused files; its useAuth export was removed because react-refresh
  forbids non-component exports from component files and nothing imports it.
*/

const AuthContext = createContext(null)

const hasPostgrest = typeof supabase?.from === 'function'

async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, created_at, updated_at')
    .eq('id', userId)
    .single()
  if (error) return { profile: null, error }
  return { profile: data, error: null }
}

export function AuthProvider({ children }) {
  const configured = hasPostgrest
  // Not-configured state is derived at initialization instead of being
  // pushed from an effect (setState-in-effect is disallowed).
  const [status, setStatus] = useState(configured ? 'boot' : 'ready') // boot | ready
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [authError, setAuthError] = useState(
    configured
      ? null
      : 'Supabase is not configured (missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY).',
  )

  const applySession = useCallback(async (next) => {
    setSession(next)
    setAuthError(null)
    if (!next) {
      setProfile(null)
      setProfileError(null)
      setStatus('ready')
      return
    }
    try {
      const { profile: row, error } = await fetchProfile(next.user.id)
      setProfile(row)
      setProfileError(error ? error.message || 'Profile could not be loaded' : null)
    } catch (err) {
      setProfile(null)
      setProfileError(err?.message || 'Profile could not be loaded')
    } finally {
      setStatus('ready')
    }
  }, [])

  useEffect(() => {
    if (!configured) {
      // api.js stub: no credentials → public site only, honest not-configured
      // state. Already set via lazy useState initializers above.
      return undefined
    }

    let cancelled = false

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) return applySession(data?.session ?? null)
        return undefined
      })
      .catch((err) => {
        if (cancelled) return
        setAuthError(err?.message || 'Session check failed')
        setStatus('ready')
      })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!cancelled) applySession(next ?? null)
    })

    return () => {
      cancelled = true
      sub?.subscription?.unsubscribe?.()
    }
  }, [applySession, configured])

  const signIn = useCallback(async (email, password) => {
    setAuthError(null)
    const { data, error } = await apiSignIn(email, password)
    if (error) throw error
    await applySession(data?.session ?? null)
    return data
  }, [applySession])

  const signUp = useCallback(async (email, password) => {
    setAuthError(null)
    const { data, error } = await apiSignUp(email, password)
    if (error) throw error
    return data
  }, [])

  const signOut = useCallback(async () => {
    await apiSignOut()
    await applySession(null)
  }, [applySession])

  const value = useMemo(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      profile,
      role: profile?.role ?? null,
      profileError,
      authError,
      configured,
      loading: status === 'boot',
      signIn,
      signUp,
      signOut,
      refreshProfile: async () => {
        if (session?.user) await applySession(session)
      },
    }),
    [status, session, profile, profileError, authError, configured, signIn, signUp, signOut, applySession],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
