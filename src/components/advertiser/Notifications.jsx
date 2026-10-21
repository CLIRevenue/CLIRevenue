import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchNotifications, markQueriesRead, screenshotLinks } from '../../lib/advertiserQueries.js'

/**
 * The bell. An icon and a count, and nothing else until you open it —
 * a header that shows you your own bad news before you asked is just
 * noise with a bell on it.
 *
 * Two kinds of thing live in here and they are not the same thing. An
 * answer from support is something you are waiting on, so it is
 * unread until you read it. A performance note is a reading of numbers
 * this console already has — passed in, never invented here.
 *
 * Read state is a database column (subscriber_read_at), not component
 * state: opening a reply stamps the row through mark_queries_read, so the
 * red dot survives a refresh and follows the advertiser to another
 * device. The optimistic local write is just for the same millisecond —
 * the server row is the source of truth.
 */

function bellPath(reading) {
  return reading
    ? 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-5.4-1.8-1.9v-4.3a5.2 5.2 0 0 0-3.7-5V4.6a1.5 1.5 0 1 0-3 0v.8a5.2 5.2 0 0 0-3.7 5v4.3L5 16.6V18h14v-1.4Z'
    : 'M12 22a2.2 2.2 0 0 0 2.2-2.2H9.8A2.2 2.2 0 0 0 12 22Zm7-5.4-1.8-1.9v-4.3a5.2 5.2 0 0 0-3.7-5V4.6a1.5 1.5 0 1 0-3 0v.8a5.2 5.2 0 0 0-3.7 5v4.3L5 16.6V18h14v-1.4Z'
}

