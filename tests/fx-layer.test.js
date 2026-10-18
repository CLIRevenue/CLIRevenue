import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* The effects layer, and the two ways it was wrong before it was pinned.

   fx.css is twenty-four pieces of motion, depth and colour that belong to
   no single surface, and fx.js is the runtime that drives the ones that
   cannot be done in CSS. Between them they had two bugs that every test
   in this repo passed straight over, because neither of them is a
   syntax error and neither of them fails a build:

   1. THE PALETTE FROZE AT :root. The first draft aliased the colours on
      `body` — `--fx-signal: var(--signal, #6f8cff)` — on the reasonable
      theory that one alias beats twenty fallbacks. It is wrong, because
      a custom property is substituted where it is DECLARED, not where it
      is used. On `/developer` the alias computed to `#60A5FA`
      (index.css :root, the pre-redesign blue) on the same page where
      `--signal` on `.clr-surface` read `#6f8cff`. Every accent in the
      layer was silently the wrong blue, and nothing anywhere complained.
      Colours are now asked for at each use site as
      `var(--signal, #6f8cff)`; only the motion constants are aliased,
      because those genuinely are the same everywhere.

   2. THE UNDERLINE WAS INVISIBLE. The field rules were written against
      `.field__input` — (0,2,0). chrome.css:488 styles the same surface
      as `.clr-surface .field input`, two classes and an ELEMENT, so
      (0,2,1). It sets `background:` as a shorthand, which resets
      `background-image` to none on its way out. Measured on /login with
      the first draft in place: `background-image: none` on a focused
      field. The compound is now repeated against itself and wins on
      load order.

   So this file does not assert that any effect LOOKS good — that is a
   taste call and taste calls do not belong in a regression suite. It
   asserts the four properties that make the layer safe to extend:

     · it loads last, because every rule in it that ties on specificity
       with a component rule depends on winning that tie;
     · it never animates a paint-heavy property on moving content, which
       is the same finding that cost the auth ribbon two thirds of its
       frame rate;
     · every token it reads is declared, including the three that only
       exist at runtime;
     · every hiding behaviour is gated behind a class that is only added
       when the effect can actually run, so a browser without
       IntersectionObserver and a reader who asked for reduced motion
       both get a complete page rather than a blank column. */

const ROOT = join(import.meta.dirname, '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

const fxCss = () => read('src', 'fx.css')
const fxJs = () => read('src', 'lib', 'fx.js')
const layer = () => read('src', 'components', 'FxLayer.jsx')
const app = () => read('src', 'App.jsx')

/* Comments are prose about the code; a regex that ignores them asserts
   against intentions instead of behaviour. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const bodyBlock = (css) => {
  const b = code(css)
  const start = b.indexOf('body {')
  if (start === -1) return ''
  let depth = 0
  for (let i = b.indexOf('{', start); i < b.length; i += 1) {
    if (b[i] === '{') depth += 1
    if (b[i] === '}') {
      depth -= 1
      if (depth === 0) return b.slice(start, i + 1)
    }
  }
  return ''
}

const reduceBlock = (css) => {
  const c = code(css)
  const start = c.indexOf('@media (prefers-reduced-motion: reduce)')
  if (start === -1) return ''
  let depth = 0
  for (let i = c.indexOf('{', start); i < c.length; i += 1) {
    if (c[i] === '{') depth += 1
    if (c[i] === '}') {
      depth -= 1
      if (depth === 0) return c.slice(start, i + 1)
    }
  }
  return ''
}

const KEYFRAMES = [
  'fx-drift-a',
  'fx-drift-b',
  'fx-breathe',
  'fx-rise-in',
  'fx-sweep',
  'fx-pop',
  'fx-drop-in',
  'fx-sweep-down',
]

describe('the effects layer is the last thing the bundle loads', () => {
  /* Every rule in fx.css that competes with a component rule does so at
     equal or one-higher specificity, and relies on load order to win.
     Move the import above App.css and the press, the focus halo, the
     panel sheen and the field underline all silently stop applying —
     no error, no failed build, no test failure. */
  it('is imported after App.css', () => {
    const css = app().indexOf("import './App.css'")
    const fx = app().indexOf("import './fx.css'")
    expect(css).toBeGreaterThan(-1)
    expect(fx).toBeGreaterThan(-1)
    expect(fx).toBeGreaterThan(css)
  })

  it('is mounted in the one layer that outlives a route change', () => {
    const src = app()
    expect(src).toMatch(/import FxLayer from '\.\/components\/FxLayer\.jsx'/)
    expect(src).toMatch(/<FxLayer \/>/)
    /* It belongs beside SpotlightTracker and RouteVeil, which is to say
       above the router — the layer does not know which route is mounted
       and must not have to be re-created per route. */
    const before = src.indexOf('<Routes />')
    expect(src.indexOf('<FxLayer />')).toBeLessThan(before)
  })

  it('exports a component and nothing else, and keeps no state', () => {
    expect(layer()).toMatch(/export default function FxLayer\(\)/)
    expect(layer()).toMatch(/useEffect\(\(\) => mountFx\(\), \[\]\)/)
    expect(layer()).toMatch(/return null/)
    expect(layer()).not.toMatch(/useState|useRef|setState/)
    /* A component file that exports a helper trips the React Compiler
       lint; a module that exports only the function is free to. */
    expect(layer()).not.toMatch(/^export (?!default)/m)
  })
})

