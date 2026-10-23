import { useCallback, useState } from 'react'
import {
  grantCredits,
  applyFreeze,
  releaseFreeze,
  listFreezes,
} from '../../lib/adminApi.js'

function AdminWalletDrawer({ profileId, displayName, onClose }) {
  const [freezes, setFreezes] = useState({ freezes: [], count: 0 })
  const [grantLoading, setGrantLoading] = useState(false)
  const [freezeLoading, setFreezeLoading] = useState(false)
  const [releaseLoading, setReleaseLoading] = useState(false)
  const [error, setError] = useState('')
  const [grantCreditsValue, setGrantCreditsValue] = useState('')
  const [grantReason, setGrantReason] = useState('')
  const [freezeScope, setFreezeScope] = useState('wallet')
  const [freezeReason, setFreezeReason] = useState('')
  const [releaseReason, setReleaseReason] = useState('')
  const [freezeIdToRelease, setFreezeIdToRelease] = useState('')

  const loadFreezes = useCallback(async () => {
    try {
      const data = await listFreezes(profileId)
      setFreezes(data ?? { freezes: [], count: 0 })
    } catch {
      // Freezes may not exist yet for a profile; an empty list is honest.
      setFreezes({ freezes: [], count: 0 })
    }
  }, [profileId])

  useState(() => { void loadFreezes() })

  const handleGrant = useCallback(async (event) => {
    event.preventDefault()
    const credits = Number(grantCreditsValue)
    if (!Number.isInteger(credits) || credits <= 0) {
      setError('Enter a whole number of credits.')
      return
    }
    if (!grantReason || grantReason.trim().length < 3) {
      setError('Give a reason (3+ characters).')
      return
    }
    setGrantLoading(true)
    setError('')
    try {
      await grantCredits(profileId, credits, grantReason.trim())
      setGrantCreditsValue('')
      setGrantReason('')
      setError('')
    } catch {
      setError('Could not grant credits.')
    } finally {
      setGrantLoading(false)
    }
  }, [profileId, grantCreditsValue, grantReason])

  const handleFreeze = useCallback(async (event) => {
    event.preventDefault()
    if (!freezeReason || freezeReason.trim().length < 3) {
      setError('Give a reason (3+ characters).')
      return
    }
    setFreezeLoading(true)
    setError('')
    try {
      await applyFreeze(profileId, freezeScope, freezeReason.trim())
      setFreezeReason('')
      setError('')
      void loadFreezes()
    } catch {
      setError('Could not apply the freeze.')
    } finally {
      setFreezeLoading(false)
    }
  }, [profileId, freezeScope, freezeReason, loadFreezes])

  const handleRelease = useCallback(async (event) => {
    event.preventDefault()
    const freezeId = freezeIdToRelease.trim()
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
      setFreezeIdToRelease('')
      setReleaseReason('')
      setError('')
      void loadFreezes()
    } catch {
      setError('Could not release the freeze.')
    } finally {
      setReleaseLoading(false)
    }
  }, [freezeIdToRelease, releaseReason, loadFreezes])

  return (
    <div className="adm-wallet-drawer">
      <div className="adm-wallet-drawer__head">
        <span className="adm-wallet-drawer__title">Wallet controls · {displayName || profileId}</span>
        <button className="adm-wallet-drawer__close" type="button" onClick={onClose}>Close</button>
      </div>

      {error ? <div className="adm-wallet-drawer__error">{error}</div> : null}

      <div className="adm-wallet-drawer__section">
        <h4 className="adm-wallet-drawer__section-title">Grant credits</h4>
        <p className="adm-wallet-drawer__section-sub">Whole credits only. Capped per person per calendar month.</p>
        <form className="adm-wallet-drawer__form" onSubmit={handleGrant}>
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

      <div className="adm-wallet-drawer__section">
        <h4 className="adm-wallet-drawer__section-title">Freeze</h4>
        <p className="adm-wallet-drawer__section-sub">Scope: account blocks everything, wallet blocks credit movement, keys blocks publisher authentication.</p>
        <form className="adm-wallet-drawer__form" onSubmit={handleFreeze}>
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

      <div className="adm-wallet-drawer__section">
        <h4 className="adm-wallet-drawer__section-title">Active freezes</h4>
        <p className="adm-wallet-drawer__section-sub">Releasing a freeze restores the account's previous scope.</p>
        {freezes.freezes.length === 0 ? (
          <p className="adm-wallet-drawer__empty">No active freezes.</p>
        ) : (
          <ul className="adm-wallet-drawer__freeze-list">
            {freezes.freezes.map((f) => (
              <li key={f.id} className="adm-wallet-drawer__freeze-row">
                <span className="adm-wallet-drawer__freeze-scope">{f.scope}</span>
                <span className="adm-wallet-drawer__freeze-reason">{f.reason}</span>
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    /* Release is handled by a separate confirmation below the list. */
                  }}
                  disabled={true}
                >
                  Release
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="adm-wallet-drawer__section">
        <h4 className="adm-wallet-drawer__section-title">Release a freeze</h4>
        <p className="adm-wallet-drawer__section-sub">Enter the freeze id from the active freezes list above.</p>
        <form className="adm-wallet-drawer__form" onSubmit={handleRelease}>
          <label className="adm-wallet-drawer__field">
            <span className="adm-wallet-drawer__label">Freeze id</span>
            <input
              name="freeze_id"
              className="adm-wallet-drawer__input"
              value={freezeIdToRelease}
              onChange={(e) => setFreezeIdToRelease(e.target.value)}
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

export default AdminWalletDrawer
