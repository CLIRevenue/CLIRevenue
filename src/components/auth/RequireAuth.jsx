import { useEffect } from 'react'
import { useAuth, roleHome } from './authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { AdvLoading } from '../advertiser/AdvertiserUI.jsx'

export function AuthLoadingScreen({ label = 'Checking session and role…' }) {
  return (
    <section className="adv-shell" aria-label="Authentication loading">
      <div className="adv-shell__inner adv-shell__inner--narrow">
        <AdvLoading label={label} />
      </div>
    </section>
  )
}

/**
 * Shared guard: authentication first, then role from public.profiles.
 * Never reads localStorage role or URL params. Redirects run in effects
 * so guards never navigate during render.
 */
export function RequireAuth({ children }) {
  const { loading, isAuthenticated } = useAuth()
  useEffect(() => {
    if (!loading && !isAuthenticated) navigateApp('/login')
  }, [loading, isAuthenticated])
  if (loading) return <AuthLoadingScreen />
  if (!isAuthenticated) return <AuthLoadingScreen label="Redirecting to login…" />
  return children
}

export function RequireRole({ allow, children }) {
  const auth = useAuth()
  const { loading, isAuthenticated, role } = auth
  const home = roleHome(role)
  const wrongRole = Boolean(role && !allow.includes(role))
  useEffect(() => {
    if (loading) return
    if (!isAuthenticated) navigateApp('/login')
    else if (wrongRole) navigateApp(home || '/')
  }, [loading, isAuthenticated, wrongRole, home])
  if (loading) return <AuthLoadingScreen />
  if (!isAuthenticated) return <AuthLoadingScreen label="Redirecting to login…" />
  if (!role) {
    return (
      <section className="adv-shell" aria-label="Missing role">
        <div className="adv-shell__inner adv-shell__inner--narrow">
          <p className="eyebrow eyebrow--plain">Account · setup needed</p>
          <h2 className="block__title">No role found for this account.</h2>
          <p className="block__body">
            Signed in, but <span className="mono">public.profiles</span> has no row for this user yet.
            If you just signed up, wait a moment and reload. Otherwise contact support.
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => auth.refresh()}>Retry</button>
        </div>
      </section>
    )
  }
  if (wrongRole) return <AuthLoadingScreen label="Wrong dashboard — redirecting…" />
  return children
}
