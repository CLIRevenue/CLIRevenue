import { useMemo, useState } from 'react'
import { AdvBarChart, AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from './AdvertiserUI.jsx'
import { ctrPct, formatCents } from '../../lib/advertiserApi.js'

function sum(list, pick) {
  return list.reduce((n, c) => n + (Number(pick(c)) || 0), 0)
}

export default function AdvertiserOverview({ campaigns, loading, error, onRetry, onCreate }) {
  const [activityFilter, setActivityFilter] = useState('all')

  const totals = useMemo(() => {
    const spend = sum(campaigns, (c) => c.spendCents)
    const budget = sum(campaigns, (c) => c.budgetCents)
    const impressions = sum(campaigns, (c) => c.impressions)
    const clicks = sum(campaigns, (c) => c.clicks)
    const conversions = sum(campaigns, (c) => c.conversions)
    const active = campaigns.filter((c) => c.status === 'active').length
    return {
      spend,
      remaining: Math.max(0, budget - spend),
      impressions,
      clicks,
      conversions,
      active,
      ctr: ctrPct(clicks, impressions),
    }
  }, [campaigns])

  const chartRows = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => b.spendCents - a.spendCents)
        .slice(0, 6)
        .map((c) => ({ id: c.id, name: c.name, value: c.spendCents, display: formatCents(c.spendCents) })),
    [campaigns],
  )

  const recent = useMemo(
    () =>
      [...campaigns]
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
        .slice(0, 4),
    [campaigns],
  )

  const activity = useMemo(() => {
    let rows = [...campaigns].sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
    if (activityFilter !== 'all') rows = rows.filter((c) => c.status === activityFilter)
    return rows.slice(0, 6).map((c) => ({
      id: c.id,
      name: c.name,
      status: c.status,
      detail: `${c.impressions.toLocaleString('en-US')} impressions · ${c.clicks.toLocaleString('en-US')} clicks · ${formatCents(c.spendCents)} spend`,
    }))
  }, [campaigns, activityFilter])

  const statItems = useMemo(() => ([
    {
      label: 'Total spend',
      value: formatCents(totals.spend),
      hint: totals.spend > 0 ? 'across all campaigns' : 'nothing spent yet',
      flag: totals.spend > 0 ? 'live' : 'idle',
      tone: totals.spend > 0 ? 'live' : 'zero',
    },
    {
      label: 'Remaining budget',
      value: formatCents(totals.remaining),
      hint: 'budget minus spend',
      flag: totals.remaining > 0 ? 'open' : 'exhausted',
      tone: totals.remaining > 0 ? 'settling' : 'zero',
    },
    {
      label: 'Active campaigns',
      value: String(totals.active),
      hint: `${campaigns.length} total`,
      flag: totals.active > 0 ? 'live' : 'none active',
      tone: totals.active > 0 ? 'live' : 'zero',
    },
    {
      label: 'Impressions',
      value: totals.impressions.toLocaleString('en-US'),
      hint: 'sponsored slots served',
      tone: totals.impressions > 0 ? 'plain' : 'zero',
    },
    {
      label: 'Clicks',
      value: totals.clicks.toLocaleString('en-US'),
      hint: `CTR ${totals.ctr.toFixed(2)}%`,
      tone: totals.clicks > 0 ? 'plain' : 'zero',
    },
    {
      label: 'Conversions',
      value: totals.conversions.toLocaleString('en-US'),
      hint: 'reported actions',
      tone: totals.conversions > 0 ? 'plain' : 'zero',
    },
  ]), [totals, campaigns.length])

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A1"
        label="Advertiser · Overview"
        title="Spend, delivery, and momentum."
        body="Live spend, impressions, and CTR from your campaigns."
      />
      <AdvError message={error} onRetry={onRetry} />
      {loading ? (
        <AdvLoading />
      ) : campaigns.length === 0 ? (
        <AdvEmpty
          mark="Ledger empty"
          title="No campaigns yet"
          body="Create your first campaign to see spend, impressions, and CTR here."
          actionLabel="Create a campaign"
          onAction={onCreate}
        />
      ) : (
        <>
          <AdvStats items={statItems} />
          <div className="adv-grid adv-grid--2">
            <section className="panel adv-panel" aria-label="Campaign performance">
              <h4 className="adv-panel__title">Campaign performance</h4>
              <p className="adv-panel__sub">Spend by campaign, from backend records.</p>
              <AdvBarChart rows={chartRows} valueLabel="Spend" />
              {chartRows.length === 0 ? (
                <AdvEmpty mark="No spend" title="Nothing to compare" body="Spend by campaign appears here once a campaign records a delivery." />
              ) : null}
            </section>
            <section className="panel adv-panel" aria-label="Recent activity">
              <div className="adv-panel__row">
                <div>
                  <h4 className="adv-panel__title">Recent activity</h4>
                  <p className="adv-panel__sub">Latest campaign updates.</p>
                </div>
                <select
                  className="field__input field__input--select adv-select"
                  value={activityFilter}
                  onChange={(e) => setActivityFilter(e.target.value)}
                  aria-label="Filter activity by status"
                >
                  <option value="all">All statuses</option>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </div>
              {activity.length === 0 ? (
                <AdvEmpty
                  mark={activityFilter === 'all' ? 'No updates' : `No ${activityFilter} campaigns`}
                title={activityFilter === 'all' ? 'Nothing has changed yet' : `No ${activityFilter} campaigns`}
                body={activityFilter === 'all'
                  ? 'Campaign edits, budget changes, and delivery milestones show up here.'
                  : 'Switch the filter back to all statuses to see the rest of your campaigns.'}
                actionLabel={activityFilter === 'all' ? undefined : 'Show all statuses'}
                onAction={activityFilter === 'all' ? undefined : () => setActivityFilter('all')}
              />
            ) : (
              <ul className="adv-activity">
                {activity.map((a) => (
                  <li key={a.id} className="adv-activity__row">
                    <span className="adv-activity__label">
                      {a.name}
                      <span className="adv-pill" data-status={a.status}>{a.status}</span>
                    </span>
                    <span className="adv-activity__detail">{a.detail}</span>
                  </li>
                ))}
              </ul>
            )}
            </section>
          </div>
          <section className="panel adv-panel" aria-label="Recent campaigns">
            <h4 className="adv-panel__title">Recent campaigns</h4>
            <div className="adv-tablewrap">
              <table className="adv-table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Status</th>
                    <th>Audience</th>
                    <th>Spend</th>
                    <th>CTR</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Campaign">{c.name}</td>
                      <td data-label="Status"><span className="adv-pill" data-status={c.status}>{c.status}</span></td>
                      <td data-label="Audience">{c.audienceLabel}</td>
                      <td className="mono" data-label="Spend">{formatCents(c.spendCents)}</td>
                      <td className="mono" data-label="CTR">{ctrPct(c.clicks, c.impressions).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
