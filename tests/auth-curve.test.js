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
 *     measured. The two curves in the 100x60 viewBox are 236.3 and 182.4 user
 *     units long as they now stand — both longer than 400 was assumed once,
 *     but for the wrong reason: they used to be 169.7 and 129.5, which is
 *     exactly why a literal is a liability. A dasharray longer than the path
 *     does not hide the line — it makes `dashoffset` meaningless and the draw
 *     animation is a no-op, so the curve is simply already there. The length
 *     has to come from `getTotalLength()`, which is why `dashPair()` exists
 *     and why a literal number in the component is a regression.
 *
 *  2. `startOffset` is a percentage of the PATH, not of the text. Walking it
 *     down by a fixed amount per frame therefore runs the two curves at two
 *     different speeds, and faster or slower depending on how wide the
 *     browser window is. Converting through the path length is what makes one
 *     number mean the same thing on both curves.
 *
 *  3. The wrap has to land on a period of the TRAIL, not on the length of the
 *     trail. `LABEL • ` repeated `TRAIL_REPEATS` times is periodic with period
 *     `textLength / TRAIL_REPEATS`, so shifting by exactly that is invisible —
 *     the glyphs land back where they started, pixel for pixel, forever.
 *     Wrapping on the full string instead would leave the seam visible once a
 *     minute.
 *
 * Two things the ribbon is not allowed to do, both because they were tried:
 *
 *  4. It is not a card in the page. It began as a framed strip above the form
 *     and is now a full-bleed layer on the auth shell, dissolving at its edges
 *     through a mask, with no frame, no radius and no background of its own.
 *
 *  5. It does not carry a switcher. It used to render Sign in / Sign up as the
 *     first thing in the reading column, above the email field. Both buttons
 *     sat on a page that already had a link to the other form under its submit
 *     button, and the first thing a reader's eye landed on was a control that
 *     went nowhere they had not already been invited to go. Backgrounds should
 *     not navigate.
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
  CURVES,
  DRAW_MASK_ID,
  DRAW_MS,
  EDGE_FADE_ID,
  EDGE_FADE_STOPS,
  EDGE_MASK_ID,
  GRADIENT_ID,
  MASK_REGION,
  PATH_ID,
  PATH_REF,
  TRAIL_REPEATS,
  TRAIL_SEPARATOR,
  TRAIL_SPEED,
  VIEWBOX,
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

/**
 * `AuthShell` and nothing else. Slicing from its declaration to the end of the
 * file would also swallow `LoginPage`, `SignupPage` and `AuthCallbackPage`,
 * whose own `useState` calls have nothing to do with the shell — so any
 * assertion about what the shell does *not* contain would fail for the wrong
 * reason.
 */
const shell = () =>
  authPages().slice(
    authPages().indexOf('export function AuthShell'),
    authPages().indexOf('export function LoginPage'),
  )

/** Strip comments so prose naming a token is never mistaken for a declaration. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * One CSS rule, brace balanced. Reading `[\s\S]*?` off the selector would run
 * through every later rule and prove nothing about the one being asked about.
 */
const css_block = (source, selector) => {
  const start = source.indexOf(selector)
  if (start < 0) return ''
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}' && (depth -= 1) === 0) return source.slice(open + 1, i)
  }
  return ''
}