describe('nothing in the layer animates a paint-heavy property', () => {
  /* A CSS `filter` forces its element into its own raster buffer. With
     the auth trail moving inside that element every frame the buffer was
     invalidated and reallocated every frame: 17fps against 52fps on the
     same layer, measured three times with the warm-up discarded. This is
     the single most expensive mistake available in this codebase and it
     produces no error at all. */
  it('uses no filter anywhere', () => {
    expect(code(fxCss())).not.toMatch(/(^|[;{\s])filter\s*:/)
  })

  it('animates no background-position', () => {
    /* `background-position` repaints the whole gradient. The one place
       it appears is the heading sheen, and it must stay a TRANSITION on
       a hover state — a loop, or an animation shorthand anywhere in the
       file, is exactly the repaint-per-frame this layer is not allowed
       to spend. Asserting the shape rather than a count means adding a
       second hover sheen later does not fail this for the wrong reason. */
    const css = code(fxCss())
    const animating = [...css.matchAll(/animation:[^;]*;/g)].map((m) => m[0])
    expect(animating.filter((d) => /background-position/.test(d))).toEqual([])
    const transitions = [...css.matchAll(/transition:[^;]*;/g)].map((m) => m[0])
    expect(transitions.filter((d) => /background-position/.test(d))).toHaveLength(1)
  })

  it('animates no geometry', () => {
    const frames = KEYFRAMES.map((name) => {
      const m = code(fxCss()).match(new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`))
      expect(m, name).not.toBeNull()
      return m ? m[0] : ''
    })
    const animated = frames.join('\n')
    for (const prop of ['width:', 'height:', 'top:', 'left:', 'right:', 'bottom:', 'margin']) {
      /* `0%`/`100%` selectors legitimately contain no colon, and the
         percentage stops are allowed; only declarations are flagged. */
      expect(animated, prop).not.toMatch(new RegExp(`\\s${prop.replace(':', '')}\\s*:`))
    }
  })

  it('reads the scroll offset rather than opening a second ScrollTrigger', () => {
    /* The homepage already owns a paused master timeline scrubbed by one
       ScrollTrigger, and the standing rule in this repo is that a second
       ScrollTrigger on an axis somebody else scrubs is not allowed.
       Reading scrollY and scaling a bar is not that. */
    expect(code(fxJs())).not.toMatch(/ScrollTrigger|gsap/i)
    expect(code(fxJs())).toMatch(/window\.scrollY/)
    expect(fxCss()).toMatch(/transform: scaleX\(var\(--fx-progress/)
  })
})

describe('the palette is asked for at each use site, never aliased', () => {
  /* A custom property is substituted where it is DECLARED. An alias on
     `body` therefore freezes whatever the token resolves to at body
     level — `index.css :root`, the pre-redesign palette — and hands that
     frozen value to every descendant, including the ones whose
     `.clr-surface` ancestor has already re-pointed the token. */
  const FROZEN = ['--fx-signal', '--fx-on-signal', '--fx-ink', '--fx-ink-2', '--fx-ink-4', '--fx-line', '--fx-line-strong', '--fx-wash']

  it('declares no colour alias on body', () => {
    const body = bodyBlock(fxCss())
    for (const name of FROZEN) expect(body, name).not.toContain(name + ':')
  })

  it('asks for the real token inline, with the value it means', () => {
    const css = code(fxCss())
    for (const name of FROZEN) expect(css, name).not.toContain(`var(${name})`)
    expect(css).toMatch(/var\(--signal, #6f8cff\)/)
    expect(css).toMatch(/var\(--ld-on-accent, #09090c\)/)
    expect(css).toMatch(/var\(--accent-soft, rgba\(111, 140, 255, \.14\)\)/)
  })

  it('keeps its motion constants on body, where freezing them is correct', () => {
    const body = bodyBlock(fxCss())
    for (const name of ['--fx-ease', '--fx-back', '--fx-tap', '--fx-fast', '--fx-base', '--fx-slow', '--fx-rise']) {
      expect(body, name).toMatch(new RegExp(name.replace('-', '-') + ':'))
    }
    /* …and never in :root, which carries a theme-parity obligation
       against .light-theme for every name it declares. */
    expect(code(fxCss())).not.toMatch(/^:root\s*\{/m)
  })

  it('declares the three runtime tokens with a resting value', () => {
    /* Written by fx.js and read by fx.css. Undeclared, the custom
       property integrity test fails; declared only in JS, the file is
       not self-sufficient and an unrun stylesheet is wrong. */
    const body = bodyBlock(fxCss())
    expect(body).toMatch(/--fx-progress: 0;/)
    expect(body).toMatch(/--fx-delay: 0ms;/)
    expect(body).toMatch(/--fx-i: 0;/)
    /* And the two the SPOTLIGHT writes, which the first twenty-four
       effects never read and effect 34 does. Declared only in
       SpotlightTracker.jsx they are invisible to the integrity test,
       which is exactly how a stylesheet ends up using a property nobody
       ever set. The resting value is the centre of the card. */
    expect(body).toMatch(/--mouse-x: 50%;/)
    expect(body).toMatch(/--mouse-y: 50%;/)
  })
})

describe('an effect never loses a specificity fight it did not know it was in', () => {
  it('repeats the field compound chrome.css actually styles', () => {
    /* chrome.css:488 is `.clr-surface .field input` — (0,2,1). A
       `.field__input` selector is (0,2,0) and loses, and because the
       winner sets `background:` as a shorthand it resets
       background-image on the way out, which is how a working underline
       became `background-image: none`. */
    const css = code(fxCss())
    expect(css).toMatch(/\.clr-surface \.field input,\n?/)
    const under = css.match(/\.clr-surface \.field input,[^{]*\{[^}]*background-image:/)
    expect(under).not.toBeNull()
  })

  it('holds an entrance animation with backwards, never both', () => {
    /* `both` pins the END state — `transform: none` — on the element for
       ever, which silently overrides the hover lift that writes the same
       property. `backwards` holds the start state during the stagger
       delay and then releases the element to its own CSS, so the hover
       owns transform afterwards and a skipped animation leaves the
       element visible rather than invisible. */
    const css = code(fxCss())
    expect(css).not.toMatch(/\bboth\b(?=[\s;}])/)
    /* Only the ENTRANCES matter here. fx-sweep is a loop: it never ends,
       so it has no end state to pin and no fill mode to get wrong. */
    const entrances = [...css.matchAll(/animation:[^;]*fx-(?:rise-in|pop)[^;]*;/g)].map((m) => m[0])
    expect(entrances.length).toBeGreaterThanOrEqual(3)
    for (const d of entrances) expect(d).toMatch(/backwards\s*;$/)
    expect(css).toMatch(/animation: fx-rise-in var\(--fx-slow\) var\(--fx-ease\) backwards;/)
  })
})

describe('reduced motion asks for less motion, not less feedback', () => {
  const block = () => reduceBlock(fxCss())

  it('exists at all', () => {
    expect(block()).not.toBe('')
  })

  /* A keyframe is neutralised either by name, or by neutralising the
     selector that drives it — cancelling `animation-name` on the host is
     the same statement made one level up, and for the ambient layers it
     is the only one available, because they are two pseudo-elements
     driven by a single shared class. So the invariant is: every fx
     keyframe is reachable from something in the reduce block. */
  it('neutralises every keyframe, by name or by host', () => {
    const HOSTS = {
      'fx-drift-a': '#root::before',
      'fx-drift-b': '#root::after',
      'fx-breathe': '.clr-surface .stat--live .stat__flag::before',
      'fx-rise-in': '.clr-surface .adv-panel',
      'fx-sweep': '.adv-loading__cell::after',
      'fx-pop': '.adv-pill',
      'fx-drop-in': '.adv-notice',
      'fx-sweep-down': ':root.fx-arrival::after',
    }
    const b = block()
    for (const name of KEYFRAMES) {
      const host = HOSTS[name]
      expect(host, `no host recorded for ${name}`).toBeTruthy()
      const byName = b.includes(name)
      const byHost = b.includes(host.replace(/::.*$/, '').split(',')[0].trim())
      expect(byName || byHost, `${name} is not neutralised`).toBe(true)
    }
    expect(b).toMatch(/animation: none !important/)
  })

  it('makes a panel visible rather than merely still', () => {
    /* The reveal hides panels. Under reduced motion it must not run, and
       the rule has to end with opacity 1 — an `animation: none` alone
       leaves the element at whatever the keyframe's start state was,
       which is opacity 0. */
    const b = block()
    expect(b).toMatch(/\[data-fx-reveal\][\s\S]*?opacity: 1 !important/)
    expect(b).toMatch(/opacity: 1 !important;\s*\n\s*transform: none !important;/)
  })

  it('keeps the colour affordances', () => {
    /* A hover that only changes colour is not motion. The underline
       wipes, the accent edges and the field underline all survive. */
    const b = block()
    expect(b).not.toMatch(/\.clrhead-links a\s*\{[\s\S]*?display: none/)
    expect(b).not.toMatch(/background-size:\s*0\s*2px\s*!important/)
  })
})

describe('the runtime gates everything that could hide something', () => {
  it('adds the styling class only when the effect can run', () => {
    const js = code(fxJs())
    expect(js).toMatch(/if \(canObserve && !reduced\) ce\.classList\.add\('js-fx'\)/)
    expect(js).toMatch(/typeof IntersectionObserver !== 'function'/)
    /* And the no-observer path marks everything visible immediately
       rather than leaving the class off and the panels at opacity 0. */
    expect(js).toMatch(/targets\.forEach\(\(el\) => el\.classList\.add\('is-in'\)\)/)
  })

  it('removes everything it added', () => {
    const js = code(fxJs())
    expect(js).toMatch(/ce\.classList\.remove\('js-fx', 'js-fx-deep'\)/)
    expect(js).toMatch(/el\.removeAttribute\('data-fx-reveal'\)/)
    expect(js).toMatch(/el\.style\.removeProperty\('--fx-i'\)/)
    expect(js).toMatch(/bar\.remove\(\)/)
  })

  it('cancels every frame it started', () => {
    const js = code(fxJs())
    const cancels = js.match(/cancelAnimationFrame/g) || []
    expect(cancels.length).toBeGreaterThanOrEqual(3)
    expect(js).toMatch(/io\.disconnect\(\)/)
  })

  it('leaves a figure looking like the number the component rendered', () => {
    /* The count-up rewrites textContent every frame, so whatever it
       leaves behind is what the reader sees and what a test asserting on
       the component's own output is really looking at. Rounding it into
       the final frame would be a lie the reader could not detect. */
    const js = code(fxJs())
    expect(js).toMatch(/el\.textContent = original;/)
    expect(js).toMatch(/cancelAnimationFrame\(run\.id\)/)
  })

  it('counts once, on first sight, and never again', () => {
    const js = code(fxJs())
    expect(js).toMatch(/io\.unobserve\(entry\.target\)/)
    expect(js).toMatch(/if \(live\.has\(entry\.target\)\) return;/)
  })

  it('hides the progress bar on a page with nothing to scroll', () => {
    /* /login and /signup are one viewport by design. A full-width bar on
       a page that cannot scroll is a progress bar at 100% forever. */
    const js = code(fxJs())
    expect(js).toMatch(/PROGRESS_MIN_SCROLL = 1\.4/)
    expect(js).toMatch(/if \(!deep\(\)\) \{\s*\n\s*bar\.hidden = true;/)
  })

  it('uses one delegated listener per signal, not one per element', () => {
    /* A hundred panels means a hundred chances to miss a removal. The
       tilt is the only pointer signal and it reads one pointermove off
       the document. */
    const js = code(fxJs())
    const addEventListener = js.match(/doc(?:ument)?\.addEventListener/g) || []
    expect(addEventListener.length).toBe(1)
    expect(js).toMatch(/e\.target\.closest\(TILT_TARGETS\)/)
  })

  it('does not tilt on touch, where the transform would only be seen frozen', () => {
    expect(code(fxJs())).toMatch(/'\(hover: hover\) and \(pointer: fine\)'/)
  })
})

describe('the layer is scoped', () => {
  it('names a wrapper the token bridge owns on every scoped rule', () => {
    /* The bridge covers exactly four surfaces. A scoped effect that
       names a fifth would resolve `--signal` from :root and quietly get
       the legacy palette — which is bug 1 in this file, one selector
       away. Bare-element global rules are the only other permitted kind. */
    const OWNED = ['.clr-surface', '.adm-root', '.sdk-page', '.advx-page', '.landing']
    /* The front page is the fifth surface, and it is in this list on
       purpose rather than by accident. It declares its own palette under
       `.landing` — which is exactly what the inline `var(--token, value)`
       fallback in this file is for — and the layer already reaches it
       through `::selection`, `.btn`, `.lbtn`, `.magnetic`, `body` and
       `#root`. Naming it means the wordmark can finally get the same
       treatment on `/` as on `/developer`, instead of the front page
       being the one surface the effects layer politely ignores. */
    /* A small, explicit set of CONTROL selectors has to work outside the
       four wrappers: the press and the sweep are properties of a button,
       not of a page, and the ghost focus ring must never be amber on any
       surface. This is the deliberate exception and it is written down
       rather than allowed through by a loose regex. */
    /* `.panel` is the one shared atom with no wrapper in its own
       shorthand, so its transition is declared unanchored. That is safe
       because a transition paints nothing on its own. */
    const GLOBAL = /^(:focus-visible|::selection|body|body::after|#root|\.panel\b|\.adv-panel\b|\.sdk-panel\b|\.btn\b|\.btn--[a-z]+|\.lbtn\b|\.lbtn--[a-z]+|\.magnetic\b|\.field__input\b|\.input\b|\.field\b|\.fx-progress\b|\.fx-count\b|\.adv-shell--auth\b|\.clrhead-links\b|\.sitefoot)/
    /* Flat scan for `selector {`, written as a character walk rather
       than a regex. Two regexes failed on this file and both failed
       quietly: one treated a `/` inside a character class as the end of
       the literal, and the other captured `@media (…)` as a selector
       because stepping over the `@` turns it into a word. A character
       walk has neither problem and does not have to be trusted. */
    const AT_RULE = /^(media|supports|keyframes|layer|container|font-face|page|property|scope)\b/
    const selectors = []
    {
      const css = code(fxCss())
      let buf = ''
      let depth = 0
      for (const ch of css) {
        if (ch === '{') {
          const sel = buf.trim()
          buf = ''
          if (depth === 0 && sel && !sel.includes('@') && !AT_RULE.test(sel)) selectors.push(sel)
          depth += 1
        } else if (ch === '}') {
          depth = Math.max(0, depth - 1)
          buf = ''
        } else if (depth === 0) {
          buf += ch
        }
      }
    }
    expect(selectors.length).toBeGreaterThan(30)
    for (const sel of selectors) {
      expect(sel, 'at-rule leaked into the selector scan').not.toMatch(AT_RULE)
      for (const part of sel.split(',')) {
        const p = part.trim()
        if (!p || p.startsWith('from') || p.startsWith('to') || /^\d|^0$|^100%$/.test(p)) continue
        const anchored = OWNED.some((o) => p.includes(o)) || /(^|\s)\.js-fx(-deep)?\b/.test(p)
        const bare = /^[a-z][a-z0-9-]*$/.test(p) || /^[a-z]+:[a-z-]+$/.test(p)
        const universal = p.startsWith(':') || p.startsWith('*')
        expect(anchored || bare || universal || GLOBAL.test(p), `unscoped selector: ${p}`).toBe(true)
      }
    }
  })

  it('keeps the one-screen auth layout it must not disturb', () => {
    /* /login and /signup are sized by #root:has(.adv-shell--auth) in
       AuthCurve.css, with four max-height tiers. An effects layer that
       re-flowed that column would undo a screenful of measured work, so
       the auth rules here are animation-only. */
    const css = code(fxCss())
    for (const sel of ['.adv-shell--auth .adv-shell__meta', '.adv-shell--auth .panel.adv-panel >']) {
      const i = css.indexOf(sel)
      expect(i, sel).toBeGreaterThan(-1)
      const block = css.slice(css.indexOf('{', i), css.indexOf('}', i))
      expect(block, sel).not.toMatch(/(padding|margin|height|width|display|position)/)
    }
  })
})

/* ── the second twenty ────────────────────────────────────────────
   Effects 25 through 44. The first twenty-four had one structural
   defect in common and this batch was built to have the opposite one:
   every one of them either costs nothing per frame or repaints once,
   on a hover, on one element. Two of them — the spotlight and the
   corner brackets — repaint on pointermove and on hover respectively,
   and both are named here so that the trade is written down rather
   than discovered. */
describe('the second twenty are texture and feedback, not motion', () => {
  const css = () => code(fxCss())
  const js = () => code(fxJs())

  it('grain is static, and is not a filter in disguise', () => {
    const c = css()
    expect(c).toMatch(/body::after \{[^}]*position: fixed;/)
    expect(c).toMatch(/body::after \{[^}]*feTurbulence/)
    /* One animation-free layer: the whole cost of effect 25 is a single
       140x140 raster the browser then repeats. The only `filter` in it
       is the `feTurbulence` inside the data URI, which is how the noise
       is GENERATED — it is not a CSS filter and it is not applied to the
       layer, so the assertion has to look for the declaration. */
    const grain = c.slice(c.indexOf('body::after'), c.indexOf('}', c.indexOf('body::after')))
    expect(grain).not.toMatch(/animation:|filter:|backdrop-filter:/)
    expect(grain).toMatch(/feTurbulence/)
    /* And it stays under reduced motion, because texture is not motion.
       A reader who asked for less movement should not get a flatter
       page as well. */
    expect(reduceBlock(fxCss())).not.toMatch(/body::after/)
    /* …and it is OFF on the two one-screen auth pages, where the frame
       budget is already spoken for by the ribbon. Measured with it on:
       /login 42fps, /signup 41fps. A third of the frame rate is not what
       a texture is worth. */
    expect(c).toMatch(/body:has\(\.adv-shell--auth\)::after \{\s*\n\s*content: none;/)
  })

  it('the rails that scroll admit that they scroll', () => {
    const c = css()
    expect(c).toMatch(/scrollbar-width: thin;/)
    expect(c).toMatch(/scrollbar-color: var\(--hair-strong, rgba\(255, 255, 255, \.17\)\) transparent;/)
    /* Answering the `scrollbar-width: none` each rail already declares
       at equal specificity. */
    expect(c).toMatch(/\.clr-surface \.adv-nav,\s*[\s\S]{0,200}?\.adm-root \.adm-main \{\s*\n\s*scrollbar-width: thin;/)
    expect(c).toMatch(/::-webkit-scrollbar-thumb/)
  })

  it('an in-page anchor lands clear of the sticky header', () => {
    /* 96px against a header measured at 73px. Smooth scrolling is inside
       a `no-preference` block, so it is a motion and it is gated like
       one. */
    const c = css()
    expect(c).toMatch(/html \{\s*\n\s*scroll-padding-top: 96px;/)
    expect(c).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\n\s*html \{\s*\n\s*scroll-behavior: smooth;/)
  })

  it('the wordmark sheen is on the span whose colour it replaces', () => {
    /* The dead effect, pinned. `.brand-text` wraps
       `<span class="brand-cli">CLI</span><span class="brand-revenue">Revenue</span>`
       and BOTH spans carry their own colour in every stylesheet that
       styles them — `.clrhead .brand-cli` in full ink,
       `.brand-text-landing .brand-revenue` in `--revenue-red
       !important`. A `background-clip: text` sheen on the PARENT sets
       `color: transparent` where no glyph is painted and leaves both
       children painting their own: a gradient clipped to nothing.
       Measured before this was caught — `background-clip: text` present,
       `linear-gradient` present, wordmark unchanged. */
    const c = css()
    const sheen = c.slice(c.indexOf('.clr-surface .brand-cli,'), c.indexOf('}', c.indexOf('.clr-surface .brand-cli,')))
    expect(sheen).toMatch(/background-clip: text;/)
    expect(sheen).toMatch(/color: transparent;/)
    expect(c).not.toMatch(/\.brand-text[^-][^{]*\{[^}]*background-clip: text;/)
    /* And it must beat, or tie-and-out-order, the rules that set that
       colour: `.clrhead .brand-cli` and `.landing .brand-cli` are both
       (0,2,0). */
    expect(c).toMatch(/\.clr-surface \.brand-cli,/)
  })

  it('prose links, inline links, the footer and the switch all answer', () => {
    const c = css()
    for (const sel of ['.clr-surface .block__body a::after', '.clr-surface .adv-link:hover', '.sitefoot__link::after', '.clr-surface .toggle input:checked + .toggle__slider::before']) {
      expect(c, sel).toContain(sel)
    }
    /* The cross-link leans. Two pixels, and the rule may not become a
       leap: this is the one control family people read as prose. */
    const lean = c.slice(c.indexOf('.clr-surface .adv-link:hover'), c.indexOf('}', c.indexOf('.clr-surface .adv-link:hover')))
    expect(lean).toMatch(/transform: translateX\(2px\);/)
    expect(lean).not.toMatch(/translateX\([4-9]/)
  })

  it('the switch is built rather than inherited from the platform', () => {
    /* `PublisherPlacements` has shipped a `<label className="toggle">`
       wrapping a checkbox and an empty `aria-hidden` span since before
       this file existed, and no stylesheet in `src/` drew either. The
       native input is hidden with `opacity` and stays in the layout, so
       the switch is still reachable from a keyboard — `display: none`
       would have fixed the appearance and broken the control. */
    const c = css()
    const hidden = c.slice(c.indexOf('.clr-surface .toggle input {'), c.indexOf('}', c.indexOf('.clr-surface .toggle input {')))
    expect(hidden).toMatch(/opacity: 0;/)
    expect(hidden).not.toMatch(/display: none|visibility: hidden/)
    expect(c).toMatch(/\.clr-surface \.toggle input:focus-visible \+ \.toggle__slider \{/)
    /* The knob travels on the overshoot curve, because a switch that
       snaps reads as a checkbox that moved. */
    const knob = c.slice(c.indexOf('.clr-surface .toggle input:checked + .toggle__slider::before'), c.indexOf('}', c.indexOf('.clr-surface .toggle input:checked + .toggle__slider::before')))
    expect(knob).toMatch(/transform: translateX\(16px\)/)
    /* The travel runs on the overshoot curve, which is declared on the
       knob in its RESTING state — a switch that snaps reads as a
       checkbox that moved. */
    const rest = c.slice(c.indexOf('.clr-surface .toggle__slider::before {'), c.indexOf('}', c.indexOf('.clr-surface .toggle__slider::before {')))
    expect(rest).toMatch(/var\(--fx-back\)/)
    /* A pill is not a rounded rectangle, and the pill radius is a
       token rather than a literal — `border-radius: 9999px` fails
       ui-polish, which builds its allowed set from `--radius*`. */
    expect(c).toMatch(/\.clr-surface \.toggle__slider \{[\s\S]{0,200}?border-radius: var\(--radius-pill\);/)
  })

  it('a disabled control cannot be mistaken for a live one', () => {
    const c = css()
    expect(c).toMatch(/\.clr-surface \.btn:disabled,[\s\S]{0,400}?cursor: not-allowed;/)
    /* The transform reset matters: a lift or a press in flight when the
       control is disabled finishes against a dead button. */
    const off = c.slice(c.indexOf('.clr-surface .btn:disabled,'), c.indexOf('}', c.indexOf('.clr-surface .btn:disabled,')))
    expect(off).toMatch(/transform: none;/)
    expect(off).toMatch(/box-shadow: none;/)
  })

  it('the band hairlines warm instead of the band moving', () => {
    const c = css()
    expect(c).toMatch(/border-color: var\(--accent-soft, rgba\(111, 140, 255, \.14\)\);/)
    /* Only the two-column rows lift; the full-width blocks do not, so a
       7800-pixel page does not become a page of things bobbing. The
       hover GROUP sets the border and a following rule sets the lift,
       so the needle is the lift rule itself rather than the group that
       mentions the same selector. */
    expect(c).toMatch(/\.clr-surface \.sdk-row:hover,\s*\n\.clr-surface \.advx-row:hover \{\s*\n\s*transform: translateY\(-2px\);/)
    expect(c).not.toMatch(/\.sdk-block:hover,[^{]*\{[^}]*transform/)
  })

  it('arrivals are announced by the thing that arrives', () => {
    const c = css()
    expect(c).toMatch(/animation: fx-drop-in var\(--fx-base\) var\(--fx-ease\) backwards;/)
    /* Upward travel for an element that sits ABOVE what it is talking
       about: it reads as "this dropped in". */
    const drop = c.slice(c.indexOf('@keyframes fx-drop-in'), c.indexOf('}', c.indexOf('@keyframes fx-drop-in')))
    expect(drop).toMatch(/translateY\(-8px\)/)
    /* And under reduced motion the end state is STATED, because a
       dropped animation leaves the element wherever the keyframe left
       it — which here would be nowhere. */
    expect(reduceBlock(fxCss())).toMatch(/\.adv-notice[\s\S]{0,240}?opacity: 1 !important;/)
  })

  it('every live indicator on the product shares one curve', () => {
    /* Section 7 replaced a hard blink with a slow ring on the stat
       card's flag. The status pill beside it still ran `clir-blink`, so
       one screen showed one indicator breathing and one blinking for
       the same sentence. Three hosts, one animation, no LED vocabulary
       anywhere. */
    const c = css()
    for (const sel of ['.clr-surface .stat--live .stat__flag::before', '.adm-root .adm-topbar__brand::after', ".clr-surface .adv-pill[data-status='active']::before", '.clr-surface .adv-empty__mark']) {
      expect(c, sel).toMatch(new RegExp(sel.replace(/[.[\]'()]/g, '\\$&') + ' \\{[\\s\\S]{0,320}?animation: fx-breathe'))
    }
    expect(c).not.toMatch(/clir-blink/)
  })

  it('the spotlight finally reads the two properties the tracker writes', () => {
    /* `SpotlightTracker` has written `--mouse-x` / `--mouse-y` onto every
       `.panel.adv-panel` and `.adv-stats .stat` since before this file
       existed, and nothing read them. This is the one effect here that
       repaints on pointermove, so its cost is named rather than
       implied: one pseudo, inside one `overflow: hidden` card a few
       hundred pixels across, whose contents do not change while the
       pointer is over it. */
    const c = css()
    expect(c).toMatch(/radial-gradient\(220px circle at var\(--mouse-x, 50%\) var\(--mouse-y, 50%\)/)
    /* The tilt cards carry the same two numbers under the other name. */
    expect(c).toMatch(/radial-gradient\(240px circle at var\(--mx, 50%\) var\(--my, 50%\)/)
    /* It goes on `::before` because the panel's `::after` is the
       specular sheen from section 10. */
    expect(c).toMatch(/\.clr-surface \.panel\.adv-panel::before,/)
  })

  it('the arrival sweep can fire once and never again', () => {
    const jsText = js()
    expect(jsText).toMatch(/ce\.classList\.add\('fx-arrival'\)/)
    expect(jsText).toMatch(/const done = \(\) => ce\.classList\.remove\('fx-arrival'\)/)
    expect(jsText).toMatch(/ce\.addEventListener\('animationend', done, \{ once: true \}\)/)
    expect(jsText).toMatch(/clearTimeout\(timer\)/)
    /* …and it is never mounted under reduced motion at all. */
    expect(jsText).toMatch(/if \(!reduced\) offs\.push\(mountArrival\(\)\);/)
  })

  it('the rail knows which section you are reading, from an observer', () => {
    const jsText = js()
    expect(jsText).toMatch(/const SPY_LINKS = '\.sdk-rail__link'/)
    expect(jsText).toMatch(/new IntersectionObserver/)
    expect(jsText).toMatch(/setAttribute\('aria-current', 'true'\)/)
    /* The expensive alternative is a scroll handler; the reveal above is
       already an observer on the same kind of node. */
    expect(jsText).not.toMatch(/addEventListener\('scroll'[\s\S]{0,200}aria-current/)
    /* fx.css has to honour the attribute the observer writes. */
    expect(css()).toMatch(/\.clr-surface \.sdk-rail__link\[aria-current='true'\]::after/)
  })

  it('selects carry the product\'s own chevron, in the product\'s own token', () => {
    const c = css()
    expect(c).toMatch(/appearance: none;/)
    /* Drawn from two linear gradients meeting at a point — no image, no
       icon font — and filled with the token so it follows the bridge. */
    expect(c).toMatch(/linear-gradient\(45deg, transparent 50%, var\(--signal, #6f8cff\) 50%\)/)
    /* Two gradient layers cannot coexist on one box and the focus
       underline is also a background-image, so the chevron is restacked
       as a third layer on focus rather than lost. That is a real
       collision the stylesheet has to answer, not a flourish. */
    expect(c).toMatch(/\.clr-surface \.field select:focus,[\s\S]{0,420}?background-size: 5px 5px, 5px 5px, 100% 2px;/)
  })

  it('the progress bar grows a head that cannot drift from the bar', () => {
    const c = css()
    expect(c).toMatch(/\.fx-progress::after \{[\s\S]{0,300}?left: calc\(var\(--fx-progress, 0\) \* 100%\);/)
    /* The same custom property the bar scales by, so the two read from
       one number. */
    expect(c).toMatch(/transform: scaleX\(var\(--fx-progress/)
  })

  it('numbers in tables stop reflowing their neighbours', () => {
    expect(css()).toMatch(/\.clr-surface \.adv-table td,\s*\n\.clr-surface \.adm-table td,\s*\n\.clr-surface \.key-table td \{\s*\n\s*font-variant-numeric: tabular-nums;/)
  })
})
