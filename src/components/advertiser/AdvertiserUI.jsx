import { DemoTag, Panel, SectionHead, Stat } from '../console/ui.jsx'
import { navigateApp } from '../../hooks/useAppRoute.js'
import './dashboard.css'

export function AdvPageHead({ index, label, title, body }) {
  return (
    <SectionHead index={index} label={label} title={title} body={body} level="h2" eyebrow />
  )
}

export function AdvError({ message, onRetry }) {
  if (!message) return null
  return (
    <div className="adv-notice adv-notice--error" role="alert">
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="btn btn--ghost adv-notice__btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  )
}

export function AdvEmpty({ title, body, actionLabel, onAction, to, mark = 'No records yet' }) {
  return (
    <Panel className="adv-empty">
      <span className="adv-empty__mark">{mark}</span>
      <h4 className="adv-empty__title">{title}</h4>
      {body ? <p className="adv-empty__body">{body}</p> : null}
      {actionLabel ? (
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            if (onAction) onAction()
            else if (to) navigateApp(to)
          }}
        >
          {actionLabel}
        </button>
      ) : null}
    </Panel>
  )
}

const SKELETON_CELLS = [0, 1, 2, 3]

export function AdvLoading({ label = 'Loading advertiser data…' }) {
  return (
    <Panel className="adv-loading" aria-live="polite" aria-busy="true">
      <span className="adv-loading__label">
        <span className="adv-loading__dot" aria-hidden="true" />
        {label}
      </span>
      <span className="adv-loading__grid" aria-hidden="true">
        {SKELETON_CELLS.map((i) => (
          <span key={i} className="adv-loading__cell">
            <span className="adv-loading__bar adv-loading__bar--label" />
            <span className="adv-loading__bar adv-loading__bar--value" />
          </span>
        ))}
      </span>
    </Panel>
  )
}

export function AdvStats({ items }) {
  return (
    <div className="adv-stats">
      {items.map((s) => (
        <Stat
          key={s.label}
          label={s.label}
          value={s.value}
          hint={s.hint}
          flag={s.flag}
          tone={s.tone || 'plain'}
        />
      ))}
    </div>
  )
}

export function AdvBarChart({ rows, valueLabel = 'Spend' }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="adv-chart" role="img" aria-label={`${valueLabel} by campaign`}>
      {rows.map((r) => (
        <div key={r.id} className="adv-chart__row">
          <span className="adv-chart__name" title={r.name}>{r.name}</span>
          <span className="adv-chart__track">
            <span className="adv-chart__fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
          </span>
          <span className="adv-chart__value mono">{r.display}</span>
        </div>
      ))}
    </div>
  )
}

export function AdvDemoNote({ children }) {
  return (
    <div className="adv-note">
      <DemoTag>{children || 'Real backend data'}</DemoTag>
    </div>
  )
}
