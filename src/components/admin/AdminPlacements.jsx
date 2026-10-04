import { useState, useEffect, useCallback } from 'react'
import { fetchAdminPlacements } from '../../lib/adminApi.js'

export default function AdminPlacements() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await fetchAdminPlacements()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading placements…</div>
  if (error)   return <div className="adm-error">{error}</div>

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Infrastructure</div>
          <div className="adm-op-header__title">Placements</div>
          <div className="adm-op-header__sub">Placement inventory</div>
        </div>
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-header">
          <span className="adm-table-title">All placements</span>
          <span className="adm-table-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Key</th>
                <th>Name</th>
                <th>Enabled</th>
                <th>Audience</th>
                <th>Publisher ID</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="adm-mono adm-dim adm-truncate">{p.id}</td>
                  <td className="adm-mono">{p.placement_key}</td>
                  <td>{p.name || '—'}</td>
                  <td><EnabledBadge enabled={p.enabled} /></td>
                  <td className="adm-muted">{p.allowed_audience_id || 'any'}</td>
                  <td className="adm-mono adm-dim adm-truncate">{p.publisher_id}</td>
                  <td className="adm-muted">{fmtDate(p.created_at)}</td>
                  <td className="adm-muted">{fmtDate(p.updated_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8}><div className="adm-empty">No placements found.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function EnabledBadge({ enabled }) {
  return <span className={`adm-badge adm-badge--${enabled ? 'enabled' : 'disabled'}`}>{enabled ? 'Enabled' : 'Disabled'}</span>
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
