import { useAuth, authNavState } from './auth/authState.js'
import { navigateApp } from '../hooks/useAppRoute.js'
import { ArrowUpRight } from 'lucide-react'

/**
 * Site-wide public header. Auth controls live top-right and stay fixed
 * while scrolling. The dashboard destination comes only from shared auth
 * state (public.profiles.role) — never localStorage, never URL params.
 * The glass material keeps it translucent so the cinematic layer reads
 * through; it never becomes an opaque slab over the film.
 *
 * Visibility is NOT decided here: authNavState() is the one place that maps
 * auth state to Login/Signup/Dashboard/Logout. In particular this header
 * never hides Login just because the current route is /login — a logged-out
 * visitor always has both ways in, on every route.
 *
 * Developer / Advertiser are plain anchors that wear the SAME btn btn--ghost
 * btn--sm classes as Log in, deliberately: one control language for the whole
 * nav, so rest, hover, press and keyboard focus cannot drift apart. They used
 * to wear a separate sitehead__nav-link plate, which drew a second, larger
 * grey-bordered box beside Log in and only ever received the global focus
 * outline. That class now survives solely on the non-interactive path chip in
 * the page mastheads, where an inert chip is the correct look.
 */
export default function PublicHeader() {
  const { loading, isAuthenticated, role, user, signOut } = useAuth()
  const nav = authNavState({ loading, isAuthenticated, role })

  async function onLogout() {
    try {
      await signOut('/')
    } catch {
      // signOut has already cleared local auth state and returned to the
      // logged-out navigation; a failed network call cannot undo that.
    }
  }

  return (
    <header className="sitehead glass" aria-label="Site">
      <button type="button" className="sitehead__brand" onClick={() => navigateApp('/')} aria-label="CLIRevenue home">
        <span className="sitehead__mark" aria-hidden="true">▸</span>
        CLI<em>Revenue</em>
      </button>
      <nav className="sitehead__nav" aria-label="Account">
        <a className="btn btn--ghost btn--sm" href="/developer">Developer</a>
        <a className="btn btn--ghost btn--sm" href="/advertiser">Advertiser</a>
        {nav.showDashboard ? (
          <>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => navigateApp(nav.dashboardHref)}
            >
              <ArrowUpRight className="sitehead__icon" aria-hidden="true" />
              Dashboard
            </button>
            <button
              type="button"
              className="sitehead__user"
              onClick={() => navigateApp(nav.accountHref)}
              title={user?.email || 'Account'}
            >
              <span className="sitehead__user-name">{user?.email || 'Signed in'}</span>
              <span className="sitehead__user-role">{role || 'member'}</span>
            </button>
          </>
        ) : null}
        {nav.showLogout ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={onLogout}
          >
            Log out
          </button>
        ) : null}
        {nav.showLogin ? (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => navigateApp('/login')}>
            Log in
          </button>
        ) : null}
        {nav.showSignup ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={() => navigateApp('/signup')}>
            Sign up
          </button>
        ) : null}
      </nav>
    </header>
  )
}
