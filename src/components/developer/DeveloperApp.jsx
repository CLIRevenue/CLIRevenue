import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdvBarChart, AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from '../advertiser/AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { supabase } from '../../lib/api.js'
import { DEFAULT_INTERNAL_BACKEND } from '../../lib/backendBase.js'
import { formatCredits } from '../../lib/walletFormat.js'
import { fetchWalletSnapshot } from '../../lib/walletApi.js'
import DeveloperAccount from './DeveloperAccount.jsx'
import DeveloperWallet from './DeveloperWallet.jsx'
import DeveloperReferrals from './DeveloperReferrals.jsx'
import DeveloperSidebar from './DeveloperSidebar.jsx'
import { useAuth } from '../auth/authState.js'
import SupportDialog from '../advertiser/SupportDialog.jsx'
import Notifications from '../advertiser/Notifications.jsx'
import SdkSetup from './SdkSetup.jsx'
import PublisherKeys from './PublisherKeys.jsx'
import PublisherPlacements from './PublisherPlacements.jsx'
import { LogoutButton } from '../auth/LogoutButton.jsx'
import './DeveloperConsole.css'

const STORAGE_KEY = 'clirevenueDeveloperTab'

/* Read off what this console already loaded. Nothing is invented here, and
   with nothing loaded there is nothing worth saying, so there are no notes
   rather than encouraging ones. */
function developerInsights(balance, rewards) {
  if (!balance || !rewards.length) return []
  const out = []
  const latest = rewards[0]
  if (latest && Number(latest.amount_cents || 0) > 0) {
    out.push({
      id: 'latest',
      title: 'Latest entry',
      body: `${formatCents(latest.amount_cents)} on ${new Date(latest.created_at || Date.now()).toLocaleDateString('en-US')}.`,
    })
  }
  return out
}
/* Versioned for the same reason as the advertiser console's key: a 'dark'
   stored against the pre-ivory palette would pin this console to the dark
   canvas forever, out of reach of any stylesheet. */
const THEME_KEY = 'clirevenue.devtheme.v2'

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

/* The account dialog. Same shape as the advertiser console's, because the
   two consoles are the same product and a person who uses both should not
   have to learn the dialog twice. */
function SettingsPanel({ onClose }) {
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="adv-settings__scrim"
      role="dialog"
      aria-modal="true"
      aria-label="Account settings"
      onClick={onClose}
    >
      <div className="adv-settings" onClick={(event) => event.stopPropagation()}>
        <div className="adv-settings__head">
          <div>
            <h2 className="adv-settings__title">Settings</h2>
            <p className="adv-settings__sub">Your account, and the way out of it.</p>
          </div>
          <button type="button" className="adv-settings__close" onClick={onClose} aria-label="Close">
            <svg className="adv-settings__close-mark" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="adv-settings__body">
          <DeveloperAccount />
        </div>
        <div className="adv-settings__foot">
          <LogoutButton />
        </div>
      </div>
    </div>
  )
}

function trimBase(raw) {
  return String(raw || '').replace(/\/+$/, '')
}

async function authedGet(url) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  let json
  try { json = await res.json() } catch { json = null }
  if (!res.ok) {
    const err = new Error(json?.error?.message || json?.error || json?.message || res.statusText || 'Request failed')
    err.status = res.status
    throw err
  }
  return json
}

function formatCents(cents) {
  const n = Number(cents || 0)
  const abs = Math.abs(n)
  const body = `${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(abs % 100).toString().padStart(2, '0')}`
  return `${n < 0 ? '-' : ''}$${body}`
}

function rewardsBases() {
  const raw = trimBase(import.meta.env.VITE_API_BASE_URL || '')
  if (!raw) return ['/api/rewards', `${DEFAULT_INTERNAL_BACKEND}/rewards`]
  if (raw.endsWith('/functions/v1')) return [`${raw}/rewards`, `${raw}/api/reviews`]
  return [`${raw}/api/rewards`]
}

