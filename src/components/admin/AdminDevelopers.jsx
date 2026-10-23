import { useState, useCallback } from 'react'
import { fetchAdminDevelopers } from '../../lib/adminApi.js'
import AdminWalletDrawer from './AdminWalletDrawer.jsx'

export default function AdminDevelopers() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [drawer, setDrawer] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await fetchAdminDevelopers()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useState(() => { void load() })

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading developers…</div>
  if (error)   return <div className="adm-error">{error}</div>

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Accounts</div>
          <div className="adm-op-header__title">Developers</div>
          <div className="adm-op-header__sub">Developer accounts</div>
        </div>
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-header">
          <span className="adm-table-title">All developer accounts</span>
          <span className="adm-table-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Payout provider</th>
                <th>Profile</th>
                <th>Wallet</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(d => {
                const prefs = d.payout_preferences || {}
                return (
                  <tr key={d.id}>
                    <td className="adm-mono adm-dim adm-truncate">{d.id}</td>
                    <td className="adm-muted adm-mono">{prefs.preferred_provider || '—'}</td>
                    <td className="adm-mono adm-dim adm-truncate">
                      <button
                        type="button"
                        className="adm-profile__link"
                        onClick={() => setDrawer({ profileId: d.profile_id, displayName: d.developer_name || d.profile_id })}
                      >
                        {d.profile_id}
                      </button>
                    </td>
                    <td className="adm-wallet__cell">
                      <button
                        type="button"
                        className="btn btn--ghost btn--sm"
                        onClick={() => setDrawer({ profileId: d.profile_id, displayName: d.developer_name || d.profile_id })}
                      >
                        Wallet
                      </button>
                    </td>
                    <td className="adm-muted">{fmtDate(d.created_at)}</td>
                    <td className="adm-muted">{fmtDate(d.updated_at)}</td>
                  </tr>
                )
              })}
              {rows.length === 0 && <tr><td colSpan={6}><div className="adm-empty">No developers found.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {drawer ? (
        <AdminWalletDrawer
          profileId={drawer.profileId}
          displayName={drawer.displayName}
          onClose={() => setDrawer(null)}
        />
      ) : null}
    </div>
  )
}

function fmtDate(iso) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return iso }
}
