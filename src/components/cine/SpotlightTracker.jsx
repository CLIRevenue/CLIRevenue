/**
 * SpotlightTracker — one delegated pointer listener for every spotlight card.
 *
 * The spotlight is a CSS effect: a radial gradient anchored to `--mouse-x` /
 * `--mouse-y` on a pseudo-element. The only thing JS has to do is keep those
 * two properties pointing at the cursor.
 *
 * Doing that with one listener on `document` rather than one `onPointerMove`
 * per card is the difference between N handlers and one. It also means the
 * effect can be applied to *existing* markup by class alone: nothing in the
 * dashboards has to grow an event handler or a ref to carry a hover effect,
 * which is why the card surfaces picked up the spotlight without a JSX change.
 *
 * `closest()` short-circuits on the first match walking up from the cursor, so
 * nested cards resolve to the innermost one — which is the one the user is
 * actually pointing at.
 *
 * Writes are batched to one property flush per event, and the values are
 * percentages rather than pixels so the gradient survives a resize or reflow
 * without recomputation.
 */
import { useEffect } from 'react'

/** Cards that light up. Anything matching here is a spotlight target. */
const TARGET = '.panel.adv-panel, .adv-stats .stat'

export default function SpotlightTracker() {
  useEffect(() => {
    if (typeof document === 'undefined') return undefined

    const onMove = (event) => {
      const card = event.target instanceof Element ? event.target.closest(TARGET) : null
      if (!card) return
      const rect = card.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const x = ((event.clientX - rect.left) / rect.width) * 100
      const y = ((event.clientY - rect.top) / rect.height) * 100
      card.style.setProperty('--mouse-x', `${x.toFixed(2)}%`)
      card.style.setProperty('--mouse-y', `${y.toFixed(2)}%`)
    }

    // The listener is passive because nothing here can prevent a scroll or a
    // gesture; saying so keeps the browser from waiting on us to paint.
    document.addEventListener('pointermove', onMove, { passive: true })
    return () => document.removeEventListener('pointermove', onMove)
  }, [])

  return null
}