async function fetchBalanceAndRewards() {
  let lastErr = null
  for (const base of rewardsBases()) {
    try {
      let balance = null
      let rewardsPayload = null
      // balance
      try {
        balance = await authedGet(`${base}/balance`)
      } catch (e) {
        if (e.status !== 404 && e.status !== 405) throw e
        lastErr = e
      }
      // list (limit small for dashboard)
      try {
        rewardsPayload = await authedGet(`${base}?limit=8`)
      } catch (e) {
        if (e.status !== 404 && e.status !== 405) throw e
        lastErr = e
      }
      if (balance || rewardsPayload) return { balance, rewardsPayload }
    } catch (e) {
      lastErr = e
      if (e.status !== 404 && e.status !== 405) throw e
    }
  }
  throw lastErr || new Error('Rewards endpoint not found.')
}

function rewardStatus(reward) {
  const raw = String(reward?.status ?? '').trim().toLowerCase()
  if (!raw) return { tone: 'pending', label: 'Pending' }
  if (raw === 'settled' || raw === 'paid' || raw === 'complete' || raw === 'completed') {
    return { tone: 'settled', label: 'Settled' }
  }
  if (raw === 'failed' || raw === 'reversed') return { tone: 'failed', label: 'Failed' }
  return { tone: 'pending', label: raw.charAt(0).toUpperCase() + raw.slice(1) }
}

