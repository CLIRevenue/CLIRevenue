/**
 * Shared presentation helpers for the four governance surfaces
 * (Accounts, Moderation, Health, Operations).
 *
 * These exist because every one of those screens has to answer the same
 * question in the same way: "is this number real, and where did it come
 * from?" The server sends a `capabilities` object describing what it
 * cannot do; this renders that honestly instead of quietly omitting it.
 */

export function fmtDate(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

export function fmtDateFull(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return String(iso)
  }
}

export function shortId(value) {
  if (!value) return '—'
  const s = String(value)
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s
}

export function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—'
  const n = Number(bytes)
  if (!Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function fmtCents(cents) {
  if (cents === null || cents === undefined) return '—'
  const n = Number(cents)
  if (!Number.isFinite(n)) return '—'
  return `$${(n / 100).toFixed(2)}`
}

export function PageHeader({ breadcrumb, title, sub, status, tone }) {
  return (
    <div className="adm-op-header">
      <div className="adm-op-header__left">
        <div className="adm-op-header__breadcrumb">{breadcrumb}</div>
        <div className="adm-op-header__title">{title}</div>
        <div className="adm-op-header__sub">{sub}</div>
      </div>
      {status && (
        <div className="adm-op-header__right">
          <div className={`adm-status-pill${tone ? ` adm-status-pill--${tone}` : ''}`}>
            <span className="adm-status-pill__dot" />
            {status}
          </div>
        </div>
      )}
    </div>
  )
}

export function LoadingState({ breadcrumb, title, note }) {
  return (
    <div>
      <div className="adm-page-title">{breadcrumb}</div>
      <h2 className="adm-page-heading">{title}</h2>
      <div className="adm-loading"><div className="adm-spinner" /> {note || 'Loading…'}</div>
    </div>
  )
}

export function ErrorState({ breadcrumb, title, error }) {
  return (
    <div>
      <div className="adm-page-title">{breadcrumb}</div>
      <h2 className="adm-page-heading">{title}</h2>
      <div className="adm-error">{error}</div>
    </div>
  )
}

export function EmptyState({ breadcrumb, title, label, body }) {
  return (
    <div>
      <div className="adm-page-title">{breadcrumb}</div>
      <h2 className="adm-page-heading">{title}</h2>
      <div className="adm-empty">
        <div className="adm-empty__label">{label}</div>
        {body}
      </div>
    </div>
  )
}

/** Map an error from adminApi into the console's standard wording. */
export function errorText(e) {
  if (e?.status === 403) return 'Access denied. Admin role required.'
  if (e?.status === 401) return 'Session expired or missing. Sign in again.'
  if (e?.status === 404) {
    return 'This endpoint is not deployed. The console cannot reach it, so nothing is shown.'
  }
  return e?.message || 'Unexpected error.'
}

export function Section({ title, subtitle, children }) {
  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <div className="adm-section__title">{title}</div>
        {subtitle && <div className="adm-section__subtitle">{subtitle}</div>}
      </div>
      {children}
    </div>
  )
}

/** A value that is genuinely absent — never a zero standing in for "unknown". */
export function Cell({ label, value, empty }) {
  const isEmpty = value === null || value === undefined || value === '' || value === false
  return (
    <div className="adm-gov-kv__cell">
      <div className="adm-gov-kv__label">{label}</div>
      <div className={`adm-gov-kv__value${isEmpty ? ' adm-gov-kv__value--empty' : ''}`}>
        {isEmpty ? (empty || 'Not recorded') : value}
      </div>
    </div>
  )
}

/**
 * The capability ledger. Every entry the server marked unsupported is shown
 * with the reason it gave. This is the mechanism that stops a design mock's
 * "KYC Tier 2 Complete" or "99.98% uptime" from quietly becoming a lie.
 */
export function CapabilityLedger({ capabilities, omit = [], labels = {}, title, subtitle }) {
  if (!capabilities || typeof capabilities !== 'object') return null
  const keys = Object.keys(capabilities).filter((k) => !omit.includes(k))
  if (keys.length === 0) return null
  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <div className="adm-section__title">{title || 'Backend capabilities'}</div>
        {subtitle && <div className="adm-section__subtitle">{subtitle}</div>}
      </div>
      <div className="adm-gov-caps">
        {keys.map((key) => {
          const entry = capabilities[key]
          const plain = typeof entry !== 'object' || entry === null
          const supported = plain ? Boolean(entry) : entry.supported === true
          const note = plain ? '' : (entry.reason || entry.scope || entry.detail || '')
          const limitNote = !plain && entry.rowLimit
            ? ` Window cap: ${entry.rowLimit} rows.`
            : ''
          return (
            <div className="adm-gov-caps__row" key={key}>
              <div className="adm-gov-caps__key">{labels[key] || key}</div>
              <div
                className={`adm-gov-caps__value adm-gov-caps__value--${
                  supported ? 'yes' : 'no'
                }`}
              >
                {supported ? 'Supported' : 'Not supported'}
                {note ? ` — ${note}${limitNote}` : limitNote}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** The explicit "this has no backend source" block. */
export function Unavailable({ label, children, reason }) {
  return (
    <div className="adm-gov-unavailable">
      {label && <div className="adm-gov-unavailable__label">{label}</div>}
      <div className="adm-gov-unavailable__body">{children}</div>
      {reason && <div className="adm-gov-unavailable__reason">{reason}</div>}
    </div>
  )
}

/**
 * A monospace well for structured, read-only output — the honest stand-in for
 * the design's 80-column stdout panels. Real rows, real values, no chrome.
 */
export function Stdout({ lines, emptyLabel }) {
  if (!lines || lines.length === 0) {
    return <pre className="adm-stdout">{emptyLabel || 'No rows.'}</pre>
  }
  return (
    <pre className="adm-stdout">
      {lines.map((line, i) => (
        <span className="adm-stdout__line" key={`${i}-${line.key || ''}`}>
          {line.key && <span className="adm-stdout__key">{line.key.padEnd(14, ' ')}</span>}
          {line.value}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

export function GovBadge({ tone, children }) {
  return <span className={`adm-badge adm-badge--${tone}`}>{children}</span>
}

export function Pill({ active, count, onClick, children }) {
  return (
    <button
      type="button"
      className={`adm-pill${active ? ' adm-pill--active' : ''}`}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
      {count !== undefined && count !== null && (
        <span className="adm-pill__count">{count}</span>
      )}
    </button>
  )
}
