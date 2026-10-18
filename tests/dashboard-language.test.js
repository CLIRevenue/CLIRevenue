import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* `import.meta.dirname` rather than `process.cwd()`: eslint only grants Node
   globals to `tests/db/**`, so `process` is a `no-undef` error out here. */
const ROOT = join(import.meta.dirname, '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

/* Every assertion here is about the DASHBOARD surfaces -- `/app/developer` and
   `/app/advertiser` -- not the marketing pages. That distinction is the whole
   point of this file.

   Those two dashboards were handed a palette, a radius scale, a type ramp and a
   spacing rhythm in an earlier pass, and then quietly reverted to the
   pre-redesign product in four places. Each of the four is a case of the same
   mistake: **the warning colour and the accent colour are not the same colour,
   and something in this surface reached for the wrong one.**

     - the ACTIVE TAB was a filled `--amber` plate, measuring 2.65:1 against its
       own label. That is the most prominent control on the page wearing the
       hue that means "warning", while `--signal` (the brand accent) appeared
       exactly once on the entire surface, on a loading dot.
     - FOCUS drew a `--hair-amber` halo around whatever card had keyboard focus
       inside it. Focus is not a warning.
     - ERRORS were painted in `--signal-text` (#f2f2f4), i.e. body ink: the
       notice badge, the notice body and the SDK panel's error line.
     - `--signal-soft` was referenced but NOT re-exported by the bridge, so the
       destructive button's hover was painting the legacy blue
       rgba(96, 165, 250, .12) from `index.css`.

   Layout-wise, two promises were not kept: the tab rail claims to stay
   reachable while a long page scrolls, and it was at `top: 12px` underneath a
   73px sticky site header; and it allowed 8 tabs to wrap onto 2-3 lines inside
   a sticky glass bar, which is the same defect as the two site headers.

   What this file deliberately does NOT assert: colours, spacing values, type
   sizes, layout. Those belong to `console-design-language.test.js` and
   `console-type-scale.test.js`. This file asserts the ROLE each colour plays,
   the geometry of the sticky rail, and that the tokens these rules now read are
   actually declared. A regression that reintroduces "the active tab is orange"
   is a meaning bug; a regression that moves the tab rail up by 4px is a taste
   call, and taste calls do not belong in a regression suite. */

/* Strips block and line comments so prose is never matched as code. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

/* Brace-balanced extract of the rule whose selector text `selector` appears in,
   matched LITERALLY with indexOf -- not as a regex. These files write grouped
   selectors across lines and escaped brackets, so a regex needle has to be
   double-escaped and silently matches nothing. `selector` is the text as it
   appears in the file, e.g. '.stat {' or '.adv-nav__btn[data-active="true"]'. */
const rule = (source, selector) => {
  const body = code(source)
  const start = body.indexOf(selector)
  if (start === -1) return null
  const open = body.indexOf('{', start)
  if (open === -1) return null
  let depth = 0
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1
    else if (body[i] === '}') {
      depth -= 1
      if (depth === 0) return body.slice(open + 1, i)
    }
  }
  return null
}

/* The declarations of one rule, as `prop: value` strings, so an assertion can
   be scoped to the rule it is about. A bare `stroke-width` regex once matched
   three times because two rules set it. */
const decls = (body) => (body || '').match(/[\w-]+:[^;]*/g) || []
const valueOf = (body, prop) => {
  const hit = decls(body).find((d) => d.trim().startsWith(prop + ':'))
  return hit ? hit.slice(hit.indexOf(':') + 1).trim() : null
}

const advertiserCss = () => read('src/components/advertiser/advertiser.css')
const dashboardCss = () => read('src/components/advertiser/dashboard.css')
const devConsoleCss = () => read('src/components/developer/DeveloperConsole.css')
const appCss = () => read('src/App.css')
const chromeCss = () => read('src/components/landing/chrome.css')

const DASH_SHEETS = [
  ['advertiser.css', advertiserCss],
  ['dashboard.css', dashboardCss],
  ['DeveloperConsole.css', devConsoleCss],
]

