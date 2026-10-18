/**
 * "The developer dashboard and the advertiser dashboard look very bad."
 *
 * They were not broken — nothing errored, nothing overflowed. They were
 * legible and unstructured, and the reason was structural rather than
 * cosmetic: the console CSS is a *bridge*, and the bridge had drifted away
 * from the page it was bridging to.
 *
 * `src/components/landing/chrome.css` declares the landing palette once, on
 * `.clr-surface`, and re-exports it under the old repo token names (`--void`,
 * `--panel`, `--hair`, `--signal`, `--amber`, `--mono`, `--gutter`, ...).
 * DeveloperLanding.css, AdvertiserLanding.css, advertiser.css,
 * DeveloperConsole.css and dashboard.css all consume those aliases, so the
 * consoles pick up the landing's look with zero edits of their own. That is a
 * genuine advantage and it is also the trap: the bridge is the only place a
 * design change can be made system-wide, and when the bridge stops matching
 * the landing, every console drifts at once and nothing in the console code
 * says why.
 *
 * Four drifts were live at the time of writing:
 *
 * 1. Typefaces. The bridge declared its own `--sans` and `--mono` using the
 *    `-apple-system` and `ui-monospace` stacks. `.clr-surface` outranks
 *    `:root`, so those two lines silently overrode the brand families
 *    (Space Grotesk, JetBrains Mono) that `src/index.css` establishes — and
 *    the landing, which declares no `--sans`/`--mono` of its own, was the ONLY
 *    page in the brand typeface. Every console, login page and dashboard was
 *    rendering in Helvetica next to a marketing page in Space Grotesk. This
 *    is the single loudest reason the dashboards read as a different product.
 *
 * 2. Tracking. `--track-head` sat at -0.03em where the landing sets its display
 *    type at -0.045em on h1 and -0.04em on h2. One flag retunes
 *    DeveloperLanding.css, AdvertiserLanding.css and App.css at once.
 *
 * 3. Surface depth. `--ld-bg` (#0b0b0e) and `--ld-surface` (#121216) were two
 *    steps apart, which on a dark screen is a flat black field with panels
 *    floating in it rather than cards resting on a page. The ladder is now
 *    canvas -> raised panel -> recessed well.
 *
 * 4. An unstyled table. `.key-table`, used by the two developer key flows a
 *    publisher reads regularly, had no rule anywhere in the project and no
 *    `.adv-tablewrap` container, so it was the one part of the console with no
 *    landing treatment at all.
 *
 * These are source-shape assertions for the same reason as every other
 * frontend contract in this repo: `vitest.config.js` runs `environment: 'node'`
 * with no DOM, so a computed-style assertion is not available. Reading the
 * bridge is reading the single source of truth for the whole console layer.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')
const chrome = () => read('src', 'components', 'landing', 'chrome.css')
const index = () => read('src', 'index.css')

/** Strip comments so prose naming a token is never mistaken for a declaration. */
const code = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/** The body of the console token block, braces balanced.
    The selector is `.clr-surface,\n.adm-root {` — the admin console was added
    to it so it inherits the same palette — so this matches the LAST selector
    before the brace rather than requiring the block to start `.clr-surface {`,
    which would silently stop finding it the day anyone reformatted that list. */
