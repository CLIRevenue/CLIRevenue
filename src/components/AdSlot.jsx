/* =============================================================
   CLIRevenue — the sponsored slot
   -------------------------------------------------------------
   The only genuinely interactive control in the film, and it earns
   that: the whole argument of the prototype is that the ad is a
   region of the interface rather than a line the tool printed, and
   the cheapest proof of that is a region that can open without
   disturbing the output above it.

   So pressing the call to action does not navigate anywhere and
   does not write anything into the terminal. It expands the slot in
   place. Everything it animates is inside its own border, the
   height change is absorbed by the slot's own box, and the stream of
   command output above it is untouched — which is precisely the
   behaviour the rest of the prototype describes.

   Motion owns this and GSAP owns the entrance: the reveal tween in
   the cinema hook animates `.adslot`, never the control inside it, so
   the two never fight over the same transform.

   Opening the slot makes the stage about 117px taller, and the film
   deliberately does not call `ScrollTrigger.refresh()` to compensate.
   The chapter plan is measured once, so the mapping drifts by under
   two percent for as long as the slot is open and snaps back when it
   closes — imperceptible, and gone. A refresh would be worse than the
   drift: it re-derives the trigger from the new geometry while
   holding the same *progress*, which yanks the playhead and visibly
   jumps the film. A surface that can open is worth more than a
   scrollbar that measures it perfectly.
   ============================================================= */

import { useId, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'

import { adSlot, arrowGlyph, placement } from '../data/demo.js'

const Arrow = arrowGlyph

/* Spring, not a duration. The panel is a surface catching a tap, and
   a surface has weight. `reducedMotion` collapses it to an instant
   swap: `MotionConfig` at the root already stops Motion's transform
   animations for viewers who ask for less motion, but an explicit
   height change is a value animation rather than a transform, so the
   height spring opts out here. */
const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }
const FLAT = { duration: 0 }

function AdSlot() {
  const [open, setOpen] = useState(false)
  const reduced = useReducedMotion()
  const panelId = useId()
  const detail = reduced ? FLAT : SPRING

  return (
    <aside
      className="adslot"
      aria-label="Sponsored advertisement"
      data-visual={open ? 'opened' : 'visible'}
    >
      <p className="visually-hidden">
        {placement.statement} {placement.detail}
      </p>

      {/* The sheet is a separate element from the shell on purpose.
          GSAP owns the shell's transform for the chapter entrance; the
          sheet owns hover, focus and paint. Splitting them is what
          keeps a scrubbed inline transform from permanently pinning the
          hover lift out of reach. */}
      <div className="adslot__plate">
        <div className="adslot__rail">
          <span className="adslot__label">{adSlot.label}</span>
          <span className="adslot__dot" />
          <span className="adslot__publisher">{adSlot.advertiser}</span>
          <span className="adslot__mark">Ad</span>
          <span className="adslot__disclosure">{adSlot.disclosure}</span>
        </div>

        <div className="adslot__body">
          <span className="adslot__logo" aria-hidden="true">
            {adSlot.brand.slice(0, 1)}
          </span>
          <div className="adslot__copy">
            <span className="adslot__brand">{adSlot.brand}</span>
            <p className="adslot__headline">{adSlot.headline}</p>
            <p className="adslot__support">{adSlot.support}</p>
            <p className="adslot__meta">
              {adSlot.category} · {adSlot.region} · {adSlot.disclosure}
            </p>
          </div>
          <motion.button
            type="button"
            className="adslot__cta"
            onClick={() => setOpen((was) => !was)}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            whileTap={{ scale: 0.97 }}
            transition={detail}
          >
            {adSlot.action}
            <Arrow aria-hidden="true" />
          </motion.button>
        </div>

      {/* `AnimatePresence` earns its place here and nowhere else in
          the prototype. The scenes are stacked, not swapped, so there
          is no enter/exit to choreograph above this — but this panel
          is genuinely mounted and unmounted, and collapsing it needs
          to animate rather than snap.

          The panel is a region rather than a bare div because the
          control above it points at it: `aria-controls` is only
          emitted while the panel exists, so the reference is never
          dangling, and a screen reader announces the expanded state as
          a region rather than as loose text. */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="detail"
            id={panelId}
            role="region"
            aria-label={`${adSlot.label} — ${adSlot.advertiser}`}
            className="adslot__detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={detail}
          >
            <div className="adslot__detail-inner">
              <p className="adslot__detail-text">{adSlot.detail}</p>
              <p className="adslot__detail-region">{adSlot.region}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      </div>
    </aside>
  )
}

export default AdSlot
