import { useState, useEffect, useCallback } from 'react'
import { fetchAdminSystemStatus } from '../../lib/adminApi.js'

export default function AdminSystem() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setStatus(await fetchAdminSystemStatus()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Checking system…</div>
  if (error)   return <div className="adm-error">{error}</div>
  if (!status) return <div className="adm-empty">No system data.</div>

  const entries = Object.entries(status).filter(([k]) => k !== 'checkedAt')

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Platform</div>
          <div className="adm-op-header__title">System Status</div>
          <div className="adm-op-header__sub">Infrastructure health</div>
        </div>
        <div className="adm-op-header__right">
          <div className="adm-status-pill">
            <span className="adm-status-pill__dot" />
            {entries.every(([, s]) => s.ok) ? 'Operational' : 'Degraded'}
          </div>
        </div>
      </div>
      <div className="adm-system-strip">
        {entries.map(([key, s]) => (
          <div className="adm-system-chip" key={key}>
            <div className="adm-system-chip__label">{key}</div>
            <div className="adm-health">
              <span className={`adm-health__dot adm-health__dot--${s.ok ? 'ok' : 'fail'}`} />
              <span className="adm-system-chip__value">{s.detail}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="adm-muted" style={{ marginTop: 14, fontSize: 10, fontFamily: 'var(--adm-mono)', letterSpacing: '.04em' }}>
        Last checked: {status.checkedAt ? new Date(status.checkedAt).toLocaleString() : '—'}
      </div>
    </div>
  )
}