const surfaceBlock = () => {
  const body = code(chrome())
  const start = body.search(/\.clr-surface[\s\S]{0,80}?\{/)
  expect(start).toBeGreaterThan(-1)
  let depth = 0
  for (let i = body.indexOf('{', start); i < body.length; i += 1) {
    if (body[i] === '{') depth += 1
    else if (body[i] === '}') {
      depth -= 1
      if (depth === 0) return body.slice(start, i + 1)
    }
  }
  throw new Error('the console token block is not closed')
}

const token = (name) => {
  const block = surfaceBlock()
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  expect(match, `${name} is not declared on .clr-surface`).toBeTruthy()
  return match[1].trim()
}

describe('the console bridge inherits the brand typefaces', () => {
  it('declares no --sans or --mono of its own', () => {
    // The override is what broke it. Asserting the ABSENCE is the assertion:
    // adding a literal stack back here is precisely the regression.
    const block = surfaceBlock()
    expect(block).not.toMatch(/--sans\s*:/)
    expect(block).not.toMatch(/--mono\s*:/)
    expect(block).not.toMatch(/-apple-system/)
  })

  it('the brand families really do live in :root, which the bridge cannot beat', () => {
    // If these move out of :root the consoles have no font at all, because
    // nothing else declares one. That is the flip side of "just inherit".
    const root = index().slice(0, index().indexOf('.light-theme'))
    expect(root).toMatch(/--font-sans\s*:[^;]*Space Grotesk/)
    expect(root).toMatch(/--font-display\s*:[^;]*Space Grotesk/)
    expect(root).toMatch(/--font-mono\s*:[^;]*JetBrains Mono/)
    expect(root).toMatch(/--sans\s*:\s*var\(--font-sans\)/)
    expect(root).toMatch(/--mono\s*:\s*var\(--font-mono\)/)
  })

  it('the landing resolves its body face through the token, not a literal', () => {
    // The asymmetry that made the bridge bug invisible: the landing was
    // correct by inheritance, so the override in `.clr-surface` looked
    // harmless. It was not -- but there was a second, symmetric defect.
    //
    // landing.css carries its own reset block, and its `body` rule declared
    // `font-family: -apple-system, BlinkMacSystemFont, …` as a LITERAL. That
    // outranked `index.css`'s `body { font-family: var(--body) }` and put the
    // marketing page in Helvetica while the rest of the system declared
    // Space Grotesk -- from a woff2 served out of public/fonts/, i.e. a
    // working, available brand face. The sibling declaration further down has
    // a comment saying it is deliberately "the page's text face rather than
    // the terminal stack", so the intent was the sans token all along; it was
    // just written out by hand.
    //
    // Both sides now go through the token, which is the only way "copy the
    // design language from the main page" is actually true: if only the
    // bridge had been fixed, the consoles would have moved to Space Grotesk
    // and diverged from the landing instead of matching it.
    const landing = read('src', 'components', 'landing', 'landing.css')
    const heart = read('src', 'components', 'landing', 'heart.css')
    for (const [name, source] of [['landing.css', landing], ['heart.css', heart]]) {
      expect(source, `${name} re-introduces a literal system stack`)
        .not.toMatch(/font-family\s*:\s*-apple-system/)
    }
    expect(landing).toMatch(/font-family\s*:\s*var\(--body\)/)
    expect(heart).toMatch(/font-family\s*:\s*var\(--body\)/)
    // And it must not invent a competing token to do it.
    expect(landing).not.toMatch(/--sans\s*:/)
    expect(landing).not.toMatch(/--mono\s*:/)
  })

  it('--body resolves to the brand face in :root', () => {
    const root = index().slice(0, index().indexOf('.light-theme'))
    expect(root).toMatch(/--body\s*:\s*var\(--font-body\)/)
  })
})

describe('display type tracks by size, the way the landing sets it', () => {
  it('--track-head matches the landing display tracking', () => {
    // Consumed by DeveloperLanding.css, AdvertiserLanding.css and App.css, so
    // this single token moves every console heading at once.
    expect(token('--track-head')).toBe('-0.045em')
  })

  it('headings use the tokens rather than a flat literal', () => {
    // A literal here would re-freeze the scale and silently opt out of the
    // retune above, which is how this drifted in the first place.
    const body = code(chrome())
    expect(body).toMatch(/\.clr-surface h1,\s*\n\.clr-surface h2 \{ letter-spacing: var\(--track-head\); \}/)
    expect(body).toMatch(/\.clr-surface h3,\s*\n\.clr-surface h4 \{ letter-spacing: var\(--track-tight\); \}/)
    expect(body).not.toMatch(/letter-spacing: -0\.028em/)
  })
})

describe('the surface ladder actually separates canvas, panel and well', () => {
  it('the panel is measurably lighter than the canvas', () => {
    // Not a style opinion: at the old two-step distance these two render as
    // one flat black field and the cards stop reading as cards.
    const bg = token('--ld-bg')
    const surface = token('--ld-surface')
    expect(bg).toMatch(/^#[0-9a-f]{6}$/i)
    expect(surface).toMatch(/^#[0-9a-f]{6}$/i)
    const value = (hex) => parseInt(hex.slice(1), 16)
    expect(value(surface) - value(bg)).toBeGreaterThan(8)
  })

  it('the well is recessed inside the panel it appears in', () => {
    // "Recessed" is relative to the surface the control sits ON, not to the
    // page canvas. An input is drawn inside a card, so the well must be
    // darker than --ld-surface -- and distinct from --ld-bg, or it stops
    // being a third step and just becomes the canvas under another name.
    const bg = token('--ld-bg')
    const surface = token('--ld-surface')
    const well = token('--ld-well')
    const value = (hex) => parseInt(hex.slice(1), 16)
    expect(value(surface) - value(well)).toBeGreaterThan(8)
    expect(value(well) - value(bg)).toBeGreaterThan(0)
  })

  it('the old aliases follow the ladder rather than freezing their own values', () => {
    // --panel and --clr-panel are what dashboard.css and advertiser.css
    // actually read. If they pin a hex the ladder above becomes cosmetic.
    expect(token('--panel')).toBe('var(--ld-surface)')
    expect(token('--panel-2')).toBe('var(--ld-bg-tint)')
    expect(token('--clr-panel')).toBe('var(--ld-surface)')
  })

  it('inputs sit in the well', () => {
    const body = code(chrome())
    expect(body).toMatch(/background: var\(--ld-well\)/)
  })
})

describe('the developer key tables carry the landing treatment', () => {
  it('key-table has real rules', () => {
    // It previously had none anywhere in the project: the only tables a
    // publisher reads on a regular basis, and the one part of the console
    // with no landing treatment at all.
    const body = code(chrome())
    expect(body).toMatch(/\.clr-surface \.key-table \{/)
    expect(body).toMatch(/\.clr-surface \.key-table th \{/)
    expect(body).toMatch(/\.clr-surface \.key-table td \{/)
    expect(body).toMatch(/\.clr-surface \.key-table tbody tr:hover td/)
  })

  it('both key flows wrap the table so it can scroll and carry a frame', () => {
    // adv-table owns no border or radius; adv-tablewrap is what supplies the
    // overflow, the hairline and the corner radius. Without the wrapper the
    // table has neither.
    for (const file of ['PublisherKeys.jsx', 'PublisherPlacements.jsx']) {
      const source = read('src', 'components', 'developer', file)
      const open = source.indexOf('<div className="adv-tablewrap">')
      const table = source.indexOf('<table className="key-table">')
      const closeTable = source.indexOf('</table>', table)
      const closeWrap = source.indexOf('</div>', closeTable)
      expect(open, `${file} has no .adv-tablewrap`).toBeGreaterThan(-1)
      // The wrapper must OPEN before the table. Nesting it the other way is
      // silently invalid HTML: the browser hoists a div out of a table, the
      // wrapper never forms, and the styling quietly does not apply.
      expect(open, `${file}: wrapper must open before the table`).toBeLessThan(table)
      expect(closeWrap, `${file}: wrapper must close after the table`).toBeGreaterThan(closeTable)
    }
  })
})

describe('the developer page has a heading hierarchy a screen reader can follow', () => {
  it('top-level section heads are h2, not h3', () => {
    // The page had NO h2 at all: its section heads were h3, one level
    // shallower than the landing's h1 -> h2 -> h3 -> h4, so the document
    // outline started at level three. Size is class-driven
    // (.sdk-head__title), so the tag swap changes no computed type size.
    const source = read('src', 'components', 'developer', 'DeveloperLanding.jsx')
    expect(source.match(/<h2 /g)?.length ?? 0).toBeGreaterThanOrEqual(10)
    expect(source).not.toMatch(/<h3 /)
    // And the anchors the section heads carry must survive the promotion.
    const ids = source.match(/<h2 [^>]*id="[^"]+"/g) ?? []
    expect(ids.length).toBeGreaterThanOrEqual(10)
  })
})
