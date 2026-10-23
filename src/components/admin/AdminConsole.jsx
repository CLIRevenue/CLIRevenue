import { useState, useCallback } from 'react'
import { useAuth } from '../auth/authState.js'
import AdminOverview from './AdminOverview.jsx'
import AdminCampaigns from './AdminCampaigns.jsx'
import AdminAdvertisers from './AdminAdvertisers.jsx'
import AdminDevelopers from './AdminDevelopers.jsx'
import AdminPlacements from './AdminPlacements.jsx'
import AdminEvents from './AdminEvents.jsx'
import AdminSystem from './AdminSystem.jsx'
import AdminContacts from './AdminContacts.jsx'
import AdminQueries from './AdminQueries.jsx'
import AdminAccount from './AdminAccount.jsx'
import AdminOperations from './AdminOperations.jsx'
import AdminAccounts from './AdminAccounts.jsx'
import AdminModeration from './AdminModeration.jsx'
import AdminHealth from './AdminHealth.jsx'
import AdminWalletManagement from './AdminWalletManagement.jsx'
import AdminLifetimeViews from './AdminLifetimeViews.jsx'
import './AdminConsole.css'

const PAGES = {
  overview:      { label: 'Overview',      icon: AdminOverviewIcon },
  campaigns:     { label: 'Campaigns',     icon: AdminCampaignsIcon },
  moderation:    { label: 'Moderation',    icon: AdminModerationIcon },
  advertisers:   { label: 'Advertisers',   icon: AdminAdvertisersIcon },
  developers:    { label: 'Developers',    icon: AdminDevelopersIcon },
  placements:    { label: 'Placements',    icon: AdminPlacementsIcon },
  events:        { label: 'Events',        icon: AdminEventsIcon },
  system:        { label: 'System',        icon: AdminSystemIcon },
  health:        { label: 'Health & Audit', icon: AdminHealthIcon },
  lifetimeViews: { label: 'Lifetime views', icon: AdminLifetimeViewsIcon },
  accounts:      { label: 'Accounts',      icon: AdminAccountsIcon },
  contacts:      { label: 'Contacts',      icon: AdminContactsIcon },
  queries:       { label: 'Advertiser queries', icon: AdminQueriesIcon },
  wallet:        { label: 'Wallet management', icon: AdminWalletIcon },
}

// "Account" is the one admin entry that is not a platform read surface, so it
// lives under its own Operations heading rather than in the Platform nav.
// It is a real page, not a placeholder: it renders the shared AccountPage —
// the same one the advertiser and developer dashboards reach, which is why all
// three sidebars label it "Account" and not "Settings".
const OPERATIONS_PAGES = {
  operations: { label: 'Operations', icon: AdminOperationsIcon },
  account: { label: 'Account', icon: AdminAccountIcon },
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
function AdminPlacementsIcon() { return <IconSvg d="M4 4h16v16H4zM4 12h16M12 4v16" /> }
function AdminEventsIcon()     { return <IconSvg d="M22 12h-4l-3 9L9 3l-3 9H2" /> }
function AdminSystemIcon()     { return <IconSvg d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" /> }

function AdminContactsIcon()   { return <IconSvg d="M4 4h16l-4 12H8z" /> }
function AdminQueriesIcon()    { return <IconSvg d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /> }
function AdminWalletIcon()     { return <IconSvg d="M3 3v18h18M7 15l4-5 3 3 5-7M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> }
function AdminModerationIcon() { return <IconSvg d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /> }
function AdminHealthIcon()     { return <IconSvg d="M2 12h4l3-8 4 16 3-8h6" /> }
function AdminLifetimeViewsIcon() { return <IconSvg d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 12c-2.5 0-4.5-2-4.5-4.5S9.5 3 12 3s4.5 2 4.5 4.5S14.5 12 12 12z" /> }
function AdminOperationsIcon()  { return <IconSvg d="M3 3v18h18M7 15l4-5 3 3 5-7" /> }
function AdminAccountsIcon()   { return <IconSvg d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 11h-6" /> }
// Sliders, not the sun/gear glyph AdminSystemIcon uses: two identical icons
// side by side in one sidebar reads as a rendering bug.
function AdminAccountIcon()   { return <IconSvg d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /> }

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
  const PAGE_COMPONENTS = {
    overview: AdminOverview,
    campaigns: AdminCampaigns,
    advertisers: AdminAdvertisers,
    developers: AdminDevelopers,
    placements: AdminPlacements,
    events: AdminEvents,
    system: AdminSystem,
    health: AdminHealth,
    accounts: AdminAccounts,
    moderation: AdminModeration,
    operations: AdminOperations,
    contacts: AdminContacts,
    queries: AdminQueries,
    wallet: AdminWalletManagement,
    account: AdminAccount,
    lifetimeViews: AdminLifetimeViews,
  }
  const PageComponent = PAGE_COMPONENTS[page] || AdminOverview

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
          <div className="adm-sidebar__section">Operations</div>
          <ul className="adm-nav">
            {Object.entries(OPERATIONS_PAGES).map(([key, { label, icon: Icon }]) => (
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
