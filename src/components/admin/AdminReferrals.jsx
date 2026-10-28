import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  fetchReferralAdminList,
  fetchReferralConfig,
  reverseReferral,
  updateReferralConfig,
} from '../../lib/referralApi.js'

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}

function mask(id) {
  if (!id) return '—'
  const s = String(id)
  return s.slice(0, 6) + '…' + s.slice(-4)
}

function StatusChip({ status }) {
  const tone = {
    pending: 'adm-status-pill--muted',
    qualified: 'adm-status-pill--muted',
    rewarded: 'adm-status-pill--amber',
    rejected: 'adm-badge--suspended',
    reversed: 'adm-badge--suspended',
  }[status] || 'adm-status-pill--muted'
  return <span className={`adm-badge ${tone}`}>{status}</span>
}

export default function AdminReferrals() {
  const [referrals, setReferrals] = useState([])
  const [config, setConfig] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterReferrer, setFilterReferrer] = useState('')
  const [filterReferred, setFilterReferred] = useState('')
  const [reverseLoading, setReverseLoading] = useState(new Set())
  const [reverseReason, setReverseReason] = useState('')
  const [reverseTarget, setReverseTarget] = useState(null)

  const counts = useMemo(() => {
    const tallied = { pending: 0, qualified: 0, rewarded: 0, rejected: 0, reversed: 0 }
    for (const r of referrals) {
      const key = r.status
      if (Object.hasOwn(tallied, key)) tallied[key] += 1
    }
    return tallied
  }, [referrals])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [listData, configData] = await Promise.all([
        fetchReferralAdminList({
          status: filterStatus || undefined,
          referrerId: filterReferrer || undefined,
          referredId: filterReferred || undefined,
        }),
        fetchReferralConfig(),
      ])
      setReferrals(listData?.referrals ?? [])
      setConfig(configData?.config ?? [])
    } catch (err) {
      setError(err.message || 'Could not load referrals.')
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterReferrer, filterReferred])

  useEffect(() => {
    const fetchData = async () => {
      await load()
    }
    void fetchData()
  }, [load])

  const configByKey = useMemo(() => {
    const out = {}
    for (const c of config) out[c.key] = c
    return out
  }, [config])

  const handleReverse = useCallback(async (event) => {
    event.preventDefault()
    if (!reverseTarget || !reverseReason.trim()) return
    setReverseLoading((prev) => new Set([...prev, reverseTarget]))
    try {
      await reverseReferral(reverseTarget, reverseReason.trim())
      setReverseReason('')
      setReverseTarget(null)
      void load()
    } catch (err) {
      setError(err.message || 'Reversal failed.')
    } finally {
      setReverseLoading((prev) => { const next = new Set(prev); next.delete(reverseTarget); return next })
    }
  }, [reverseTarget, reverseReason, load])

  const handleConfigUpdate = useCallback(async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const key = form.elements.config_key.value.trim()
    const raw = form.elements.config_value.value.trim()
    if (!key || !raw) return
    let value
    try { value = JSON.parse(raw) } catch { value = raw }
    try {
      await updateReferralConfig(key, value)
      form.reset()
      void load()
    } catch (err) {
      setError(err.message || 'Config update failed.')
    }
  }, [load])

  return (
    <div className="adm-panel adm-referrals">
      <div className="adm-panel__head">
        <h2 className="adm-panel__title">Referral management</h2>
        <p className="adm-panel__sub">Approve, reverse, and inspect advertiser referrals. Rewards are promotional credits, not cash.</p>
      </div>

      {error ? <div className="adm-note adm-note--error" role="alert">{error}</div> : null}

      <div className="adm-referrals__config">
        <h3 className="adm-referrals__config-title">Program configuration</h3>
        <form className="adm-form" onSubmit={handleConfigUpdate} noValidate>
          <label className="adm-field">
            <span className="adm-field__label">Referrer reward (credits)</span>
            <input name="config_key" value="referrer_reward_credits" readOnly className="adm-field__input" />
            <input name="config_value" type="number" min="0" defaultValue={configByKey.referrer_reward_credits?.value_json?.credits ?? 150} className="adm-field__input" />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Referred reward (credits)</span>
            <input name="config_key" value="referred_reward_credits" readOnly className="adm-field__input" />
            <input name="config_value" type="number" min="0" defaultValue={configByKey.referred_reward_credits?.value_json?.credits ?? 150} className="adm-field__input" />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Min eligible funding (minor units)</span>
            <input name="config_key" value="min_funding_amount_minor" readOnly className="adm-field__input" />
            <input name="config_value" type="number" min="0" defaultValue={configByKey.min_funding_amount_minor?.value_json?.minor ?? 100000} className="adm-field__input" />
          </label>
          <label className="adm-field">
            <span className="adm-field__label">Max successful referrals</span>
            <input name="config_key" value="max_successful_referrals" readOnly className="adm-field__input" />
            <input name="config_value" type="number" min="0" defaultValue={configByKey.max_successful_referrals?.value_json?.max ?? 3} className="adm-field__input" />
          </label>
          <button type="submit" className="btn btn--primary">Save configuration</button>
        </form>
      </div>

      <div className="adm-referrals__toolbar">
        <label className="adm-field">
          <span className="adm-field__label">Status</span>
          <select name="status" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} className="adm-field__input">
            <option value="">All</option>
            <option value="pending">Pending signup</option>
            <option value="qualified">Awaiting funding</option>
            <option value="rewarded">Successful</option>
            <option value="rejected">Rejected</option>
            <option value="reversed">Reversed</option>
          </select>
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Referrer id</span>
          <input name="referrer_id" value={filterReferrer} onChange={(e) => setFilterReferrer(e.target.value)} className="adm-field__input" placeholder="…" />
        </label>
        <label className="adm-field">
          <span className="adm-field__label">Referred id</span>
          <input name="referred_id" value={filterReferred} onChange={(e) => setFilterReferred(e.target.value)} className="adm-field__input" placeholder="…" />
        </label>
        <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Refresh</button>
      </div>

      <div className="adm-referrals__stats">
        <div className="adm-stat"><span className="adm-stat__label">Successful</span><span className="adm-stat__value">{counts.rewarded}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Pending</span><span className="adm-stat__value">{counts.pending}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Rejected</span><span className="adm-stat__value">{counts.rejected}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Reversed</span><span className="adm-stat__value">{counts.reversed}</span></div>
      </div>

      {loading ? (
        <div className="adm-note">Loading referrals…</div>
      ) : referrals.length === 0 ? (
        <div className="adm-note adm-note--muted">No referrals match the current filters.</div>
      ) : (
        <table className="adm-table">
          <thead>
            <tr>
              <th>Referral id</th>
              <th>Referrer</th>
              <th>Referred</th>
              <th>Status</th>
              <th>Qualifying top-up</th>
              <th>Qualified at</th>
              <th>Rewarded at</th>
              <th>Reversal reason</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {referrals.map((r) => (
              <tr key={r.id} className="adm-table__row">
                <td className="mono">{mask(r.id)}</td>
                <td className="mono">{mask(r.referrer_profile_id)}</td>
                <td className="mono">{mask(r.referred_profile_id)}</td>
                <td><StatusChip status={r.status} /></td>
                <td className="mono">{mask(r.qualifying_topup_id)}</td>
                <td>{fmtDate(r.qualified_at)}</td>
                <td>{fmtDate(r.rewarded_at)}</td>
                <td>{r.reversal_reason || '—'}</td>
                <td>
                  {r.status === 'rewarded' ? (
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      disabled={reverseLoading.has(r.id)}
                      onClick={(event) => {
                        event.preventDefault()
                        setReverseTarget(r.id)
                      }}
                    >
                      {reverseLoading.has(r.id) ? 'Reversing…' : 'Reverse'}
                    </button>
                  ) : null}
                  {reverseTarget === r.id ? (
                    <>
                      <input name="reason" value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} className="adm-field__input" placeholder="Reason" />
                      <button type="button" className="btn btn--primary btn--sm" onClick={handleReverse}>Confirm</button>
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setReverseTarget(null); setReverseReason('') }}>Cancel</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
