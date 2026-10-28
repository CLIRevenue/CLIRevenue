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

export function AdvLoading({ label = 'Loading advertiser data…' }) {
  return (
    <Panel className="adv-loading glass-spinner" aria-live="polite" aria-busy="true">
      <div className="glass-content">
        <div className="spinner-ring" />
        <div className="spinner-core" />
        <span className="adv-loading__label">{label}</span>
      </div>
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

/* An empty chart is still a chart.

   A box that swaps its graph for a sentence when there is no data tells the
   reader nothing about the shape of what is coming, and it makes the first
   campaign look like a different page from the second. So the frame is
   always drawn: the tracks, the labels, and a hairline at the baseline that
   is the zero it is sitting on. With nothing recorded, the rows are drawn
   blank at that same zero -- no invented names, no sliver of bar pretending
   to be a measurement. The `Math.max(2, …)` floor that used to keep a bar
   visible has to go with them: at zero the bar's honest width is nothing. */
const BLANK_ROWS = [
  { id: 'blank-0', name: '\u2014', value: 0, display: '0' },
  { id: 'blank-1', name: '\u2014', value: 0, display: '0' },
  { id: 'blank-2', name: '\u2014', value: 0, display: '0' },
  { id: 'blank-3', name: '\u2014', value: 0, display: '0' },
];

export function AdvBarChart({ rows, valueLabel = 'Spend' }) {
  const list = rows.length ? rows : BLANK_ROWS;
  const max = Math.max(1, ...list.map((r) => r.value));
  const empty = rows.length === 0;
  return (
    <div className="adv-chart" role="img" aria-label={`${valueLabel} by campaign${empty ? ', nothing recorded yet' : ''}`}>
      {list.map((r) => (
        <div key={r.id} className="adv-chart__row">
          <span className="adv-chart__name" title={r.name}>{r.name}</span>
          <span className="adv-chart__track">
            <span className="adv-chart__zero" aria-hidden="true" />
            {r.value > 0 ? (
              <span className="adv-chart__fill" style={{ width: `${Math.max(2, (r.value / max) * 100)}%` }} />
            ) : null}
          </span>
          <span className="adv-chart__value mono">{r.display}</span>
        </div>
      ))}
    </div>
  );
}

export function AdvDemoNote({ children }) {
  return (
    <div className="adv-note">
      <DemoTag>{children || 'Real backend data'}</DemoTag>
    </div>
  )
}
