import { useId } from 'react'

/** Small shared pieces of the console's visual system. */

export function SectionHead({ index, label, title, body }) {
  const id = useId()
  return (
    <header className="block__head">
      <p className="eyebrow eyebrow--plain">{`${index} — ${label}`}</p>
      <h3 className="block__title" id={id}>
        {title}
      </h3>
      {body ? <p className="block__body">{body}</p> : null}
    </header>
  )
}

export function DemoTag({ children = 'Demo data' }) {
  return (
    <span className="demo-tag" title="Simulated figures. No real money moves.">
      <span className="demo-tag__dot" aria-hidden="true" />
      {children}
    </span>
  )
}

export function Stat({ label, value, hint, tone = 'plain' }) {
  return (
    <div className={`stat stat--${tone}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {hint ? <span className="stat__hint">{hint}</span> : null}
    </div>
  )
}

export function Panel({ children, className = '' }) {
  return <div className={`panel ${className}`.trim()}>{children}</div>
}
