import useAdvertiserCampaigns from '../../hooks/useAdvertiserCampaigns.js'
import useAppRoute, { navigateApp } from '../../hooks/useAppRoute.js'
import { useAuth } from '../auth/authState.js'
import AdvertiserOverview from './AdvertiserOverview.jsx'
import AdvertiserCampaigns from './AdvertiserCampaigns.jsx'
import AdvertiserAnalytics from './AdvertiserAnalytics.jsx'
import AdvertiserBilling from './AdvertiserBilling.jsx'
import AdvertiserAccount from './AdvertiserAccount.jsx'

const TABS = [
  { id: 'overview', label: 'Overview', path: '/app/advertiser' },
  { id: 'campaigns', label: 'Campaigns', path: '/app/advertiser/campaigns' },
  { id: 'analytics', label: 'Analytics', path: '/app/advertiser/analytics' },
  { id: 'billing', label: 'Billing', path: '/app/advertiser/billing' },
  { id: 'account', label: 'Account', path: '/app/advertiser/account' },
]

function tabForPath(path) {
  const clean = (path.split('?')[0].split('#')[0] || '/app/advertiser').replace(/\/+$/, '') || '/app/advertiser'
  if (clean === '/app/advertiser') return 'overview'
  if (clean.startsWith('/app/advertiser/campaigns')) return 'campaigns'
  if (clean.startsWith('/app/advertiser/analytics')) return 'analytics'
  if (clean.startsWith('/app/advertiser/billing')) return 'billing'
  if (clean.startsWith('/app/advertiser/account')) return 'account'
  return 'overview'
}

// Route is already guarded by RequireRole(['advertiser']) in App.jsx.
// This keeps the existing dashboard UI intact and reads shared auth only
// for the account panel + missing-role notice.
export default function AdvertiserApp() {
  const auth = useAuth()
  const campaignsState = useAdvertiserCampaigns()
  const route = useAppRoute()
  const tab = tabForPath(route)

  return (
    <section className="adv-shell" aria-label="Advertiser dashboard">
      <div className="adv-shell__inner">
        <nav className="adv-nav" aria-label="Advertiser">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="adv-nav__btn"
              aria-current={tab === t.id ? 'page' : undefined}
              data-active={tab === t.id}
              onClick={() => navigateApp(t.path)}
            >
              {t.label}
            </button>
          ))}
        </nav>

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
        {tab === 'account' ? <AdvertiserAccount auth={auth} /> : null}
      </div>
    </section>
  )
}
