import { useEffect, useRef, useState } from 'react'
import useAdvertiserCampaigns from '../../hooks/useAdvertiserCampaigns.js'
import useAppRoute, { navigateApp } from '../../hooks/useAppRoute.js'
import { useAuth } from '../auth/authState.js'
import { LogoutButton } from '../auth/LogoutButton.jsx'
import AdvertiserSidebar from './AdvertiserSidebar.jsx'
import AdvertiserOverview from './AdvertiserOverview.jsx'
import AdvertiserCampaigns from './AdvertiserCampaigns.jsx'
import AdvertiserAnalytics from './AdvertiserAnalytics.jsx'
import AdvertiserBilling from './AdvertiserBilling.jsx'
import AdvertiserAccount from './AdvertiserAccount.jsx'
import './advertiser.css'

const TABS = [
  { id: 'overview', label: 'Overview', path: '/app/advertiser', icon: 'overview' },
  { id: 'campaigns', label: 'Campaigns', path: '/app/advertiser/campaigns', icon: 'campaigns' },
  { id: 'analytics', label: 'Analytics', path: '/app/advertiser/analytics', icon: 'analytics' },
  { id: 'billing', label: 'Billing', path: '/app/advertiser/billing', icon: 'billing' },
  { id: 'account', label: 'Account', path: '/app/advertiser/account', icon: 'settings' },
]

/* Account is a route and stays one — /app/advertiser/account is a real
   deep link and somebody has it in a bookmark — but it is not a rail
   item. The rail's entry for it is Settings, in the foot, which opens
   the same form in an overlay with the way out of the account sitting
   next to it. One form, two doors; not two forms, one of which is
   hidden behind a settings icon nobody would guess at. */
const NAV = TABS.filter((t) => t.id !== 'account')

function tabForPath(path) {
  const clean = (path.split('?')[0].split('#')[0] || '/app/advertiser').replace(/\/+$/, '') || '/app/advertiser'
  if (clean === '/app/advertiser') return 'overview'
  if (clean.startsWith('/app/advertiser/campaigns')) return 'campaigns'
  if (clean.startsWith('/app/advertiser/analytics')) return 'analytics'
  if (clean.startsWith('/app/advertiser/billing')) return 'billing'
  if (clean.startsWith('/app/advertiser/account')) return 'account'
  return 'overview'
}

function SettingsPanel({ onClose }) {
  /* Escape closes. A dialog you cannot leave with the keyboard is a
     dialog you are trapped in, and this one sits over the whole screen. */
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="adv-settings__scrim"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Account settings"
    >
      {/* The scrim closes on click, so the panel has to stop the click —
          otherwise the first click inside it dismisses the thing you
          opened. */}
      <div className="adv-settings" onClick={(event) => event.stopPropagation()}>
        <div className="adv-settings__head">
          <div>
            <h2 className="adv-settings__title">Settings</h2>
            <p className="adv-settings__sub">Your account, and the way out of it.</p>
          </div>
          <button type="button" className="adv-settings__close" onClick={onClose} aria-label="Close settings">
            <svg className="adv-settings__close-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" />
            </svg>
          </button>
        </div>

        <div className="adv-settings__body">
          <AdvertiserAccount />
        </div>

        <div className="adv-settings__foot">
          <LogoutButton />
        </div>
      </div>
    </div>
  )
}

// Route is already guarded by RequireRole(['advertiser']) in App.jsx.
// This keeps the existing dashboard UI intact and reads shared auth only
// for the missing-role notice.
export default function AdvertiserApp() {
  const auth = useAuth()
  const campaignsState = useAdvertiserCampaigns()
  const route = useAppRoute()
  const tab = tabForPath(route)
  const [settingsOpen, setSettingsOpen] = useState(false)
  /* The frame, not the rail: it owns the grid column the rail's width
     actually controls. */
  const shellRef = useRef(null)

  return (
    /* clr-surface stays. It is the wrapper the site's shared control
       styling hangs off, and dropping it with the header would have
       restyled every button and panel on the page as a side effect of a
       layout change. The header it belonged to is gone; the wrapper is
       not the header. */
    <div className="clr-surface adv-console" ref={shellRef}>
      <AdvertiserSidebar
        shellRef={shellRef}
        items={NAV}
        active={tab}
        activeLabel={TABS.find((t) => t.id === tab)?.label || 'Overview'}
        onNavigate={(item) => navigateApp(item.path)}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="adv-main" aria-label="Advertiser dashboard">
        <header className="adv-topbar">
          <span className="adv-topbar__mark">
            <span className="adv-topbar__cli">CLI</span>
            <span className="adv-topbar__rev">Revenue</span>
          </span>
          <button
            type="button"
            className="adv-topbar__account"
            onClick={() => setSettingsOpen(true)}
            aria-haspopup="dialog"
          >
            Account
          </button>
        </header>
        <div className="adv-main__inner">
          {auth.role === null ? (
            <div className="adv-notice" role="status">
              Signed in, but no role row was found in <span className="mono">public.profiles</span> yet.
              Campaign reads will fail until the bootstrap creates it.
            </div>
          ) : null}

          {tab === 'overview' ? (
            <AdvertiserOverview
              campaigns={campaignsState.campaigns}
              loading={campaignsState.loading}
              error={campaignsState.error}
              onRetry={campaignsState.refresh}
              onCreate={() => navigateApp('/app/advertiser/campaigns')}
            />
          ) : null}
          {tab === 'campaigns' ? (
            <AdvertiserCampaigns
              campaigns={campaignsState.campaigns}
              loading={campaignsState.loading}
              error={campaignsState.error}
              onRetry={campaignsState.refresh}
              onChanged={campaignsState.refresh}
              onUpsert={campaignsState.upsertCampaign}
            />
          ) : null}
          {tab === 'analytics' ? (
            <AdvertiserAnalytics
              campaigns={campaignsState.campaigns}
              loading={campaignsState.loading}
              error={campaignsState.error}
              onRetry={campaignsState.refresh}
            />
          ) : null}
          {tab === 'billing' ? (
            <AdvertiserBilling
              campaigns={campaignsState.campaigns}
              loading={campaignsState.loading}
              error={campaignsState.error}
              onRetry={campaignsState.refresh}
            />
          ) : null}
          {tab === 'account' ? <AdvertiserAccount /> : null}
        </div>
      </main>

      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  )
}
