/**
 * authCurve — the geometry and the maths behind the login/signup ribbon.
 *
 * Two things live here and nothing else does:
 *
 *  1. The two path `d` strings and the word that rides on them. Both curves
 *     live in a 100x60 viewBox, so the same `d` reads as a U-dip on the login
 *     page and an S on the signup page without a second set of coordinates.
 *
 *  2. The scroll maths. `startOffset` on a `<textPath>` is a percentage of the
 *     *path*, not of the text, which is what makes a naive `offset -= 0.2`
 *     loop run at a different speed on each curve and wrap at an arbitrary
 *     point. Measuring both lengths turns it into something exact.
 *
 * The loop is seamless because the trail is periodic by construction: it is
 * `label + separator` repeated whole times, so shifting by exactly one unit
 * lands the glyphs back where they started, pixel for pixel. No `textLength`
 * and no `pathLength` normalising is needed — both are avoided deliberately,
 * because `textLength` on a `textPath` and `pathLength` on the path have to be
 * kept in agreement by hand and drift the moment a letter-spacing changes.
 *
 * Every export here is pure so it can be unit-tested without a DOM; the
 * component owns the DOM and the rAF.
 */

/**
 * How many times the label is repeated. Any integer loops; more is denser.
 *
 * Sixteen is not a style choice, it is a frame budget. Every scroll frame
 * re-shapes every glyph along the path, so the repeat count is the amount of
 * text work per frame. The path is ~170 user units and one unit measures ~22,
 * so even twelve repeats cover it twice over; sixteen leaves margin without
 * asking the compositor to move a glyph it cannot see.
 */
export const TRAIL_REPEATS = 16

/** Glue between repeats. One glyph wide, so a unit boundary is a real break. */
export const TRAIL_SEPARATOR = ' • '

/**
 * Scroll speed in *path units per second*, not pixels: the ribbon is scaled to
 * fill a band, so the same number runs at different pixel speeds on a phone and
 * a desktop, and speed in path units is the only figure that means the same
 * thing on both curves.
 *
 * Eight, deliberately. The trail is scenery behind a form; at a speed where a
 * word takes a second to cross the screen it stops being texture and starts
 * being something you try to read, and it never settles. At eight units a
 * second one repeat crosses the visible path in about half a minute.
 */
export const TRAIL_SPEED = 8

/** Draw duration. Matches `DRAW_MS` in AuthCurve.css. */
export const DRAW_MS = 1200

/** Ids are fixed for the life of the page. */
export const PATH_ID = 'auth-curve-line'
export const PATH_REF = `#${PATH_ID}`
export const GRADIENT_ID = 'auth-curve-grad'
export const EDGE_FADE_ID = 'auth-curve-fade'
export const EDGE_MASK_ID = 'auth-curve-edge'
export const DRAW_MASK_ID = 'auth-curve-draw'

/**
 * The mask region, in viewBox user units. Both masks need a region wider than
 * the 100x60 box: the curves run past the top and the bottom edge and the fade
 * has to reach past them too, or the mask clips the ribbon instead of letting
 * it dissolve.
 */
export const MASK_REGION = { x: -40, y: -40, width: 180, height: 140 }

/**
 * The fade stops, as fractions of the radial gradient.
 *
 * Flat through the middle so the ribbon keeps its full strength where the copy
 * sits, then a *shoulder* before the zero: two stops with everything at full
 * strength until 58% and straight to nothing at the rim leaves a visible ring
 * where the falloff changes character. The extra stop is what makes the edge
 * read as a fade rather than a boundary.
 */
export const EDGE_FADE_STOPS = [
  { key: 'in', offset: 0 },
  { key: 'mid', offset: 0.46 },
  { key: 'soft', offset: 0.78 },
  { key: 'out', offset: 1 },
]

/**
 * The box the ribbon has to escape.
 *
 * `preserveAspectRatio="xMidYMid slice"` scales to *cover* the element, so how
 * much of the viewBox you can see depends on the viewport's aspect ratio, and
 * not in the way the phrase "100x60 viewBox" suggests. Measured across six
 * real viewport sizes:
 *
 *   1440x1000  ->  visible x 6.8 .. 93.2,  y 0 .. 60
 *    900x700   ->  visible x 19.1 .. 80.9, y 0 .. 60
 *    420x800   ->  visible x 35.3 .. 64.7, y 0 .. 60
 *
 * Two things follow. First, the visible width is *narrowest on a phone*: at 420
 * px you see under a third of the drawing, because the scale is set by height.
 * Second, when the viewport is wide and short the scale is set by width instead,
 * and the visible box widens to the full `x 0 .. 100` while the visible height
 * shrinks inside `y 0 .. 60`.
 *
 * So `x 0..100` by `y 0..60` is the **maximal** visible box, at every viewport.
 * Any point outside it is off-page everywhere, and any point inside it is
 * potentially visible. That is the invariant the curve endpoints are placed
 * against — see `CURVES` below.
 */
