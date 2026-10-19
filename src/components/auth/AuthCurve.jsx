/**
 * AuthCurve — the ribbon that is the background of every auth screen.
 *
 * One component covers login, signup and the four signup confirmation states
 * because `AuthShell` is the only place all of them share. It takes a `mode`,
 * draws the matching curve, and runs the word trail along it forever.
 *
 * Five things this deliberately does *not* do:
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
 *
 *  - It does not let the trail exist before the ribbon does. A second copy of
 *    the path, white, inside a mask is stroked with the same dash as the
 *    visible line, so the words are revealed by the draw instead of sliding
 *    around in front of a page that has not arrived yet.
 *
 *  - It does not glow with a filter. The halo underneath is a third copy of
 *    the path, wider and fainter, stroked by the same pass as the line above
 *    it. A CSS filter has to be rasterised into its own buffer, and because
 *    the trail moves every frame that buffer is reallocated every frame —
 *    measured at about 17fps with the filter and 46 without, on this layer
 *    alone. A stroke costs nothing extra to get the same glow.
 *
 *  - It does not carry a switcher. It used to export one, and the tabs it
 *    drew sat above the email field as the first thing in the reading column
 *    — two buttons answering a question the page below them already answers.
 *    A sign-up form already has a link to sign in under its submit button,
 *    and a second copy above the fold is noise wearing a costume. The ribbon
 *    is scenery; it does not get to navigate.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import usePrefersReducedMotion from '../../hooks/usePrefersReducedMotion.js'
import {
  DRAW_MASK_ID,
  EDGE_FADE_ID,
  EDGE_FADE_STOPS,
  EDGE_MASK_ID,
  GRADIENT_ID,
  MASK_REGION,
  PATH_ID,
  PATH_REF,
  TRAIL_REPEATS,
  advance,
  DRAW_MS,
  buildTrail,
  curveFor,
  dashPair,
  leadInPercent,
  stepPercentPerSecond,
  unitLength,
  wrapPercent,
} from '../../lib/authCurve.js'
import './AuthCurve.css'

/**
 * The ribbon. `mode` selects the curve; everything else about the draw is
 * measured from the DOM, so there is nothing to keep in sync with the markup.
 */
