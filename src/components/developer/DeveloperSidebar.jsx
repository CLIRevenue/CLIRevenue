import { useEffect, useRef } from 'react'
import '../advertiser/sidebar.css'

/* The developer rail, built on the advertiser console's shell rather than a
   parallel one.

   The two consoles are the same shape: a resizable column of pages, a top
   bar carrying nothing but the mark, and a foot holding theme, account and
   the way out. Rather than fork five hundred lines of paper-and-glass CSS
   and let the two drift, this renders the same class names and therefore
   the same stylesheet — `sidebar.css` is imported above, once, and the
   advertiser rail picks up the identical rules.

   The class names carry an `adv-` prefix that reads as "advertiser" and is
   in fact "console". That is a debt, not a decision: renaming it means
   touching every rule in that file, and this change is worth more landed
   than renamed. Do not add new `adv-` names here — `dev-` is the direction.

   The drag logic below is duplicated from `AdvertiserSidebar.jsx` for the
   same reason. Two copies of thirty lines beat one shared module and a
   refactor of a working console; collapsing them is the next job, not
   this one. */

function Icon({ d }) {
  return (
    <svg className="adv-side__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={d} />
    </svg>
  )
}

const GLYPH = {
  dashboard: <Icon d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />,
  earnings: <Icon d="M4 19h16v-2H4v2Zm2-4h3V9H6v6Zm5 0h3V5h-3v10Zm5 0h3v-8h-3v8Z" />,
  sdk: <Icon d="m8 6-6 6 6 6 1.4-1.4L4.8 12l4.6-4.6L8 6Zm8 0 1.4 1.4L12.8 12l4.6 4.6L16 18l6-6-6-6Z" />,
  keys: <Icon d="M14 7a4 4 0 1 1-3.9 4.9L4 18v2h3v-2h2v-2h2l1.1-1.1A4 4 0 0 1 14 7Zm2 2.5a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />,
  placements: <Icon d="M4 5h7v7H4V5Zm9 0h7v4h-7V5Zm0 6h7v8h-7v-8ZM4 14h7v5H4v-5Z" />,
  integrations: <Icon d="M10 4h4v3h3v4h-3v3h-4v-3H7V7h3V4Zm-5 9h4v4H5v-4Z" />,
  analytics: <Icon d="M5 20V10h3v10H5Zm5.5 0V4h3v16h-3ZM16 20v-7h3v7h-3Z" />,
  account: <Icon d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5Z" />,
  sun: <Icon d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5Zm0-6.5 1.6 2.7h-3.2L12 2Zm0 20-1.6-2.7h3.2L12 22ZM2 12l2.7-1.6v3.2L2 12Zm20 0-2.7 1.6v-3.2L22 12ZM4.9 4.9 7.7 6v0L4.9 4.9Zm14.2 14.2L17 18v0l2.1 1.1ZM19.1 4.9 17 6v0l2.1-1.1ZM4.9 19.1 7 18v0l-2.1 1.1Z" />,
  moon: <Icon d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />,
  grip: <Icon d="M9 5h2v2H9V5Zm4 0h2v2h-2V5ZM9 11h2v2H9v-2Zm4 0h2v2h-2v-2Zm-4 6h2v2H9v-2Zm4 0h2v2h-2v-2Z" />,
}

const W_MIN = 72
const W_MAX = 420
const W_DEFAULT = 200
const W_KEY = 'clirevenue.devside.w'
const NARROW_AT = 168

function clamp(n) {
  return Math.min(W_MAX, Math.max(W_MIN, n))
}

/* Width and narrowness are one decision, so they are set in one function.
   Setting one without the other is how a rail ends up with four-character
   labels. */
function applyWidth(el, next) {
  el.style.setProperty('--adv-side-w', `${next}px`)
  if (next <= NARROW_AT) el.dataset.narrow = 'true'
  else delete el.dataset.narrow
}

function readStoredWidth() {
  try {
    const raw = Number(window.localStorage.getItem(W_KEY))
    return raw && Number.isFinite(raw) ? clamp(raw) : W_DEFAULT
  } catch {
    return W_DEFAULT
  }
}

export default function DeveloperSidebar({
  items,
  active,
  onNavigate,
  onOpenSettings,
  logoutSlot,
  theme,
  onToggleTheme,
  activeLabel,
  shellRef,
}) {
  const rootRef = useRef(null)
  const startRef = useRef(null)
  const dark = theme === 'dark'

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    applyWidth(el, readStoredWidth())
  }, [shellRef])

  useEffect(() => {
    const el = shellRef.current
    const grip = el && el.querySelector('.adv-side__grip')
    if (!el || !grip) return undefined

    const onDown = (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      grip.setPointerCapture?.(event.pointerId)

      /* Measure the rail, not the frame. `shellRef` is the grid parent and
         reads back as the whole window, so starting from it clamps the
         first move straight to the maximum and the rail jumps open the
         instant the grip is touched. */
      startRef.current = {
        x: event.clientX,
        w: (rootRef.current ?? el).getBoundingClientRect().width,
      }
      el.dataset.resizing = 'true'

      const onMove = (moveEvent) => {
        const from = startRef.current
        if (!from) return
        applyWidth(el, clamp(from.w + (moveEvent.clientX - from.x)))
      }
      const onUp = (upEvent) => {
        startRef.current = null
        delete el.dataset.resizing
        grip.releasePointerCapture?.(upEvent.pointerId)
        const w = (rootRef.current ?? el).getBoundingClientRect().width
        try {
          window.localStorage.setItem(W_KEY, String(Math.round(w)))
        } catch {
          /* A console with storage off still resizes; it just forgets. */
        }
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onUp)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    grip.addEventListener('pointerdown', onDown)
    return () => grip.removeEventListener('pointerdown', onDown)
  }, [shellRef])

  return (
    <aside ref={rootRef} className="adv-side" aria-label="Developer navigation">
      <nav className="adv-nav" aria-label="Developer pages">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="adv-nav__btn"
            aria-current={active === item.id ? 'page' : undefined}
            data-active={active === item.id}
            onClick={() => onNavigate(item)}
          >
            <span className="adv-nav__glyph">{GLYPH[item.icon] || GLYPH.dashboard}</span>
            <span className="adv-nav__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="adv-side__foot">
        <p className="adv-side__where" aria-live="polite">{activeLabel}</p>

        <button type="button" className="adv-side__row" onClick={onToggleTheme} aria-pressed={dark}>
          <span className="adv-nav__glyph">{dark ? GLYPH.sun : GLYPH.moon}</span>
          <span className="adv-nav__label">{dark ? 'Light' : 'Dark'}</span>
        </button>

        <button type="button" className="adv-side__row" onClick={onOpenSettings} aria-haspopup="dialog">
          <span className="adv-nav__glyph">{GLYPH.account}</span>
          <span className="adv-nav__label">Account</span>
        </button>

        <div className="adv-side__row adv-side__row--host">{logoutSlot}</div>
      </div>

      <div
        className="adv-side__grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        tabIndex={-1}
      >
        {GLYPH.grip}
      </div>
    </aside>
  )
}
