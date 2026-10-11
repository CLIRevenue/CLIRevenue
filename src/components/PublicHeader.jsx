import { useAuth, authNavState } from './auth/authState.js'
import { navigateApp, spaNav } from '../hooks/useAppRoute.js'
import { ArrowUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'

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
 *
 * They keep a real href rather than becoming buttons, so middle-click,
 * cmd-click and "copy link address" still do the native thing — but a plain
 * left click is handed to spaNav(). Without that, these two were the only
 * controls in the header that threw away the SPA: they issued a full document
 * request, which rebooted the app, replayed the whole intro film and made the
 * boot cost the visitor a second time for a link that is one click from the
 * current page. (The landing routes carry their own mastheads, so this header is
 * never mounted while you are on /developer or /advertiser — which is why these
 * two need no active state, and why the Log in / Dashboard controls beside them
 * already carry the "where am I" job.)
 */
export default function PublicHeader() {
  const { loading, isAuthenticated, role, user, signOut } = useAuth()
  const nav = authNavState({ loading, isAuthenticated, role })
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme')
    return saved === 'light' ? 'light' : 'dark'
  })

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('light-theme')
    } else {
      document.documentElement.classList.remove('light-theme')
    }
    localStorage.setItem('theme', theme)
  }, [theme])

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
        <svg
          className="sitehead__logo"
          viewBox="0 0 32 32"
          width="32"
          height="32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="26" height="26" rx="0" fill="var(--bg)" strokeWidth="0" />
          <rect x="3" y="3" width="26" height="26" rx="0" stroke="var(--electric-cyan)" strokeWidth="1.5" />
          <path d="M8 8h2v16h-2v-4h1" stroke="var(--electric-cyan)" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 8h2v16h-2v-8h6v2h2v-6h-2v4h-4v-6" stroke="var(--hyper-violet)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <span className="sitehead__name">CLI<em>Revenue</em></span>
      </button>
      <nav className="sitehead__nav" aria-label="Account">
        <a className="btn btn--ghost btn--sm" href="/developer" onClick={spaNav}>Developer</a>
        <a className="btn btn--ghost btn--sm" href="/advertiser" onClick={spaNav}>Advertiser</a>
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
          <button type="button" className="btn btn--signal btn--sm" onClick={() => navigateApp('/signup')}>
            Sign up
          </button>
        ) : null}
        {/* Theme toggle */}
        <button
          type="button"
          className="btn btn--ghost btn--sm theme-toggle"
          onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            {theme === 'light' ? (
              <path d="M8 1V2M8 14V15M2.34 2.34L2.95 2.95M13.05 13.05L13.66 13.66M1 8H2M14 8H15M2.34 13.66L2.95 13.05M13.05 2.95L13.66 2.34" strokeWidth="1.5" stroke="currentColor" />
            ) : (
              <circle cx="8" cy="8" r="3" fill="currentColor" />
            )}
          </svg>
        </button>
      </nav>
    </header>
  )
}