/**
 * One product, one scale.
 *
 * Three consoles, seven stylesheets, and for most of this repo's life each of
 * them decided for itself how big its labels were, how far apart its rows sat
 * and how tightly its mono caps were tracked. That is not a matter of taste —
 * it is the reason the developer page, the advertiser dashboard and the admin
 * console each read as a different product wearing the same header. There was
 * no rule to disagree with, because there was no rule.
 *
 * These assertions exist so a fifth stylesheet cannot quietly grow its own
 * scale again, and so a well-meant "just bump this one label" cannot land as
 * an untracked exception. They read source, not a DOM: there is no jsdom here
 * and none of this is observable without a browser.
 *
 * What is deliberately NOT asserted: colours, spacing values or layout beyond
 * the scale itself. `tests/ui-polish.test.js` owns the theme-parity and radius
 * contracts; `tests/console-design-language.test.js` owns the token bridge's
 * palette and the typefaces. This file owns the three axes that were free:
 * type size, spacing step and tracking.
 */
/* Imported, not global: vitest here runs with `globals: false`, and this
   project's test files are also linted, where a bare `describe` is a no-undef. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* `import.meta.dirname` rather than `process.cwd()`: eslint only grants Node
   globals to `tests/db/**`, so `process` is a no-undef error out here. */