export default function DeveloperApp() {
  // Initialize tab from sessionStorage or default to 'dashboard'
  const auth = useAuth()
  const [tab, setTab] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = window.sessionStorage.getItem(STORAGE_KEY)
        if (stored && ['dashboard', 'earnings', 'sdk', 'keys', 'wallet', 'integrations', 'analytics', 'account', 'placements'].includes(stored)) {
          return stored
        }
      } catch (e) {
        console.warn('Failed to read developer tab state from sessionStorage:', e)
      }
    }
    return 'dashboard'
  })

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState(null)
  const [rewards, setRewards] = useState([])
  const [theme, setTheme] = useState(readTheme)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportSent, setSupportSent] = useState(0)
  /* Credit-wallet balance for the rail fact. Separate from `balance`,
     which is the reward ledger in cents — two different pots, two
     different formats (₹ whole rupees vs $ cents). Null until the
     snapshot lands; the rail prints an em-dash until then. */
  const [walletCredits, setWalletCredits] = useState(null)

  // Persist tab state to sessionStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(STORAGE_KEY, tab)
      } catch (e) {
        console.warn('Failed to write developer tab state to sessionStorage:', e)
      }
    }
  }, [tab])

  // Initial load: every setState happens after the awaited fetch, so the
  // effect itself never synchronously updates state.
  const load = useCallback(async () => {
    try {
      const { balance: b, rewardsPayload } = await fetchBalanceAndRewards()
      const list = rewardsPayload?.rewards || rewardsPayload?.data || []
      setRewards(Array.isArray(list) ? list : [])
      // Contract uses *_cents; normalize defensively.
      setBalance(b ? {
        availableCents: b.available_cents ?? b.availableCents ?? 0,
        pendingCents: b.pending_cents ?? b.pendingCents ?? 0,
        lifetimeCents: b.lifetime_cents ?? b.lifetimeCents ?? 0,
        reservedCents: b.reserved_cents ?? b.reservedCents ?? 0,
      } : null)
      setError('')
    } catch (e) {
      setError(e.status === 401 ? 'Session expired. Please log in again.' : (e.message || 'Could not load developer data.'))
    } finally {
      setLoading(false)
    }
  }, [])

  // Retry path (event handlers): may flip loading synchronously.
  const refresh = useCallback(async () => {
    setLoading(true)
    setError('')
    await load()
  }, [load])

  useEffect(() => {
    // Async boundary: kick the loader off without synchronously mutating
    // state from the effect body itself.
    void (async () => {
      await load()
    })()
  }, [load])

  // Wallet fact for the rail. Stale-guarded so StrictMode's double
  // invocation cannot write a second time; a failed snapshot just
  // leaves the em-dash rather than erroring the whole console.
  useEffect(() => {
    let stale = false
    fetchWalletSnapshot()
      .then((snap) => {
        if (stale) return
        setWalletCredits(Number(snap?.wallet?.balance_credits ?? snap?.balance_credits ?? 0))
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [])

  const available = Number(balance?.availableCents ?? 0)
  const pending = Number(balance?.pendingCents ?? 0)
  const rewardsCount = rewards.length

  const stats = useMemo(() => ([
    {
      label: 'Available',
      value: formatCents(available),
      hint: available > 0 ? 'withdrawable now' : 'nothing to withdraw yet',
      flag: available > 0 ? 'live' : 'empty',
      tone: available > 0 ? 'live' : 'zero',
    },
    {
      label: 'Pending',
      value: formatCents(pending),
      hint: pending > 0 ? 'settling' : 'nothing in flight',
      flag: pending > 0 ? 'settling' : 'idle',
      tone: pending > 0 ? 'settling' : 'zero',
    },
    {
      label: 'Lifetime',
      value: formatCents(balance?.lifetimeCents),
      hint: `${rewardsCount} ${rewardsCount === 1 ? 'entry' : 'entries'} in the ledger`,
      tone: 'plain',
    },
    {
      label: 'Reserved',
      value: formatCents(balance?.reservedCents),
      hint: Number(balance?.reservedCents ?? 0) > 0 ? 'payouts requested' : 'no payout requested',
      tone: 'plain',
    },
  ]), [available, pending, balance, rewardsCount])

  const chartRows = useMemo(() => rewards.slice(0, 6).map((r) => ({
    id: r.id,
    name: r.campaign_name || r.campaign_id || 'Reward',
    value: Number(r.amount_cents ?? r.amountCents ?? 0),
    display: formatCents(r.amount_cents ?? r.amountCents ?? 0),
  })), [rewards])

  const TABS = [
    { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { id: 'earnings', label: 'Earnings', icon: 'earnings' },
    { id: 'sdk', label: 'SDK setup', icon: 'sdk' },
    { id: 'keys', label: 'Publisher Keys', icon: 'keys' },
    { id: 'placements', label: 'Placements', icon: 'placements' },
    { id: 'integrations', label: 'Integrations', icon: 'integrations' },
    { id: 'analytics', label: 'Analytics', icon: 'analytics' },
    { id: 'wallet', label: 'Wallet', icon: 'wallet' },
    { id: 'referrals', label: 'Referrals', icon: 'referrals' },
    { id: 'account', label: 'Account', icon: 'account' },
  ]
  /* Account is in TABS because the panel and the deep link both read it,
     but it is not a destination in the rail: it opens a dialog, and a rail
     is for pages. */
  const NAV = TABS.filter((t) => t.id !== 'account')

  return (
    <div
      className="clr-surface adv-console"
      data-theme={theme === 'dark' ? 'dark' : undefined}
    >
      <DeveloperSidebar
        items={NAV}
        active={tab}
        activeLabel={TABS.find((t) => t.id === tab)?.label || 'Dashboard'}
        onNavigate={(item) => setTab(item.id)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSupport={() => setSupportOpen(true)}
        workspace={{
          name: auth?.profile?.display_name || auth?.user?.email || '—',
          balance: balance ? formatCents(balance.availableCents) : '—',
          wallet: walletCredits === null ? '—' : formatCredits(walletCredits),
          entries: rewards.length,
        }}
        logoutSlot={<LogoutButton />}
        theme={theme}
        onToggleTheme={() =>
          setTheme((current) => {
            const next = current === 'dark' ? 'light' : 'dark'
            try {
              window.localStorage.setItem(THEME_KEY, next)
            } catch {
              /* Storage off still toggles; it just forgets by reload. */
            }
            return next
          })
        }
      />

      <main className="adv-main" aria-label="Developer dashboard">
        <header className="adv-topbar">
          <span className="adv-topbar__mark">
            <span className="adv-topbar__cli">CLI</span>
            <span className="adv-topbar__rev">Revenue</span>
          </span>
          <span className="adv-topbar__spacer" />
          <Notifications key={supportSent} insights={developerInsights(balance, rewards)} />
        </header>

        <div className="adv-main__inner">

          {tab !== 'account' && tab !== 'sdk' ? (
            <AdvPageHead
              index="D1"
              label="Developer"
              title={tab === 'dashboard' ? 'Earnings at a glance.' : tab[0].toUpperCase() + tab.slice(1) + '.'}
              body={{
                dashboard: 'Every figure below is read live from your account — real reward balances and delivery, never estimates.',
                earnings: 'Balances and rewards as they land, straight from your account.',
                integrations: 'Which CLIs you\'ve connected, and how each one reads.',
                sdk: 'Ad delivery, end to end.',
                keys: 'Manage your publisher keys.',
                placements: 'Manage your ad placements.',
                analytics: 'Where your earnings came from, and what is not measured yet.',
                wallet: 'Top up your credit wallet and watch every movement.',
                account: 'Your details, security, and account controls.',
              }[tab]}
            />
          ) : null}

          {error && tab !== 'sdk' ? <AdvError message={error} onRetry={refresh} /> : null}

          {tab === 'sdk' ? (
            <SdkSetup />
          ) : tab === 'keys' ? (
            <PublisherKeys />
          ) : tab === 'placements' ? (
            <PublisherPlacements />
          ) : tab === 'wallet' ? (
            <DeveloperWallet />
          ) : tab === 'referrals' ? (
            <DeveloperReferrals />
          ) : loading ? (
            <AdvLoading label="Loading developer rewards…" />
          ) : (
            <>
              {(tab === 'dashboard' || tab === 'earnings') && (
                <>
                  <AdvStats items={stats} />
                  <div className="adv-grid adv-grid--2">
                    <section className="panel adv-panel" aria-label="Recent rewards">
                      <h4 className="adv-panel__title">Recent rewards</h4>
                      <p className="adv-panel__sub">Latest entries in your reward ledger.</p>
                      {rewards.length === 0 ? (
                        <AdvEmpty
                          mark="Ledger empty"
                          title="No rewards yet"
                          body="Rewards land here the moment a sponsored slot in one of your CLIs is served. Integrate the SDK, then watch this fill."
                          actionLabel="Set up the SDK"
                          onAction={() => setTab('sdk')}
                        />
                      ) : (
                        <ul className="adv-activity">
                          {rewards.slice(0, 6).map((r) => (
                            <li key={r.id} className="adv-activity__row">
                              <span className="adv-activity__label">
                                {r.campaign_name || r.campaign_id || 'Reward'}
                              </span>
                              <span className="adv-activity__detail">
                                {rewardStatus(r).label} · {formatCents(r.amount_cents ?? r.amountCents ?? 0)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </section>

                    <section className="panel adv-panel" aria-label="Reward mix">
                      <h4 className="adv-panel__title">Reward mix</h4>
                      <p className="adv-panel__sub">By campaign (latest entries).</p>
                      {chartRows.length ? (
                        <AdvBarChart rows={chartRows} valueLabel="Rewards" />
                      ) : (
                        <AdvEmpty
                          mark="Nothing to chart"
                          title="No rewards to compare"
                          body="Once two or more campaigns pay out, this becomes a side-by-side breakdown of where your earnings come from."
                        />
                      )}
                    </section>
                  </div>
                </>
              )}

              {tab === 'integrations' && (
                <Panel className="adv-panel">
                  <h4 className="adv-panel__title">Integrations</h4>
                  <p className="adv-panel__sub">
                    Each coding CLI gets its own placement key, so its earnings stay separable.
                    The CLI writes this list into clirevenue.config.json in your project.
                  </p>
                  {/* The dashboard cannot read that file — it lives in the developer's
                      project, not on the server — so this shows the rule and the command
                      that reports the real list. Inventing plausible-looking rows here
                      would be the exact failure the design system forbids: a confident
                      number that is not a measurement. */}
                  <ul className="adv-activity">
                    <li className="adv-activity__row">
                      <span className="adv-activity__label">One key per CLI</span>
                      <span className="adv-activity__detail">
                        Add a CLI, and setup provisions a placement for it. Two integrations
                        can never share a key, so one editor's ad is never mistaken for another's.
                      </span>
                    </li>
                    <li className="adv-activity__row">
                      <span className="adv-activity__label">Many slots per key</span>
                      <span className="adv-activity__detail">
                        A second ad on the same page is another slot on the same key, with its
                        own size and position — not another placement on your account.
                      </span>
                    </li>
                    <li className="adv-activity__row">
                      <span className="adv-activity__label">Positions stay in your repo</span>
                      <span className="adv-activity__detail">
                        clirevenue.config.json holds each slot's geometry and never contains a
                        key, so it is safe to commit.
                      </span>
                    </li>
                  </ul>
                  <div className="setup__actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setTab('sdk')}
                    >
                      How to connect one
                    </button>
                  </div>
                  <AdvEmpty
                    mark="Not shown here"
                    title="This list lives in your project, not on the server"
                    body="Run clirevenue integrations list in your project to see the integrations and slots you have actually configured, or run npx clirevenue setup to add one."
                  />
                </Panel>
              )}

              {tab === 'analytics' && (
                <>
                  <Panel className="adv-panel">
                    <h4 className="adv-panel__title">Where the earnings come from</h4>
                    <p className="adv-panel__sub">
                      Every reward in your ledger, newest first. Balances are on Earnings; this
                      is the breakdown of which campaign paid what.
                    </p>
                    {rewards.length === 0 ? (
                      <AdvEmpty
                        mark="No history"
                        title="This becomes a breakdown after your first reward"
                        body="There is one reward per served impression, so there is nothing to compare until a campaign pays. This panel reads your ledger directly — no sampling, no estimates."
                        actionLabel="Connect a CLI"
                        onAction={() => setTab('integrations')}
                      />
                    ) : (
                      <AdvBarChart rows={chartRows} valueLabel="Rewards by campaign" />
                    )}
                  </Panel>

                  <Panel className="adv-panel">
                    <h4 className="adv-panel__title">Not available yet</h4>
                    <p className="adv-panel__sub">
                      Stated rather than faked. Each of these would need a developer-facing
                      endpoint that does not exist, and a row of zeros would read as a
                      measurement instead of the absence of one.
                    </p>
                    <ul className="adv-activity">
                      <li className="adv-activity__row">
                        <span className="adv-activity__label">Impressions and fill rate</span>
                        <span className="adv-activity__detail">
                          Delivery counts are recorded on the server, but nothing exposes them to
                          a developer yet.
                        </span>
                      </li>
                      <li className="adv-activity__row">
                        <span className="adv-activity__label">Per-placement breakdown</span>
                        <span className="adv-activity__detail">
                          Your ledger keys rewards by campaign today. Which of your own
                          placements served one is not yet reported back.
                        </span>
                      </li>
                      <li className="adv-activity__row">
                        <span className="adv-activity__label">Time series</span>
                        <span className="adv-activity__detail">
                          The rewards endpoint returns recent entries rather than a range, so
                          this panel shows what it was given instead of extrapolating a trend.
                        </span>
                      </li>
                    </ul>
                  </Panel>
                </>
              )}

              {tab === 'account' && <DeveloperAccount />}
            </>
          )}
        </div>
      </main>

      {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}
      {supportOpen ? (
        <SupportDialog
          onClose={() => setSupportOpen(false)}
          onSent={() => { setSupportOpen(false); setSupportSent((n) => n + 1) }}
          userEmail={auth?.user?.email || ''}
        />
      ) : null}
    </div>
  )
}