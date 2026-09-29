import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdvError, AdvLoading, AdvPageHead } from './AdvertiserUI.jsx'
import { Panel } from '../console/ui.jsx'
import { useAuth } from '../auth/authState.js'
import {
  ACCOUNT_COLUMN_GROUPS,
  changePassword,
  deleteOwnAccount,
  fetchAccountBundle,
  saveAccountProfile,
} from '../../lib/accountApi.js'

/* ----------------------------------------------------------------
   Shared account page for both roles. Sections:
   PROFILE · COMPANY|DEVELOPER · SECURITY · PREFERENCES · DANGER ZONE
   All data comes from the database (fetchAccountBundle); all writes
   are owner-scoped RLS updates. No fabricated values anywhere.
   ---------------------------------------------------------------- */

const PROFILE_LABELS = {
  full_name: 'Full name',
  phone: 'Phone',
  address: 'Address',
  city: 'City',
  state: 'State / region',
  country: 'Country',
}

const ADVERTISER_LABELS = {
  company_name: 'Company name',
  company_website: 'Company website',
  company_description: 'Company description',
  company_size: 'Company size',
  industry: 'Industry',
  hear_about_us: 'How did you hear about us?',
}

const DEVELOPER_LABELS = {
  developer_name: 'Developer / studio name',
  developer_type: 'Developer type',
  website: 'Website',
  apps_description: 'Apps / products description',
  app_count: 'Approximate app count',
  platforms: 'Platforms used',
  experience_level: 'Experience level',
  hear_about_us: 'How did you hear about us?',
}

const COMPANY_AREA_FIELDS = new Set(['company_description'])
const DEVELOPER_AREA_FIELDS = new Set(['apps_description'])
const DEVELOPER_URL_FIELDS = new Set(['website'])
const ADVERTISER_URL_FIELDS = new Set(['company_website'])

function emptyForm(names) {
  return Object.fromEntries(names.map((n) => [n, '']))
}

function rowsToForm(row, names) {
  const out = emptyForm(names)
  if (!row) return out
  for (const n of names) {
    if (row[n] === null || row[n] === undefined) continue
    out[n] = String(row[n])
  }
  return out
}

function diffPatch(initial, current, names) {
  const patch = {}
  for (const n of names) {
    const a = (initial[n] || '').trim()
    const b = (current[n] || '').trim()
    if (a !== b) patch[n] = b
  }
  return patch
}

function Field({ name, label, value, onChange, area, url, type = 'text' }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {area ? (
        <textarea
          className="field__input field__input--area"
          rows={3}
          name={name}
          value={value}
          onChange={onChange}
        />
      ) : (
        <input
          className="field__input"
          name={name}
          type={url ? 'url' : type}
          inputMode={url ? 'url' : undefined}
          value={value}
          onChange={onChange}
          autoComplete={name === 'phone' ? 'tel' : 'off'}
        />
      )}
    </label>
  )
}