const ROOT = join(import.meta.dirname, '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

/** Strip comments so prose in a CSS file can never satisfy a code assertion. */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Every `var(--x)` mentioned in a body, de-duplicated. */
function varsIn(body) {
  return [...new Set([...body.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))]
}

/**
 * Flat rule scanner: yields `{ selector, body, at }` for every declaration
 * block, descending through at-rule containers (@media) so a rule inside a
 * breakpoint is reported the same as one at the top level. Deliberately simple
 * because these files do not nest beyond @media.
 */
function rules(source) {
  const s = code(source)
  const out = []
  let i = 0
  let start = 0
  while (i < s.length) {
    if (s[i] !== '{') { i += 1; continue }
    const selector = s.slice(start, i).trim()
    // Find the matching close brace.
    let depth = 1
    let j = i + 1
    while (j < s.length && depth) {
      if (s[j] === '{') depth += 1
      else if (s[j] === '}') depth -= 1
      j += 1
    }
    const body = s.slice(i + 1, j - 1)
    if (!selector.startsWith('@')) {
      out.push({ selector: selector.split().join(' '), body, at: s.slice(0, i).split('\n').length })
    }
    i = j
    start = i
  }
  return out
}

/** The brace-balanced body of the rule whose selector matches `pattern`. */
function block(source, pattern) {
  const hit = rules(source).find((r) => pattern.test(r.selector))
  return hit ? hit.body : null
}

/* The three consoles, and only their own stylesheets. `chrome.css` is the
   bridge rather than a consumer, and `advertiser.css` doubles as the shared
   advertiser landing page, so both are read separately below. */
const CONSOLE_SHEETS = {
  'admin/AdminConsole.css': 'src/components/admin/AdminConsole.css',
  'admin/AdminGovernance.css': 'src/components/admin/AdminGovernance.css',
  'admin/AdminContacts.css': 'src/components/admin/AdminContacts.css',
  'advertiser/advertiser.css': 'src/components/advertiser/advertiser.css',
  'advertiser/dashboard.css': 'src/components/advertiser/dashboard.css',
  'developer/DeveloperConsole.css': 'src/components/developer/DeveloperConsole.css',
}

const CAPS_SHEETS = {
  ...CONSOLE_SHEETS,
  'advertiser/AdvertiserLanding.css': 'src/components/advertiser/AdvertiserLanding.css',
  'developer/DeveloperLanding.css': 'src/components/developer/DeveloperLanding.css',
}

const chrome = () => read('src/components/landing/chrome.css')
const index = () => read('src/index.css')
const bridge = () => block(chrome(), /^\.clr-surface\b/)
const isCaps = (body) => /text-transform:\s*uppercase/.test(body)

describe('the scale lives in the bridge, and nowhere else', () => {
  it('declares the type ramp on the bridge block, not on :root', () => {
    const b = bridge()
    expect(b).toBeTruthy()
    for (const rung of ['micro', 'label', 'small', 'body', 'read', 'lead', 'prose', 'panel', 'title', 'hero']) {
      expect(b).toMatch(new RegExp(`--c-text-${rung}:`))
    }
    expect(b).toMatch(/--c-space-1: 4px/)
    expect(b).toMatch(/--c-space-8: 40px/)
    /* A token on :root would acquire a .light-theme parity obligation, which
       is why these are on the bridge block instead. */
    const root = block(index(), /^:root/)
    expect(root).toBeTruthy()
    expect(root).not.toMatch(/--c-text-/)
    expect(root).not.toMatch(/--c-space-/)
  })

  it('gives every console wrapper the same tokens, not just the one inside a header', () => {
    /* Four surfaces need the bridge, for two different reasons.
       .adm-root: AdminConsole renders at App.jsx with no PageChrome around it,
       so it never sits inside .clr-surface.
       .sdk-page / .advx-page: the opposite problem. Those two ARE the pages,
       and .clr-surface is a DESCENDANT of them, so custom properties inherit
       downward and a wrapper cannot read the tokens its own child declares.
       Both painted `background: var(--void)` at a level where --void came from
       index.css :root, which put 7799px of console on the pre-redesign cool
       blue-black with the landing's canvas one level inside it.
       The assertion is on the whole selector list rather than on a window
       between two names, because the list grows as surfaces are found and a
       window turns that growth into a test failure. */
    const list = chrome().slice(0, chrome().indexOf('{'))
    for (const sel of ['.clr-surface', '.adm-root', '.sdk-page', '.advx-page']) {
      expect(list).toMatch(new RegExp(sel.replace('.', '\\.')))
    }
  })

  it('aliases the console-local names rather than keeping a second scale', () => {
    /* The --adm-* aliases live on AdminConsole.css's own .adm-root block, which
       is right: they are that console's vocabulary for the shared scale, not a
       second copy of it. What matters is that every one of them resolves to a
       --c-* rung rather than to a number of its own. */
    const b = block(read('src/components/admin/AdminConsole.css'), /^\.adm-root$/)
    expect(b).toMatch(/--adm-track:\s*var\(--track-caps\)/)
    for (const rung of ['micro', 'label', 'small', 'body', 'read', 'title', 'figure']) {
      expect(b).toMatch(new RegExp(`--adm-text-${rung}:\\s*var\\(--c-text-${rung}\\)`))
    }
    expect(b).toMatch(/--adm-space-1:\s*var\(--c-space-1\)/)
    expect(b).toMatch(/--adm-space-8:\s*var\(--c-space-8\)/)
  })
})

describe('no console invents a type size', () => {
  /* The one documented exception, and the reason it exists: the telemetry
     figure is the largest number on the admin console and it has to shrink with
     the breakpoint, because five of them side by side at 30px do not fit a
     900px screen. Its ramp is 30 / 26 / 24 / 22 / 20 and it belongs to no rung
     on the type scale at all. The two relative code-tag sizes are the other:
     `0.9em` against whatever the surrounding block already is, which is the
     point of writing them relatively. */
  const FIGURE_RAMP = /^\.adm-tele-card(?:--primary)? \.adm-tele-card__value$/

  it('leaves the telemetry figure ramp as the only px in the admin console', () => {
    const offenders = []
    for (const r of rules(read('src/components/admin/AdminConsole.css'))) {
      for (const m of r.body.matchAll(/font-size:\s*([\d.]+)(px|em|rem)/g)) {
        if (!FIGURE_RAMP.test(r.selector)) offenders.push(`${r.selector} -> ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('sizes the relative code tags relatively', () => {
    for (const p of ['src/components/advertiser/AdvertiserLanding.css', 'src/components/developer/DeveloperLanding.css']) {
      const offenders = rules(read(p))
        .flatMap((r) => [...r.body.matchAll(/font-size:\s*([\d.]+)(px|rem)/g)].map((m) => `${r.selector} -> ${m[0]}`))
      expect(offenders).toEqual([])
    }
  })

  it('leaves no absolute size outside the bridge in any console stylesheet', () => {
    for (const [name, path] of Object.entries(CONSOLE_SHEETS)) {
      const offenders = []
      for (const r of rules(read(path))) {
        if (name === 'admin/AdminConsole.css' && FIGURE_RAMP.test(r.selector)) continue
        for (const m of r.body.matchAll(/font-size:\s*([\d.]+)(px|rem)\s*;/g)) {
          offenders.push(`${name} ${r.selector} -> ${m[0].trim()}`)
        }
      }
      expect(offenders).toEqual([])
    }
  })
})

describe('no console invents a spacing step', () => {
  /* Padding, gaps and block margins are the axes a layout is built from. When
     each stylesheet can pick any number it wants, two panels that sit side by
     side stop agreeing on where the air is, which reads as misalignment long
     before anyone can say what is wrong. 0, 1px, auto and the negative of a
     step are exempt: a hairline grid gap and an auto inset are not steps. */
  const PROPS = /(^|;)\s*(gap|row-gap|column-gap|padding|padding-top|padding-right|padding-bottom|padding-left|margin-top|margin-bottom)\s*:\s*([^;]*)/g
  const ALLOWED = /^(0|1px|auto|none|inherit|initial|calc\(|var\(|clamp\(|min\(|max\()/

  it('resolves every gap, padding and block margin to a step', () => {
    for (const [name, path] of Object.entries(CAPS_SHEETS)) {
      const offenders = []
      for (const r of rules(read(path))) {
        for (const m of r.body.matchAll(PROPS)) {
          const value = m[3].trim()
          if (ALLOWED.test(value)) continue
          if (/^-\s*var\(--(c|adm)-space-/.test(value)) continue
          offenders.push(`${name} ${r.selector} -> ${m[2]}: ${value}`)
        }
      }
      expect(offenders).toEqual([])
    }
  })
})

describe('mono uppercase has exactly two tracking values', () => {
  /* Every uppercase label in any console is mono at 9-11px: table headers,
     pills, field names, section kickers, rail headings, code tags, status
     markers. Between them the seven sheets had picked from nine values with no
     rule, so a 10px label in one panel tracked differently from the same 10px
     label in the next, and the admin console was still on the older 0.09em
     from before the redesign. Two jobs, two values. */
  /* Read the VALUE, not the selector, when listing offenders: these files put
     some selectors and their declarations on one line, so a selector slice is
     not reliably a selector. A line number is a better label anyway. */
  const caps = () => Object.entries(CAPS_SHEETS).flatMap(([name, path]) =>
    rules(read(path)).filter((r) => isCaps(r.body) && /letter-spacing:/.test(r.body)).map((r) => ({ name, r })))
  /* Restricted to one line on purpose. `[^;]*` alone is a trap here: the last
     declaration in a CSS block needs no semicolon, and it is legal, so the
     capture ran on past `letter-spacing` and swallowed the next lines of the
     block. That made every uppercase rule look like it was on a tracking token
     followed by `text-transform: uppercase`, and the test failed on a value it
     had itself mangled. */
  const tracking = (r) => /letter-spacing:\s*([^;\n]*)/.exec(r.body)[1].trim()

  it('gives every uppercase label one of the two caps tokens', () => {
    const offenders = caps()
      .filter(({ r }) => !/^var\(--(track-caps|track-caps-tight|adm-track)\)$/.test(tracking(r)))
      .map(({ name, r }) => `${name}:${r.at} -> ${tracking(r)}`)
    expect(offenders).toEqual([])
  })

  it('has not left an uppercase label on the old eyebrow tracking', () => {
    /* --track-label is the .eyebrow role: a sans kicker at 11px on the
       marketing pages. A mono 9px table header sitting on the same token is how
       the two families quietly converged in the first place. */
    const offenders = caps()
      .filter(({ r }) => /var\(--track-label\)/.test(tracking(r)))
      .map(({ name, r }) => `${name}:${r.at}`)
    expect(offenders).toEqual([])
  })

  it('uses the tight value only on mono runs that carry data rather than a name', () => {
    const tight = caps().filter(({ r }) => tracking(r) === 'var(--track-caps-tight)')
    /* Exactly four, and the count is the assertion: a fifth site needs a
       reason, not a shrug. A formula you read as arithmetic, an audience id you
       compare against the API, a measured verdict sitting in a column of other
       verdicts, and a server-supplied reason of unknown length. Tracking exists
       to make a label legible; on data it works against the comparison the
       data is there for. */
    expect(tight).toHaveLength(4)
    expect(tight.every(({ r }) => /font-family:\s*var\(--(mono|adm-mono)\)/.test(r.body))).toBe(true)
  })
})

describe('the radius scale is the landing scale, declared once', () => {
  it('gives every radius rung the value the front page uses', () => {
    const css = code(index())
    /* These were all 0px under a sharp-corners contract the front page never
       actually used, and the bridge was re-declaring two of them at its own
       values, so a card inside a header-backed page had 12px corners and the
       same card on the admin console had none at all. */
    for (const [rung, value] of [['radius', '8px'], ['radius-sm', '7px'], ['radius-md', '12px'], ['radius-lg', '18px'], ['radius-xl', '20px'], ['radius-2xl', '22px'], ['radius-pill', '9999px']]) {
      expect(css).toMatch(new RegExp(`--${rung}: ${value};`))
    }
    expect(css).not.toMatch(/--(?:radius|radius-sm|radius-md|radius-lg|radius-xl|radius-2xl):\s*0px/)
  })

  it('declares every radius rung together wherever any one of them is declared', () => {
    /* Theme parity exempts anything whose name starts with --radius, so the
       theme check cannot catch one theme losing a rung. What can catch it is
       the rule that a block which has any of them has all of them: the scale
       is a set, and a set with a member missing in one theme is two scales. */
    const RUNGS = ['radius', 'radius-sm', 'radius-md', 'radius-lg', 'radius-xl', 'radius-2xl', 'radius-pill']
    const blocks = [...code(index()).matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((b) => /--radius-md:/.test(b))
    expect(blocks.length).toBeGreaterThanOrEqual(2)
    for (const body of blocks) {
      for (const rung of RUNGS) expect(body).toMatch(new RegExp(`--${rung}:`))
    }
  })
})

describe('every token the consoles reach for is actually declared', () => {
  it('declares each --c-* and --adm-* the console sheets read somewhere in src', () => {
    /* The bridge is the declared home for the shared scale. The admin console
       names are aliases and live in the same block. Anything a console reads
       and nothing declares resolves to whatever :root happens to hold, which is
       how a 9.5px note ends up at 2.6:1 while the designer believes the bridge
       answered. */
    const declared = new Set()
    for (const path of [
      'src/components/landing/chrome.css',
      'src/index.css',
      'src/components/admin/AdminConsole.css',
      'src/components/advertiser/advertiser.css',
      'src/components/advertiser/dashboard.css',
      'src/components/advertiser/AdvertiserLanding.css',
      'src/components/developer/DeveloperLanding.css',
      'src/components/developer/DeveloperConsole.css',
    ]) {
      for (const m of code(read(path)).matchAll(/^\s*(--[\w-]+)\s*:/gm)) declared.add(m[1])
    }
    const used = new Set()
    for (const path of Object.values(CONSOLE_SHEETS)) {
      for (const r of rules(read(path))) for (const v of varsIn(r.body)) if (/^--(c|adm|track-caps|track)-/.test(v)) used.add(v)
    }
    expect([...used].filter((v) => !declared.has(v))).toEqual([])
  })
})

describe('the admin console is branded like the rest of the product', () => {
  it('takes its accent from the landing rather than carrying its own', () => {
    const b = block(read('src/components/admin/AdminConsole.css'), /^\.adm-root$/)
    expect(b).toBeTruthy()
    expect(b).toMatch(/--adm-brand:\s*var\(--ld-accent\)/)
    expect(b).not.toMatch(/--adm-brand:\s*#/)
    expect(b).toMatch(/--adm-bg:\s*var\(--ld-bg\)/)
    expect(b).toMatch(/--adm-surface:\s*var\(--ld-surface\)/)
  })

  it('paints no literal colour in any admin stylesheet', () => {
    for (const path of ['src/components/admin/AdminConsole.css', 'src/components/admin/AdminGovernance.css', 'src/components/admin/AdminContacts.css']) {
      expect(code(read(path))).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    }
  })

  it('keeps the destructive action out of the brand hue', () => {
    /* .adm-gov-btn--danger used to wear --adm-brand-*, so "Stop serving" and
       "Confirm: block serving" looked like the recommended action. Red-for-
       danger is meaning, not branding, and it lives in the status family. */
    const css = code(read('src/components/admin/AdminGovernance.css'))
    const danger = css.match(/\.adm-gov-btn--danger[^{}]*\{([^{}]*)\}/)
    expect(danger).toBeTruthy()
    expect(danger[1]).toMatch(/--adm-status-error/)
    expect(danger[1]).not.toMatch(/--adm-brand/)
  })
})

describe('no declaration was swallowed by a missing semicolon', () => {
  /* This suite rewrote several hundred declarations across eight stylesheets,
     and the rewrite dropped the trailing semicolon on seventy-two of them. A
     declaration with no semicolon is not a syntax error: the parser reads it as
     the last one in its block and drops it. So `font-size: var(--adm-text-micro)`
     followed by `color: ...` simply stopped applying, in a rule, in a console,
     with nothing in the build to say so -- and no test in this repo was looking,
     because every one of them was asserting on text that was still present.

     The check is narrow on purpose. A missing semicolon on the LAST declaration
     of a block is legal CSS and fires on hundreds of lines across chrome.css and
     landing.css, so it must not be reported. Only a missing semicolon followed
     by ANOTHER declaration is a defect, and that is what is asserted here. */

  const PATTERN = /([\w-]+[ \t]*:[^;{}\n]*)(?=\n[ \t]*[\w-]+[ \t]*:)/g

  const dropped = (path) => {
    /* Comments are blanked, not deleted: deleting them would join two lines and
       invent a match that the file does not contain. */
    const raw = read(path)
    const masked = raw.replace(/\/\*[\s\S]*?\*\//g, (c) => ' '.repeat(c.length))
    const out = []
    for (const m of masked.matchAll(PATTERN)) {
      const line = raw.slice(0, m.index).split('\n').length
      out.push(`${path}:${line} -> ${m[1].trim()}`)
    }
    return out
  }

  it('keeps every semicolon in every console stylesheet', () => {
    const offenders = Object.values(CONSOLE_SHEETS).flatMap(dropped)
    expect(offenders).toEqual([])
  })

  it('keeps every semicolon in the bridge that hands them their tokens', () => {
    expect(dropped('src/components/landing/chrome.css')).toEqual([])
  })
})
