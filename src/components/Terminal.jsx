import AdSlot from './AdSlot.jsx'
import CommandLine from './CommandLine.jsx'
import OutputStream from './OutputStream.jsx'

const IDLE_FRAME = {
  command: '',
  lines: [],
  phase: 'idle',
  showCursor: true,
  settled: true,
  resetPrompt: true,
}

function Terminal({
  title,
  live = false,
  slot = null,
  bare = false,
  narrow = false,
  outHeight = null,
  frame = IDLE_FRAME,
  foot = null,
  hint = null,
  showAd = false,
  children = null,
}) {
  const outClass = [
    'terminal__out',
    outHeight === 'xs' && 'terminal__out--xs',
    outHeight === 'short' && 'terminal__out--short',
    outHeight === 'tall' && 'terminal__out--tall',
  ]
    .filter(Boolean)
    .join(' ')

  const shellClass = [
    'terminal',
    narrow && 'terminal--narrow',
    bare && 'terminal--bare',
  ]
    .filter(Boolean)
    .join(' ')

  /* a finished command leaves a fresh prompt behind it, which is what
     keeps the command line demonstrably usable rather than frozen */
  const fresh = frame.settled && frame.resetPrompt

  return (
    <div className={shellClass} data-phase={frame.phase}>
      {/* The window is a wrapper so it can be clipped away. The prompt
          below sits outside it, so when the film opens on an empty
          terminal the only thing left is the prompt and a cursor, and
          the interface arrives by growing around the prompt rather than
          by arriving with it. */}
      <div className="terminal__body">
        <div className="terminal__chrome">
          <div className="terminal__lights" aria-hidden="true">
            <span className="terminal__light" />
            <span className="terminal__light" />
            <span
              className={`terminal__light ${live ? 'terminal__light--live' : ''}`}
            />
          </div>
          <span className="terminal__title">{title}</span>
          <span
            className={`terminal__slot ${slot ? 'terminal__slot--ad' : ''}`}
          >
            {slot}
          </span>
        </div>

        <div className={outClass}>
          <OutputStream lines={frame.lines} />
          {children}
        </div>

        {foot && <div className="terminal__foot">{foot}</div>}

        {showAd && <AdSlot />}
      </div>

      <div className="terminal__in">
        {fresh ? (
          <CommandLine command="" />
        ) : (
          <CommandLine command={frame.command} showCursor={frame.showCursor} />
        )}
        {hint && <span className="terminal__hint">{hint}</span>}
      </div>
    </div>
  )
}

export default Terminal
