import { useState, useEffect, useCallback } from 'react'

import { fetchAdminContacts, updateContactStatus, deleteContact } from '../../lib/adminApi.js'
import './AdminContacts.css'

// Tones, not colours. A colour map meant the dot stayed green and pulsing for
// an archived submission, so "resolved" was the only status that looked like
// itself. The five labels are the `contact_statuses` enum from migration
// 000019 — an unknown status must still render, so it falls back to amber.
const STATUS_TONE = {
  new: 'adm-status-pill--amber',
  in_progress: 'adm-status-pill--amber',
  read: 'adm-status-pill--muted',
  archived: 'adm-status-pill--muted',
  resolved: '',
}

function StatusPill({ status }) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.new
  return (
    <span className={tone ? `adm-status-pill ${tone}` : 'adm-status-pill'}>
      <span className="adm-status-pill__dot" />
      {status}
    </span>
  )
}

function ContactDetail({ submission, onClose, onUpdate }) {
  // Held locally rather than read back off `submission`: the parent hands
  // down the row captured when the panel opened, so it never reflects a
  // change made from inside the panel.
  const [notes, setNotes] = useState(submission.adminNotes || '')
  const [status, setStatus] = useState(submission.status)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleChangeStatus = async (newStatus) => {
    setSaving(true)
    setError('')
    try {
      await updateContactStatus(submission.id, newStatus, notes)
      setStatus(newStatus)
      // Refresh the inbox so the row, the count and the timestamps agree
      // with what was just saved. The parent owns the list, so a write that
      // is not followed by a reload leaves the table showing a stale status.
      if (onUpdate) await onUpdate()
    } catch (e) {
      setError(e.message || 'Failed to update submission.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this submission permanently?')) return
    try {
      await deleteContact(submission.id)
      if (onUpdate) await onUpdate()
      onClose()
    } catch (e) {
      setError(e.message || 'Failed to delete submission.')
    }
  }

  return (
    <div className="adm-contacts__detail">
      <div className="adm-contacts__detail-header">
        <span className="adm-contacts__detail-title">Submission details</span>
        <button className="adm-contacts__detail-close" onClick={onClose} type="button">
          Close
        </button>
      </div>

      <div className="adm-contacts__meta">
        <div className="adm-contacts__meta-row">
          <span className="adm-contacts__label">Sender</span>
          <span className="adm-contacts__value">
            <span className="adm-contacts__name">{submission.name}</span>
            {`<${submission.email}>`}
          </span>
        </div>
        <div className="adm-contacts__meta-row">
          <span className="adm-contacts__label">Subject</span>
          <span className="adm-contacts__value">{submission.subject}</span>
        </div>
        <div className="adm-contacts__meta-row">
          <span className="adm-contacts__label">Category</span>
          <span className="adm-contacts__value">{submission.category}</span>
        </div>
        <div className="adm-contacts__meta-row">
          <span className="adm-contacts__label">Created</span>
          <span className="adm-contacts__value">{new Date(submission.createdAt).toLocaleString()}</span>
        </div>
        <div className="adm-contacts__meta-row">
          <span className="adm-contacts__label">Status</span>
          <span className="adm-contacts__value">
            <StatusPill status={status} />
          </span>
        </div>
      </div>

      <div className="adm-contacts__message-block">
        <div className="adm-contacts__message-label">Message</div>
        <div className="adm-contacts__message">{submission.message}</div>
      </div>

      <div className="adm-contacts__actions">
        <label className="adm-contacts__status-label">Transition to</label>
        <select
          className="adm-contacts__status-select"
          value={status}
          onChange={(e) => handleChangeStatus(e.target.value)}
          disabled={saving}
        >
          {['new', 'read', 'in_progress', 'resolved', 'archived'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>

        <textarea
          className="adm-contacts__notes"
          placeholder="Internal notes (private to the admin panel)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={saving}
        />

        <div className="adm-contacts__buttons">
          <button
            className="adm-contacts__btn adm-contacts__btn--save"
            onClick={() => handleChangeStatus(submission.status)}
            disabled={saving || !notes.trim()}
            type="button"
          >
            {saving ? 'Saving…' : 'Save notes'}
          </button>
          <button
            className="adm-contacts__btn adm-contacts__btn--delete"
            onClick={handleDelete}
            disabled={saving}
            type="button"
          >
            Delete submission
          </button>
        </div>

        {error && <div className="adm-contacts__error">{error}</div>}
      </div>
    </div>
  )
}

function MainContacts() {
  const [rows, setRows] = useState([])
  const [selected, setSelected] = useState(null)
  const [expanded, setExpanded] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await fetchAdminContacts()
      setRows(result.submissions ?? [])
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
        <h2 className="adm-page-heading">Contacts</h2>
        <div className="adm-loading">
          <div className="adm-spinner" />
          Loading inbox…
        </div>
      </div>
    )
  }
  if (error) {
    return (
      <div>
        <div className="adm-page-title">Operations</div>
        <h2 className="adm-page-heading">Contacts</h2>
        <div className="adm-error">{error}</div>
      </div>
    )
  }

  return (
    <div>
      <div className="adm-op-header">
        <div className="adm-op-header__left">
          <div className="adm-op-header__breadcrumb">Operations</div>
          <div className="adm-op-header__title">Contacts</div>
          <div className="adm-op-header__sub">Website contact form submissions</div>
        </div>
        <div className="adm-op-header__right">
          <div className="adm-status-pill adm-status-pill--muted">
            <span className="adm-status-pill__dot" />
            {rows.length} row{rows.length === 1 ? '' : 's'}
          </div>
        </div>
      </div>

      <div className="adm-contacts__list">
        <table className="adm-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Sender</th>
              <th>Subject</th>
              <th>Category</th>
              <th>Status</th>
              <th>Read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={`adm-contacts__row${expanded === r.id ? ' adm-contacts__row--expanded' : ''}`}
                onClick={() => setSelected(r)}
              >
                <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                <td>
                  <span className="adm-contacts__name">{r.name}</span>
                  {`<${r.email}>`}
                </td>
                <td>{r.subject}</td>
                <td>{r.category}</td>
                <td><StatusPill status={r.status} /></td>
                <td>
                  {r.status === 'new' ? 'New' : r.readAt ? 'Read' : '-'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="adm-contacts__empty">
                  <div className="adm-empty__label">No submissions yet</div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <ContactDetail
          // Without a key, React reuses this instance when a different row is
          // opened, so the previous submission's draft notes stayed in the
          // textarea. Keying on the id remounts per submission.
          key={selected.id}
          submission={selected}
          onClose={() => setSelected(null)}
          onUpdate={load}
        />
      )}
    </div>
  )
}

export default MainContacts