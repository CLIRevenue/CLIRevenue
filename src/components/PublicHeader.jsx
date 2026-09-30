import { useAuth, roleHome } from './auth/authState.js'
import useAppRoute, { navigateApp } from '../hooks/useAppRoute.js'

/**
 * Site-wide public header. Auth controls live top-right and stay fixed
 * while scrolling. The dashboard destination comes only from shared auth
 * state (public.profiles.role) — never localStorage, never URL params.
 * The glass material keeps it translucent so the cinematic layer reads
 * through; it never becomes an opaque slab over the film.
 */
export default function PublicHeader() {
  const { loading, isAuthenticated, role, user } = useAuth()
  const path = useAppRoute()
  const home = roleHome(role)
  // Never repeat the page you are already on: on /login, "Log in" is noise.
  const onLogin = path.startsWith('/login')
  const onSignup = path.startsWith('/signup')

  return (
    <header className="sitehead glass" aria-label="Site">
      <button type="button" className="sitehead__brand" onClick={() => navigateApp('/')}>
        CLI<em>Revenue</em>
      </button>
      <nav className="sitehead__nav" aria-label="Account">
        {loading ? null : isAuthenticated ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigateApp(home || '/app')}
            >
              Open dashboard
            </button>
            <button
              type="button"
              className="sitehead__user"
              onClick={() => navigateApp(home ? `${home}/account` : '/app')}
              title={user?.email || 'Account'}
            >
              <span className="sitehead__user-name">{user?.email || 'Signed in'}</span>
              <span className="sitehead__user-role">{role || 'member'}</span>
            </button>
          </>
        ) : (
          <>
            {onLogin ? null : (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigateApp('/login')}>
                Log in
              </button>
            )}
            {onSignup ? null : (
              <button type="button" className="btn btn--primary btn--sm" onClick={() => navigateApp('/signup')}>
                Sign up
              </button>
            )}
          </>
        )}
      </nav>
    </header>
  )
}
