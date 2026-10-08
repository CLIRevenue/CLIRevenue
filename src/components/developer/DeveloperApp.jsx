import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdvBarChart, AdvEmpty, AdvError, AdvLoading, AdvStats } from '../advertiser/AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { supabase } from '../../lib/api.js'
import DeveloperAccount from './DeveloperAccount.jsx'
import SdkSetup from './SdkSetup.jsx'
import PublisherKeys from './PublisherKeys.jsx'
import { LogoutButton } from '../auth/LogoutButton.jsx'

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
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : null } catch { json = null }
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
  if (!raw) return ['/api/rewards']
  if (raw.endsWith('/functions/v1')) return [`${raw}/rewards`, `${raw}/api/rewards`]
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
  const [tab, setTab] = useState('dashboard')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [balance, setBalance] = useState(null)
  const [rewards, setRewards] = useState([])

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
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'earnings', label: 'Earnings' },
    { id: 'sdk', label: 'SDK setup' },
    { id: 'keys', label: 'Publisher Keys' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'analytics', label: 'Analytics' },
    { id: 'account', label: 'Account' },
  ]

  return (
    <section className="adv-shell" aria-label="Developer dashboard">
      <div className="adv-shell__inner">
        <nav className="adv-nav" aria-label="Developer">
          {TABS.map((t) => (
            <button key={t.id} type="button" className="adv-nav__btn" data-active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          <LogoutButton />
        </nav>

        {/* The account and SDK tabs render their own page head — showing
            this one too would stack two eyebrows and two headlines. */}
        {tab !== 'account' && tab !== 'sdk' ? (
          <AdvPageHead
            index="D1"
            label="Developer"
            title={tab === 'dashboard' ? 'Earnings at a glance.' : tab[0].toUpperCase() + tab.slice(1) + '.'}
            body={
              {
                dashboard: 'Every figure below is read live from your account — real reward balances and delivery, never estimates.',
                earnings: 'Balances and rewards as they land, straight from your account.',
                integrations: 'Which CLIs you\'ve connected and how each one reads.',
                sdk: 'Ad delivery, end to end.',
                keys: 'Manage your publisher keys.',
                analytics: 'A quick look at what you\'ve earned so far.',
                account: 'Your details, security, and account controls.',
              }[tab]
            }
          />
        ) : null}
        {/* The rewards banner is suppressed on the SDK tab: it describes a
            failure the SDK page has nothing to do with, and the SDK page
            reports its own status honestly. */}
        {error && tab !== 'sdk' ? <AdvError message={error} onRetry={refresh} /> : null}
        {/* SDK setup needs no account data, so it sits outside the loading
            gate on purpose: a rewards endpoint that has not been deployed
            yet must not hide the one page that explains how to integrate. */}
        {tab === 'sdk' ? <SdkSetup /> : tab === 'keys' ? <PublisherKeys /> : loading ? <AdvLoading label="Loading developer rewards…" /> : (
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
                              {rewardStatus(r).label} · {formatCents(r.amount_cents ?? r.amountCents ?? 0)}
                            </span>
                          </li>
                        )}
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
                <p className="adv-panel__sub">Which CLIs you've connected, at a glance.</p>
                <ul className="adv-activity">
                  <li className="adv-activity__row">
                    <span className="adv-activity__label">Claude Code</span>
                    <span className="adv-activity__detail">Sponsored slot supported · read-only in this build.</span>
                  </li>
                  <li className="adv-activity__row">
                    <span className="adv-activity__label">Codex / Cline / OpenCode</span>
                    <span className="adv-activity__detail">Same sponsored slot, one shared key.</span>
                  </li>
                </ul>
              </Panel>
            )}
            {tab === 'analytics' && (
              <Panel className="adv-panel">
                <h4 className="adv-panel__title">Analytics</h4>
                <p className="adv-panel__sub">Straight from your reward ledger.</p>
                <AdvStats items={[
                  {
                    label: 'Rewards seen',
                    value: String(rewards.length),
                    hint: rewards.length === 1 ? 'one entry' : 'entries in the ledger',
                    tone: rewards.length > 0 ? 'live' : 'zero' },
                  { label: 'Available', value: formatCents(available), tone: available > 0 ? 'live' : 'zero' },
                  { label: 'Pending', value: formatCents(pending), tone: pending > 0 ? 'settling' : 'zero' },
                ]} />
                {rewards.length === 0 ? (
                  <AdvEmpty
                    mark="No history"
                    title="Analytics start after the first impression"
                    body="This panel reads your reward ledger directly — no sampling, no estimates. Serve one sponsored slot and the numbers appear here."
                    actionLabel="Integrate the SDK"
                    onAction={() => setTab('sdk')}
                  />
                ) : (
                  <AdvBarChart rows={chartRows} valueLabel="Rewards by campaign" />
                )}
              </Panel>
            )}
            {tab === 'account' && <DeveloperAccount />}
          </>
        )}
      </div>
    )
  )
}