describe('the accent is the accent and the warning is the warning', () => {
  it('paints the active tab in the brand accent, not the warning hue', () => {
    const rail = rule(advertiserCss(), '.adv-nav {')
    const btn = rule(advertiserCss(), '.adv-nav__btn {')
    const active = rule(advertiserCss(), '.adv-nav__btn[data-active="true"]')
    expect(rail).toBeTruthy()
    expect(btn).toBeTruthy()
    expect(active).toBeTruthy()

    expect(valueOf(active, 'background')).toBe('var(--signal)')
    expect(valueOf(active, 'border-color')).toBe('var(--signal)')
    /* --paper (#f4f2ee) on --amber (#e8752f) measured 2.65:1, which is a hard
       AA failure at 11px. --ld-on-accent (#09090c) on --signal (#6f8cff) is
       about 6.4:1, so the label now reads on the plate. */
    expect(valueOf(active, 'color')).toBe('var(--ld-on-accent)')
    expect(valueOf(active, 'color')).not.toBe('var(--paper)')
    expect(valueOf(active, 'background')).not.toContain('--amber')
    expect(valueOf(active, 'box-shadow')).not.toContain('--amber')
  })

  it('keeps the accent out of the hover states of the row and the bar chart', () => {
    /* Both used to repaint themselves --amber on hover, which is how a data
       surface ends up looking like a warning. */
    /* The leading `.adv-activity ` / `.adv-chart ` ancestors are part of the
       real selector text, and leaving them off finds nothing. */
    const row = rule(dashboardCss(), '.adv-activity .adv-activity__row:hover::before')
    const bar = rule(dashboardCss(), '.adv-chart .adv-chart__row:hover .adv-chart__fill')
    expect(row).toBeTruthy()
    expect(bar).toBeTruthy()
    expect(valueOf(row, 'background')).toBe('var(--signal)')
    expect(valueOf(bar, 'background')).toBe('var(--signal)')
    expect(`${row}${bar}`).not.toContain('--amber')
  })

  it('draws focus with the accent, because focus is not a warning', () => {
    const focus = rule(dashboardCss(), '.panel.adv-panel:focus-within')
    expect(focus).toBeTruthy()
    expect(valueOf(focus, 'border-color')).toBe('var(--signal)')
    expect(focus).not.toContain('--hair-amber')
  })

  it('leaves --amber alone where it is genuinely a status', () => {
    /* The point of the assertion is the LIMIT: a paused or pending campaign is
       legitimately amber, and a rewrite that swept --amber out of the file
       would have thrown that meaning away too. */
    /* A paused campaign. The needle carries the attribute VALUE and the
       brace, because `.adv-pill[data-status]::before` sits earlier in the
       file and `indexOf` would hand back that rule instead. */
    const pills = rule(dashboardCss(), ".adv-pill[data-status='paused'] {")
    expect(pills).toBeTruthy()
    expect(pills).toContain('--amber')
  })

  it('paints a destructive button in the error hue', () => {
    const danger = rule(advertiserCss(), '.btn--danger')
    expect(danger).toBeTruthy()
    /* It was branded: --hair-amber border, --signal-text label, and a hover
       that asked for --signal-soft, a token the bridge does not re-export, so
       the hover painted the legacy blue rgba(96, 165, 250, .12). It is used
       by AccountPage for "Delete account" and AdvertiserCampaigns for "Remove
       creative", so all three states were wrong. */
    expect(danger).not.toContain('--signal')
    expect(danger).not.toContain('--hair-amber')
    expect(`${danger}`).not.toMatch(/(^|[^-])--signal-soft/)
  })

  it('paints an error in the error hue, in all three places an error is rendered', () => {
    /* All three used --signal-text (#f2f2f4) or --ink, i.e. body ink. */
    const notice = rule(dashboardCss(), '.adv-notice.adv-notice--error {')
    const badge = rule(dashboardCss(), '.adv-notice.adv-notice--error::before')
    const field = rule(advertiserCss(), '.adv-field-error')
    const text = rule(devConsoleCss(), '.setup__text-error')
    for (const r of [notice, badge, field, text]) expect(r).toBeTruthy()
    expect(notice).not.toContain('--signal-text')
    expect(badge).not.toContain('--signal-text')
    expect(field).not.toContain('--signal-text')
    expect(valueOf(text, 'color')).toBe('var(--accent-error)')
    /* The error WASH is a surface tint, so it lives on the bridge; the error
       HUE stays on :root on purpose and must not be re-exported, because red
       meaning "failed" is not branding. */
    expect(valueOf(notice, 'background')).toBe('var(--accent-error-wash)')
  })

  it('reads every token these three sheets name for colour', () => {
    const declared = new Set()
    /* :root belongs in this set deliberately: the bridge family of bugs is a
     token that :root DOES declare and the bridge does NOT re-export, so a
     declaration check that skipped index.css would pass the bug. */
  for (const src of [read('src/index.css'), chromeCss(), advertiserCss(), dashboardCss(), devConsoleCss(), appCss()]) {
      for (const m of code(src).matchAll(/(--[\w-]+)\s*:/g)) declared.add(m[1])
    }
    const reads = new Set()
    for (const [, get] of DASH_SHEETS) {
      for (const m of code(get()).matchAll(/var\((--[\w-]+)\)/g)) reads.add(m[1])
    }
    const missing = [...reads].filter((n) => !declared.has(n)).sort()
    /* Two tokens are named here on purpose, because they are the ones that
       resolved to nothing inside the bridge and silently painted the legacy
       palette. --signal-soft is declared at :root only, so `declared` above
       considers it answered and this is the assertion that actually catches
       it. --track-display is still read four times in App.css by the front
       page's own furniture, which the bridge does not claim, so it is
       asserted against its own rule body further down instead. */
    for (const [, get] of DASH_SHEETS) {
      expect(code(get())).not.toMatch(/var\(--signal-soft\)/)
    }
    expect(missing).toEqual([])
  })

  it('does not re-export the error hue from the bridge', () => {
    const surface = chromeCss().slice(chromeCss().search(/\.clr-surface[\s\S]{0,80}?\{/))
    const body = surface.slice(surface.indexOf('{'), surface.indexOf('}', surface.indexOf('{')))
    expect(body).toContain('--accent-error-wash')
    expect(body).not.toMatch(/^\s*--accent-error\s*:/m)
  })
})

describe('the tab rail keeps the promise its comment makes', () => {
  it('sits below the sticky site header, not under it', () => {
    const rail = rule(advertiserCss(), '.adv-nav {')
    /* .clrhead is sticky at top: 0 and measured 73px tall. `top: 12px` put the
       rail underneath it, so the comment "tabs stay reachable while long pages
       scroll" was false on any scrolled view. */
    expect(valueOf(rail, 'top')).toBe('76px')
    expect(valueOf(rail, 'z-index')).toBe('30')
    const head = rule(chromeCss(), '.clrhead {')
    expect(valueOf(head, 'z-index')).toBe('40')
  })

  it('keeps eight tabs on one row and pans instead of wrapping', () => {
    const rail = rule(advertiserCss(), '.adv-nav {')
    expect(valueOf(rail, 'flex-wrap')).toBe('nowrap')
    expect(valueOf(rail, 'overflow-x')).toBe('auto')
    /* The scroller used to live only under @media (max-width: 640px), so
       between 641px and roughly 1000px the row folded onto two or three lines
       INSIDE a sticky glass bar -- which then covered the content it was meant
       to navigate. */
    expect(advertiserCss()).not.toMatch(/@media[^{]*640px[^}]*\{[\s\S]{0,400}?\.adv-nav \{[^}]*overflow-x/s)
    const btn = rule(advertiserCss(), '.adv-nav__btn {')
    expect(valueOf(btn, 'flex')).toBe('0 0 auto')
  })

  it('hides the scrollbar it just added', () => {
    const sb = rule(advertiserCss(), '.adv-nav::-webkit-scrollbar')
    expect(sb).toBeTruthy()
    expect(valueOf(sb, 'display')).toBe('none')
    expect(valueOf(rule(advertiserCss(), '.adv-nav {'), 'scrollbar-width')).toBe('none')
  })
})

describe('the stat card stopped speaking the pre-redesign dialect', () => {
  it('puts the label on the shared micro rung and the shared caps tracking', () => {
    const label = rule(appCss(), '.stat__label {')
    /* 9.5px at 0.18em was the old landing eyebrow spec, and .stat__flag in
       dashboard.css was already var(--c-text-micro) with var(--track-caps) --
       two different label systems on the same card. */
    expect(valueOf(label, 'font-size')).toBe('var(--c-text-micro)')
    expect(valueOf(label, 'letter-spacing')).toBe('var(--track-caps)')
  })

  it('puts the card padding and gap on the spacing scale', () => {
    const stat = rule(appCss(), '.stat {')
    expect(valueOf(stat, 'gap')).toBe('var(--c-space-2)')
    expect(valueOf(stat, 'padding')).toBe('var(--c-space-5)')
  })

  it('tracks the dashboard page title from the same token as every other title', () => {
    const title = rule(appCss(), '.block__title {')
    /* --track-display is declared only at :root (-0.03em) and the bridge does
       not re-export it, so this was the odd title out of three. */
    expect(valueOf(title, 'letter-spacing')).toBe('var(--track-head)')
    /* Scoped to this rule on purpose. App.css still carries four other
       --track-display uses (.scene__title, .closing__headline,
       .masthead__title and one in the .btn--sm region) and every one of them
       belongs to the front page's own furniture, which the bridge does not
       claim. A file-wide assertion would be asserting that the landing and the
       dashboard share a scale, and they deliberately do not. */
    expect(title).not.toContain('--track-display')
  })
})
/* ────────────────────────────────────────────────────────────────────────────
   The caption rung was never a caption rung.

   Measured with the real cascade (the stylesheets concatenated in load order
   over markup carrying the actual class names, every element's background
   resolved by compositing its alpha ancestors up to the canvas):

       --ld-ink-3 #74747f   4.31:1 on the canvas   3.86:1 on a panel

   Both are under AA's 4.5:1 floor. So it is not a legal text colour ANYWHERE
   on this palette, at any size below 24px, and the admin console had wired it
   into `--adm-muted` — which carried 29 of the console's 70 measured text
   elements: every sidebar section, every table header, every status pill,
   every telemetry label, every note, every empty-state line, and the
   `.adm-muted` table cells holding spend, impressions and dates.

   The rung that IS legal already existed (`--ink-4` `#80808b`, 5.09:1 on the
   canvas and 4.57:1 on a panel) but had no `--ld-*` name, so a console token
   could not point at it without reaching for the legacy re-export.

   These assertions are about MEANING, which is why they belong here rather
   than in console-design-language (that suite pins the ramp and the palette's
   shape; it does not judge whether a grey is dark enough to read).
   ──────────────────────────────────────────────────────────────────────────── */
describe('the muted rung is dark enough to read', () => {
  it('gives --ld-ink-3 the sibling it never had, and makes --ink-4 an alias', () => {
    const bridge = code(chromeCss())
    expect(bridge).toMatch(/--ld-ink-3: #74747f;/)
    expect(bridge).toMatch(/--ld-ink-4: #80808b;/)
    /* One hex, two names. A second literal would be a value free to drift —
       which is exactly how --ink-4 ended up at 2.6:1 last time. */
    expect(bridge).toMatch(/--ink-4: var\(--ld-ink-4\);/)
    expect(bridge.match(/#80808b/g) || []).toHaveLength(1)
  })

  it('points the admin caption token at the legal rung, not the decorative one', () => {
    const root = rule(code(chromeCss()), '.adm-root,')
    const block = chromeCss().slice(chromeCss().indexOf('.adm-root'))
    for (const line of block.split('\n').slice(0, 140)) {
      const m = line.match(/^\s*--(adm-muted|adm-muted-dim):\s*(.+);$/)
      if (m) expect(m[2].trim(), m[1]).toBe('var(--ld-ink-4)')
    }
    expect(root).not.toBeNull()
  })

  it('never asks --ink-3 to carry text inside a panel', () => {
    /* These three sat on --surface at 3.86:1 and failed AA outright. */
    expect(valueOf(rule(advertiserCss(), '.adv-count {'), 'color')).toBe('var(--ink-4)')
    expect(valueOf(rule(dashboardCss(), ".adv-pill[data-status='draft'] {"), 'color'))
      .toBe('var(--ink-4)')
    /* A hint is a sentence, so it takes the prose rung rather than the caption
       one — the same rule the landing pages were lifted to last round. */
    expect(valueOf(rule(appCss(), '.stat__hint {'), 'color')).toBe('var(--ink-2)')
  })

  it('does not put the caption rung on the primary navigation', () => {
    /* A tab you click to move around is not a caption. It was on --adm-muted,
       i.e. 3.86:1, on the most-read label in the console. */
    const nav = read('src/components/admin/AdminConsole.css')
    expect(valueOf(rule(nav, '.adm-nav__btn {'), 'color')).toBe('var(--adm-text-dim)')
  })

  it('lifts a status word off the caption rung when it sits on its own wash', () => {
    /* A grey label on a grey wash cannot reach 4.5:1 at 9px: the wash
       composites to rgb(31,31,34) and --adm-muted reads 4.21:1 on it. */
    const admin = read('src/components/admin/AdminConsole.css')
    expect(valueOf(rule(admin, '.adm-status-pill--muted {'), 'color'))
      .toBe('var(--adm-text-dim)')
  })
})

describe('an affordance never wears the warning hue', () => {
  /* The developer dashboard was fixed for exactly this last round: its tab
     rail, its row marker, its chart hover and its card focus ring were all
     amber. The advertiser form had the same disease in the place that matters
     most — the keyboard focus ring on the field you are typing into. */
  const form = () => appCss()

  it('does not ring the focused field in the product warning colour', () => {
    const focused = rule(form(), '.field__input:focus {')
    expect(focused).not.toBeNull()
    expect(valueOf(focused, 'border-color')).toBe('var(--signal)')
    expect(focused).not.toMatch(/--amber|hair-amber/)
  })

  it('hovers a field in a line, not in a warning', () => {
    const hovered = rule(form(), '.field__input:hover:not(:disabled) {')
    expect(valueOf(hovered, 'border-color')).toBe('var(--hair-strong)')
  })

  it('writes a field error in the error hue, not the warning hue', () => {
    expect(valueOf(rule(form(), '.form__error {'), 'color')).toBe('var(--accent-error)')
  })

  it('writes the link inside a success notice in the accent', () => {
    expect(valueOf(rule(form(), '.form__ok a {'), 'color')).toBe('var(--signal)')
  })

  it('has exactly one error pink, and it is the token', () => {
    /* Was #ff8a8a behind a bare [role="alert"] catch-all that outranked every
       per-component error rule in the product and would not follow
       --accent-error into the light theme. */
    const alert = rule(code(chromeCss()), '.clr-surface [role="alert"] {')
    expect(valueOf(alert, 'color')).toBe('var(--accent-error)')
    expect(code(chromeCss())).not.toMatch(/#ff8a8a/i)
  })
})

describe('no pre-redesign grey is left in the admin stylesheets', () => {
  /* rgba(113,113,122,…) is #71717a at low alpha: the neutral the console used
     before the bridge existed. It survived in four pill/badge washes and one
     border. The same literal was already found and removed from the governance
     hatch gradients last round; this is the rest of it. */
  const adminSheets = [
    () => read('src/components/admin/AdminConsole.css'),
    () => read('src/components/admin/AdminGovernance.css'),
    () => read('src/components/admin/AdminContacts.css'),
  ]

  it('has no #71717a literal anywhere in the console', () => {
    for (const get of adminSheets) {
      const src = get()
      expect(src, 'rgba(113, 113, 122').not.toMatch(/rgba\(\s*113,\s*113,\s*122/)
      expect(src, 'rgba(113,113,122').not.toMatch(/rgba\(\s*113\s*,\s*113\s*,\s*122/)
    }
  })
})
