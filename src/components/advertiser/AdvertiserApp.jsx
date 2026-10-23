import { useEffect, useState } from 'react'
import useAdvertiserCampaigns from '../../hooks/useAdvertiserCampaigns.js'
import useAppRoute, { navigateApp } from '../../hooks/useAppRoute.js'
import { useAuth } from '../auth/authState.js'
import { LogoutButton } from '../auth/LogoutButton.jsx'
import AdvertiserSidebar from './AdvertiserSidebar.jsx'
import SupportDialog from './SupportDialog.jsx'
import Notifications from './Notifications.jsx'
import AdvertiserOverview from './AdvertiserOverview.jsx'
import AdvertiserCampaigns from './AdvertiserCampaigns.jsx'
import AdvertiserAnalytics from './AdvertiserAnalytics.jsx'
import AdvertiserBilling from './AdvertiserBilling.jsx'
import AdvertiserAccount from './AdvertiserAccount.jsx'
import { campaignWarnings } from '../../lib/advertiserApi.js'
import './advertiser.css'

const TABS = [
  { id: 'overview', label: 'Overview', path: '/app/advertiser', icon: 'overview' },
  { id: 'campaigns', label: 'Campaigns', path: '/app/advertiser/campaigns', icon: 'campaigns' },
  { id: 'analytics', label: 'Analytics', path: '/app/advertiser/analytics', icon: 'analytics' },
  { id: 'wallet', label: 'Wallet', path: '/app/advertiser/wallet', icon: 'wallet' },
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
  if (clean.startsWith('/app/advertiser/wallet')) return 'wallet'
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

      </div>
    </div>
  )
}

/* Versioned, and deliberately so.

   The console is paper by default now. A 'dark' left in localStorage by a
   visitor who once clicked the moon — against the OLD palette, before
   the ivory design existed — pins the console to the dark canvas for as
   long as the browser lives, and no amount of shipping a new stylesheet
   can change that: the preference is read at render time and wins.

   So the key carries the design it was chosen against. A preference made
   against a palette that no longer exists is not a preference, it is a
   leftover, and the next version of the console gets to decide for
   itself. The toggle still writes here and still persists; only a
   stranger's leftover is ignored. */
const THEME_KEY = 'clirevenue.advtheme.v2'

function readTheme() {
  // The console is white paper (sidebar.css restates the whole palette
  // for it), so "no choice made" means light, and it means light on
  // every machine. Reading the OS here instead would hand a dark-OS
  // visitor a dark console they never asked for -- and would have
  // turned a design decision into a setting nobody can see.
  try {
    return window.localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

// Route is already guarded by RequireRole(['advertiser']) in App.jsx.
// This keeps the existing dashboard UI intact and reads shared auth only
// for the missing-role notice.
/* Performance notes, read off the rows already loaded. Nothing is asked of
   the server and nothing is guessed: with no campaigns there is nothing
   worth saying, so there are no notes at all rather than encouraging ones. */
function insights(campaigns) {
  const live = campaigns.filter((c) => c.status === 'active')
  if (!live.length) return []
  const out = []
  const spent = live.reduce((sum, c) => sum + Number(c.spendCents || 0), 0)
  const budget = live.reduce((sum, c) => sum + Number(c.budgetCents || 0), 0)
  if (budget > 0 && spent / budget >= 0.8) {
    out.push({
      id: 'budget',
      tone: 'warn',
      title: 'Budget nearly spent',
      body: `${Math.round((spent / budget) * 100)}% of the budget on live campaigns is gone.`,
    })
  }
  const clicks = live.reduce((s, c) => s + Number(c.clicksCount || 0), 0)
  const impressions = live.reduce((s, c) => s + Number(c.impressionsCount || 0), 0)
  if (impressions > 500) {
    const ctr = (clicks / impressions) * 100
    out.push({
      id: 'ctr',
      title: 'Click-through',
      body: `${ctr.toFixed(2)}% across ${live.length} live campaign${live.length === 1 ? '' : 's'}.`,
    })
  }
  // Per-campaign spend and end-date warnings. These come from
  // campaignWarnings(), which reads the same fields the detail panel does,
  // so the bell and the panel can never disagree about what is running low.
  // Each warning is tagged with its campaign name so the note is actionable
  // — "budget nearly spent" is only useful if it says which campaign.
  for (const c of campaigns) {
    if (c.status === 'archived') continue
    for (const body of campaignWarnings(c)) {
      out.push({
        id: `warn-${c.id}`,
        tone: 'warn',
        title: `${c.name} needs attention`,
        body,
      })
    }
  }
  return out
}

export default function AdvertiserApp() {
  const auth = useAuth()
  const campaignsState = useAdvertiserCampaigns()
  const route = useAppRoute()
  const tab = tabForPath(route)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportSent, setSupportSent] = useState(0)
  const [theme, setTheme] = useState(readTheme)
  /* The frame, not the rail: it owns the grid column the rail's width
     actually controls. */

  return (
    /* clr-surface stays. It is the wrapper the site's shared control
       styling hangs off, and dropping it with the header would have
       restyled every button and panel on the page as a side effect of a
       layout change. The header it belonged to is gone; the wrapper is
       not the header. */
    <div
      className="clr-surface adv-console"
      data-theme={theme === 'dark' ? 'dark' : undefined}
    >
      <AdvertiserSidebar
        items={NAV}
        active={tab}
        activeLabel={TABS.find((t) => t.id === tab)?.label || 'Overview'}
        onNavigate={(item) => navigateApp(item.path)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSupport={() => setSupportOpen(true)}
        workspace={{
          name: auth?.profile?.company_name || auth?.advertiser?.company_name || '—',
          campaigns: campaignsState.campaigns.length,
          active: campaignsState.campaigns.filter((c) => c.status === 'active').length,
        }}
        logoutSlot={<LogoutButton />}
        theme={theme}
        onToggleTheme={() =>
          setTheme((current) => {
            const next = current === 'dark' ? 'light' : 'dark'
            try {
              window.localStorage.setItem(THEME_KEY, next)
            } catch {
              /* A console with the storage turned off still gets a theme,
                 it just gets the default one back on reload. */
            }
            return next
          })
        }
      />

      <main className="adv-main" aria-label="Advertiser dashboard">
        <header className="adv-topbar">
          <span className="adv-topbar__mark">
            <span className="adv-topbar__cli">CLI</span>
            <span className="adv-topbar__rev">Revenue</span>
          </span>
          <span className="adv-topbar__spacer" />
          <Notifications
            key={supportSent}
            insights={insights(campaignsState.campaigns)}
          />
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
              onUpsert={campaignsState.upsertCampaign}
              onChanged={campaignsState.refresh}
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
          {tab === 'wallet' ? (
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
      {supportOpen ? (
        <SupportDialog
          onClose={() => setSupportOpen(false)}
          onSent={() => {
            setSupportOpen(false)
            setSupportSent((n) => n + 1)
          }}
          userEmail={auth?.user?.email || ''}
          companyName={auth?.profile?.company_name || ''}
        />
      ) : null}
    </div>
  )
}
