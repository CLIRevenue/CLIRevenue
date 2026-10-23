import { useCallback, useState } from 'react'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { formatCents } from '../../lib/advertiserApi.js'
import { fetchWalletSnapshot, fetchWalletLedger, fetchWalletTopups } from '../../lib/walletApi.js'

function formatCredits(credits) {
  const n = Number(credits || 0)
  const abs = Math.abs(n)
  const body = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}₹${body}`
}

export default function BillingPage({ campaigns, loading, error, onRetry }) {
  const [wallet, setWallet] = useState(null)
  const [ledger, setLedger] = useState({ transactions: [], count: 0 })
  const [topups, setTopups] = useState({ topups: [], count: 0 })
  const [errorMsg, setErrorMsg] = useState('')

  const load = useCallback(async () => {
    try {
      const [snapshot, ledgerData, topupsData] = await Promise.all([
        fetchWalletSnapshot(),
        fetchWalletLedger(),
        fetchWalletTopups(),
      ])
      setWallet(snapshot.wallet || snapshot)
      setLedger(ledgerData || { transactions: [], count: 0 })
      setTopups(topupsData || { topups: [], count: 0 })
      setErrorMsg('')
    } catch (err) {
      setErrorMsg(err.message || 'Could not load billing data.')
    }
  }, [])

  useState(() => {
    void load()
  })

  const available = Number(wallet?.balance_credits ?? 0)
  const reserved = Number(wallet?.reserved_credits ?? 0)
  const frozen = wallet?.frozen_at

  const topupRows = topups.topups
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
  const txRows = ledger.transactions
    .slice()
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A4"
        label="Advertiser · Billing"
        title="Payment methods, invoices, and billing history."
        body="Manage your payment methods, view invoices, and track billing history."
      />
      <AdvError message={error} onRetry={onRetry} />
      <AdvError message={errorMsg} />

      {loading || wallet === null ? <AdvLoading /> : (
        <>
          <AdvStats
            items={[
              {
                label: 'Available credit',
                value: formatCredits(available),
                hint: reserved > 0 ? `${formatCredits(reserved)} reserved on live campaigns` : 'ready to spend',
                flag: frozen ? 'frozen' : available > 0 ? 'open' : 'empty',
                tone: frozen ? 'warn' : available > 0 ? 'live' : 'zero',
              },
              {
                label: 'Reserved credit',
                value: formatCredits(reserved),
                hint: 'held while campaigns run',
                tone: 'plain',
              },
              {
                label: 'Total credit',
                value: formatCredits(available + reserved),
                hint: available + reserved > 0 ? 'balance plus holds' : 'nothing yet',
                tone: available + reserved > 0 ? 'settling' : 'zero',
              },
            ]}
          />

          {frozen ? (
            <Panel className="adv-note adv-note--warn">
              <p className="adv-note__body">
                This wallet is frozen. No credit can move in or out until it is
                released. Open a support request below to ask for unfreezing.
              </p>
            </Panel>
          ) : null}

          <div className="adv-grid adv-grid--2">
            <section className="panel adv-panel" aria-label="Payment methods">
              <h4 className="adv-panel__title">Payment methods</h4>
              <p className="adv-panel__sub">Your saved payment methods for automatic top-ups.</p>
              <div className="adv-panel adv-note">
                <p className="adv-note__body">No payment methods saved yet. Add one from the Wallet tab.</p>
              </div>
            </section>

            <section className="panel adv-panel" aria-label="Invoices">
              <h4 className="adv-panel__title">Invoices</h4>
              <p className="adv-panel__sub">Your billing history and downloadable invoices.</p>
              {topupRows.length === 0 ? (
                <AdvEmpty mark="No invoices" title="No billing history yet" body="Confirmed top-ups and campaign invoices will appear here." />
              ) : (
                <ul className="adv-activity">
                  {topupRows.map((t) => (
                    <li key={t.id} className="adv-activity__row">
                      <span className="adv-activity__label">
                        {formatCredits(t.credits || 0)} · {t.currency || 'INR'}
                      </span>
                      <span className="adv-activity__detail">
                        {t.status} · {t.payment_method || '—'} · {t.created_at ? new Date(t.created_at).toLocaleDateString() : '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="panel adv-panel" aria-label="Billing ledger">
            <h4 className="adv-panel__title">Billing ledger</h4>
            <p className="adv-panel__sub">Every credit movement, newest first.</p>
            {txRows.length === 0 ? (
              <AdvEmpty mark="No transactions" title="No credit movements yet" body="Top-ups confirmed and campaign spends appear here." />
            ) : (
              <ul className="adv-activity">
                {txRows.map((t) => (
                  <li key={t.id} className="adv-activity__row">
                    <span className="adv-activity__label">{t.kind || 'credit'}</span>
                    <span className="adv-activity__detail">
                      {t.amount_credits != null ? (t.amount_credits >= 0 ? `+${t.amount_credits}` : t.amount_credits) : '—'} credit{t.amount_credits === 1 ? '' : 's'} · {t.status || 'posted'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}