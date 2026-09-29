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
        body="Billing API is not available in the backend yet. This page derives spend from campaign rows and never claims a payment succeeded."
      />
      <AdvError message={error} onRetry={onRetry} />
      {loading ? <AdvLoading /> : (
        <>
          <AdvStats
            items={[
              { label: 'Current spend', value: formatCents(derived.spend), hint: 'sum of spendCents' },
              { label: 'Committed budget', value: formatCents(derived.budget), hint: 'sum of budgetCents' },
              { label: 'Remaining budget', value: formatCents(derived.remaining) },
            ]}
          />
          <div className="adv-grid adv-grid--2">
            <section className="panel adv-panel" aria-label="Transaction history">
              <h4 className="adv-panel__title">Transaction history</h4>
              <p className="adv-panel__sub">Derived from campaign delivery. No invoices endpoint exists yet.</p>
              {derived.rows.length === 0 ? (
                <AdvEmpty title="No spend yet" body="Transactions appear once campaigns record delivery." />
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
                <p className="adv-panel__sub">MISSING_BACKEND: no payment-method API. This stays disconnected.</p>
                <div className="adv-note adv-note--warn">No card is stored. Do not enter real payment details in this prototype.</div>
                <button className="btn btn--primary" type="button" disabled aria-disabled="true" title="Unavailable: billing API missing">
                  Add payment method (unavailable)
                </button>
              </Panel>
              <Panel className="adv-panel">
                <h4 className="adv-panel__title">Invoices</h4>
                <p className="adv-panel__sub">MISSING_BACKEND: no invoices endpoint.</p>
                <AdvEmpty title="No invoices" body="Invoice download will appear when the backend supports it." />
              </Panel>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
