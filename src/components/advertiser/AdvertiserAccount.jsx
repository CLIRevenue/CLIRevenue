import { useState } from 'react'
import { AdvError, AdvPageHead } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { useAuth } from '../auth/authState.js'

export default function AdvertiserAccount({ auth }) {
  const shared = useAuth()
  const [notify, setNotify] = useState({ spend: true, status: true, weekly: false })
  const [msg, setMsg] = useState('')
  const [signingOut, setSigningOut] = useState(false)

  async function handleLogout() {
    setMsg('')
    setSigningOut(true)
    try {
      await shared.signOut('/')
    } catch (e) {
      setMsg(e.message || 'Sign out failed.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="adv-page">
      <AdvPageHead
        index="A5"
        label="Advertiser · Account"
        title="Company, access, and preferences."
        body="Identity comes from Supabase Auth and public.profiles. Tokens and service credentials are never displayed here."
      />
      <AdvError message={auth.error} />
      <div className="adv-grid adv-grid--2">
        <Panel className="adv-panel">
          <h4 className="adv-panel__title">Company profile</h4>
          <dl className="adv-detail">
            <div><dt>Company name</dt><dd>{auth.advertiser?.company_name || '— (not set in advertisers table)'}</dd></div>
            <div><dt>Contact email</dt><dd>{auth.advertiser?.contact_email || '—'}</dd></div>
            <div><dt>Account email</dt><dd>{auth.user?.email || '—'}</dd></div>
            <div><dt>Role</dt><dd><span className="adv-pill">{auth.role || 'unknown'}</span></dd></div>
            <div><dt>User ID</dt><dd className="mono adv-id">{auth.user?.id || '—'}</dd></div>
          </dl>
          <p className="form__note">Company editing has no backend endpoint yet, so this view is read-only.</p>
        </Panel>
        <div className="adv-stack">
          <Panel className="adv-panel">
            <h4 className="adv-panel__title">Security</h4>
            <p className="adv-panel__sub">Session is managed by Supabase Auth. No access tokens are shown.</p>
            {msg ? <div className="adv-notice" role="status">{msg}</div> : null}
            <button className="btn btn--primary" type="button" onClick={handleLogout} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Log out'}
            </button>
          </Panel>
          <Panel className="adv-panel">
            <h4 className="adv-panel__title">Notifications</h4>
            <p className="adv-panel__sub">Local-only preferences. No backend endpoint backs these yet.</p>
            {Object.entries({ spend: 'Spend alerts', status: 'Status changes', weekly: 'Weekly summary' }).map(([k, label]) => (
              <label key={k} className="adv-check">
                <input type="checkbox" checked={notify[k]} onChange={(e) => setNotify({ ...notify, [k]: e.target.checked })} />
                <span>{label}</span>
              </label>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}
