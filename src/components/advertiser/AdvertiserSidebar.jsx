import { useEffect, useRef } from 'react'
import './sidebar.css'

/* ── icons ────────────────────────────────────────────────────────────
   Inline rather than pulled from a library: four glyphs are not worth a
   dependency, and an <svg> inherits currentColor, which is the whole
   point of them being inline — the icon recolours with the label when
   the rail narrows to icons and the label is gone. */

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
  grip: <Icon d="M10 8.5h1.5v1.5H10V8.5Zm0 3.5h1.5v1.5H10V12Zm0 3.5h1.5V17H10v-1.5Zm4-7h1.5v1.5H14V8.5Zm0 3.5h1.5v1.5H14V12Zm0 3.5h1.5V17H14v-1.5Z" />,
  close: <Icon d="m6.4 5 5.6 5.6L17.6 5 19 6.4 13.4 12 19 17.6 17.6 19 12 13.4 6.4 19 5 17.6 10.6 12 5 6.4 6.4 5Z" />,  /* The two halves of the theme control. Sun for what the toggle will
     give you, moon for what you are leaving, which is the only pairing
     that is unambiguous without a tooltip. */
  sun: (
    <Icon d="M12 5V2M12 22v-3M5 12H2M22 12h-3M6.3 6.3 4.2 4.2M19.8 19.8l-2.1-2.1M6.3 17.7l-2.1 2.1M19.8 4.2l-2.1 2.1M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" />
  ),
  moon: (
    <Icon d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  ),

}

/* Widths. 72 is the floor because that is what the rail measures once
   the labels are gone, and there is no collapse button left to reach it
   — so it has to be draggable all the way down. 420 is where the content
   column stops being able to hold a two-up grid at 1280. Both are walls
   on purpose: a rail you can drag to 900px is not a rail, it is a
   mistake. */
const W_MIN = 72
const W_MAX = 420
const W_KEY = 'clirevenue.advside.w'
const W_DEFAULT = 252

/* Where the words go. Below this the labels cannot fit at their natural
   width without truncating: "Campaigns" in the mono caps face is about
   101px, plus an 11px gap, plus the glyph, plus the rail's 12px of
   padding either side. At 168 there is still a little slack, so this
   fires just before the text starts colliding with the icon rather than
   once it already has. */
const NARROW_AT = 168

function clamp(n) {
  return Math.min(W_MAX, Math.max(W_MIN, n))
}

/* Width and narrowness are written together, in one place, on purpose.
   They are one decision — a rail narrower than NARROW_AT is a rail of
   icons — and setting one without the other is how you end up with a rail
   whose words are clipped to four characters. */
function applyWidth(el, next) {
  el.style.setProperty('--adv-side-w', `${next}px`)
  if (next <= NARROW_AT) el.dataset.narrow = 'true'
  else delete el.dataset.narrow
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
 * The advertiser rail: one column of the screen, holding the pages.
 *
 * One gesture governs it. You take hold of the right-hand margin and
 * drag, and everything else follows from how wide that leaves it —
 * including losing the labels, because a word that no longer fits should
 * go rather than truncate. A separate collapse button would be a second
 * way of saying the same thing, and two controls on one axis is a pair
 * that can disagree with itself.
 *
 * The width lives in a CSS custom property rather than in component state
 * on purpose. Dragging a rail re-renders sixty times a second, and every
 * one of those renders would walk the whole dashboard subtree to change
 * one number the DOM already knows how to read. Nothing here re-renders
 * while you drag; the property is written straight to the node.
 */
export default function AdvertiserSidebar({
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
  const dark = theme === 'dark'
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
    applyWidth(el, readStoredWidth())
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
      // The rail's width, not the frame's. `el` is the frame, which is
      // the whole window wide, so measuring it here made every drag
      // start from 1280 and clamp straight to W_MAX on the first move --
      // the rail jumped open the moment you touched the grip, in
      // whichever direction you touched it. The rail is rootRef; the
      // frame is only what the width is written to.
      startRef.current = {
        x: event.clientX,
        w: (rootRef.current ?? el).getBoundingClientRect().width,
      }
      el.dataset.resizing = 'true'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onUp)
    }

    // A pointermove can fire more often than a frame, and each write here
    // invalidates the grid track. Coalescing to one write per frame is the
    // difference between the rail tracking the cursor and the rail chasing
    // it through a backlog of events that have already been superseded.
    let frame = 0
    let pending = null

    function flush() {
      frame = 0
      if (pending === null) return
      applyWidth(el, clamp(pending))
      pending = null
    }

    function onMove(event) {
      const from = startRef.current
      if (!from) return
      pending = from.w + (event.clientX - from.x)
      if (!frame) frame = window.requestAnimationFrame(flush)
    }

    function onUp(event) {
      startRef.current = null
      delete el.dataset.resizing
      const grip = el.querySelector('.adv-side__grip')
      grip?.releasePointerCapture?.(event.pointerId)
      try {
        const w = (rootRef.current ?? el).getBoundingClientRect().width
        window.localStorage.setItem(W_KEY, String(Math.round(w)))
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
        <p className="adv-side__where" aria-live="polite">
          {activeLabel}
        </p>

        {/* Theme. This console is a working surface you stare at for an
            hour, and white paper at that length is not neutral, it is
            bright. Whether you read it light or dark is a reading
            preference, so it belongs with the other controls and not
            filed inside the account form behind a button that opens
            something else. */}
        <button
          type="button"
          className="adv-side__row"
          onClick={onToggleTheme}
          aria-pressed={dark}
        >
          <span className="adv-nav__glyph">{dark ? GLYPH.sun : GLYPH.moon}</span>
          <span className="adv-nav__label">{dark ? 'Light' : 'Dark'}</span>
        </button>

        {/* Account, and logout. Both are passed in as nodes rather than
            drawn here, so the button that ends the session is composed by
            the component that owns the session and the rail only lays it
            out. A rail that could sign you out on its own would be one
            more place to get that wrong. */}
        <button
          type="button"
          className="adv-side__row"
          onClick={onOpenSettings}
          aria-haspopup="dialog"
        >
          <span className="adv-nav__glyph">{GLYPH.settings}</span>
          <span className="adv-nav__label">Account</span>
        </button>
        <div className="adv-side__row adv-side__row--host">{logoutSlot}</div>
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