export default function Notifications({ insights = [] }) {
  const [open, setOpen] = useState(false)
  const [data, setData] = useState({ answered: [], waiting: [], unread: 0, queries: [] })
  const [detail, setDetail] = useState(null)
  const [linksByQuery, setLinksByQuery] = useState({})
  const [error, setError] = useState('')
  const rootRef = useRef(null)

  const load = useCallback(async () => {
    try {
      setData(await fetchNotifications())
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }, [])

  /* The first load is written as a promise chain rather than as a call to
     `load`, because `load` sets state and the compiler is right to be
     suspicious of a state write that could land during the effect's own
     commit. Here the write can only happen after a network round trip. */
  useEffect(() => {
    let alive = true
    fetchNotifications()
      .then((next) => {
        if (!alive) return
        setData(next)
        setError('')
      })
      .catch((err) => {
        if (alive) setError(err.message)
      })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = data.answered.filter((q) => !q.readAt).length
  const hasInsights = insights.length > 0
  const bellUnread = unread + hasInsights

  function stampRead(ids) {
    // Optimistic: the row the user just opened should stop counting as new
    // immediately, even while the write is in flight. The server call is
    // deliberately narrow — it can only stamp rows the signed-in user owns,
    // and it is a no-op for rows already stamped. A failed stamp is not
    // shouted about in the panel; the refresh button or the next fetch
    // recovers it, the same way a dropped page view recovers.
    setData((current) => ({
      ...current,
      answered: current.answered.map((q) => (ids.includes(q.id) ? { ...q, readAt: new Date().toISOString() } : q)),
    }))
    markQueriesRead(ids).catch(() => {})
  }

  const markAllRead = () => {
    // No ids means "everything unread that is mine" — exactly one round
    // trip, not one per row.
    stampRead(data.answered.map((q) => q.id))
  }

  function openReply(query) {
    stampRead([query.id])
    setDetail(query)
    // Same signed-link contract as the admin console: storage paths get a
    // short-lived URL, legacy bare filenames stay plain text. Links are
    // keyed by the query id, so a slow resolution can never land on another
    // detail's list.
    if (query.screenshots.length) {
      screenshotLinks(query.screenshots).then((resolved) => {
        setLinksByQuery((current) => ({ ...current, [query.id]: resolved }))
      })
    }
  }

  return (
    <div className="adv-bell" ref={rootRef}>
      <button
        type="button"
        className="adv-side__icon-btn adv-bell__btn"
        onClick={() => setOpen((v) => !v)}
        aria-label={bellUnread ? `Notifications, ${bellUnread} new` : 'Notifications'}
        aria-expanded={open}
        title="Notifications"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={bellPath(bellUnread > 0)} />
          {bellUnread > 0 ? <circle cx="18" cy="6" r="4.5" className="adv-bell__dot" /> : null}
        </svg>
      </button>

      {open ? (
        <div className="adv-bell__panel" role="dialog" aria-label="Notifications">
          <div className="adv-bell__head">
            <span className="adv-bell__title">Notifications</span>
            <div className="adv-bell__head-actions">
              {unread > 0 ? (
                <button type="button" className="adv-bell__mark-read" onClick={markAllRead}>
                  Mark all as read
                </button>
              ) : null}
              <button type="button" className="adv-bell__refresh" onClick={load} aria-label="Refresh">↻</button>
            </div>
          </div>

          {error ? <p className="adv-bell__empty">{error}</p> : null}

          {!error && data.answered.length === 0 && insights.length === 0 ? (
            <p className="adv-bell__empty">Nothing needs you right now.</p>
          ) : null}

          {data.answered.length ? (
            <section className="adv-bell__group">
              <h3 className="adv-bell__group-title">Replies from support</h3>
              {data.answered.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  className="adv-bell__item"
                  onClick={() => openReply(q)}
                  data-unread={!q.readAt}
                >
                  <span className="adv-bell__item-title">{q.subject}</span>
                  <span className="adv-bell__item-sub">
                    Answered {new Date(q.repliedAt || q.createdAt).toLocaleDateString('en-US')}
                  </span>
                </button>
              ))}
            </section>
          ) : null}

          {insights.length ? (
            <section className="adv-bell__group">
              <h3 className="adv-bell__group-title">Performance</h3>
              {insights.map((item) => (
                <div key={item.id} className="adv-bell__item adv-bell__item--static" data-tone={item.tone || 'plain'}>
                  <span className="adv-bell__item-title">{item.title}</span>
                  <span className="adv-bell__item-sub">{item.body}</span>
                </div>
              ))}
            </section>
          ) : null}

          {data.waiting.length ? (
            <p className="adv-bell__foot-note">
              {data.waiting.length} request{data.waiting.length === 1 ? '' : 's'} still waiting on us.
            </p>
          ) : null}
        </div>
      ) : null}

      {detail ? (
        <div className="adv-settings__scrim" role="dialog" aria-modal="true" aria-label="Support reply" onClick={() => setDetail(null)}>
          <div className="adv-settings" onClick={(event) => event.stopPropagation()}>
            <div className="adv-settings__head">
              <div>
                <h2 className="adv-settings__title">{detail.subject}</h2>
                <p className="adv-settings__sub">
                  Raised {new Date(detail.createdAt).toLocaleDateString('en-US')}
                  {detail.repliedAt ? ` · answered ${new Date(detail.repliedAt).toLocaleDateString('en-US')}` : ''}
                </p>
              </div>
              <button type="button" className="adv-settings__close" onClick={() => setDetail(null)} aria-label="Close">
                <svg className="adv-settings__close-mark" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="adv-settings__body">
              <p className="adv-bell__eyebrow">What you told us</p>
              <p className="adv-bell__quote">{detail.body}</p>
              <dl className="adv-detail">
                <div><dt>Email</dt><dd>{detail.email}</dd></div>
                {detail.phone ? <div><dt>Phone</dt><dd>{detail.phone}</dd></div> : null}
                {detail.screenshots.length ? (
                  <div>
                    <dt>Screenshots</dt>
                    <dd>
                      <ul className="adm-query__files">
                        {(linksByQuery[detail.id] || detail.screenshots.map((value) => ({ value, name: value, url: null }))).map((f) => (
                          <li key={f.value}>
                            {f.url
                              ? <a href={f.url} target="_blank" rel="noopener noreferrer">{f.name}</a>
                              : <span>{f.name}</span>}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <p className="adv-bell__eyebrow">Our answer</p>
              <p className="adv-bell__resolution">{detail.reply}</p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
