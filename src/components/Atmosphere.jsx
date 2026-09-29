/* =============================================================
   CLIRevenue — persistent cinematic atmosphere
   -------------------------------------------------------------
   One fixed backdrop for the whole page: faint technical grid,
   hairline instrumentation, long-distance signal drift, depth
   parallax. All compositor-friendly transforms/opacity only.
   Reduced motion collapses to a static layer.
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
      <div className="atmos__hlines">
        <i style={{ top: '18%' }} />
        <i style={{ top: '46%' }} />
        <i style={{ top: '74%' }} />
      </div>
      <div className="atmos__depth atmos__depth--a" />
      <div className="atmos__depth atmos__depth--b" />
      <div className="atmos__drift atmos__drift--a" />
      <div className="atmos__drift atmos__drift--b" />
      <div className="atmos__signal" />
    </div>
  )
}

export default Atmosphere
