import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdvEmpty, AdvError, AdvLoading, AdvPageHead, AdvStats } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { formatCents } from '../../lib/advertiserApi.js'
import {
  fetchWalletSnapshot,
  fetchWalletLedger,
  fetchWalletTopups,
  createWalletTopup,
  fetchWalletNotifications,
  markWalletNotificationsRead,
  MIN_TOPUP_AMOUNT,
} from '../../lib/walletApi.js'

/* One credit is one rupee. The wallet holds whole credits; the top-up form
   collects the payer's details and the amount in minor units (cents), and
   the Edge Function converts to credits server-side. Nothing here invents
   money. */
function formatCredits(credits) {
  const n = Number(credits || 0)
  const abs = Math.abs(n)
  const body = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${n < 0 ? '-' : ''}₹${body}`
}

function parseAmount(value) {
  const n = Number(String(value || '').replace(/,/g, ''))
  return Number.isFinite(n) ? n : 0
}

export default function AdvertiserWallet({ campaigns, loading, error, onRetry }) {
  void campaigns
  const [wallet, setWallet] = useState(null)
  const [ledger, setLedger] = useState({ transactions: [], count: 0 })
  const [topups, setTopups] = useState({ topups: [], count: 0 })
  const [notifications, setNotifications] = useState({ notifications: [], unreadCount: 0 })
  const [topupLoading, setTopupLoading] = useState(false)
  const [topupError, setTopupError] = useState('')

  const load = useCallback(async () => {
    try {
      const [snapshot, ledgerData, topupsData, notifyData] = await Promise.all([
        fetchWalletSnapshot(),
        fetchWalletLedger(),
        fetchWalletTopups(),
        fetchWalletNotifications(),
      ])
      setWallet(snapshot.wallet || snapshot)
      setLedger(ledgerData || { transactions: [], count: 0 })
      setTopups(topupsData || { topups: [], count: 0 })
      setNotifications(notifyData || { notifications: [], unreadCount: 0 })
      setTopupError('')
    } catch (err) {
      setTopupError(err.message || 'Could not load wallet.')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const available = Number(wallet?.balance_credits ?? 0)
  const reserved = Number(wallet?.reserved_credits ?? 0)
  const frozen = wallet?.frozen_at

  const handleTopup = useCallback(
    async (event) => {
      event.preventDefault()
      const form = event.currentTarget
      const formData = new FormData(form)
      const amountMinor = parseAmount(formData.get('amount_minor'))
      const currency = String(formData.get('currency') || 'INR')
      const payerName = String(formData.get('payer_name') || '').trim()
      const payerEmail = String(formData.get('payer_email') || '').trim()
      const payerAddress = String(formData.get('payer_address') || '').trim()
      const paymentMethod = String(formData.get('payment_method') || '')

      if (!amountMinor || amountMinor < 100) {
        setTopupError(`Amount must be at least ${MIN_TOPUP_AMOUNT}.`)
        return
      }
      if (!payerName || !payerEmail || !payerAddress || !paymentMethod) {
        setTopupError('Fill in every field before requesting a top-up.')
        return
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) {
        setTopupError('Enter a valid email address.')
        return
      }

      setTopupLoading(true)
      setTopupError('')
      try {
        await createWalletTopup({ amount_minor: Math.floor(amountMinor), currency, payer_name: payerName, payer_email: payerEmail, payer_address: payerAddress, payment_method: paymentMethod })
        form.reset()
        setTopupError('')
        void load()
      } catch (err) {
        setTopupError(err.message || 'Top-up request failed.')
      } finally {
        setTopupLoading(false)
      }
    },
    [load]
  )

  const handleMarkRead = useCallback(() => {
    const ids = notifications.notifications.filter((n) => !n.read_at).map((n) => n.id)
    if (!ids.length) return
    markWalletNotificationsRead(ids).catch(() => {})
  }, [notifications.notifications])

  const topupRows = useMemo(() => [...topups.topups].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), [topups.topups])
  const txRows = useMemo(() => [...ledger.transactions].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)), [ledger.transactions])

  const hasNotifications = notifications.notifications.length > 0
  const unread = notifications.notifications.filter((n) => !n.read_at).length

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A4"
        label="Advertiser · Wallet"
        title="Your credit wallet."
        body="Credits are whole rupees. Top up here, then spend on campaigns. Every credit movement is recorded in the ledger below."
      />
      <AdvError message={error} onRetry={onRetry} />
      <AdvError message={topupError} />

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
            <section className="panel adv-panel" aria-label="Top up wallet">
              <h4 className="adv-panel__title">Top up</h4>
              <p className="adv-panel__sub">Request a credit top-up. A reviewer confirms it and the credits land in your wallet.</p>
              <form className="form adv-form" onSubmit={handleTopup} noValidate>
                <label className="field">
                  <span className="field__label">Amount</span>
                  <input
                    type="number"
                    name="amount_minor"
                    min="100"
                    step="100"
                    className="field__input"
                    placeholder="e.g. 100"
                    required
                  />
                  <span className="adv-upload__hint">Minimum ₹1.00 · whole rupees only</span>
                </label>
                <label className="field">
                  <span className="field__label">Currency</span>
                  <select name="currency" className="field__input" defaultValue="INR" required>
                    <option>INR</option>
                    <option>USD</option>
                    <option>EUR</option>
                    <option>GBP</option>
                  </select>
                </label>
                <label className="field">
                  <span className="field__label">Payer name</span>
                  <input name="payer_name" className="field__input" placeholder="Name on the payment" required />
                </label>
                <label className="field">
                  <span className="field__label">Payer email</span>
                  <input name="payer_email" type="email" className="field__input" placeholder="payer@example.com" required />
                </label>
                <label className="field">
                  <span className="field__label">Payer address</span>
                  <textarea name="payer_address" className="field__input" rows="2" placeholder="Street, city, pincode" required />
                </label>
                <label className="field">
                  <span className="field__label">Payment method</span>
                  <select name="payment_method" className="field__input" required>
                    <option value="">Choose one</option>
                    <option value="upi">UPI</option>
                    <option value="card">Card</option>
                    <option value="bank_transfer">Bank transfer</option>
                    <option value="manual">Manual (invoice)</option>
                    <option value="promo">Promo credit</option>
                  </select>
                </label>
                <button type="submit" className="btn btn--primary" disabled={topupLoading}>
                  {topupLoading ? 'Requesting…' : 'Request top-up'}
                </button>
              </form>
            </section>

            <section className="panel adv-panel" aria-label="Pending top-ups">
              <h4 className="adv-panel__title">Pending top-ups</h4>
              <p className="adv-panel__sub">Awaiting confirmation. Credits appear here once a reviewer approves them.</p>
              {topupRows.length === 0 ? (
                <AdvEmpty mark="No pending top-ups" title="Nothing awaiting confirmation" body="Requested top-ups show here until they are confirmed or rejected." />
              ) : (
                <ul className="adv-activity">
                  {topupRows.map((t) => (
                    <li key={t.id} className="adv-activity__row">
                      <span className="adv-activity__label">
                        {formatCents(t.amount_minor || 0)} · {t.currency || 'INR'}
                      </span>
                      <span className="adv-activity__detail">
                        {t.status} · {t.payment_method || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <section className="panel adv-panel" aria-label="Wallet ledger">
            <h4 className="adv-panel__title">Transaction ledger</h4>
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

          <section className="panel adv-panel" aria-label="Wallet notifications">
            <h4 className="adv-panel__title">Wallet notifications</h4>
            <p className="adv-panel__sub">Top-up confirmations, freezes, and releases.</p>
            {!hasNotifications ? (
              <p className="adv-empty__body">No notifications yet.</p>
            ) : (
              <>
                {unread > 0 ? (
                  <button type="button" className="btn btn--ghost btn--sm adv-notice__btn" onClick={handleMarkRead}>
                    Mark all as read
                  </button>
                ) : null}
                <ul className="adv-activity">
                  {notifications.notifications.map((n) => (
                    <li key={n.id} className={`adv-activity__row${n.read_at ? ' adv-activity__row--read' : ''}`}>
                      <span className="adv-activity__label">{n.title || 'Wallet notice'}</span>
                      <span className="adv-activity__detail">{n.body || ''}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  )
}
