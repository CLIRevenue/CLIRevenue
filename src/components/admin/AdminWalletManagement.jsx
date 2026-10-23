import { useCallback, useEffect, useState } from 'react'
import {
  fetchAdminWallets,
  fetchAdminPendingTopups,
  grantCredits,
  confirmTopup,
  rejectTopup,
  applyFreeze,
  releaseFreeze,
  listFreezes,
} from '../../lib/adminApi.js'

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={`adm-tele-card${accent ? ' adm-tele-card--primary' : ''}`}>
      <div className="adm-tele-card__label">{label}</div>
      <div className="adm-tele-card__value">{value ?? '—'}</div>
      {sub && <div className="adm-tele-card__context">{sub}</div>}
    </div>
  )
}

function WalletStatusChip({ frozenAt, frozenReason }) {
  if (frozenAt) {
    return (
      <span className="adm-badge adm-badge--suspended" title={frozenReason || 'Frozen'}>
        Frozen
      </span>
    )
  }
  return <span className="adm-badge adm-badge--enabled">Active</span>
}

function fmtCredits(n) {
  if (n == null) return '—'
  return Number(n).toLocaleString()
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

export default function AdminWalletManagement() {
  const [wallets, setWallets] = useState([])
  const [pendingTopups, setPendingTopups] = useState([])
  const [activeFreezes, setActiveFreezes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [grantLoading, setGrantLoading] = useState(false)
  const [freezeLoading, setFreezeLoading] = useState(false)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [confirmLoading, setConfirmLoading] = useState(new Set())
  const [rejectLoading, setRejectLoading] = useState(new Set())

  const [grantCreditsValue, setGrantCreditsValue] = useState('')
  const [grantProfileId, setGrantProfileId] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [freezeProfileId, setFreezeProfileId] = useState('')
  const [freezeScope, setFreezeScope] = useState('wallet')
  const [freezeReason, setFreezeReason] = useState('')
  const [releaseFreezeId, setReleaseFreezeId] = useState('')
  const [releaseReason, setReleaseReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [walletsData, topupsData, freezesData] = await Promise.all([
        fetchAdminWallets(),
        fetchAdminPendingTopups(),
        listFreezes(null),
      ])
      setWallets(walletsData ?? [])
      setPendingTopups(topupsData ?? [])
      setActiveFreezes((freezesData && freezesData.freezes) ?? [])
    } catch (e) {
      setError(e.status === 403 ? 'Access denied. Admin role required.' : e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      load()
    }, 0)
    return () => clearTimeout(timer)
  }, [load])

  const handleGrant = useCallback(async (event) => {
    event.preventDefault()
    const credits = Number(grantCreditsValue)
    if (!Number.isInteger(credits) || credits <= 0) {
      setError('Enter a whole number of credits.')
      return
    }
    if (!grantProfileId) {
      setError('Enter a profile id.')
      return
    }
    if (!grantReason || grantReason.trim().length < 3) {
      setError('Give a reason (3+ characters).')
      return
    }
    setGrantLoading(true)
    setError('')
    try {
      await grantCredits(grantProfileId, credits, grantReason.trim())
      setGrantCreditsValue('')
      setGrantProfileId('')
      setGrantReason('')
      setError('')
      await load()
    } catch (e) {
      setError('Could not grant credits: ' + (e.message || 'unknown error'))
    } finally {
      setGrantLoading(false)
    }
  }, [grantCreditsValue, grantProfileId, grantReason, load])

  const handleFreeze = useCallback(async (event) => {
    event.preventDefault()
    if (!freezeProfileId) {
      setError('Enter a profile id.')
      return
    }
    if (!freezeReason || freezeReason.trim().length < 3) {
      setError('Give a reason (3+ characters).')
      return
    }
    setFreezeLoading(true)
    setError('')
    try {
      await applyFreeze(freezeProfileId, freezeScope, freezeReason.trim())
      setFreezeProfileId('')
      setFreezeReason('')
      setError('')
      await load()
    } catch (e) {
      setError('Could not apply the freeze: ' + (e.message || 'unknown error'))
    } finally {
      setFreezeLoading(false)
    }
  }, [freezeProfileId, freezeScope, freezeReason, load])

  const handleRelease = useCallback(async (event) => {
    event.preventDefault()
    const freezeId = releaseFreezeId.trim()
    if (!freezeId) {
      setError('Enter a freeze id.')
      return
    }
    if (!releaseReason || releaseReason.trim().length < 3) {
      setError('Give a reason (3+ characters).')
      return
    }
    setReleaseLoading(true)
    setError('')
    try {
      await releaseFreeze(freezeId, releaseReason.trim())
      setReleaseFreezeId('')
      setReleaseReason('')
      setError('')
      await load()
    } catch (e) {
      setError('Could not release the freeze: ' + (e.message || 'unknown error'))
    } finally {
      setReleaseLoading(false)
    }
  }, [releaseFreezeId, releaseReason, load])

  const handleConfirm = useCallback(async (topupId) => {
    setConfirmLoading((prev) => new Set(prev).add(topupId))
    try {
      await confirmTopup(topupId, null)
      await load()
    } catch (e) {
      setError('Could not confirm top-up: ' + (e.message || 'unknown error'))
    } finally {
      setConfirmLoading((prev) => { const next = new Set(prev); next.delete(topupId); return next })
    }
  }, [load])

  const handleReject = useCallback(async (topupId) => {
    const reason = window.prompt('Reason for rejecting this top-up:')
    if (!reason || reason.trim().length < 3) {
      setError('A reason (3+ characters) is required to reject.')
      return
    }
    setRejectLoading((prev) => new Set(prev).add(topupId))
    try {
      await rejectTopup(topupId, reason.trim())
      await load()
    } catch (e) {
      setError('Could not reject top-up: ' + (e.message || 'unknown error'))
    } finally {
      setRejectLoading((prev) => { const next = new Set(prev); next.delete(topupId); return next })
    }
  }, [load])

  const totalBalance = wallets.reduce((sum, w) => sum + (Number(w.balanceCredits) || 0), 0)
  const totalReserved = wallets.reduce((sum, w) => sum + (Number(w.reservedCredits) || 0), 0)
  const frozenCount = wallets.filter((w) => w.frozenAt).length
  const pendingCount = pendingTopups.length

  if (loading) {
    return (
      <div>
        <div className="adm-page-title">Wallet Management</div>
        <h2 className="adm-page-heading">Wallet Management</h2>
        <div className="adm-loading"><div className="adm-spinner" /> Loading…</div>
      </div>
    )
  }

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Operations</div>
          <div className="adm-op-header__title">Wallet Management</div>
          <div className="adm-op-header__sub">Credit balances, top-ups, grants and freezes across every advertiser and developer account</div>
        </div>
        <div className="adm-op-header__right">
          {error ? (
            <div className="adm-error">{error}</div>
          ) : null}
        </div>
      </div>

      <div className="adm-telemetry">
        <StatCard label="Wallets on platform" value={wallets.length.toLocaleString()} sub="Advertiser + developer accounts" />
        <StatCard label="Total balance" value={fmtCredits(totalBalance)} sub="Credits held across all wallets" accent />
        <StatCard label="Reserved" value={fmtCredits(totalReserved)} sub="Held by active campaign budgets" />
        <StatCard label="Frozen wallets" value={frozenCount.toLocaleString()} sub="Cannot move credits" />
        <StatCard label="Pending top-ups" value={pendingCount.toLocaleString()} sub="Awaiting staff confirm / reject" accent />
      </div>

      {error && <div className="adm-error">{error}</div>}

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">All wallets</div>
          <div className="adm-section__subtitle">Balance, reservation and freeze state per account</div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Role</th>
                <th className="adm-mono">Balance</th>
                <th className="adm-mono">Reserved</th>
                <th className="adm-mono">Status</th>
                <th className="adm-mono">Frozen at</th>
              </tr>
            </thead>
            <tbody>
              {wallets.length === 0 ? (
                <tr><td colSpan={6}><div className="adm-empty">No wallets found.</div></td></tr>
              ) : (
                wallets.map((w) => (
                  <tr key={w.profileId}>
                    <td className="adm-mono adm-truncate" title={w.fullName || w.profileId}>
                      {w.fullName || w.profileId}
                    </td>
                    <td className="adm-muted">{w.role || '—'}</td>
                    <td className="adm-mono">{fmtCredits(w.balanceCredits)}</td>
                    <td className="adm-mono">{fmtCredits(w.reservedCredits)}</td>
                    <td><WalletStatusChip frozenAt={w.frozenAt} frozenReason={w.frozenReason} /></td>
                    <td className="adm-muted">{fmtDate(w.frozenAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Pending top-ups</div>
          <div className="adm-section__subtitle">Claims awaiting staff confirm or reject</div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="adm-mono">Amount</th>
                <th className="adm-mono">Credits</th>
                <th>Payer</th>
                <th className="adm-mono">Method</th>
                <th className="adm-mono">Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {pendingTopups.length === 0 ? (
                <tr><td colSpan={7}><div className="adm-empty">No pending top-ups.</div></td></tr>
              ) : (
                pendingTopups.map((t) => (
                  <tr key={t.id}>
                    <td className="adm-mono adm-truncate" title={t.fullName || t.profileId}>
                      {t.fullName || t.profileId}
                    </td>
                    <td className="adm-mono">{fmtCredits(t.amountMinor / 100)} {t.currency}</td>
                    <td className="adm-mono">{fmtCredits(t.credits)}</td>
                    <td className="adm-muted">{t.payerName || '—'}</td>
                    <td className="adm-muted">{t.paymentMethod || '—'}</td>
                    <td className="adm-muted">{fmtDate(t.createdAt)}</td>
                    <td>
                      <div className="adm-page__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={confirmLoading.has(t.id)}
                          onClick={() => handleConfirm(t.id)}
                        >
                          {confirmLoading.has(t.id) ? '…' : 'Confirm'}
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={rejectLoading.has(t.id)}
                          onClick={() => handleReject(t.id)}
                        >
                          {rejectLoading.has(t.id) ? '…' : 'Reject'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Active freezes</div>
          <div className="adm-section__subtitle">Releasing restores the account's previous scope</div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Scope</th>
                <th>Reason</th>
                <th className="adm-mono">Frozen at</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeFreezes.length === 0 ? (
                <tr><td colSpan={5}><div className="adm-empty">No active freezes.</div></td></tr>
              ) : (
                activeFreezes.map((f) => (
                  <tr key={f.id}>
                    <td className="adm-mono adm-truncate">{f.profile_id}</td>
                    <td className="adm-muted">{f.scope}</td>
                    <td className="adm-muted">{f.reason}</td>
                    <td className="adm-muted">{fmtDate(f.frozen_at)}</td>
                    <td>
                      <div className="adm-page__actions">
                        <button
                          type="button"
                          className="btn btn--ghost btn--sm"
                          disabled={releaseLoading}
                          onClick={() => {
                            setReleaseFreezeId(f.id)
                          }}
                        >
                          Release
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Grant credits</div>
          <div className="adm-section__subtitle">Whole credits only. Capped per person per calendar month.</div>
        </div>
        <form className="adm-wallet-drawer__form" onSubmit={handleGrant}>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Profile id</span>
            <input
              name="profile_id"
              className="adm-wallet-drawer__input"
              value={grantProfileId}
              onChange={(e) => setGrantProfileId(e.target.value)}
              placeholder="Profile UUID"
              required
            />
          </label>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Credits</span>
            <input
              type="number"
              name="credits"
              min="1"
              step="1"
              className="adm-wallet-drawer__input"
              value={grantCreditsValue}
              onChange={(e) => setGrantCreditsValue(e.target.value)}
              required
            />
          </label>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Reason</span>
            <textarea
              name="reason"
              className="adm-wallet-drawer__input"
              rows="2"
              value={grantReason}
              onChange={(e) => setGrantReason(e.target.value)}
              placeholder="Why is this credit being granted?"
              required
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={grantLoading}>
            {grantLoading ? 'Granting…' : 'Grant credits'}
          </button>
        </form>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Apply freeze</div>
          <div className="adm-section__subtitle">Scope: account blocks everything, wallet blocks credit movement, keys blocks publisher authentication.</div>
        </div>
        <form className="adm-wallet-drawer__form" onSubmit={handleFreeze}>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Profile id</span>
            <input
              name="profile_id"
              className="adm-wallet-drawer__input"
              value={freezeProfileId}
              onChange={(e) => setFreezeProfileId(e.target.value)}
              placeholder="Profile UUID"
              required
            />
          </label>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Scope</span>
            <select
              name="scope"
              className="adm-wallet-drawer__input"
              value={freezeScope}
              onChange={(e) => setFreezeScope(e.target.value)}
            >
              <option value="wallet">Wallet</option>
              <option value="account">Account</option>
              <option value="keys">Publisher keys</option>
            </select>
          </label>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Reason</span>
            <textarea
              name="reason"
              className="adm-wallet-drawer__input"
              rows="2"
              value={freezeReason}
              onChange={(e) => setFreezeReason(e.target.value)}
              placeholder="Why is this account being frozen?"
              required
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={freezeLoading}>
            {freezeLoading ? 'Freezing…' : 'Apply freeze'}
          </button>
        </form>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Release a freeze</div>
          <div className="adm-section__subtitle">Enter the freeze id from the active freezes list above.</div>
        </div>
        <form className="adm-wallet-drawer__form" onSubmit={handleRelease}>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Freeze id</span>
            <input
              name="freeze_id"
              className="adm-wallet-drawer__input"
              value={releaseFreezeId}
              onChange={(e) => setReleaseFreezeId(e.target.value)}
              placeholder="Freeze identifier"
              required
            />
          </label>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Reason</span>
            <textarea
              name="reason"
              className="adm-wallet-drawer__input"
              rows="2"
              value={releaseReason}
              onChange={(e) => setReleaseReason(e.target.value)}
              placeholder="Why is this freeze being released?"
              required
            />
          </label>
          <button type="submit" className="btn btn--primary" disabled={releaseLoading}>
            {releaseLoading ? 'Releasing…' : 'Release freeze'}
          </button>
        </form>
      </div>
    </div>
  )
}
