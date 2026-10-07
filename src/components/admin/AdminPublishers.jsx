import { useState, useEffect, useCallback } from 'react'
import { fetchAdminPublishers } from '../../lib/adminApi.js'

export default function AdminPublishers() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await fetchAdminPublishers()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading publishers…</div>
  if (error)   return <div className="adm-error">{error}</div>

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Infrastructure</div>
          <div className="adm-op-header__title">Publishers</div>
          <div className="adm-op-header__sub">Publisher inventory</div>
        </div>
      </div>
      <div className="adm-note adm-note--lead">
        Raw publisher keys are never displayed. Only safe identifying metadata is shown.
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-header">
          <span className="adm-table-title">All publishers</span>
          <span className="adm-table-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Status</th>
                <th>Owner profile ID</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => (
                <tr key={p.id}>
                  <td className="adm-mono adm-dim adm-truncate">{p.id}</td>
                  <td>{p.name}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="adm-mono adm-dim adm-truncate">{p.owner_profile_id || '—'}</td>
                  <td className="adm-muted">{fmtDate(p.created_at)}</td>
                  <td className="adm-muted">{fmtDate(p.updated_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6}><div className="adm-empty">No publishers found.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }) {
  return <span className={`adm-badge adm-badge--${status ?? 'draft'}`}>{status ?? 'unknown'}</span>
}
function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
