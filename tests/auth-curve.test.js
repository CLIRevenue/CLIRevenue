/**
 * The login/signup ribbon: a thick blue curve that draws itself, with a word
 * trail that scrolls along it forever.
 *
 * The reference this was built from was three CSS rules and a `setInterval`:
 * `stroke-dasharray: 400`, a `.active` class, and `startOffset -= 0.2` every
 * frame. Three things in that are wrong for this codebase, and each one is an
 * assertion here.
 *
 *  1. `stroke-dasharray: 400` is a guess about the length of a path it never
 *     measured. The two curves in the 100x60 viewBox are 169.7 and 129.5 user
 *     units long. A dasharray longer than the path does not hide the line —
 *     it makes `dashoffset` meaningless and the draw animation is a no-op, so
 *     the curve is simply already there. The length has to come from
 *     `getTotalLength()`, which is why `dashPair()` exists and why a literal
 *     number in the component is a regression.
 *
 *  2. `startOffset` is a percentage of the PATH, not of the text. Walking it
 *     down by a fixed amount per frame therefore runs the two curves at two
 *     different speeds, and faster or slower depending on how wide the
 *     browser window is. Converting through the path length is what makes one
 *     number mean the same thing on both curves.
 *
 *  3. The wrap has to land on a period of the TRAIL, not on the length of the
 *     trail. `LABEL • ` repeated 24 times is periodic with period
 *     `textLength / 24`, so shifting by exactly that is invisible — the glyphs
 *     land back where they started, pixel for pixel, forever. Wrapping on the
 *     full string instead would leave the seam visible once a minute.
 *
 * `textLength` and `pathLength` are the usual escapes from this and both are
 * deliberately avoided: they have to agree with each other by hand and drift
 * the instant a letter-spacing or a repeat count changes. Measuring is
 * cheaper than keeping that honest.
 *
 * Source-shape assertions, like every other frontend contract here:
 * `vitest.config.js` runs `environment: 'node'` with no DOM, so nothing can be
 * measured on screen. The maths is pure and IS unit-tested directly.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CURVE_ORDER,
  CURVES,
  DRAW_MS,
  GRADIENT_ID,
  PATH_ID,
  PATH_REF,
  TRAIL_REPEATS,
  TRAIL_SEPARATOR,
  TRAIL_SPEED,
  advance,
  buildTrail,
  curveFor,
  dashPair,
  stepPercentPerSecond,
  unitLength,
  wrapPercent,
} from '../src/lib/authCurve.js'

const ROOT = join(import.meta.dirname, '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const curveCss = () => code(read('src', 'components', 'auth', 'AuthCurve.css'))
const curveComponent = () => code(read('src', 'components', 'auth', 'AuthCurve.jsx'))
const authPages = () => code(read('src', 'components', 'auth', 'AuthPages.jsx'))

/** Strip comments so prose naming a token is never mistaken for a declaration. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

describe('the two curves are the ones the design asked for', () => {
  it('both live in the same 100x60 box so one component draws both', () => {
    const source = curveComponent()
    expect(source).toMatch(/viewBox="0 0 100 60"/)
    expect(CURVE_ORDER).toEqual(['login', 'signup'])
    expect(Object.keys(CURVES).sort()).toEqual(['login', 'signup'])
  })

  it('login is the U-dip and signup is the S, verbatim', () => {
    // These are the coordinates from the brief. They are not derived from
    // anything, so changing them is a design change and the test should say
    // so rather than silently accept a different curve.
    expect(CURVES.login.d).toBe('M 10 50 Q 20 22, 42 25 T 48 38 Q 56 58, 76 36 T 65 19 Q 55 5, 45 2')
    expect(CURVES.signup.d).toBe('M 8 12 Q 35 18, 53 26.5 Q 31.8 40.5, 46.5 50.8 Q 72.5 46, 96.5 52')
  })

  it('an unknown mode falls back instead of throwing', () => {
    // The prop comes from a call site. A typo should draw the login dip, not
    // blank the page a signed-in user is trying to leave.
    expect(curveFor('nonsense')).toBe(CURVES.login)
    expect(curveFor(undefined)).toBe(CURVES.login)
    expect(curveFor('login')).toBe(CURVES.login)
  })

  it('each curve knows where it is going and what to say', () => {
    expect(CURVES.login.label).toBe('LOGIN')
    expect(CURVES.login.href).toBe('/login')
    expect(CURVES.signup.label).toBe('SIGNUP')
    expect(CURVES.signup.href).toBe('/signup')
  })
})

describe('the trail is periodic, which is what makes the loop seamless', () => {
  it('is the label plus a separator, repeated whole times', () => {
    expect(TRAIL_SEPARATOR).toBe(' • ')
    expect(buildTrail('LOGIN')).toBe(`LOGIN${TRAIL_SEPARATOR}`.repeat(TRAIL_REPEATS))
    expect(buildTrail('SIGNUP')).toContain(`SIGNUP${TRAIL_SEPARATOR}`)
    expect(buildTrail('LOGIN').length).toBe(TRAIL_REPEATS * 8)
  })

  it('one unit is the whole trail divided by the repeat count', () => {
    // This is the number the wrap is built from. If it were the full trail
    // length the loop would run once per 24 words instead of once per word.
    expect(unitLength(800, 24)).toBeCloseTo(800 / 24, 10)
    expect(unitLength(0, 24)).toBe(0)
    expect(unitLength(800, 0)).toBe(0)
  })

  it('shifting by exactly one unit is indistinguishable from not shifting', () => {
    const step = 15
    const wrap = 18.25
    // One full loop period expressed in milliseconds.
    const period = (wrap / step) * 1000
    expect(advance(0, period, step, wrap)).toBeCloseTo(0, 9)
    // And it is invisible from any other starting point too.
    expect(advance(-4.5, period, step, wrap)).toBeCloseTo(-4.5, 9)
  })
})

describe('the scroll maths is measured, never assumed', () => {
  it('speed converts through the path length, so both curves move alike', () => {
    // startOffset is a percentage of the path. Skipping this conversion is
    // what made the reference loop run at different speeds per curve.
    expect(stepPercentPerSecond(100, 26)).toBeCloseTo(26, 10)
    expect(stepPercentPerSecond(169.7, 26)).toBeCloseTo((26 / 169.7) * 100, 10)
    expect(stepPercentPerSecond(0, 26)).toBe(0)
    expect(stepPercentPerSecond(100, 0)).toBe(0)
  })

  it('the wrap is one unit as a percentage of the path', () => {
    expect(wrapPercent(100, 800, 24)).toBeCloseTo((800 / 24 / 100) * 100, 10)
    expect(wrapPercent(0, 800, 24)).toBe(0)
    expect(wrapPercent(100, 0, 24)).toBe(0)
    expect(wrapPercent(100, 800, 0)).toBe(0)
  })

  it('a long frame wraps more than once instead of jumping past the seam', () => {
    // A backgrounded tab hands back one enormous delta. The wrap is a loop,
    // not a subtraction: with a single `if` the offset would land in the
    // middle of the trail and the seam would flash.
    const step = 36
    const wrap = 18
    const afterAStall = advance(0, 3000, step, wrap)
    expect(afterAStall).toBeGreaterThan(-wrap)
    expect(afterAStall).toBeLessThanOrEqual(0)
  })

  it('an unmeasured element freezes the loop rather than dividing by zero', () => {
    // getComputedTextLength() is 0 before layout or while hidden. Running the
    // loop anyway would put the trail on an arbitrary speed forever.
    expect(advance(0, 16, 0, 0)).toBe(0)
    expect(advance(0, 16, 30, 0)).toBe(0)
  })

  it('the offset runs backwards along the path', () => {
    expect(advance(0, 1000, 10, 50)).toBeCloseTo(-10, 10)
  })
})

describe('the draw is sized from the path, not from a guessed number', () => {
  it('one number both hides the line and reveals it', () => {
    expect(dashPair(169.707)).toEqual({ dasharray: '170', dashoffset: '170' })
    expect(dashPair(129.535)).toEqual({ dasharray: '130', dashoffset: '130' })
  })

  it('an unmeasured path yields no dash rather than a NaN', () => {
    expect(dashPair(0)).toEqual({ dasharray: '', dashoffset: '' })
  })

  it('the component measures, and carries no length of its own', () => {
    const source = curveComponent()
    expect(source).toMatch(/path\.getTotalLength\(\)/)
    expect(source).toMatch(/dashPair\(total\)/)
    // The regression: a literal dash length is what made the reference
    // snippet's animation a no-op.
    expect(source).not.toMatch(/\b400\b/)
    expect(source).not.toMatch(/strokeDasharray\s*=\s*['"][^'"]*\d/)
  })

  it('the start state is committed before the line is released', () => {
    // Without the forced read both writes land in the same frame and the
    // curve is simply present instead of drawing.
    const source = curveComponent()
    expect(source).toMatch(/path\.style\.transition = 'none'/)
    expect(source).toMatch(/void path\.getBoundingClientRect\(\)/)
    const reset = source.indexOf('void path.getBoundingClientRect()')
    const release = source.indexOf("path.style.transition = ''")
    expect(release).toBeGreaterThan(reset)
  })

  it('reduced motion paints the line and skips the wipe', () => {
    expect(curveComponent()).toMatch(/if \(reduced\) return/)
    expect(curveComponent()).toMatch(/usePrefersReducedMotion/)
  })
})

describe('the loop is a DOM write in a frame, not a re-render', () => {
  it('cancels its frame on cleanup', () => {
    // StrictMode double-mounts every effect. A frame that outlives its
    // component is a frame writing to a detached node for the life of the
    // tab.
    expect(curveComponent()).toMatch(/return \(\) => cancelAnimationFrame\(frame\)/)
  })

  it('keeps no scroll state in React', () => {
    // Sixty state writes a second would re-render the auth form sixty times a
    // second for an effect nobody can interact with.
    const source = curveComponent()
    expect(source).toMatch(/trailPath\.setAttribute\('startOffset'/)
    expect(source).not.toMatch(/useState/)
  })

  it('treats the first frame as a baseline, not as elapsed time', () => {
    // The gap between scheduling the frame and running it is not a delay the
    // trail should inherit.
    expect(curveComponent()).toMatch(/previous === null \? 0 : now - previous/)
  })
})

describe('the reference is stable for the life of the page', () => {
  it('one path id, referenced rather than repointed', () => {
    // Safari does not reliably re-resolve a textPath whose href changed, so
    // the href is written once and only ever points at the same id.
    expect(PATH_REF).toBe(`#${PATH_ID}`)
    expect(curveComponent()).toMatch(/id=\{PATH_ID\}/)
    expect(curveComponent()).toMatch(/href=\{PATH_REF\}/)
    expect(curveComponent()).not.toMatch(/setAttribute\('href'/)
  })

  it('the gradient id in the stylesheet matches the id in the markup', () => {
    // The stroke paints from a paint-server reference, and a typo there is a
    // silently invisible line rather than an error.
    expect(GRADIENT_ID).toBe('auth-curve-grad')
    expect(curveCss()).toMatch(/stroke: url\(#auth-curve-grad\)/)
  })
})

describe('the ribbon is decoration, and says so', () => {
  it('is hidden from assistive technology and from the pointer', () => {
    // It carries no information the heading above it does not already carry,
    // and a full-width band across the top of the form would otherwise eat
    // the first click aimed at a field.
    const source = curveComponent()
    expect(source).toMatch(/aria-hidden="true"/)
    expect(source).toMatch(/focusable="false"/)
    expect(curveCss()).toMatch(/pointer-events: none/)
  })

  it('is present on every auth screen through one integration point', () => {
    // AuthShell is the only component all six auth screens share. Wiring the
    // ribbon anywhere else would mean six call sites and six chances to miss
    // one.
    const source = authPages()
    expect(source).toMatch(/import AuthCurve from '\.\/AuthCurve\.jsx'/)
    expect(source).toMatch(/mode = 'login'/)
    const shell = source.slice(source.indexOf('export function AuthShell'))
    expect(shell).toMatch(/<AuthCurve mode=\{mode\} \/>/)
  })

  it('draws the login dip on login and the S on signup', () => {
    const source = authPages()
    expect(source).toMatch(/<AuthShell\s*\n\s*mode="login"/)
    // Both signup call sites, including the two confirmation screens: they are
    // still signup, and the curve should not flicker to the login dip because
    // the form was replaced.
    expect(source.match(/<AuthShell\s*\n\s*mode="signup"/g)?.length).toBe(2)
  })

  it('sits above the back-link, not behind the title', () => {
    // The curves span nearly the full height of the viewBox, so anything the
    // ribbon overlapped would be a collision rather than a layering.
    const source = authPages()
    const shell = source.slice(source.indexOf('export function AuthShell'))
    const ribbon = shell.indexOf('<AuthCurve')
    const back = shell.indexOf('← Back to site')
    expect(ribbon).toBeGreaterThan(-1)
    expect(back).toBeGreaterThan(ribbon)
  })
})

describe('clicking a tab is what draws the curve', () => {
  it('the active tab redraws instead of navigating to where it already is', () => {
    // Pushing /login while already on /login changes nothing, so the ribbon
    // would not respond at all to the click that was supposed to draw it.
    const source = curveComponent()
    expect(source).toMatch(/if \(item\.id === curve\.id\) \{/)
    expect(source).toMatch(/event\.preventDefault\(\)\s*\n\s*draw\(\)/)
    expect(source).toMatch(/navigateApp\(item\.href\)/)
  })

  it('the tabs are real buttons that say which one is current', () => {
    // A div with an onClick would be unreachable by keyboard and would carry
    // no role; both are cheaper to prevent here than to debug later.
    const source = curveComponent()
    expect(source).toMatch(/role="group"/)
    expect(source).toMatch(/aria-current=\{active \? 'page' : undefined\}/)
    expect(source).toMatch(/type="button"/)
    expect(source.match(/<button/g)?.length).toBe(1)
  })

  it('never drifts: the tabs are not magnetic', () => {
    // A switcher that leans away from the pointer while you are deciding
    // where to go is the exact failure the drift rule exists to prevent.
    expect(curveComponent()).not.toMatch(/magnetic/)
    // The tabs borrow the product's own button so they cannot drift away from
    // the rest of the language: `btn btn--sm`, with the ghost variant for the
    // tab you are not on.
    expect(curveComponent()).toMatch(/'auth-curve__tab btn btn--primary btn--sm'/)
    expect(curveComponent()).toMatch(/'auth-curve__tab btn btn--ghost btn--sm'/)
  })
})

describe('the ribbon obeys the project CSS contracts', () => {
  it('declares its colours at point of use, never in :root', () => {
    // A token added to :root acquires an obligation to be mirrored in
    // .light-theme (tests/ui-polish.test.js enforces parity), and these
    // three blues are a flourish for one component.
    const css = curveCss()
    expect(css).not.toMatch(/^:root/m)
    expect(css).toMatch(/^\.auth-curve \{[^}]*--auth-curve-blue-hi: #3b82f6;/m)
    expect(css).toMatch(/^\.auth-curve \{[^}]*--auth-curve-blue-lo: #1d4ed8;/m)
  })

  it('uses no literal pixel radius', () => {
    // ui-polish reads the allowed scale out of index.css's --radius* tokens
    // and fails any other `border-radius: Npx` anywhere in src.
    expect(curveCss()).not.toMatch(/border-radius:\s*\d/)
    expect(curveCss()).toMatch(/border-radius: var\(--ld-r9\)/)
  })

  it('paints a stroke wide enough for the text to sit on', () => {
    const width = Number(curveCss().match(/stroke-width:\s*([\d.]+)/)?.[1])
    expect(width).toBeGreaterThanOrEqual(10)
    expect(width).toBeLessThanOrEqual(14)
  })

  it('keeps the glyphs legible on the blue', () => {
    // White on the light end of the gradient is about 3.6:1. The keyline is
    // what makes it comfortable, and paint-order is what keeps the stroke
    // from eating the letter shapes.
    const css = curveCss()
    expect(css).toMatch(/paint-order: stroke fill/)
    expect(css).toMatch(/fill: var\(--auth-curve-ink\)/)
    expect(css).toMatch(/stroke: var\(--auth-curve-edge\)/)
  })

  it('does not stretch the trail to fit', () => {
    // `slice` scales uniformly and crops; `none` would scale x and y
    // independently, which turns every glyph into a smear.
    expect(curveComponent()).toMatch(/preserveAspectRatio="xMidYMid slice"/)
    expect(curveComponent()).not.toMatch(/preserveAspectRatio="none"/)
  })

  it('stops animating when the reader asked it to', () => {
    const css = curveCss()
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/transition: none/)
  })

  it('draws over the same duration the component asks for', () => {
    // DRAW_MS and the CSS transition are two numbers describing one thing. If
    // they drift the wipe takes longer or shorter than the state says.
    expect(DRAW_MS).toBe(1200)
    expect(curveCss()).toMatch(/stroke-dashoffset 1200ms/)
  })
})

describe('the trail scrolls at a readable pace', () => {
  it('speed is in path units per second, not pixels', () => {
    // The ribbon scales to fill its band, so a pixel speed would run three
    // times faster on a desktop than on a phone for the same number.
    expect(TRAIL_SPEED).toBe(26)
    expect(stepPercentPerSecond(169.707, TRAIL_SPEED)).toBeCloseTo((26 / 169.707) * 100, 9)
  })
})