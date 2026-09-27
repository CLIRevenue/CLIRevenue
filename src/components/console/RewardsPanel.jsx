/* =============================================================
   CLIRevenue — the developer's account and rewards
   -------------------------------------------------------------
   Connect, watch a qualifying event mint a reward, watch the settle
   pass move it from pending to available, request a payout against a
   rail that never settles. Every figure on this panel is simulated,
   and the panel says so in more than one place.
   ============================================================= */

import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { DemoTag, SectionHead } from './ui.jsx'
import { PAYMENT_PROVIDERS, formatMoney, parseBudget } from '../../lib/economy.js'
import {
  closePayoutDraft,
  connectAccount,
  disconnectAccount,
  economyBalances,
  openPayoutDraft,
  requestPayout,
  rewardActivity,
  setPayoutProvider,
} from '../../lib/economyStore.js'

const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const FLAT = { duration: 0 }

const STATUS_COPY = {
  accrued: 'Pending',
  available: 'Available',
  requested: 'Requested',
}

function RewardsPanel({ economy }) {
  const reduced = useReducedMotion()
  const panelId = useId()
  const balances = economyBalances()
  const activity = rewardActivity(6)
  const connected = economy.account.connected

  const [amount, setAmount] = useState(() =>
    formatMoney(balances.availableCents).replace('$', ''),
  )
  const [error, setError] = useState('')
  const draft = economy.payoutDraft
  const detail = reduced ? FLAT : SPRING

  const cancelDraft = () => {
    closePayoutDraft()
    setError('')
  }

  const amountCents = parseBudget(amount, balances.availableCents)

  const handleOpen = () => {
    if (!connected) {
      setError('Connect the demo account before requesting a payout.')
      return
    }
    if (amountCents <= 0 || amountCents > balances.availableCents) {
      setError('Enter an amount between $0.01 and the available balance.')
      return
    }
    setError('')
    openPayoutDraft(amountCents, draft.providerId)
  }

  const handleConfirm = () => {
    const result = requestPayout()
    if (!result) {
      setError('That payout could not be created. Check the amount and try again.')
      return
    }
    setAmount(formatMoney(economyBalances().availableCents).replace('$', ''))
    setError('')
  }

  return (
    <div className="block rewards" id="rewards">
      <SectionHead
        index="03"
        label="User reward"
        title="Pending is visible. Available is spendable. Nothing is real."
        body="The wallet reads from the same ledger the advertiser writes to, so an interaction in the workbench shows up here within a tick — first as pending, then as available."
      />

      <div className="rewards__grid">
        <div className="reward">
          <header className="reward__head">
            <div className="reward__identity">
              <p className="reward__eyebrow">CLIRevenue account</p>
              <p className="reward__handle">{economy.account.handle}</p>
              <p className="reward__org">{economy.account.org} · demo identity</p>
            </div>
            <div className="reward__flags">
              <DemoTag>Simulated balance</DemoTag>
              <span className="reward__state" data-connected={connected ? 'true' : undefined}>
                {connected ? 'Connected' : 'Not connected'}
              </span>
            </div>
          </header>

          <div className="reward__balances">
            <div className="balance balance--primary">
              <span className="balance__label">Available balance</span>
              <span className="balance__value">{formatMoney(balances.availableCents)}</span>
              <span className="balance__hint">withdrawable · demo</span>
            </div>
            <div className="balance">
              <span className="balance__label">Pending rewards</span>
              <span className="balance__value balance__value--sm">
                {formatMoney(balances.pendingCents)}
              </span>
              <span className="balance__hint">settles in 5s</span>
            </div>
            <div className="balance">
              <span className="balance__label">Lifetime earnings</span>
              <span className="balance__value balance__value--sm">
                {formatMoney(balances.lifetimeCents)}
              </span>
              <span className="balance__hint">all time · demo</span>
            </div>
          </div>

          <div className="reward__connect">
            <p className="reward__connect-copy">
              {connected
                ? 'Qualifying interactions now mint rewards against this account. Disconnecting stops accrual immediately; nothing already recorded is lost.'
                : 'Interactions still count for the advertiser. Until an account is connected they simply do not earn.'}
            </p>
            <button
              type="button"
              className={`btn ${connected ? 'btn--ghost' : 'btn--primary'}`}
              aria-pressed={connected}
              onClick={() => (connected ? disconnectAccount() : connectAccount())}
            >
              {connected ? 'Disconnect account' : 'Connect CLIRevenue'}
            </button>
          </div>

          <div className="reward__payout">
            <div className="payout__controls">
              <label className="field field--inline">
                <span className="field__label">Amount (USD)</span>
                <input
                  className="field__input"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value)
                    setError('')
                  }}
                  disabled={!connected || balances.availableCents <= 0}
                  inputMode="decimal"
                />
              </label>
              <label className="field field--inline">
                <span className="field__label">Rail</span>
                <select
                  className="field__input field__input--select"
                  value={draft.providerId}
                  onChange={(event) => setPayoutProvider(event.target.value)}
                  disabled={!connected}
                >
                  {PAYMENT_PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {provider.label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--ghost"
                aria-expanded={draft.open}
                aria-controls={panelId}
                onClick={() => (draft.open ? cancelDraft() : handleOpen())}
                disabled={!connected || balances.availableCents <= 0}
              >
                {draft.open ? 'Cancel' : 'Request payout'}
              </button>
            </div>

            <p className="payout__error" aria-live="assertive">
              {error}
            </p>

            <AnimatePresence initial={false}>
              {draft.open && (
                <motion.div
                  key="confirm"
                  id={panelId}
                  className="payout__panel"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={detail}
                >
                  <div className="payout__panel-inner">
                    <p className="payout__summary">
                      Request <strong>{formatMoney(draft.amountCents)}</strong> through{' '}
                      <strong>
                        {PAYMENT_PROVIDERS.find((p) => p.id === draft.providerId)?.label}
                      </strong>
                      .
                    </p>
                    <p className="payout__rail-note">
                      {PAYMENT_PROVIDERS.find((p) => p.id === draft.providerId)?.status}
                    </p>
                    <div className="payout__actions">
                      <button type="button" className="btn btn--primary" onClick={handleConfirm}>
                        Confirm demo payout
                      </button>
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={cancelDraft}
                      >
                        Keep it
                      </button>
                    </div>
                    <p className="payout__disclaimer">
                      TEST ONLY · no processor is called, no KYC runs, no funds move. This
                      writes a pending record to a local ledger and nothing else.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        <div className="activity">
          <header className="activity__head">
            <h4 className="activity__title">Recent reward activity</h4>
            <span className="activity__note">Demo ledger</span>
          </header>
          <ul className="activity__list">
            {activity.length === 0 && (
              <li className="activity__row activity__row--empty">
                No activity yet. Interact with the sponsored slot in the workbench.
              </li>
            )}
            {activity.map((row) => (
              <li className="activity__row" key={row.id} data-kind={row.kind}>
                <span className="activity__mark" aria-hidden="true" />
                <span className="activity__copy">
                  <span className="activity__name">{row.title}</span>
                  <span className="activity__meta">{row.meta}</span>
                </span>
                <span className="activity__amount" data-sign={row.amountCents < 0 ? 'out' : 'in'}>
                  {formatMoney(row.amountCents, { sign: row.kind === 'reward' })}
                </span>
                <span className="activity__status" data-status={row.status}>
                  {STATUS_COPY[row.status] ?? row.status}
                </span>
              </li>
            ))}
          </ul>
          <p className="activity__foot">
            TEST ONLY · simulated rewards, no real money, no KYC, no payout processing.
          </p>
        </div>
      </div>
    </div>
  )
}

export default RewardsPanel
