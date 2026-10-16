/**
 * AuthCurve — the ribbon that sits above every auth screen.
 *
 * One component covers login, signup and the four signup confirmation states
 * because `AuthShell` is the only place all of them share. It takes a `mode`,
 * draws the matching curve, and runs the word trail along it forever.
 *
 * Three things this deliberately does *not* do:
 *
 *  - It does not keep the scroll offset in state. Sixty writes a second into
 *    React would re-render the auth form sixty times a second for an effect
 *    nobody can interact with, so the offset is written straight onto the
 *    `textPath` node inside a rAF and the frame is cancelled on cleanup. Same
 *    approach as SpotlightTracker.
 *
 *  - It does not measure the path from a hardcoded number. `getTotalLength()`
 *    is the only honest answer, and it is different for every curve — the
 *    reference snippet this was built from used `stroke-dasharray: 400`, which
 *    is longer than either path and would have hidden the draw entirely.
 *
 *  - It does not repoint the `textPath` href. Only one path is ever mounted,
 *    under a fixed id, so the reference never has to be resolved again —
 *    Safari does not reliably re-resolve a changed `textPath` href.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion.js'
import { navigateApp } from '../../hooks/useAppRoute.js'
import {
  CURVE_ORDER,
  GRADIENT_ID,
  PATH_ID,
  PATH_REF,
  advance,
  buildTrail,
  curveFor,
  dashPair,
  stepPercentPerSecond,
  wrapPercent,
} from '../../lib/authCurve.js'
import './AuthCurve.css'

export default function AuthCurve({ mode = 'login' }) {
  const curve = curveFor(mode)
  const reduced = usePrefersReducedMotion()
  const pathRef = useRef(null)
  const trailRef = useRef(null)
  const trailPathRef = useRef(null)
  const trail = useMemo(() => buildTrail(curve.label), [curve.label])

  /**
   * Reset the dash to fully hidden and then release it in a second frame, so
   * the line wipes itself on every visit instead of only appearing once. The
   * transition lives in CSS, so it has to be taken out of the inline style
   * before the reset lands or the reset would animate too.
   */
  const draw = useCallback(() => {
    const path = pathRef.current
    if (!path) return
    const total = path.getTotalLength()
    if (!(total > 0)) return
    const { dasharray, dashoffset } = dashPair(total)

    path.style.transition = 'none'
    path.style.strokeDasharray = dasharray
    path.style.strokeDashoffset = reduced ? '0' : dashoffset
    path.style.opacity = '1'

    if (reduced) return

    // Force the hidden state to be committed before the next write. Without
    // this both values land in the same frame and the line simply appears.
    void path.getBoundingClientRect()
    path.style.transition = ''
    path.style.strokeDashoffset = '0'
  }, [reduced])

  useEffect(() => {
    draw()
  }, [draw])

  useEffect(() => {
    if (reduced) return undefined
    const path = pathRef.current
    const trailNode = trailRef.current
    const trailPath = trailPathRef.current
    if (!path || !trailNode || !trailPath) return undefined

    const pathLength = path.getTotalLength()
    const step = stepPercentPerSecond(pathLength)
    const wrap = wrapPercent(pathLength, trailNode.getComputedTextLength())
    // A hidden or not-yet-laid-out element measures zero. Stop rather than
    // divide by it — an unmeasured trail would run at an arbitrary speed.
    if (!(step > 0) || !(wrap > 0)) return undefined

    let offset = 0
    let previous = null
    let frame = 0

    const tick = (now) => {
      // The first frame is the baseline, not a step: a long frame between the
      // rAF being scheduled and it running would otherwise jump the trail.
      const delta = previous === null ? 0 : now - previous
      previous = now
      offset = advance(offset, delta, step, wrap)
      trailPath.setAttribute('startOffset', `${offset.toFixed(3)}%`)
      frame = requestAnimationFrame(tick)
    }

    trailPath.setAttribute('startOffset', '0%')
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, reduced])

  /**
   * The already-active tab re-draws instead of navigating: pushing `/login`
   * while already on `/login` changes nothing, so the ribbon would never
   * respond to the click that was supposed to draw it.
   */
  const onTab = useCallback(
    (event, item) => {
      if (item.id === curve.id) {
        event.preventDefault()
        draw()
        return
      }
      navigateApp(item.href)
    },
    [curve.id, draw],
  )

  return (
    <div className="auth-curve">
      <div className="auth-curve__stage">
        <svg
          className="auth-curve-svg"
          viewBox="0 0 100 60"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            {/* The stops are styled from CSS, not from a `stopColor`
                attribute: presentation attributes do not substitute
                `var()`, so a token on them would silently resolve to nothing. */}
            <linearGradient id={GRADIENT_ID} x1="0" y1="0" x2="1" y2="1">
              <stop className="auth-curve__stop auth-curve__stop--hi" offset="0" />
              <stop className="auth-curve__stop auth-curve__stop--lo" offset="1" />
            </linearGradient>
          </defs>
          <path ref={pathRef} id={PATH_ID} className="auth-curve__line" d={curve.d} />
          <text className="auth-curve__trail" ref={trailRef}>
            <textPath ref={trailPathRef} href={PATH_REF} startOffset="0%">
              {trail}
            </textPath>
          </text>
        </svg>
      </div>
      <div className="auth-curve__tabs" role="group" aria-label="Log in or create an account">
        {CURVE_ORDER.map((id) => {
          const item = curveFor(id)
          const active = item.id === curve.id
          return (
            <button
              key={item.id}
              type="button"
              className={active ? 'auth-curve__tab btn btn--primary btn--sm' : 'auth-curve__tab btn btn--ghost btn--sm'}
              aria-current={active ? 'page' : undefined}
              onClick={(event) => onTab(event, item)}
            >
              {item.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}