function SaveBar({ dirty, saving, savedAt, onSave, error }) {
  return (
    <div className="account-savebar">
      <button className="btn btn--primary" type="button" onClick={onSave} disabled={!dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
      </button>
      {savedAt && !dirty ? <span className="account-saved-at">Saved just now</span> : null}
      {error ? <span className="form__error" role="alert">{error}</span> : null}
    </div>
  )
}

/* ---------------- password change ---------------- */

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [state, setState] = useState({ busy: false, error: '', ok: '' })

  const errors = useMemo(() => {
    if (!attempted) return {}
    const e = {}
    if (!current) e.current = 'Enter your current password.'
    if (!next) e.next = 'Enter a new password.'
    else if (next.length < 6) e.next = 'At least 6 characters.'
    else if (next === current) e.next = 'New password must differ from the current one.'
    if (!confirm) e.confirm = 'Confirm the new password.'
    else if (next && confirm !== next) e.confirm = 'Passwords do not match.'
    return e
  }, [attempted, current, next, confirm])

  const valid = Object.keys(errors).length === 0

  async function onSubmit(e) {
    e.preventDefault()
    setAttempted(true)
    setState({ busy: false, error: '', ok: '' })
    if (Object.keys(errors).length) return
    setState({ busy: true, error: '', ok: '' })
    try {
      await changePassword({ currentPassword: current, newPassword: next })
      setCurrent('')
      setNext('')
      setConfirm('')
      setAttempted(false)
      setState({ busy: false, error: '', ok: 'Password changed.' })
    } catch (err) {
      setState({ busy: false, error: err.message || 'Could not change password.', ok: '' })
    }
  }

  return (
    <Panel className="adv-panel">
      <h4 className="adv-panel__title">Change password</h4>
      <p className="adv-panel__sub">
        Verified against your current password, then updated through Supabase Auth. Nothing is stored locally.
      </p>
      <form className="form adv-form" onSubmit={onSubmit} noValidate>
        <label className="field">
          <span className="field__label">Current password</span>
          <input className="field__input" type="password" name="currentPassword" value={current} onChange={(e) => { setCurrent(e.target.value); setAttempted(false); setState({ busy: false, error: '', ok: '' }) }} autoComplete="current-password" />
          {errors.current ? <span className="adv-field-error">{errors.current}</span> : null}
        </label>
        <div className="field-row">
          <label className="field">
            <span className="field__label">New password</span>
            <input className="field__input" type="password" name="newPassword" value={next} onChange={(e) => { setNext(e.target.value); setAttempted(false); setState({ busy: false, error: '', ok: '' }) }} autoComplete="new-password" />
            {errors.next ? <span className="adv-field-error">{errors.next}</span> : null}
          </label>
          <label className="field">
            <span className="field__label">Confirm new password</span>
            <input className="field__input" type="password" name="confirmNewPassword" value={confirm} onChange={(e) => { setConfirm(e.target.value); setAttempted(false); setState({ busy: false, error: '', ok: '' }) }} autoComplete="new-password" />
            {errors.confirm ? <span className="adv-field-error">{errors.confirm}</span> : null}
          </label>
        </div>
        {state.error ? <div className="adv-notice adv-notice--error" role="alert">{state.error}</div> : null}
        {state.ok ? <div className="adv-notice" role="status">{state.ok}</div> : null}
        <button className="btn btn--primary" type="submit" disabled={state.busy || (attempted && !valid)}>
          {state.busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </Panel>
  )
}

/* ---------------- danger zone + modal ---------------- */

function DeleteModal({ busy, error, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('')
  const [understood, setUnderstood] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const armed = typed.trim().toUpperCase() === 'DELETE' && understood && !busy

  return (
    <div className="dangertz-overlay" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="dangertz-modal" role="dialog" aria-modal="true" aria-labelledby="dangertz-title">
        <h4 className="adv-panel__title" id="dangertz-title">Delete this account permanently?</h4>
        <p className="block__body">
          This removes your sign-in, profile, and role data. Records that must survive for the
          economic ledger (campaign delivery and reward history) are detached, not erased. This
          cannot be undone.
        </p>
        <label className="field">
          <span className="field__label">Type DELETE to confirm</span>
          <input
            ref={inputRef}
            className="field__input"
            name="confirmDelete"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck="false"
          />
        </label>
        <label className="adv-check">
          <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>I understand this is permanent.</span>
        </label>
        {error ? <div className="adv-notice adv-notice--error" role="alert">{error}</div> : null}
        <div className="dangertz-actions">
          <button className="btn btn--ghost" type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn--danger" type="button" onClick={onConfirm} disabled={!armed}>
            {busy ? 'Deleting…' : 'Delete account forever'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DangerZone() {
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState({ busy: false, error: '' })

  async function onConfirm() {
    setState({ busy: true, error: '' })
    try {
      await deleteOwnAccount()
      // Edge Function deleted the auth user (service role, server side).
      // Local session is now dead; clear provider state and leave the app.
      await signOut('/')
    } catch (err) {
      setState({ busy: false, error: err.message || 'Deletion failed. If the Edge Function is not deployed yet, deploy delete_account and retry.' })
    }
  }

  return (
    <Panel className="adv-panel dangertz">
      <h4 className="adv-panel__title">Danger zone</h4>
      <p className="adv-panel__sub">
        Deletion happens server-side through an authenticated Edge Function. Your browser never
        holds, sends, or sees any privileged key.
      </p>
      <button className="btn btn--danger" type="button" onClick={() => setOpen(true)} disabled={state.busy}>
        Delete account
      </button>
      {open ? (
        <DeleteModal
          busy={state.busy}
          error={state.error}
          onConfirm={onConfirm}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </Panel>
  )
}

/* ---------------- preferences (local-only, honest about it) ---------------- */

function PreferencesSection() {
  const [notify, setNotify] = useState({ spend: true, status: true, weekly: false })
  return (
    <Panel className="adv-panel">
      <h4 className="adv-panel__title">Preferences</h4>
      <p className="adv-panel__sub">
        Local-only until a preferences endpoint ships. Nothing is persisted to the database yet.
      </p>
      {Object.entries({ spend: 'Spend alerts', status: 'Status changes', weekly: 'Weekly summary' }).map(([k, label]) => (
        <label key={k} className="adv-check">
          <input type="checkbox" checked={notify[k]} onChange={(e) => setNotify({ ...notify, [k]: e.target.checked })} />
          <span>{label}</span>
        </label>
      ))}
    </Panel>
  )
}

/* ---------------- the page ---------------- */

export default function AccountPage({ role, email, userId, headlineIndex, roleLabel }) {
  const [loadState, setLoadState] = useState({ loading: true, error: '', bundle: null })

  const profileNames = ACCOUNT_COLUMN_GROUPS.profiles
  const advNames = ACCOUNT_COLUMN_GROUPS.advertisers
  const devNames = ACCOUNT_COLUMN_GROUPS.developer_accounts

  const [profileForm, setProfileForm] = useState(emptyForm(profileNames))
  const [advForm, setAdvForm] = useState(emptyForm(advNames))
  const [devForm, setDevForm] = useState(emptyForm(devNames))
  const [initial, setInitial] = useState(null)
  const [saveState, setSaveState] = useState({ saving: false, error: '', saved: false })

  // Initial load: the first setState happens only after the awaited fetch,
  // so the mount effect never synchronously updates state. Loading is the
  // initial state already; retry (event path) may flip it synchronously.
  const load = useCallback(async () => {
    try {
      const bundle = await fetchAccountBundle()
      const pf = rowsToForm(bundle.profile, profileNames)
      const af = rowsToForm(bundle.advertiser, advNames)
      const df = rowsToForm(bundle.developer, devNames)
      setProfileForm(pf)
      setAdvForm(af)
      setDevForm(df)
      setInitial({ profiles: pf, advertisers: af, developer_accounts: df })
      setLoadState({ loading: false, error: '', bundle })
    } catch (e) {
      setLoadState({ loading: false, error: e.message || 'Could not load account data.', bundle: null })
    }
  }, [profileNames, advNames, devNames])

  // Retry path (event handlers): may flip loading synchronously.
  const retry = useCallback(async () => {
    setLoadState((s) => ({ ...s, loading: true, error: '' }))
    await load()
  }, [load])

  useEffect(() => {
    // Async boundary: kick the loader off without synchronously mutating
    // state from the effect body itself.
    void (async () => {
      await load()
    })()
  }, [load])

  const dirty = useMemo(() => {
    if (!initial) return false
    return (
      Object.keys(diffPatch(initial.profiles, profileForm, profileNames)).length > 0 ||
      (role === 'advertiser' && Object.keys(diffPatch(initial.advertisers, advForm, advNames)).length > 0) ||
      (role === 'developer' && Object.keys(diffPatch(initial.developer_accounts, devForm, devNames)).length > 0)
    )
  }, [initial, profileForm, advForm, devForm, role, profileNames, advNames, devNames])

  async function onSave() {
    if (!initial) return
    setSaveState({ saving: true, error: '', saved: false })
    const patches = {
      profilePatch: diffPatch(initial.profiles, profileForm, profileNames),
      advertiserPatch: role === 'advertiser' ? diffPatch(initial.advertisers, advForm, advNames) : undefined,
      developerPatch: role === 'developer' ? diffPatch(initial.developer_accounts, devForm, devNames) : undefined,
    }
    try {
      const results = await saveAccountProfile(patches)
      const failures = [results.profile && `profile: ${results.profile}`, results.advertiser && `company: ${results.advertiser}`, results.developer && `developer: ${results.developer}`].filter(Boolean)
      if (failures.length) {
        setSaveState({ saving: false, error: failures.join(' · '), saved: false })
      } else {
        setInitial({ profiles: profileForm, advertisers: advForm, developer_accounts: devForm })
        setSaveState({ saving: false, error: '', saved: true })
      }
    } catch (e) {
      setSaveState({ saving: false, error: e.message || 'Save failed.', saved: false })
    }
  }

  if (loadState.loading) {
    return (
      <div className="adv-page">
        <AdvPageHead index={headlineIndex} label={roleLabel} title="Account." body="Loading your account from the database…" />
        <AdvLoading label="Loading account…" />
      </div>
    )
  }

  if (loadState.error) {
    return (
      <div className="adv-page">
        <AdvPageHead index={headlineIndex} label={roleLabel} title="Account." body="Your account data could not be loaded." />
        <AdvError message={loadState.error} onRetry={retry} />
      </div>
    )
  }

  return (
    <div className="adv-page">
      <AdvPageHead
        index={headlineIndex}
        label={`${roleLabel} · Account`}
        title="Profile, security, and account controls."
        body="Identity comes from Supabase Auth and your own rows in the database. Writes are owner-scoped by row level security."
      />

      <div className="adv-grid adv-grid--2">
        <div className="adv-stack">
          <Panel className="adv-panel">
            <h4 className="adv-panel__title">Profile</h4>
            <p className="adv-panel__sub">Shared identity and contact details.</p>
            <dl className="adv-detail">
              <div><dt>Account email</dt><dd>{email || '—'}</dd></div>
              <div><dt>Role</dt><dd><span className="adv-pill">{role || 'unknown'}</span></dd></div>
              <div><dt>User ID</dt><dd className="mono adv-id">{userId || '—'}</dd></div>
            </dl>
            <div className="account-fields">
              {profileNames.map((n) => (
                <Field
                  key={n}
                  name={n}
                  label={PROFILE_LABELS[n]}
                  value={profileForm[n]}
                  onChange={(e) => { setProfileForm({ ...profileForm, [n]: e.target.value }); setSaveState({ saving: false, error: '', saved: false }) }}
                />
              ))}
            </div>
          </Panel>

          {role === 'advertiser' ? (
            <Panel className="adv-panel">
              <h4 className="adv-panel__title">Company</h4>
              <p className="adv-panel__sub">Advertiser-specific company record.</p>
              <div className="account-fields">
                {advNames.map((n) => (
                  <Field
                    key={n}
                    name={n}
                    label={ADVERTISER_LABELS[n]}
                    value={advForm[n]}
                    area={COMPANY_AREA_FIELDS.has(n)}
                    url={ADVERTISER_URL_FIELDS.has(n)}
                    onChange={(e) => { setAdvForm({ ...advForm, [n]: e.target.value }); setSaveState({ saving: false, error: '', saved: false }) }}
                  />
                ))}
              </div>
            </Panel>
          ) : null}

          {role === 'developer' ? (
            <Panel className="adv-panel">
              <h4 className="adv-panel__title">Developer</h4>
              <p className="adv-panel__sub">Developer/studio record shown to the network.</p>
              <div className="account-fields">
                {devNames.map((n) => (
                  <Field
                    key={n}
                    name={n}
                    label={DEVELOPER_LABELS[n]}
                    value={devForm[n]}
                    area={DEVELOPER_AREA_FIELDS.has(n)}
                    url={DEVELOPER_URL_FIELDS.has(n)}
                    type={n === 'app_count' ? 'number' : 'text'}
                    onChange={(e) => { setDevForm({ ...devForm, [n]: e.target.value }); setSaveState({ saving: false, error: '', saved: false }) }}
                  />
                ))}
              </div>
            </Panel>
          ) : null}
        </div>

        <div className="adv-stack">
          <Panel className="adv-panel">
            <h4 className="adv-panel__title">Unsaved changes</h4>
            <p className="adv-panel__sub">
              {dirty ? 'You have edits that are not saved yet.' : 'Everything is saved.'}
            </p>
            <SaveBar
              dirty={dirty}
              saving={saveState.saving}
              savedAt={saveState.saved}
              onSave={onSave}
              error={saveState.error}
            />
          </Panel>

          <PasswordSection />
          <PreferencesSection />
          <DangerZone />
        </div>
      </div>
    </div>
  )
}
