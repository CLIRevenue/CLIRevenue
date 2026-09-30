/* =============================================================
   CLIRevenue — persistent cinematic atmosphere
   -------------------------------------------------------------
   One fixed backdrop for the whole page: faint technical grid,
   long-distance signal drift, depth parallax. All compositor-friendly
   transforms/opacity only.
   Reduced motion collapses to a static layer.

   Horizontal instrumentation (hlines, drift lines, the signal rule and
   the grid's horizontal rows) was removed deliberately: 1px full-width
   lines over the soft radial pools read as seams/banding rather than
   as instrumentation. The depth pools and vertical grid carry the
   atmosphere on their own.
   ============================================================= */

import { useEffect, useRef } from 'react'

import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

function Atmosphere() {
  const rootRef = useRef(null)
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const root = rootRef.current
    if (!root || reduced) return undefined
    let raf = 0
    let ticking = false
    const update = () => {
      ticking = false
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
      const p = Math.min(1, Math.max(0, window.scrollY / max))
      root.style.setProperty('--atmos-p', p.toFixed(4))
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      raf = window.requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.cancelAnimationFrame(raf)
    }
  }, [reduced])

  return (
    <div className="atmos" ref={rootRef} aria-hidden="true">
      <div className="atmos__grid" />
      <div className="atmos__vlines">
        <i style={{ left: '8%' }} />
        <i style={{ left: '27%' }} />
        <i style={{ left: '50%' }} />
        <i style={{ left: '73%' }} />
        <i style={{ left: '92%' }} />
      </div>
    </div>
  )
}

export default Atmosphere
