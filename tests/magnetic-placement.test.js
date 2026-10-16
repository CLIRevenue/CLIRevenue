import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* ──────────────────────────────────────────────────────────────────────────
   The cursor-following button effect has to be spent, not sprayed.

   A button that leans toward the pointer also has a hit target that is no
   longer where it was drawn. That is a flourish on a marketing hero and a
   usability defect on a form submit: you press the button, the pointer is
   now over empty space, and nothing happens. So the placement of the
   effect is load-bearing behaviour, not taste, and it is pinned here.

   The bug this guards against is the one that shipped. The effect began as
   a single `.magnetic` opt-in class and was later broadened to "every
   button on the site" — which put a sliding submit button on the sign-up
   form and a sliding Create-key button inside the developer console.
   Anyone widening the selector again has to delete a test that says why.

   Second-order rule, and the one most easily broken by fixing the first:
   chrome.css neutralises the repo's own hover lift with `transform: none`
   on these buttons, and that neutraliser exists ONLY to make room for the
   drift. Once the drift is opt-in, an unscoped neutraliser would delete the
   lift from every button at once and leave the non-drifting ones with no
   hover motion whatsoever — quieter than the original bug, but the same
   shape. So the neutraliser carries `.magnetic` too.

   No DOM in this suite (`environment: 'node'`), so these are the repo's
   usual source assertions.
   ────────────────────────────────────────────────────────────────────────── */

/* `import.meta.dirname` rather than `process.cwd()`: eslint only grants Node
   globals to `tests/db/**`, so `process` is a `no-undef` error out here. */
const ROOT = join(import.meta.dirname, '..')

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

/** Source with comments removed, so prose that mentions a selector is never
    mistaken for code that uses one. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const landing = () => read('src', 'components', 'landing', 'landing.js')
const chrome = () => read('src', 'components', 'landing', 'chrome.css')

/** The body of magneticFx(), from its declaration to the reduced-motion
    guard — the part that decides what the effect is allowed to touch. */
