import { useState, useCallback } from 'react'
import { useAuth, roleHome } from '../auth/authState.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import AdminOverview from './AdminOverview.jsx'
import AdminCampaigns from './AdminCampaigns.jsx'
import AdminAdvertisers from './AdminAdvertisers.jsx'
import AdminDevelopers from './AdminDevelopers.jsx'
import AdminPublishers from './AdminPublishers.jsx'
import AdminPlacements from './AdminPlacements.jsx'
import AdminEvents from './AdminEvents.jsx'
import AdminSystem from './AdminSystem.jsx'
import './AdminConsole.css'

const PAGES = {
  overview:   { label: 'Overview',   icon: AdminOverviewIcon },
  campaigns:  { label: 'Campaigns',  icon: AdminCampaignsIcon },
  advertisers:{ label: 'Advertisers',icon: AdminAdvertisersIcon },
  developers: { label: 'Developers', icon: AdminDevelopersIcon },
  publishers: { label: 'Publishers', icon: AdminPublishersIcon },
  placements: { label: 'Placements', icon: AdminPlacementsIcon },
  events:     { label: 'Events',     icon: AdminEventsIcon },
  system:     { label: 'System',     icon: AdminSystemIcon },
}

function IconSvg({ d, size = 14 }) {
  return (
    <svg
      className="adm-nav__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}
function AdminOverviewIcon()  { return <IconSvg d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> }
function AdminCampaignsIcon() { return <IconSvg d="M12 20V10M6 20V4M18 20v-6" /> }
function AdminAdvertisersIcon() { return <IconSvg d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /> }
function AdminDevelopersIcon(){ return <IconSvg d="M16 18l6-6-6-6M8 6l-6 6 6 6" /> }
function AdminPublishersIcon(){ return <IconSvg d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /> }
function AdminPlacementsIcon() { return <IconSvg d="M4 4h16v16H4zM4 12h16M12 4v16" /> }
function AdminEventsIcon()     { return <IconSvg d="M22 12h-4l-3 9L9 3l-3 9H2" /> }
function AdminSystemIcon()     { return <IconSvg d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /> }

export default function AdminConsole() {
  const { user, role, session, signOut, loading } = useAuth()
  const [page, setPage] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const handleSignOut = useCallback(() => {
    signOut('/login')
  }, [signOut])

  const handleNav = useCallback((key) => {
    setPage(key)
    setSidebarOpen(false)
  }, [])

  if (loading) {
    return (
      <div className="adm-root">
        <div className="adm-loading">
          <div className="adm-spinner" />
          Verifying admin session…
        </div>
      </div>
    )
  }

  if (role !== 'admin' || !session) {
    return (
      <div className="adm-root">
        <div className="adm-loading">Redirecting…</div>
      </div>
    )
  }
  const PageComponent = PAGES[page] ? {
    overview: AdminOverview,
    campaigns: AdminCampaigns,
    advertisers: AdminAdvertisers,
    developers: AdminDevelopers,
    publishers: AdminPublishers,
    placements: AdminPlacements,
    events: AdminEvents,
    system: AdminSystem,
  }[page] : AdminOverview

  return (
    <div className="adm-root">
      {/* Top command bar */}
      <header className="adm-topbar">
        <button
          type="button"
          className="adm-mobile-toggle"
          onClick={() => setSidebarOpen(o => !o)}
          aria-label="Toggle navigation"
          aria-expanded={sidebarOpen}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            {sidebarOpen ? (
              <path d="M18 6L6 18M6 6l12 12" />
            ) : (
              <path d="M3 12h18M3 6h18M3 18h18" />
            )}
          </svg>
        </button>
        <span className="adm-topbar__brand">CLIRevenue</span>
        <span className="adm-topbar__sep" />
        <span className="adm-topbar__title">Admin Console</span>
        <span className="adm-topbar__sep" />
        <span className="adm-topbar__meta">Operations / Production</span>
        <span className="adm-topbar__spacer" />
        <div className="adm-topbar__identity">
          <span className="adm-topbar__email" title={user?.email || ''}>
            {user?.email || 'unknown'}
          </span>
          <span className="adm-topbar__badge">Admin</span>
        </div>
        <button
          type="button"
          className="adm-topbar__logout"
          onClick={handleSignOut}
          title="Sign out"
        >
          Sign out
        </button>
      </header>

      {/* Body */}
      <div className="adm-body">
        <nav
          className={`adm-sidebar${sidebarOpen ? ' adm-sidebar--open' : ''}`}
          aria-label="Admin navigation"
          aria-hidden={!sidebarOpen}
        >
          <div className="adm-sidebar__section">Platform</div>
          <ul className="adm-nav">
            {Object.entries(PAGES).map(([key, { label, icon: Icon }]) => (
              <li className="adm-nav__item" key={key}>
                <button
                  type="button"
                  className={`adm-nav__btn${page === key ? ' adm-nav__btn--active' : ''}`}
                  onClick={() => handleNav(key)}
                  aria-current={page === key ? 'page' : undefined}
                >
                  <Icon />
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="adm-sidebar__section" style={{ marginTop: 16 }}>Operations</div>
          <ul className="adm-nav">
            <li className="adm-nav__item">
              <button type="button" className="adm-nav__btn" onClick={() => {}}>
                <svg className="adm-nav__icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                Settings
              </button>
            </li>
          </ul>
        </nav>

        <main className="adm-main" key={page}>
          <div className="adm-main__inner">
            <PageComponent />
          </div>
        </main>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="adm-overlay"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}
    </div>
  )
}
