import { useState, useEffect, useCallback } from 'react'
import { fetchAdminCampaigns } from '../../lib/adminApi.js'

export default function AdminCampaigns() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await fetchAdminCampaigns()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading campaigns…</div>
  if (error)   return <div className="adm-error">{error}</div>

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Inventory</div>
          <div className="adm-op-header__title">Campaigns</div>
          <div className="adm-op-header__sub">Campaign activity</div>
        </div>
        <div className="adm-op-header__right">
          <div className="adm-status-pill" style={{ color: 'var(--adm-muted)', background: 'rgba(113,113,122,.06)', borderColor: 'rgba(113,113,122,.15)' }}>
            <span className="adm-status-pill__dot" style={{ background: 'var(--adm-muted)' }} />
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-header">
          <span className="adm-table-title">All campaigns</span>
          <span className="adm-table-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Audience</th>
                <th>Budget</th>
                <th>Spend</th>
                <th>Impr.</th>
                <th>Clicks</th>
                <th>Conv.</th>
                <th>Advertiser ID</th>
                <th>Starts</th>
                <th>Ends</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(c => (
                <tr key={c.id}>
                  <td className="adm-mono adm-truncate">{c.name}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="adm-muted">{c.audience_id ?? '—'}</td>
                  <td className="adm-mono">${((c.budget_cents ?? 0) / 100).toFixed(2)}</td>
                  <td className="adm-mono adm-muted">${(((c.spend_milli_cents ?? 0) / 1000) / 100).toFixed(4)}</td>
                  <td className="adm-mono adm-muted">{(c.impressions_count ?? 0).toLocaleString()}</td>
                  <td className="adm-mono adm-muted">{(c.clicks_count ?? 0).toLocaleString()}</td>
                  <td className="adm-mono adm-muted">{(c.conversions_count ?? 0).toLocaleString()}</td>
                  <td className="adm-mono adm-dim adm-truncate">{c.advertiser_id ?? '—'}</td>
                  <td className="adm-muted">{fmtDate(c.starts_at)}</td>
                  <td className="adm-muted">{fmtDate(c.ends_at)}</td>
                  <td className="adm-muted">{fmtDate(c.created_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={12}><div className="adm-empty">No campaigns found.</div></td></tr>}
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