export const VIEWBOX = { x: 0, y: 0, width: 100, height: 60 }
/**
 * `label` is what rides the ribbon, and it is set in caps because it is a
 * texture, not a heading. It used to have two siblings — `tab`, `href` and
 * `hint` — which only the switcher ever read. The switcher is gone, so they
 * are: a sign-up form already has its own link to sign in under the submit
 * button, and a curve table that carries the answer to a question nothing
 * asks is a second source of truth waiting to disagree with the first.
 *
 * The `d` strings are the original curves with **both ends extended past the
 * page**. They used to stop at (10, 50) and (45, 2) on login and (8, 12) and
 * (96.5, 52) on signup — and every one of those four points is inside the
 * maximal visible box, so on a wide screen the ribbon began and ended in
 * mid-air with a visible cap sitting on the page. Nothing about the shape in
 * between changed; only what happens outside the frame.
 *
 * The extensions are drawn along each end's own tangent, which is why the first
 * and last commands are not arbitrary:
 *
 *   login lead-in   the tangent leaving (10, 50) is (10, -28); a control at
 *                   (3.3, 68.8) continues that exact direction, so the curve is
 *                   unbroken and only the endpoint moved, to (-20, 56).
 *   login lead-out  the tangent arriving at (45, 2) is (-10, -3); a straight
 *                   run to (16, -6.7) is parallel to it, so `L` is as smooth as
 *                   a curve would be and the end leaves through the top edge.
 *   signup          both ends are extended with a straight `L` because both of
 *                   its tangents are shallow enough that the line *is* the
 *                   tangent: (-20, 5.8) -> (8, 12) and (96.5, 52) -> (120, 57.9).
 *
 * Every endpoint is outside `VIEWBOX` (x < 0, x > 100, or y < 0), so it is off
 * the page at every viewport rather than at the size it was designed at.
 */
export const CURVES = {
  login: {
    id: 'login',
    label: 'SIGN IN',
    d: 'M -20 56 Q 3.3 68.8 10 50 Q 20 22, 42 25 T 48 38 Q 56 58, 76 36 T 65 19 Q 55 5, 45 2 L 16 -6.7',
  },
  signup: {
    id: 'signup',
    label: 'SIGN UP',
    d: 'M -20 5.8 L 8 12 Q 35 18, 53 26.5 Q 31.8 40.5, 46.5 50.8 Q 72.5 46, 96.5 52 L 120 57.9',
  },
}

/** Unknown modes fall back to login rather than throwing on a bad prop. */
export function curveFor(mode) {
  return CURVES[mode] || CURVES.login
}

/**
 * The scroll string. One unit is `label + separator`; the whole trail is that
 * unit repeated, which is what makes a one-unit shift invisible.
 */
export function buildTrail(label, repeats = TRAIL_REPEATS) {
  const unit = `${label}${TRAIL_SEPARATOR}`
  return unit.repeat(repeats)
}

/** Length of one repeated unit, in the text's own user units. */
export function unitLength(textLength, repeats = TRAIL_REPEATS) {
  if (!(textLength > 0) || !(repeats > 0)) return 0
  return textLength / repeats
}

/**
 * How far the offset travels in one second, as a percentage of the path.
 * `startOffset` percentages are of `pathLength`, so the speed has to be
 * converted through it — this is what keeps both curves moving at one speed.
 */
/**
 * Where the curve first reaches the page, as a percentage of its own length.
 *
 * Every curve is drawn with both ends pushed outside the viewbox, so the
 * path's zero is not where the ribbon becomes visible: on login that is a
 * run of several units of length before the first pixel the eye can see. A
 * trail anchored at zero therefore spends the beginning of every loop
 * off-page, and the ribbon reads as bare for a stretch before the first
 * badge arrives — the same seam on every cycle.
 *
 * The trail's cycle has to be anchored here instead. Returns 0 for a curve
 * that starts inside the box, so nothing changes for one that has no
 * lead-in, and 0 for anything that cannot be measured, which leaves the
 * old behaviour rather than a broken offset.
 */
export function leadInPercent(path, step = 0.5) {
  if (!path || typeof path.getTotalLength !== 'function') return 0
  const total = path.getTotalLength()
  if (!(total > 0)) return 0
  const { x, y, width, height } = VIEWBOX
  for (let at = 0; at <= total; at += step) {
    const point = path.getPointAtLength(at)
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) {
      return (at / total) * 100
    }
  }
  return 0
}

export function stepPercentPerSecond(pathLength, unitsPerSecond = TRAIL_SPEED) {
  if (!(pathLength > 0) || !(unitsPerSecond > 0)) return 0
  return (unitsPerSecond / pathLength) * 100
}

/**
 * The wrap distance: one trail unit expressed as a percentage of the path.
 * Landing exactly on this is what makes the loop seamless.
 */
export function wrapPercent(pathLength, textLength, repeats = TRAIL_REPEATS) {
  if (!(pathLength > 0) || !(textLength > 0) || !(repeats > 0)) return 0
  return (unitLength(textLength, repeats) / pathLength) * 100
}

/**
 * One frame of the scroll, as a pure function of where the offset is now.
 * The offset runs backwards along the path so the trail reads left to right,
 * and wraps by whole units rather than by the full trail length — a full-trail
 * wrap would leave the visible gap where the string ends.
 */
export function advance(offset, deltaMs, step, wrap) {
  if (!(step > 0) || !(wrap > 0)) return 0
  let next = offset - step * (Math.max(0, deltaMs) / 1000)
  // A long frame (a backgrounded tab) can overshoot the wrap by more than one
  // unit, so this has to be a loop and not a single subtraction.
  while (next <= -wrap) next += wrap
  return next
}

/**
 * The dash pair that hides the line completely before it draws, and reveals it
 * completely after. A single number does both because `dasharray === total` and
 * `dashoffset === total` cancel out, and `0` reveals all of it.
 */
export function dashPair(pathLength) {
  if (!(pathLength > 0)) return { dasharray: '', dashoffset: '' }
  const total = Math.ceil(pathLength)
  return { dasharray: `${total}`, dashoffset: `${total}` }
}