describe('the two curves are the ones the design asked for', () => {
  it('both live in the same 100x60 box so one component draws both', () => {
    const source = curveComponent()
    expect(source).toMatch(/viewBox="0 0 100 60"/)
    expect(source).toMatch(/preserveAspectRatio="xMidYMid slice"/)
    expect(Object.keys(CURVES).sort()).toEqual(['login', 'signup'])
  })

  it('login is the U-dip and signup is the S, verbatim', () => {
    // The middle of each curve is the original geometry from the brief, with
    // one addition at each end: a lead-in and a lead-out that run off the
    // page. Changing any of these coordinates is a design change and the test
    // should say so rather than silently accept a different curve.
    expect(CURVES.login.d).toBe(
      'M -20 56 Q 3.3 68.8 10 50 Q 20 22, 42 25 T 48 38 Q 56 58, 76 36 T 65 19 Q 55 5, 45 2 L 16 -6.7',
    )
    expect(CURVES.signup.d).toBe(
      'M -20 5.8 L 8 12 Q 35 18, 53 26.5 Q 31.8 40.5, 46.5 50.8 Q 72.5 46, 96.5 52 L 120 57.9',
    )
  })

  it('begins and ends off the page, on every viewport', () => {
    // `slice` scales to cover, so how much of the viewBox you can see depends
    // on the viewport's aspect ratio — narrowest on a phone. The maximal
    // visible box at ANY viewport is exactly `VIEWBOX`, so an endpoint inside
    // it is potentially visible and an endpoint outside it is off-page
    // everywhere. This is the regression guard: the curves used to start at
    // (10, 50) and stop at (45, 2), both inside the box, so on a wide screen
    // the ribbon began and ended in mid-air with a visible cap.
    const outside = ({ x, y }) =>
      x < VIEWBOX.x || x > VIEWBOX.x + VIEWBOX.width || y < VIEWBOX.y || y > VIEWBOX.y + VIEWBOX.height

    for (const curve of Object.values(CURVES)) {
      const start = /^M\s+(-?[\d.]+)\s+(-?[\d.]+)/.exec(curve.d)
      const pairs = [...curve.d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)]
      const [, endX, endY] = pairs[pairs.length - 1]
      expect(outside({ x: Number(start[1]), y: Number(start[2]) })).toBe(true)
      expect(outside({ x: Number(endX), y: Number(endY) })).toBe(true)
    }
  })

  it('extends each end along that end\'s own tangent, so the joins are invisible', () => {
    // A lead-in that arrives at a different angle from the curve it continues
    // puts a kink at the join, and a kink is a spike once the stroke is thick
    // enough. Each extension therefore has to leave and arrive parallel to the
    // tangent it is continuing.
    expect(CURVES.login.d).toMatch(/^M -20 56 Q 3\.3 68\.8 10 50/) // (10,-28) continued
    expect(CURVES.login.d).toMatch(/45 2 L 16 -6\.7$/) // parallel to (-10,-3)
    expect(CURVES.signup.d).toMatch(/^M -20 5\.8 L 8 12/) // tangent is shallow enough
    expect(CURVES.signup.d).toMatch(/96\.5 52 L 120 57\.9$/)
  })

  it('an unknown mode falls back instead of throwing', () => {
    // The prop comes from a call site. A typo should draw the login dip, not
    // blank the page a signed-in user is trying to leave.
    expect(curveFor('nonsense')).toBe(CURVES.login)
    expect(curveFor(undefined)).toBe(CURVES.login)
    expect(curveFor('login')).toBe(CURVES.login)
  })

  it('carries the one thing it needs and nothing else', () => {
    // `label` is the only field that survives. The curves used to also carry
    // `tab`, `href` and `hint`, all of which only the switcher read — and the
    // switcher is gone. A curve table that carries a route and a heading it
    // never draws is a second source of truth waiting to disagree with the
    // page that does draw them.
    expect(CURVES.login.label).toBe('SIGN IN')
    expect(CURVES.signup.label).toBe('SIGN UP')
    for (const curve of Object.values(CURVES)) {
      expect(Object.keys(curve).sort()).toEqual(['d', 'id', 'label'])
    }
  })

  it('never says "log in" in the trail', () => {
    // One vocabulary on the auth pages. A test rather than a convention
    // because nothing else in the codebase can catch it: "Log in" is correct
    // in the form\'s own submit button, which this does not own.
    const labels = Object.values(CURVES)
      .map((c) => c.label)
      .join(' ')
    expect(labels).not.toMatch(/log\s?in/i)
    expect(labels).not.toMatch(/log\s?out/i)
  })
})

