import { useMemo } from 'react'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { formatCents } from '../../lib/advertiserApi.js'

// Billing has no dedicated backend in this repo: keep the money UI honest.
// Spend/transactions shown here are derived from campaign rows only,
// and payment/invoice actions are explicitly disabled stubs.
export default function AdvertiserBilling({ campaigns, loading, error, onRetry }) {
  const derived = useMemo(() => {
    const spend = campaigns.reduce((n, c) => n + (c.spendCents || 0), 0)
    const budget = campaigns.reduce((n, c) => n + (c.budgetCents || 0), 0)
    const rows = [...campaigns]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
      .slice(0, 8)
      .map((c) => ({
        id: c.id,
        label: `Campaign spend · ${c.name}`,
        detail: `${c.status} · ${formatCents(c.spendCents)} of ${formatCents(c.budgetCents)}`,
        at: c.updatedAt || c.createdAt,
      }))
    return { spend, budget, remaining: Math.max(0, budget - spend), rows }
  }, [campaigns])

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A4"
        label="Advertiser · Billing"
        title="What delivery has cost so far."
        body="Spend totals come from your campaigns. Payments aren't connected yet."
      />
      <AdvError message={error} onRetry={onRetry} />
      {loading ? <AdvLoading /> : (
        <>
          <AdvStats
            items={[
              {
                label: 'Current spend',
                value: formatCents(derived.spend),
                hint: derived.spend > 0 ? 'across all campaigns' : 'nothing spent yet',
                flag: derived.spend > 0 ? 'live' : 'idle',
                tone: derived.spend > 0 ? 'live' : 'zero',
              },
              {
                label: 'Committed budget',
                value: formatCents(derived.budget),
                hint: 'across all campaigns',
                tone: 'plain',
              },
              {
                label: 'Remaining budget',
                value: formatCents(derived.remaining),
                hint: derived.remaining > 0 ? 'still unspent' : 'fully committed',
                flag: derived.remaining > 0 ? 'open' : 'exhausted',
                tone: derived.remaining > 0 ? 'settling' : 'zero',
              },
            ]}
          />
          <div className="adv-grid adv-grid--2">
            <section className="panel adv-panel" aria-label="Transaction history">
              <h4 className="adv-panel__title">Transaction history</h4>
              <p className="adv-panel__sub">Spend recorded as campaigns deliver.</p>
              {derived.rows.length === 0 ? (
                <AdvEmpty mark="No transactions" title="No spend yet" body="Transactions appear once campaigns record delivery." />
              ) : (
                <ul className="adv-activity">
                  {derived.rows.map((r) => (
                    <li key={r.id} className="adv-activity__row">
                      <span className="adv-activity__label">{r.label}</span>
                      <span className="adv-activity__detail">{r.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="adv-stack">
              <Panel className="adv-panel">
                <h4 className="adv-panel__title">Payment information</h4>
                <p className="adv-panel__sub">Payments aren't connected yet.</p>
                <div className="adv-note adv-note--warn">No card is stored. Do not enter real payment details.</div>
                <button className="btn btn--primary" type="button" disabled aria-disabled="true" title="Payments aren't connected yet">
                  Add payment method
                </button>
              </Panel>
              <Panel className="adv-panel">
                <h4 className="adv-panel__title">Invoices</h4>
                <p className="adv-panel__sub">Invoices aren't connected yet.</p>
                <AdvEmpty mark="Not issued" title="No invoices" body="Invoices will appear here once available." />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
