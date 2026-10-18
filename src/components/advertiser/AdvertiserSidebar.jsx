import { useEffect, useRef } from 'react'
import './sidebar.css'

/* ── icons ────────────────────────────────────────────────────────────
   Inline rather than pulled from a library: four glyphs are not worth a
   dependency, and an <svg> inherits currentColor, which is the whole
   point of them being inline — the icon recolours with the label when
   the rail is collapsed to icons and the label is gone. */

function Icon({ d, children }) {
  return (
    <svg className="adv-side__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {d ? <path d={d} /> : children}
    </svg>
  )
}

const GLYPH = {
  overview: <Icon d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z" />,
  campaigns: <Icon d="M4 5h16v3H4V5Zm0 5.5h16v3H4v-3ZM4 16h10v3H4v-3Z" />,
  analytics: <Icon d="M5 19h14v2H5v-2ZM7 10h3v7H7v-7Zm4-4h3v11h-3V6Zm4 6h3v5h-3v-5Z" />,
  billing: <Icon d="M3 7.5A2.5 2.5 0 0 1 5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9Zm2 1v2h14v-2H5Zm0 4v2.5h9V12.5H5Z" />,
  settings: <Icon d="M12 8.6A3.4 3.4 0 1 0 12 15.4 3.4 3.4 0 0 0 12 8.6Zm8.3 3.4c0 .5 0 1-.1 1.4l2 1.6-2 3.4-2.4-1a8 8 0 0 1-2.4 1.4l-.4 2.6h-4l-.4-2.6a8 8 0 0 1-2.4-1.4l-2.4 1-2-3.4 2-1.6a8.7 8.7 0 0 1 0-2.8l-2-1.6 2-3.4 2.4 1a8 8 0 0 1 2.4-1.4L11 2.6h4l.4 2.6a8 8 0 0 1 2.4 1.4l2.4-1 2 3.4-2 1.6c.1.4.1.9.1 1.4Z" />,
  collapse: <Icon d="M14.5 6.5 9 12l5.5 5.5V6.5ZM5 5v14h2V5H5Zm12 0v14h2V5h-2Z" />,
  grip: <Icon d="M10 8.5h1.5v1.5H10V8.5Zm0 3.5h1.5v1.5H10V12Zm0 3.5h1.5V17H10v-1.5Zm4-7h1.5v1.5H14V8.5Zm0 3.5h1.5v1.5H14V12Zm0 3.5h1.5V17H14v-1.5Z" />,
  close: <Icon d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" />,
}

/* Widths. 208 is where "Campaigns" in the mono caps face stops needing
   the label to truncate; 420 is where the content column stops being
   able to hold a two-up grid at 1280. Both are walls on purpose — a rail
   you can drag to 900px is not a rail, it is a mistake. */
const W_MIN = 208
const W_MAX = 420
const W_KEY = 'clirevenue.advside.w'
const W_DEFAULT = 252

function clamp(n) {
  return Math.min(W_MAX, Math.max(W_MIN, n))
}

function readStoredWidth() {
  try {
    const raw = window.localStorage.getItem(W_KEY)
    const n = Number(raw)
    return raw && Number.isFinite(n) ? clamp(n) : W_DEFAULT
  } catch {
    /* Private mode, or a browser that has decided storage is a trap.
       The rail still works; it just forgets. */
    return W_DEFAULT
  }
}

/**
 * The advertiser rail: one column of the screen, holding the pages, the
 * brand, and the way out.
 *
 * It is collapsible and resizable because those are two different answers
 * to two different needs. Collapsing is for the moment you want the
 * content — a slide-over, a table, a number you are checking — and it has
 * to be instant and reversible without a thought, so it is one attribute
 * and no transition on the width itself. Resizing is for the person who
 * has decided they want the table wider than this account is currently
 * showing it, and that decision should survive the session.
 *
 * The width lives in a CSS custom property rather than in component state
 * on purpose. Dragging a rail re-renders sixty times a second, and every
 * one of those renders would walk the whole dashboard subtree to change
 * one number the DOM already knows how to read. Nothing here re-renders
 * while you drag; the property is written straight to the node.
 */
export default function AdvertiserSidebar({ items, active, onNavigate, onOpenSettings, activeLabel, collapsed, onToggleCollapse, shellRef }) {
  const rootRef = useRef(null)
  const startRef = useRef(null)

  /* Restore the remembered width once, on mount. localStorage in a
     lazy useState initializer would run during render and throw in a
     server render; this component is client-only, but the habit is worth
     keeping — the rule in this repo is that anything that allocates,
     subscribes or probes happens after the mount, not during it. */
  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    el.style.setProperty('--adv-side-w', `${readStoredWidth()}px`)
  }, [shellRef])

  /* The drag. Pointer capture on the grip means the pointer can leave the
     6px handle and keep going — a resize you have to keep the cursor
     inside to continue is a resize that fights you. The listener is
     attached on pointerdown and removed on pointerup, so it exists for
     exactly as long as the gesture. */
  useEffect(() => {
    const el = shellRef.current
    if (!el) return undefined

    function onDown(event) {
      if (event.button !== 0) return
      const grip = event.currentTarget
      grip.setPointerCapture?.(event.pointerId)
      startRef.current = { x: event.clientX, w: el.getBoundingClientRect().width }
      el.dataset.dragging = 'true'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    function onMove(event) {
      const from = startRef.current
      if (!from) return
      const next = clamp(from.w + (event.clientX - from.x))
      el.style.setProperty('--adv-side-w', `${next}px`)
    }

    function onUp(event) {
      startRef.current = null
      delete el.dataset.dragging
      const grip = el.querySelector('.adv-side__grip')
      grip?.releasePointerCapture?.(event.pointerId)
      try {
        window.localStorage.setItem(W_KEY, String(Math.round(el.getBoundingClientRect().width)))
      } catch {
        /* See readStoredWidth. */
      }
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    const grip = el.querySelector('.adv-side__grip')
    grip?.addEventListener('pointerdown', onDown)
    return () => {
      grip?.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [shellRef])

  return (
    <aside ref={rootRef} className="adv-side" aria-label="Advertiser navigation">
      {/* No wordmark. The old header was a 73px band of sticky glass
          carrying a wordmark, three links and two buttons; the rail took
          the navigation and then took the wordmark too, because a second
          copy of the product name is not navigation and it is not an
          identity either — the tab already says so, and a name you have
          to look at in order to use the thing is not helping anyone. The
          top of the rail belongs to the controls and to nothing else. */}

      <button
        type="button"
        className="adv-side__collapse"
        onClick={onToggleCollapse}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {GLYPH.collapse}
      </button>

      <nav className="adv-nav" aria-label="Advertiser pages">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="adv-nav__btn"
            aria-current={active === item.id ? 'page' : undefined}
            data-active={active === item.id}
            onClick={() => onNavigate(item)}
          >
            <span className="adv-nav__glyph">{GLYPH[item.icon] || GLYPH.overview}</span>
            <span className="adv-nav__label">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="adv-side__foot">
        <button
          type="button"
          className="adv-side__settings"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
        >
          <span className="adv-nav__glyph">{GLYPH.settings}</span>
          <span className="adv-nav__label">Settings</span>
        </button>
        <p className="adv-side__where" aria-live="polite">
          {activeLabel}
        </p>
      </div>

      {/* The resize handle. A 6px column is deliberately below the 10px
          that reliably earns a pointer on a trackpad and wide enough to
          hit with a mouse; it paints a 2px line that grows to 3 and
          brightens on hover, so there is something to aim at before you
          know you are aiming at it. */}
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
