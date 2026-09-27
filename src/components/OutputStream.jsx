const Caret = () => <span className="cursor cursor--inline" aria-hidden="true" />

/* Each line is always mounted; `data-state` withholds it until its
   slice of the stream arrives. That keeps the reserved output region
   from reflowing as lines print. */
function Line({ entry }) {
  const { line, state, mode, text, printed } = entry
  const attrs = { className: `out out--${line.kind}`, 'data-state': state }

  if (line.kind === 'rule') return <span {...attrs} />

  if (line.kind === 'kv')
    return (
      <span {...attrs}>
        <span className="out__key">{line.key}</span>
        <span className="out__val"> {line.value}</span>
      </span>
    )

  if (line.kind === 'step')
    return (
      <span {...attrs}>
        <span className="out__label">{text}</span>
        {/* the leader is the flex gap made visible; it carries a real
            space so the line does not read as run-together text */}
        <span className="out__leader"> </span>
        {printed && line.status && (
          <span className={`out__value out__value--${line.status}`}>
            {line.value ?? line.status}
          </span>
        )}
        {printed && line.value && !line.status && (
          <span className="out__value">{line.value}</span>
        )}
        {state === 'active' && mode !== 'none' && <Caret />}
      </span>
    )

  return (
    <span {...attrs}>
      {text}
      {state === 'active' && mode !== 'none' && <Caret />}
    </span>
  )
}

function OutputStream({ lines = [] }) {
  return lines.map((entry, i) => <Line key={i} entry={entry} />)
}

export default OutputStream