const magneticFx = () => {
  const src = landing()
  const start = src.indexOf('function magneticFx(')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('let cur = null', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

/** Every className string in a component, so a placement assertion can be
    made per control rather than per file. */
const classNames = (source) => [...code(source).matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((m) => m[1] ?? m[2] ?? '')

/** The console and auth controls that must never drift: a submit, a step
    advance, a save, a create, an activate, a copy. */
const MUST_NOT_DRIFT = [
  'src/components/auth/AuthPages.jsx',
  'src/components/advertiser/AccountPage.jsx',
  'src/components/advertiser/AdvertiserBilling.jsx',
  'src/components/advertiser/AdvertiserCampaigns.jsx',
  'src/components/advertiser/AdvertiserUI.jsx',
  'src/components/developer/SdkSetup.jsx',
  'src/components/developer/PublisherKeys.jsx',
  'src/components/developer/PublisherPlacements.jsx',
  'src/components/landing/PageChrome.jsx',
]

/** The invitation CTAs the effect is for. Named so that removing one is a
    deletion in this file, not a silent downgrade on the page. */
const MUST_DRIFT = [
  ['src/components/landing/Landing.jsx', 'Start earning — free'],
  ['src/components/advertiser/AdvertiserLanding.jsx', 'Start advertising'],
  ['src/components/developer/DeveloperLanding.jsx', 'Install with npm'],
]

describe('the drift is opt-in, not sprayed', () => {
  it('matches the opt-in class and nothing else', () => {
    expect(magneticFx()).toMatch(/const SELECTOR = '\.magnetic';/)
  })

  it('no longer selects a bare button or a utility class by type', () => {
    /* Each of these was an entry in the original allowlist. Asserting them
       individually keeps a future broadening from quietly re-adding one. */
    const body = magneticFx()
    expect(body).not.toMatch(/'button'/)
    for (const cls of ['.btn', '.lbtn', '.adv-btn', '.sdk-btn', '.adv-nav__btn', '.adm-topbar__logout', '.adv-password__btn', '.placement-slot__cta', '.switcher__btn', '.cmd-copy']) {
      expect(body).not.toContain(`'${cls}'`)
    }
    /* The old form was an array joined by ','. A bare string is the point. */
    expect(body).not.toMatch(/const SELECTOR = \[/)
    expect(body).not.toMatch(/\.join\(','\)/)
  })

  it('still no-ops under prefers-reduced-motion', () => {
    /* Scoping the selector must not turn a motion preference into a motion. */
    expect(landing()).toMatch(/const reduced = matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches;\s*\n\s*if \(reduced\) return \(\) => \{\};/)
  })

  it('still folds the press into the one inline writer of transform', () => {
    /* The drift is inline, so the stylesheet's :active press is invisible
       unless it is written into the same value. */
    expect(magneticFx()).toMatch(/const PRESS = 'scale\(\.978\) translateY\(1px\)'/)
    expect(landing()).toMatch(/held \? PRESS \+ ' ' : ''/)
  })
})

describe('the class is spent on invitations', () => {
  for (const file of MUST_NOT_DRIFT) {
    it(`${file.split('/').pop()} opts nothing in`, () => {
      expect(classNames(read(...file.split('/')))).not.toContain('magnetic')
    })
  }

  it('the sign-in and sign-up submits are specifically named in the rule', () => {
    /* These are the two the original report was about. */
    const auth = classNames(read('src/components/auth/AuthPages.jsx')).join(' ')
    expect(auth).toMatch(/btn btn--primary/)
    expect(auth).not.toMatch(/magnetic/)
  })

  for (const [file, label] of MUST_DRIFT) {
    it(`${file.split('/').pop()} invites with "${label}"`, () => {
      const names = classNames(read(...file.split('/')))
      expect(names.some((n) => n.includes('btn--primary') && n.includes('magnetic'))).toBe(true)
      expect(read(...file.split('/'))).toContain(label)
    })
  }

  it('the front page keeps more than one, because a hero alone is a report of a missing effect', () => {
    const names = classNames(read('src/components/landing/Landing.jsx'))
    expect(names.filter((n) => n.includes('magnetic')).length).toBeGreaterThanOrEqual(4)
  })

  it('the effect is still mounted on both hosts', () => {
    /* The landing is not a .clr-surface, so the two mounts are separate and
       both are load-bearing. Dropping one re-creates the original symptom on
       whichever page lost it. */
    expect(read('src/components/landing/Landing.jsx')).toMatch(/landingFx/)
    expect(read('src/components/landing/PageChrome.jsx')).toMatch(/landingFx\(document\.body\)/)
  })
})

describe('the lift is only surrendered where the drift takes over', () => {
  /* The rule under test is the one that sets `transform: none` on hover,
     cancelling App.css's translate(-2px,-2px). */
  const neutraliser = () => {
    const src = code(chrome())
    const at = src.indexOf('transform: none;')
    expect(at).toBeGreaterThan(-1)
    const from = src.lastIndexOf('{', at)
    return src.slice(src.lastIndexOf('}', from) + 1, from)
  }

  it('carries the opt-in class in its selector', () => {
    expect(neutraliser()).toMatch(/\.magnetic/)
  })

  it('still outranks the repo hover lift and still spares the focus ring', () => {
    const sel = neutraliser()
    expect(sel).toMatch(/:hover:not\(:disabled\):not\(:focus-visible\)/)
    /* Specificity is .clr-surface (class) + :is(...magnetic) (class) +
       :not(.a, .b, .c, .d) (ONE class, however many arguments) + :hover
       (class) + :not(:disabled) (attribute) + :not(:focus-visible) (pseudo)
       = (0,6,0) against App.css's (0,3,0). Count the three `:not(` groups,
       not the arguments of the multi-selector :not(): dropping one of them
       ties the score and App.css wins on bundle order, which is what put a
       filled primary button white-on-white on hover once already. */
    expect(sel.trim().startsWith('.clr-surface :is(')).toBe(true)
    expect(sel.split(':not(').length - 1).toBe(3)
  })

  it('does not also blank the shadow, which is a separate decision', () => {
    /* `box-shadow: none` on the same selector would flatten the focus ring's
       pairing if the :not(:focus-visible) guard ever moved. Keep the pair
       under one selector so they move together. */
    const body = neutraliser()
    expect(body).toMatch(/:not\(:focus-visible\)/)
  })
})