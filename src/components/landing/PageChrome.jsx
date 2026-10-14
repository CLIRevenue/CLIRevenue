import { useEffect, useRef } from 'react'
import { navigateApp } from '../../hooks/useAppRoute.js'
import { useAuth, authNavState } from '../auth/authState.js'
import { LogoutButton } from '../auth/LogoutButton.jsx'
import './chrome.css'

/* onClick for an in-app anchor: keep the href, intercept the navigation so
   the app router handles it instead of the document reloading. Same guard
   set as spaNav, minus the "/app/" carve-out — this header only ever points
   at public routes. */
function spa(event) {
  if (event.defaultPrevented) return
  if (event.button !== 0) return
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  const href = event.currentTarget.getAttribute('href')
  if (!href || !href.startsWith('/')) return
  event.preventDefault()
  navigateApp(href)
}

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/developer', label: 'Developers' },
  { href: '/advertiser', label: 'Advertisers' },
]

/**
 * The one header every surface outside the landing page wears, so
 * /developer, /advertiser, /login and /signup cannot drift apart from
 * each other or from the front page.
 *
 * `active` is the route this page IS, used only for aria-current — it
 * never hides a link, because a nav that hides pages is a nav you
 * cannot navigate with.
 */
export default function PageChrome({ active, subnav, children, footer }) {
  /* Visibility is NOT decided here. authNavState() is the one place that maps
     auth to navigation, so this header shows exactly what the dashboards show
     and cannot drift from them: no auth control while the session resolves,
     Sign in AND Sign up to a logged-out visitor on every route, and the
     dashboard entry plus Logout once there is a session. */
  const { loading, isAuthenticated, role } = useAuth()
  const nav = authNavState({ loading, isAuthenticated, role })
  const ref = useRef(null)

  useEffect(() => {
    const onScroll = () => {
      const el = ref.current
      if (!el) return
      el.classList.toggle('stuck', window.scrollY > 8)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="clr-surface">
      <header className="clrhead" ref={ref}>
        <div className="clrhead-in">
          <a href="/" className="brand-text" onClick={spa} aria-label="CLIRevenue — home">
            <span className="brand-cli">CLI</span>
            <span className="brand-revenue">Revenue</span>
          </a>

          <nav className="clrhead-links" aria-label="Main">
            {LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={spa}
                aria-current={active === l.href ? 'page' : undefined}
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="clrhead-cta">
            {nav.showLogin ? (
              <a className="btn is-ghost clrhead-sm" href="/login" onClick={spa}>
                Sign in
              </a>
            ) : null}
            {nav.showSignup ? (
              <a className="btn clrhead-sm" href="/signup" onClick={spa}>
                Sign up
              </a>
            ) : null}
            {nav.showDashboard ? (
              <a className="btn clrhead-sm" href={nav.dashboardHref} onClick={spa}>
                Dashboard
              </a>
            ) : null}
            {nav.showLogout ? (
              <LogoutButton className="btn is-ghost clrhead-sm" />
            ) : null}
          </div>
        </div>
      </header>

      {subnav ? (
        <nav className="clr-subnav" aria-label="Sections">
          {subnav}
        </nav>
      ) : null}

      {children}

      {footer || null}
    </div>
  )
}

export { spa }