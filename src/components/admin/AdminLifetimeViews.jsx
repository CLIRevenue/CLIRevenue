import { useState, useEffect, useCallback } from 'react'
import { fetchAdminOverview } from '../../lib/adminApi.js'

export default function AdminLifetimeViews() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminOverview()
      setData(result)
    } catch (e) {
      setError(e.status === 403 ? 'Access denied. Admin role required.' : e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Lifetime Views</h2>
        <div className="adm-loading"><div className="adm-spinner" /> Loading…</div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Lifetime Views</h2>
        <div className="adm-error">{error}</div>
      </div>
    )
  }
  if (!data) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Lifetime Views</h2>
        <div className="adm-empty"><div className="adm-empty__label">No data</div>Server returned no overview.</div>
      </div>
    )
  }

  const { pageViews, totalLifetimeViews } = data

  return (
    <div className="adm-lifetime-views-page">
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Operations</div>
          <div className="adm-op-header__title">Lifetime Views</div>
          <div className="adm-op-header__sub">Per-page lifetime view counts</div>
        </div>
      </div>

      <div className="adm-telemetry">
        <div className="adm-tele-card adm-tele-card--primary">
          <div className="adm-tele-card__label">Total Lifetime Views</div>
          <div className="adm-tele-card__value">{totalLifetimeViews?.toLocaleString() ?? '—'}</div>
          <div className="adm-tele-card__context">All pages combined</div>
        </div>
      </div>

      <div className="adm-section">
        <div className="adm-section__header">
          <div className="adm-section__title">Views by Page</div>
          <div className="adm-section__subtitle">Lifetime page view breakdown</div>
        </div>
        <div className="adm-table-wrap">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Page</th>
                <th className="adm-mono">Lifetime Views</th>
                <th>First Seen</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              {(pageViews || []).map((pv, idx) => (
                <tr key={idx}>
                  <td className="adm-mono adm-truncate">{pv.path}</td>
                  <td className="adm-mono">{pv.view_count.toLocaleString()}</td>
                  <td className="adm-muted">{pv.first_seen_at ? new Date(pv.first_seen_at).toLocaleDateString() : '—'}</td>
                  <td className="adm-muted">{pv.last_seen_at ? new Date(pv.last_seen_at).toLocaleDateString() : '—'}</td>
                </tr>
              ))}
              {(!pageViews || pageViews.length === 0) && (
                <tr>
                  <td colSpan="4"><div className="adm-empty">No page views recorded yet.</div></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}