describe('the trail is periodic, which is what makes the loop seamless', () => {
  it('is the label plus a separator, repeated whole times', () => {
    expect(TRAIL_SEPARATOR).toBe(' • ')
    // Separator first, label last: it reads identically, and it ends on a
    // letter rather than on the space a trailing separator would leave,
    // which the renderer trims. A string whose final period is short is
    // not periodic, and a non-periodic trail shows its seam once a cycle.
    expect(buildTrail('SIGN IN')).toBe(`${TRAIL_SEPARATOR}SIGN IN`.repeat(TRAIL_REPEATS))
    expect(buildTrail('SIGN UP')).toContain(`${TRAIL_SEPARATOR}SIGN UP`)
    expect(buildTrail('SIGN IN').endsWith('SIGN IN')).toBe(true)
    expect(buildTrail('SIGN UP').endsWith('SIGN UP')).toBe(true)
    // "SIGN IN • " is ten characters, not the eight "LOGIN • " was. A
    // hardcoded multiplier from the old label would have quietly truncated a
    // word without failing anything, which is why it is derived instead.
    expect(buildTrail('SIGN IN').length).toBe(TRAIL_REPEATS * 10)
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
    expect(dashPair(236.28)).toEqual({ dasharray: '237', dashoffset: '237' })
    expect(dashPair(182.44)).toEqual({ dasharray: '183', dashoffset: '183' })
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
    expect(source).toMatch(/style\.transition = 'none'/)
    expect(source).toMatch(/void path\.getBoundingClientRect\(\)/)
    const reset = source.indexOf('void path.getBoundingClientRect()')
    const release = source.indexOf("style.transition = ''")
    expect(release).toBeGreaterThan(reset)
  })

  it('writes the line, its halo and its mask twin in one breath', () => {
    // The words are revealed by the same wipe as the ribbon, and the glow by
    // the wipe before that. Written a frame apart — or worse, only written to
    // the visible line — the trail would be scrolling along a curve that has
    // not arrived yet, or the halo would bloom behind a ribbon that is not
    // there. One collection, one forced reflow, one release.
    const source = curveComponent()
    expect(source).toMatch(/const lines = \[halo, path, maskPath\]\.filter\(Boolean\)/)
    expect(source).toMatch(/for \(const line of lines\) \{/)
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

describe('the ribbon is the background of the page, not a card in it', () => {
  it('covers the shell instead of sitting in the reading column', () => {
    // It used to be a framed stage above the form. A full-bleed layer cannot be
    // a child of `.adv-shell__inner--narrow` — that is 640px of a 1440px page,
    // which is a card again by another name. Its containing block has to be the
    // shell, so it is a sibling of the column and precedes it.
    const source = authPages()
    const shell = source.slice(source.indexOf('export function AuthShell'))
    const ribbon = shell.indexOf('<AuthCurve')
    const column = shell.indexOf('adv-shell__inner')
    expect(ribbon).toBeGreaterThan(-1)
    expect(column).toBeGreaterThan(ribbon)
    expect(curveCss()).toMatch(/\.auth-curve \{[^}]*position: absolute;/m)
    expect(curveCss()).toMatch(/\.auth-curve \{[^}]*inset: 0;/m)
  })

  it('lifts the reading column instead of lowering the ribbon', () => {
    // An absolutely positioned layer paints above in-flow content in the same
    // stacking context whatever its z-index says. Dropping the ribbon to a
    // negative z-index would put it behind the shell's own opaque background
    // and the ribbon would vanish — which is a far worse regression than the
    // one this whole pass exists to fix.
    const css = curveCss()
    expect(css).toMatch(/\.auth-curve ~ \.adv-shell__inner \{[^}]*position: relative;/m)
    expect(css).not.toMatch(/z-index:\s*-\d/)
  })

  it('never draws a frame', () => {
    // The brief: no sharp edges. There is no stage, no border, no radius and no
    // panel background left to give the ribbon a rectangular boundary — the
    // soft edge is a falloff instead.
    const css = curveCss()
    expect(css).not.toMatch(/auth-curve__stage/)
    expect(css).not.toMatch(/border:/)
    expect(css).not.toMatch(/border-radius:/)
  })

  it('dissolves at the edges with a mask rather than stopping at one', () => {
    // A radial falloff painted white through the middle and zero at the rim.
    // Everything is sized in user units on the viewBox, and the region is
    // deliberately larger than the 100x60 box: the curves run past the top and
    // the bottom edge and a mask that stopped at the box would clip the ribbon
    // instead of letting it go.
    expect(EDGE_MASK_ID).toBe('auth-curve-edge')
    expect(EDGE_FADE_ID).toBe('auth-curve-fade')
    expect(MASK_REGION.width).toBeGreaterThan(100)
    expect(MASK_REGION.height).toBeGreaterThan(60)
    expect(EDGE_FADE_STOPS.at(-1).offset).toBe(1)
    const css = curveCss()
    expect(css).toMatch(/fill: url\(#auth-curve-fade\)/)
    expect(css).toMatch(/stop-opacity: 0/)
    expect(curveComponent()).toMatch(/mask=\{`url\(#\$\{EDGE_MASK_ID\}\)`\}/)
  })

  it('lets the words arrive with the ribbon, not before it', () => {
    // A white copy of the same path, under a mask on the text, stroked with the
    // same dash. That is the mechanism behind "as the ribbon appears the text
    // appears with it" — the trail is only painted where the stroke has been.
    expect(DRAW_MASK_ID).toBe('auth-curve-draw')
    const source = curveComponent()
    expect(source).toMatch(/id=\{DRAW_MASK_ID\}/)
    expect(source).toMatch(/className="auth-curve__mask-line" d=\{curve\.d\}/)
    expect(source).toMatch(/mask=\{`url\(#\$\{DRAW_MASK_ID\}\)`\}/)
    // The mask is white and never stroked visibly: it is a stencil.
    expect(curveCss()).toMatch(/\.auth-curve__mask-line \{[^}]*stroke: var\(--auth-curve-ink\)/m)
  })

  it('every part of the ribbon carries the identical wipe', () => {
    // Three, not two: the ribbon is drawn as three copies of one path — the
    // halo underneath, the gradient line, and the white mask twin that reveals
    // the words. Same duration, same easing. If any of them drifts the reveal
    // edge stops lining up with the ribbon and the words appear at its margin,
    // or the glow arrives at a different moment than the thing it is a glow of.
    const css = curveCss()
    const wipe = /stroke-dashoffset 1200ms cubic-bezier\(0\.65, 0, 0\.35, 1\)/
    expect(css.match(new RegExp(wipe.source, 'g'))?.length).toBe(3)
    const widths = [
      css.match(/\.auth-curve__line \{[^}]*stroke-width: ([\d.]+)/m)?.[1],
      css.match(/\.auth-curve__mask-line \{[^}]*stroke-width: ([\d.]+)/m)?.[1],
    ]
    expect(widths).toHaveLength(2)
    expect(widths[0]).toBeDefined()
    expect(widths[0]).toBe(widths[1])
  })
})

describe('the ribbon is decoration, and says so', () => {
  it('is hidden from assistive technology and from the pointer', () => {
    // It carries no information the heading above it does not already carry,
    // and a full-bleed band behind the form would otherwise eat the first
    // click aimed at a field. This one matters more than it used to: the layer
    // is no longer a strip above the form, it is behind all of it.
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
    expect(shell()).toMatch(/<AuthCurve mode=\{mode\} \/>/)
  })

  it('draws the login dip on login and the S on signup', () => {
    const source = authPages()
    expect(source).toMatch(/<AuthShell\s*\n\s*mode="login"/)
    // Both signup call sites, including the two confirmation screens: they are
    // still signup, and the curve should not flicker to the login dip because
    // the form was replaced.
    expect(source.match(/<AuthShell\s*\n\s*mode="signup"/g)?.length).toBe(2)
  })

  it('adds no buttons of its own to the reading column', () => {
    // The ribbon used to render a Sign in / Sign up switcher as the first
    // thing inside `.adv-shell__inner`, so two buttons sat directly above the
    // email field and answered a question the form already answers with a link
    // under its submit button. A full-bleed background that also navigates is
    // two features wearing one component; scenery should not navigate.
    const column = shell().slice(shell().indexOf('adv-shell__inner'))
    // The one button the column has always had is the link back to the site.
    // Counting it is better than banning buttons: a future copy button is
    // allowed here, a switcher is not.
    expect(column.match(/<button/g)?.length).toBe(1)
    expect(column).toMatch(/← Back to site/)
    expect(shell()).not.toMatch(/AuthCurveTabs/)
    expect(authPages()).not.toMatch(/AuthCurveTabs/)
    expect(curveComponent()).not.toMatch(/<button|navigateApp|AuthCurveTabs/)
  })

  it('leaves no dead switcher styling behind', () => {
    // Rules nothing selects are not free: they read as current, and the next
    // person to look for the switcher finds a class name and no component.
    const css = curveCss()
    expect(css).not.toMatch(/auth-curve__tab/)
    expect(curveComponent()).not.toMatch(/auth-curve__tab/)
  })

  it('draws once on arrival, and has no replay machinery to keep', () => {
    // The counter existed only so a click on the already-active tab could
    // redraw. With no tabs there is no click to serve, so the ribbon is keyed
    // on nothing, owns no state, and redraws when the mode actually changes —
    // which the effect already handles through `curve.id`.
    expect(shell()).not.toMatch(/replay|setReplay|useState/)
    expect(shell()).not.toMatch(/<AuthCurve\s+key=/)
    expect(curveComponent()).toMatch(/\[draw, curve\.id\]/)
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
    // and fails any other `border-radius: Npx` anywhere in src. The ribbon has
    // no radius at all now, which is the assertion that matters — the one that
    // used to be here guarded a frame that no longer exists.
    expect(curveCss()).not.toMatch(/border-radius/)
  })

  it('paints a stroke wide enough for the text to sit inside', () => {
    // The brief asked for 10-14px, which was calibrated to the small framed
    // stage this replaced. Here the numbers are user units on a viewBox that
    // is scaled to fill a whole page, so a literal range would be meaningless.
    // What actually has to hold is the relationship: the glyphs are inscribed
    // in the ribbon, so the stroke must be at least as tall as the text.
    const css = curveCss()
    const stroke = Number(css.match(/\.auth-curve__line \{[^}]*stroke-width: ([\d.]+)/m)?.[1])
    const text = Number(css.match(/\.auth-curve__trail \{[^}]*font-size: ([\d.]+)/m)?.[1])
    expect(stroke).toBeGreaterThan(text)
    // And still a band rather than a hairline. The stroke went 8 -> 5 -> 3.2 and
    // the trail 3.6 -> 2.2 -> 1.4, keeping the ratio — the thing the glyphs
    // actually depend on — while letting more of the page show through. The
    // floors are the floor and not the old values: below about 2.5 the band
    // stops reading as a ribbon and starts reading as a stripe with letters
    // painted on it, so 2.5 is where this stops being thinner and starts being
    // wrong.
    expect(stroke).toBeGreaterThanOrEqual(2.5)
    expect(text).toBeGreaterThanOrEqual(1)
    // The ratio is the contract, and it is asserted as a ratio so thinning
    // one without the other cannot pass.
    expect(text / stroke).toBeGreaterThan(0.3)
    expect(text / stroke).toBeLessThan(0.6)
    // The halo is the line's bloom, not an absolute width: 1.8x. Without this,
    // thinning the line alone turns the glow into a smear.
    const halo = Number(css.match(/\.auth-curve__halo \{[^}]*stroke-width: ([\d.]+)/m)?.[1])
    expect(halo / stroke).toBeGreaterThan(1.5)
    expect(halo / stroke).toBeLessThan(2.2)
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
    expect(TRAIL_SPEED).toBe(8)
    expect(stepPercentPerSecond(236.28, TRAIL_SPEED)).toBeCloseTo((8 / 236.28) * 100, 9)
  })

  it('is slow enough to read as texture rather than as text', () => {
    // The number above is only meaningful against the path it runs on: at
    // eight units a second, one repeat takes about half a minute to cross the
    // ~170-unit path. Anything much faster and a word crosses the screen inside
    // a second, at which point it stops being a texture the eye slides over and
    // becomes something you try to read — which is not what background is for.
    const secondsToCross = 236.28 / TRAIL_SPEED
    expect(secondsToCross).toBeGreaterThan(15)
  })
})
describe('the ribbon is cheap to animate and soft at the corners', () => {
  // Both of these are regressions of a real complaint — "it is very very
  // laggy" and "the curve has sharp edges" — so both are pinned here rather
  // than left to taste. The measurements behind them are in the source.

  it('paints no filter, because a filter here cost two thirds of the frames', () => {
    // Measured over three alternating passes with everything else held
    // constant: ~17fps with `filter: drop-shadow(...)` on the line, ~46fps
    // without. A CSS filter has to be rasterised into its own buffer, and the
    // trail moving inside the masked group invalidates that buffer every frame
    // across the whole layer. The glow is now a wider, fainter stroke instead.
    expect(curveCss()).not.toMatch(/filter\s*:/)
    expect(curveComponent()).toMatch(/className="auth-curve__halo"/)
  })

  it('glows with a stroke that draws alongside the line, not above it', () => {
    const css = curveCss()
    expect(css).toMatch(/\.auth-curve__halo \{[^}]*stroke: var\(--auth-curve-blue-lo\)/m)
    expect(css).toMatch(/\.auth-curve__halo \{[^}]*stroke-width: ([\d.]+)/m)
    // The halo has to be wider than the line or it is not a halo, it is a
    // hairline behind the ribbon's own edge.
    const halo = Number(css.match(/\.auth-curve__halo \{[^}]*stroke-width: ([\d.]+)/m)?.[1])
    const line = Number(css.match(/\.auth-curve__line \{[^}]*stroke-width: ([\d.]+)/m)?.[1])
    expect(halo).toBeGreaterThan(line)
  })

  it('rounds every join, because these paths genuinely kink', () => {
    // `T 48 38` continues from `Q 20 22, 42 25` at a slightly different
    // angle, which leaves a kink at (42, 25); the signup path changes
    // direction at both of its joints. The SVG default is `miter`, and a miter
    // turns every one of those into a spike pointing off the curve.
    for (const rule of ['line', 'halo', 'mask-line']) {
      const block = css_block(curveCss(), `.auth-curve__${rule}`)
      expect(block).toMatch(/stroke-linejoin: round/)
      expect(block).toMatch(/stroke-linecap: round/)
    }
  })

  it('fades through a shoulder, so the falloff has no visible rim', () => {
    // Flat until the last stop and then straight to nothing leaves a ring
    // where the falloff changes character. The shoulder is what makes the
    // edge read as a fade rather than as a boundary.
    expect(EDGE_FADE_STOPS.length).toBeGreaterThanOrEqual(4)
    const soft = EDGE_FADE_STOPS.find((s) => s.key === 'soft')
    expect(soft).toBeDefined()
    expect(soft.offset).toBeLessThan(1)
    expect(curveCss()).toMatch(/\.auth-curve__fade--soft \{[^}]*stop-opacity: 0\./m)
  })
})

describe('the auth pages are one screen: a header and the form, nothing below the fold', () => {
  const landingCss = () => code(read('src', 'components', 'landing', 'landing.css'))
  const footer = () => code(read('src', 'components', 'Footer.jsx'))

  it('marks its shell so the layout can opt in without moving any other page', () => {
    // `.adv-shell` is shared with the dashboards and /advertiser, which
    // genuinely do scroll and are genuinely taller than the window. A change
    // to `.adv-shell` itself would reflow all of them, so the one-screen
    // treatment hangs off a name only this section carries.
    expect(shell()).toMatch(/<section className="adv-shell adv-shell--auth" aria-label=\{title\}>/)
    expect(authPages().match(/adv-shell--auth/g)?.length).toBe(1)
  })

  it('sizes the page, not the surface, because the footer is a sibling of both', () => {
    // App.jsx renders <Footer/> next to PageChrome's `.clr-surface`, so the
    // surface was never an element the footer could sit inside and could never
    // be the frame. #root is the nearest ancestor of the header, the form and
    // the footer at once. The id also outranks every class rule regardless of
    // which file imports last.
    const block = css_block(curveCss(), '#root:has(.adv-shell--auth) {')
    expect(block).toMatch(/height: 100dvh/)
    expect(block).toMatch(/display: flex/)
    expect(block).toMatch(/flex-direction: column/)
    // `overflow: hidden` would clip the submit button off a short window
    // instead of letting it scroll. A clipped submit button is a dead form.
    expect(block).toMatch(/overflow-y: auto/)
    expect(block).not.toMatch(/overflow: hidden/)
  })

  it('centres the column with auto margins, never with justify-content', () => {
    // This was a real defect, not a style preference. `justify-content:
    // center` centres unconditionally, so on a 1280x800 window the back link
    // and the eyebrow were landing at a NEGATIVE top, behind the sticky
    // header, with nothing to scroll back to. An auto block margin resolves to
    // zero when there is no free space and centres when there is, so the column
    // either sits in the middle or starts at the top and overflows downward,
    // where #root can scroll it.
    const css = curveCss()
    expect(css).toMatch(
      /#root:has\(\.adv-shell--auth\) \.adv-shell\.adv-shell--auth \.adv-shell__inner--narrow \{ margin-block: auto; \}/,
    )
    expect(css).not.toMatch(/justify-content: center/)
    // Three classes beat advertiser.css's `margin: 0 auto` on
    // .adv-shell__inner, so this does not depend on import order.
    expect(css).not.toMatch(/\.adv-shell__inner--narrow \{ margin: /)
  })

  it('hands air back rather than padding a short window out of the fold', () => {
    // The signup form is the only thing on the site that has not fitted a
    // short window. Below 780px and again below 720px the panel padding and
    // the column gap come off; above them they come back. Anything that fixed
    // this by hiding the overflow instead would have taken the submit button
    // with it.
    const css = curveCss()
    expect(css).toMatch(/@media \(max-height: 860px\)/)
    expect(css).toMatch(/@media \(max-height: 780px\)/)
    expect(css).toMatch(/@media \(max-height: 720px\)/)
    // The panel's 24px padding is set on a plain class in advertiser.css,
    // which loads AFTER this file, so the selector carries both names.
    expect(css).toMatch(
      /@media \(max-height: 780px\) \{[\s\S]*?\.panel\.adv-panel \{ padding: 16px; \}/,
    )
  })

  it('stops the landing stylesheet styling a footer that is not the landing one', () => {
    // A bare `footer` selector in landing.css was adding 56px of top padding,
    // 44px of bottom padding and a 96px top margin to the SHARED site footer,
    // on every route, because landing.css is in the bundle for all of them.
    // That is 402px of document height that only the marketing page ever
    // wanted. The landing's own footer is `.foot` inside `.landing`.
    const css = landingCss()
    expect(css).toMatch(/\.landing footer\{/)
    expect(css).not.toMatch(/(^|[,>~])footer\{/m)
    // Two rules leaked, not one: the padding/margin block, and further up a
    // `position: relative; z-index: 1` in the landing's own reset. Harmless
    // for height, still the same bug, so both are scoped. The regex looks for
    // `footer{` at the start of a selector or straight after a combinator —
    // `.landing footer{` has a space before it and does not match.
    expect(css).toMatch(/main,header\.nav,\.landing footer\{/)
  })

  it('renders no footer on either auth screen', () => {
    // Footer.jsx already declined to render on /app/**, because a dashboard
    // has no room for one. The auth screens say the same: the form is the page,
    // and the legal links the footer carried are one tap away in the header
    // everywhere else.
    const source = footer()
    expect(source).toMatch(/const isAuth = clean === '\/login' \|\| clean === '\/signup'/)
    expect(source).toMatch(/if \(isDashboard \|\| isAuth\) return null/)
    // The dashboard exclusion has to survive being widened, or /app/** would
    // quietly start showing a footer again.
    expect(source).toMatch(/const \[theme, setTheme\]/) // unrelated guard: keeps the file honest
    expect(source.match(/isDashboard/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('the shell says what it has to say', () => {
  it('puts the back link on the eyebrow row instead of spending a row on it', () => {
    // The back link had a row of its own, and that row cost 21px plus a gap on
    // the one screen with no slack left. The header 73px above already offers
    // Home, Developers, Advertisers and the wordmark, so this is the least
    // load-bearing element on the page and it is page metadata anyway — same
    // as the eyebrow, so the two belong side by side.
    const source = shell()
    const meta = source.slice(source.indexOf('adv-shell__meta'), source.indexOf('</div>', source.indexOf('adv-shell__meta')))
    expect(source).toMatch(/<div className="adv-shell__meta">/)
    expect(meta).toMatch(/← Back to site/)
    expect(meta).toMatch(/eyebrow eyebrow--plain/)
    // It must be inside the row, not merely near it: the old markup had two
    // siblings and the whole saving depends on them nesting.
    const link = source.indexOf('← Back to site')
    const row = source.indexOf('adv-shell__meta')
    expect(link).toBeGreaterThan(row)

    const css = curveCss()
    expect(css).toMatch(/\.adv-shell__meta \{[^}]*display: flex;/)
    expect(css).toMatch(/\.adv-shell__meta \{[^}]*justify-content: space-between;/)
    expect(css).toMatch(/\.adv-shell__meta \{[^}]*align-items: baseline;/)
    // `flex-wrap: wrap` on purpose: at 320px the eyebrow drops below the link
    // rather than the two colliding. It never wraps in practice.
    expect(css).toMatch(/\.adv-shell__meta \{[^}]*flex-wrap: wrap;/)
  })

  it('has a tier for the 720p and short-768 band', () => {
    // 768 was still not enough and 800 was: after the back link moved, the
    // column came out 30px over on a 1280x720 window and 36px over on a
    // 1440x760 one. This tier gives back ~40px and only here — 4px of shell
    // padding, 4px gaps, a 10px panel and a 38px heading. Every one of those is
    // inside the range the other breakpoints already use, so nothing here looks
    // like a different design.
    const css = curveCss()
    const tier = /@media \(max-height: 760px\) \{[\s\S]*?\n\}/.exec(css)?.[0] || ''
    expect(tier).toMatch(/padding: 4px var\(--gutter\)/)
    expect(tier).toMatch(/gap: 4px/)
    expect(tier).toMatch(/\.panel\.adv-panel \{ padding: 10px; \}/)
    expect(tier).toMatch(/line-height: 1\.45/)
    expect(tier).toMatch(/block__title \{ font-size: 38px; \}/)
  })

  it('never gets the height by taking something away from the reader', () => {
    // The temptation at 720px was to hide the body copy or collapse the form.
    // Neither happens: the two blocks the page exists for are still there, at
    // 17px and at full height. The measured result is that the signup column
    // fits a 720px window with zero overflow and a 640px window still scrolls
    // inside itself rather than clipping the submit button.
    const css = curveCss()
    expect(css).not.toMatch(/\.block__body[^}]*display: none/)
    expect(css).not.toMatch(/\.panel\.adv-panel[^}]*display: none/)
    // `overflow-y: auto`, not `hidden`: a clipped submit button is a dead form.
    const root = css_block(css, '#root:has(.adv-shell--auth) {')
    expect(root).toMatch(/overflow-y: auto/)
    expect(root).not.toMatch(/overflow: hidden/)
  })
})

describe('the shell is not competing with the ribbon behind it', () => {
  it('the body and the notes are both lifted off the failing grey', () => {
    // `.form__note` asks for `var(--ink-4)`, and `--ink-4` is not one of the
    // tokens the chrome bridge re-exports, so it falls through to an index.css
    // value: `#55555f`, about 2.6:1 at 9.5px. It was not being outshone by the
    // ribbon, it was unreadable. The body was fine on flat ground at about 7:1
    // and lost only where the curve crosses it.
    const css = curveCss()
    expect(css).toMatch(/> \.block__body \{[^}]*color: var\(--ld-ink\);/)
    expect(css).toMatch(/> \.block__body \{[^}]*font-size: 17px;/)
    expect(css).toMatch(/> \.form__note \{[^}]*color: var\(--ld-ink-2\);/)
    expect(css).toMatch(/> \.form__note \{[^}]*font-size: 12\.5px;/)
    // And the back link gets the same treatment, because it is the same
    // element and it sits on the same background. It moved into `.adv-shell__meta`
    // when it shared a row with the eyebrow, so both selectors have to be named.
    expect(css).toMatch(/\.adv-shell__meta > \.form__note,/)
  })

  it('lifts the lines that carry an action and leaves the captions alone', () => {
    // The ribbon's switcher is gone, so the in-form cross-links — "Create one"
    // on sign in, "Log in" on sign up, plus "Forgot password?" — are the only
    // way between the two auth screens. They are `.adv-link` buttons inside a
    // `.form__note`, and `.adv-link` has no colour rule of its own anywhere in
    // the project, so they inherited the note's 2.6:1 grey. A page that removed
    // its switcher and left the replacement unreadable has not replaced it.
    //
    // `:has()` picks out the notes that CONTAIN an action, which is what keeps
    // the panel's genuine captions — "Step 1 of 2 - credentials", "Pick
    // Advertiser or Developer to show the profile fields" — at 9.5px, where
    // they belong. Measured live: those two are still rgb(85,85,95) at 9.5px
    // while the three action lines are rgb(162,162,173) at 12.5px.
    const css = curveCss()
    expect(css).toMatch(/\.form__note:has\(\.adv-link\) \{/)
    expect(css).toMatch(/\.panel\.adv-panel \.adv-link \{[^}]*color: var\(--ld-ink\);/)
    expect(css).toMatch(/\.panel\.adv-panel \.adv-link \{[^}]*font-size: 12\.5px;/)
    // The captions are protected by the `:has()`, not by a negation rule that a
    // future note could quietly fall outside of.
    expect(css).not.toMatch(/\.adv-shell__inner--narrow \.panel \.adv-panel > \.form__note \{/)
  })

  it('is scoped to the auth pages, so nothing else on the site moves', () => {
    // Every rule in this section hangs off `#root:has(.adv-shell--auth)`, which
    // only exists on /login and /signup. A bare `.block__body` or
    // `.form__note` rule here would repaint the developer console, the
    // advertiser console and the marketing pages.
    const css = curveCss()
    const lifted = css.match(/#[^\n]*\{[^}]*(color|font-size)[^}]*\}/g) || []
    expect(lifted.length).toBeGreaterThan(0)
    for (const rule of lifted) expect(rule).toMatch(/#root:has\(\.adv-shell--auth\)/)
  })
})
