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

/** How many times the label is repeated. Any integer loops; more is denser. */
export const TRAIL_REPEATS = 24

/** Glue between repeats. One glyph wide, so a unit boundary is a real break. */
export const TRAIL_SEPARATOR = ' • '

/**
 * Scroll speed in *path units per second*, not pixels: the ribbon is scaled to
 * fill a band, so the same number runs at different pixel speeds on a phone and
 * a desktop, and speed in path units is the only figure that means the same
 * thing on both curves.
 */
export const TRAIL_SPEED = 26

/** Draw duration. Matches `DRAW_MS` in AuthCurve.css. */
export const DRAW_MS = 1200

/** Ids are fixed for the life of the page. */
export const PATH_ID = 'auth-curve-line'
export const PATH_REF = `#${PATH_ID}`
export const GRADIENT_ID = 'auth-curve-grad'

/** Tab order — the left-to-right reading order of the switcher. */
export const CURVE_ORDER = ['login', 'signup']

export const CURVES = {
  login: {
    id: 'login',
    label: 'LOGIN',
    d: 'M 10 50 Q 20 22, 42 25 T 48 38 Q 56 58, 76 36 T 65 19 Q 55 5, 45 2',
    href: '/login',
    hint: 'Welcome back.',
  },
  signup: {
    id: 'signup',
    label: 'SIGNUP',
    d: 'M 8 12 Q 35 18, 53 26.5 Q 31.8 40.5, 46.5 50.8 Q 72.5 46, 96.5 52',
    href: '/signup',
    hint: 'Create an account.',
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