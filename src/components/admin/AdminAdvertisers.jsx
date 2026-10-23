import { useState, useCallback } from 'react'
import { fetchAdminAdvertisers } from '../../lib/adminApi.js'
import AdminWalletDrawer from './AdminWalletDrawer.jsx'

export default function AdminAdvertisers() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [drawer, setDrawer] = useState(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setRows(await fetchAdminAdvertisers()) }
    catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useState(() => { void load() })

  if (loading) return <div className="adm-loading"><div className="adm-spinner" /> Loading advertisers…</div>
  if (error)   return <div className="adm-error">{error}</div>

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Accounts</div>
          <div className="adm-op-header__title">Advertisers</div>
          <div className="adm-op-header__sub">Advertiser accounts</div>
        </div>
      </div>
      <div className="adm-table-wrap">
        <div className="adm-table-header">
          <span className="adm-table-title">All advertiser accounts</span>
          <span className="adm-table-count">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        </div>
        <div className="adm-table-scroll">
          <table className="adm-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Company</th>
                <th>Contact email</th>
                <th>Profile</th>
                <th>Wallet</th>
                <th>Created</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.id}>
                  <td className="adm-mono adm-dim adm-truncate">{a.id}</td>
                  <td>{a.company_name || '—'}</td>
                  <td className="adm-mono adm-muted">{a.contact_email || '—'}</td>
                  <td className="adm-mono adm-dim adm-truncate">
                    <button
                      type="button"
                      className="adm-profile__link"
                      onClick={() => setDrawer({ profileId: a.profile_id, displayName: a.company_name || a.profile_id })}
                    >
                      {a.profile_id}
                    </button>
                  </td>
                  <td className="adm-wallet__cell">
                    <button
                      type="button"
                      className="btn btn--ghost btn--sm"
                      onClick={() => setDrawer({ profileId: a.profile_id, displayName: a.company_name || a.profile_id })}
                    >
                      Wallet
                    </button>
                  </td>
                  <td className="adm-muted">{fmtDate(a.created_at)}</td>
                  <td className="adm-muted">{fmtDate(a.updated_at)}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7}><div className="adm-empty">No advertisers found.</div></td></tr>}
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
