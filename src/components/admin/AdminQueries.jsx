import { useCallback, useEffect, useMemo, useState } from 'react'
import { checkAdminAccess, bootstrapAdminAllowlist, fetchAllQueries, replyToQuery, closeQuery } from '../../lib/advertiserQueries.js'

/**
 * Advertiser queries, and the reply box.
 *
 * Everything an advertiser typed is shown here verbatim before anything is
 * answered: they wrote it expecting a person to read it, and a support desk
 * that summarises the request back at them is a support desk that will
 * answer the wrong thing. The reply is saved straight to the row, which is
 * the same row the advertiser's bell reads, so there is no delivery step
 * that can fail between the answer being written and being seen.
 */

const STATUS = {
  open: { label: 'Open', tone: 'warn' },
  answered: { label: 'Answered', tone: 'good' },
  closed: { label: 'Closed', tone: 'plain' },
}

function when(iso) {
  if (!iso) return '—'
  const then = new Date(iso)
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return then.toLocaleDateString('en-US')
}

export default function AdminQueries() {
  const [rows, setRows] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [openId, setOpenId] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)
  const [admin, setAdmin] = useState(null)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [bootstrapNotice, setBootstrapNotice] = useState('')

  const load = useCallback(async () => {
    try {
      setAdmin(await checkAdminAccess())
      setRows(await fetchAllQueries())
      setError('')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    checkAdminAccess().then((a) => { if (alive) setAdmin(a) })
    fetchAllQueries()
      .then((next) => { if (alive) { setRows(next); setError('') } })
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  async function handleBootstrap() {
    setBootstrapping(true)
    setBootstrapNotice('')
    setError('')
    let bootstrapError = null
    try {
      const result = await bootstrapAdminAllowlist()
      if (result?.email) {
        setBootstrapNotice(`Added ${result.email} to the admin allowlist. Refreshing…`)
      }
    } catch (err) {
      // "Already bootstrapped" (409) is success for this button: the email
      // is on the allowlist, so the confirmation check below is the real
      // answer — not surfacing the Edge Function's raw error string into a
      // red banner.
      bootstrapError = err
    } finally {
      setBootstrapping(false)
    }
    const after = await checkAdminAccess().catch(() => null)
    if (after?.admin) {
      setBootstrapNotice('')
      await load()
      return
    }
    setError(bootstrapError?.message || 'Could not reach the admin bootstrap. Insert your email into public.admin_emails from the SQL console, then refresh.')
  }

  const shown = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  )

  async function send(query) {
    const text = drafts[query.id]
    if (!text || !text.trim()) return
    setSaving(true)
    try {
      const updated = await replyToQuery(query.id, text)
      setRows((current) => current.map((r) => (r.id === updated.id ? updated : r)))
      setDrafts((d) => { const next = { ...d }; delete next[query.id]; return next })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function close(query) {
    try {
      await closeQuery(query.id)
      setRows((current) => current.map((r) => (r.id === query.id ? { ...r, status: 'closed' } : r)))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="adm-page">
      <header className="adm-page__head">
        <div>
          <p className="eyebrow eyebrow--plain">Support</p>
          <h2 className="block__title">Advertiser queries</h2>
        </div>
        <div className="adm-page__actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFilter(filter === 'all' ? 'open' : 'all')}>
            {filter === 'all' ? 'Open only' : 'Showing open'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={load}>Refresh</button>
        </div>
      </header>

      {error ? <p className="form__error" role="alert">{error}</p> : null}
      {admin && !admin.admin && !loading ? (
        <p className="form__error" role="alert">
          This account is signed in but its email is not on the admin allowlist
          (<span className="mono">public.admin_emails</span>), so row level security is
          filtering every admin read on this page — returning no rows and no error.
          {' '}
          <button type="button" className="btn btn--primary btn--sm" disabled={bootstrapping} onClick={handleBootstrap}>
            {bootstrapping ? 'Adding…' : 'Add me to the allowlist'}
          </button>
          {' '}
          <span className="mono">INSERT INTO public.admin_emails (email) VALUES (lower(…));</span>
          {admin.reason ? ` (${admin.reason})` : ''}
          {bootstrapNotice ? <><br />{bootstrapNotice}</> : null}
        </p>
      ) : null}
      {loading ? <p className="adm-empty">Loading…</p> : null}
      {!loading && !shown.length && !(admin && !admin.admin) ? (
        <p className="adm-empty">No queries yet.</p>
      ) : null}

      <ul className="adm-query-list">
        {shown.map((q) => (
          <li key={q.id} className="adm-query" data-status={q.status}>
            <button type="button" className="adm-query__head" onClick={() => setOpenId(openId === q.id ? null : q.id)}>
              <span className="adm-query__subject">{q.subject}</span>
              <span className={`adm-query__status adm-query__status--${STATUS[q.status].tone}`}>
                {STATUS[q.status].label}
              </span>
              <span className="adm-query__when">{when(q.createdAt)}</span>
            </button>

            {openId === q.id ? (
              <div className="adm-query__body">
                <dl className="adv-detail">
                  <div><dt>User id</dt><dd className="mono">{q.profileId}</dd></div>
                  <div><dt>Email</dt><dd>{q.email}</dd></div>
                  <div><dt>Phone</dt><dd>{q.phone || '—'}</dd></div>
                  {q.company ? <div><dt>Company</dt><dd>{q.company}</dd></div> : null}
                  <div><dt>Category</dt><dd>{q.category}</dd></div>
                  <div><dt>Screenshots</dt><dd>{q.screenshots.length ? q.screenshots.join(', ') : 'none attached'}</dd></div>
                </dl>

                <p className="adm-query__message">{q.body}</p>

                {q.reply ? (
                  <div className="adm-query__reply" data-sent="true">
                    <p className="adm-query__reply-label">Answer sent {when(q.repliedAt)}</p>
                    <p>{q.reply}</p>
                  </div>
                ) : null}

                <div className="adm-query__compose">
                  <label className="adv-field">
                    <span className="adv-field__label">
                      {q.reply ? 'Send another answer' : 'Reply'}
                    </span>
                    <textarea
                      className="adv-input adv-textarea"
                      rows={4}
                      value={drafts[q.id] || ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                      placeholder="Say what you did, and what they should do next."
                    />
                  </label>
                  <div className="adm-query__compose-actions">
                    <button type="button" className="btn btn--primary btn--sm" disabled={saving} onClick={() => send(q)}>
                      {saving ? 'Sending…' : 'Send reply'}
                    </button>
                    {q.status !== 'closed' ? (
                      <button type="button" className="btn btn--ghost btn--sm" onClick={() => close(q)}>Close</button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}