export default function AuthCurve({ mode = 'login' }) {
  const curve = curveFor(mode)
  const reduced = usePrefersReducedMotion()
  const pathRef = useRef(null)
  const haloRef = useRef(null)
  const maskPathRef = useRef(null)
  const trailRef = useRef(null)
  const trailPathRef = useRef(null)
  const maskTimer = useRef(0)
  /* How many units the trail actually has. Lengthening the trail without
     telling the wrap leaves the two disagreeing, and a wrap that is out by
     a fraction of a unit is a jump you can see. */
  const repeatsRef = useRef(TRAIL_REPEATS)
  const trail = useMemo(() => buildTrail(curve.label), [curve.label])

  /**
   * Reset the dash to fully hidden and then release it in a second frame, so
   * the line wipes itself on every visit instead of only appearing once. The
   * transition lives in CSS, so it has to be taken out of the inline style
   * before the reset lands or the reset would animate too.
   *
* The mask copy is written in the same breath as the visible line, and so is
 * the halo underneath it. They share a `d`, so they share a length, and the
 * whole point of both is that they arrive *with* the ribbon — written a frame
 * apart the glow would lead the line and the words would appear behind a page
 * that had not turned up yet.
 */
  const draw = useCallback(() => {
    const path = pathRef.current
    const halo = haloRef.current
    const maskPath = maskPathRef.current
    if (!path) return
    const total = path.getTotalLength()
    if (!(total > 0)) return
    const { dasharray, dashoffset } = dashPair(total)
    const lines = [halo, path, maskPath].filter(Boolean)

    for (const line of lines) {
      line.style.transition = 'none'
      line.style.strokeDasharray = dasharray
      line.style.strokeDashoffset = reduced ? '0' : dashoffset
      line.style.opacity = '1'
    }

    /* The draw mask is only load-bearing while the line is drawing.

       A mask makes the browser keep an offscreen buffer and re-render it
       every frame, and this one contains text that scrolls continuously —
       so it was costing a full-viewport composite on every single frame
       of the page's life, long after the reveal it exists for had
       finished. Measured over five seconds of presented frames on
       /login: with the mask 54.8fps average, a 23ms p95 and twenty-five
       frames over 21ms; with it lifted, 59.6fps, a 19ms p95 and none.

       It stays for the length of the draw, then comes off. Reduced motion
       draws instantly, so it never goes on at all. The attribute is put
       back by this same effect on every curve change, because navigating
       from /login to /signup re-runs the draw. */
    const trailNode = trailRef.current
    const dropMask = () => trailNode && trailNode.removeAttribute('mask')

    if (reduced) {
      dropMask()
      return
    }

    // Force the hidden state to be committed before the next write. Without
    // this both values land in the same frame and the line simply appears.
    void path.getBoundingClientRect()
    for (const line of lines) {
      line.style.transition = ''
      line.style.strokeDashoffset = '0'
    }

    maskTimer.current = window.setTimeout(dropMask, DRAW_MS + 80)
  }, [reduced])

  // `curve.id` is a dependency in its own right: navigating from /login to
  // /signup swaps the path but leaves `draw` identical, so without it the
  // second curve would appear already drawn.
  useEffect(() => {
    draw()
    // A pending "drop the mask" must not survive into the next curve, or
    // the mask would come off mid-draw on the page it just navigated to.
    return () => window.clearTimeout(maskTimer.current)
  }, [draw, curve.id])

  /* The trail has to outlast the path, or the ribbon runs out of badges
     partway along and its last stretch is bare. A fixed repeat count cannot
     promise that: the path length, the glyph size and the viewport all move,
     and on /login the sixteen repeats were ending around x=77 while the
     ribbon stayed visible to x=96.

     Measured, not guessed — the unit's length comes from the rendered text
     rather than from an assumed character width, and the count is rounded up
     to whole units so the scroll's wrap stays seamless. Only ever grows the
     string, and it writes to the DOM directly because re-rendering would
     restart the draw. */
  useEffect(() => {
    const path = pathRef.current
    const trailNode = trailRef.current
    const trailPath = trailPathRef.current
    if (!path || !trailNode || !trailPath) return

    const pathLength = path.getTotalLength()
    if (!(pathLength > 0)) return

    const unit = unitLength(trailNode.getComputedTextLength(), TRAIL_REPEATS)
    if (!(unit > 0)) return

    const needed = Math.ceil((pathLength + unit) / unit)
    if (needed <= TRAIL_REPEATS) return

    trailPath.textContent = buildTrail(curve.label, needed)
    repeatsRef.current = needed
  }, [mode, curve.label])

  useEffect(() => {
    if (reduced) return undefined
    const path = pathRef.current
    const trailNode = trailRef.current
    const trailPath = trailPathRef.current
    if (!path || !trailNode || !trailPath) return undefined

    const pathLength = path.getTotalLength()
    // Anchor the cycle where the ribbon actually reaches the page, not at the
    // path's off-page origin. The wrap is by whole units, so a glyph at this
    // distance is the same glyph every time round.
    const base = leadInPercent(path)
    const step = stepPercentPerSecond(pathLength)
    // The repeat count has to come from what is on the path now. Measuring
    // the unit against the original TRAIL_REPEATS while the string holds
    // `needed` of them makes the wrap short by a factor of needed/16, and a
    // wrap that does not land on a unit boundary is a visible jump.
    /* The whole laid-out string, divided by the repeat count.

       getSubStringLength looks like the more honest measure and is not:
       startOffset is positive, so the first characters sit BEFORE the
       start of the path and have no position on it. Asking for the length
       of the first ten returns a degenerate number, the wrap collapses to
       almost nothing, and the trail does not scroll at all — it vibrates
       in place, advancing less than a period before snapping back. That
       is a worse bug than the seam it was meant to remove, and it is why
       this measures the string. */
    const wrap = wrapPercent(
      pathLength,
      trailNode.getComputedTextLength(),
      repeatsRef.current,
    )
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
      trailPath.setAttribute('startOffset', `${(base + offset).toFixed(3)}%`)
      frame = requestAnimationFrame(tick)
    }

    trailPath.setAttribute('startOffset', `${base.toFixed(3)}%`)
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [mode, reduced])

  return (
    <div className="auth-curve" aria-hidden="true">
      <svg
        className="auth-curve-svg"
        viewBox="0 0 100 60"
        preserveAspectRatio="xMidYMid slice"
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

          {/* What makes the edges soft. A radial falloff from the middle of the
              page, so the ribbon dissolves into the background instead of
              stopping at a rectangle. */}
          <radialGradient id={EDGE_FADE_ID} cx="50%" cy="50%" r="62%">
            {EDGE_FADE_STOPS.map((stop) => (
              <stop
                key={stop.key}
                className={`auth-curve__fade auth-curve__fade--${stop.key}`}
                offset={stop.offset}
              />
            ))}
          </radialGradient>

          <mask
            id={EDGE_MASK_ID}
            maskUnits="userSpaceOnUse"
            x={MASK_REGION.x}
            y={MASK_REGION.y}
            width={MASK_REGION.width}
            height={MASK_REGION.height}
          >
            <rect
              className="auth-curve__fade-fill"
              x={MASK_REGION.x}
              y={MASK_REGION.y}
              width={MASK_REGION.width}
              height={MASK_REGION.height}
              fill={`url(#${EDGE_FADE_ID})`}
            />
          </mask>

          {/* The reveal. A white copy of the same path, stroked with the same
              dash, so the trail is only painted where the ribbon has been. */}
          <mask
            id={DRAW_MASK_ID}
            maskUnits="userSpaceOnUse"
            x={MASK_REGION.x}
            y={MASK_REGION.y}
            width={MASK_REGION.width}
            height={MASK_REGION.height}
          >
            <path ref={maskPathRef} className="auth-curve__mask-line" d={curve.d} />
          </mask>
        </defs>

        <g mask={`url(#${EDGE_MASK_ID})`}>
          {/* Underneath, not on top: a wider fainter copy of the same path. The
              glow costs one extra stroke instead of one extra buffer. */}
          <path ref={haloRef} className="auth-curve__halo" d={curve.d} />
          <path ref={pathRef} id={PATH_ID} className="auth-curve__line" d={curve.d} />
          <text className="auth-curve__trail" ref={trailRef} mask={`url(#${DRAW_MASK_ID})`}>
            <textPath ref={trailPathRef} href={PATH_REF} startOffset="0%">
              {trail}
            </textPath>
          </text>
        </g>
      </svg>
    </div>
  )
}