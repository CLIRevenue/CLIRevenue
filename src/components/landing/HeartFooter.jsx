import { useCallback, useEffect, useRef, useState } from 'react'
import { addHeart, readHearts, readOwnHeart, writeOwnHeart } from '../../lib/heartsApi.js'
import './heart.css'

const BURSTS = [
  { dx: -14, dy: -46, r: -22, delay: 0 },
  { dx: 12, dy: -54, r: 18, delay: 60 },
  { dx: -4, dy: -38, r: -8, delay: 110 },
  { dx: 20, dy: -44, r: 26, delay: 170 },
]

/* The heart lives at the bottom of every surface: on the landing it sits in
   its own footer, and PageChrome renders it for the other eight routes. The
   "did I click it" flag is read from storage on mount, so arriving on a
   second page already shows the filled heart rather than asking again. */
export default function HeartFooter() {
  const [count, setCount] = useState(null)
  // Read once during the first render: a one-time probe belongs in lazy
  // initial state, not in an effect that setStates on mount.
  const [mine, setMine] = useState(readOwnHeart)
  const [pulse, setPulse] = useState(false)
  const [busy, setBusy] = useState(false)
  const [bursts, setBursts] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    let alive = true
    readHearts().then((r) => {
      if (alive && r.count !== null) setCount(r.count)
    })
    return () => {
      alive = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const onClick = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setMine(true)
    writeOwnHeart()

    /* The counter moves straight away so the button never feels stuck, and
       the database total replaces it when it lands. */
    setCount((c) => (typeof c === 'number' ? c + 1 : 1))
    setPulse(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setPulse(false), 620)

    const stamp = Date.now()
    setBursts(BURSTS.map((b, i) => ({ ...b, key: `${stamp}-${i}` })))
    timer.current = setTimeout(() => setBursts([]), 900)

    const r = await addHeart()
    setCount((c) => {
      if (r.count !== null) return r.count
      /* Offline the total is unknowable. Showing a permanent dash reads as
         a broken widget and makes the click look like it did nothing, so
         fall back to the one heart this visit is known to have added. */
      return typeof c === 'number' ? c : 1
    })
    setBusy(false)
  }, [busy])

  const label = count === null ? '—' : count.toLocaleString()

  return (
    <div className={`heartfoot${mine ? ' is-mine' : ''}${pulse ? ' is-pulsing' : ''}`}>
      <button
        type="button"
        className="heart"
        onClick={onClick}
        aria-pressed={mine}
        aria-label={mine ? 'You liked this site' : 'Like this site'}
      >
        <span className="heart__shape" aria-hidden="true">
          <svg viewBox="0 0 32 29" width="22" height="20" focusable="false">
            <path
              d="M16 29S2 20.5 2 10.2C2 5.2 5.7 2 10 2c2.6 0 4.8 1.3 6 3.3C17.2 3.3 19.4 2 22 2c4.3 0 8 3.2 8 8.2C30 20.5 16 29 16 29Z"
              fill="currentColor"
            />
          </svg>
        </span>
        {/* The count is the only thing that changes on click, so it carries
            the live region. It used to sit beside a sentence that said so,
            which is a worse trade: a decorative caption is read out loud on
            every navigation, and the number is what actually matters. */}
        <span className="heart__count" role="status" aria-live="polite">{label}</span>
      </button>

      <span className="heart__bursts" aria-hidden="true">
        {bursts.map((b) => (
          <i
            key={b.key}
            className="heart__burst"
            style={{
              '--dx': `${b.dx}px`,
              '--dy': `${b.dy}px`,
              '--r': `${b.r}deg`,
              animationDelay: `${b.delay}ms`,
            }}
          />
        ))}
      </span>
    </div>
  )
}