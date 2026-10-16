/**
 * The header is one line. Always. That is a promise about LAYOUT rather than
 * about width: the wordmark, the nav and the calls to action are three flex
 * groups, and they need ~550px inside a row that is 928px even on a phone, so
 * the row never runs out of room -- it only ever ran out of patience.
 *
 * The defect this pins is a real one that was live until now. `.clrhead-in`
 * carried `flex-wrap: wrap`, and the `@media (max-width: 960px)` block moved
 * the nav to its own row with `order: 3; flex-basis: 100%`. Measured in a real
 * browser across 1440 -> 320: the row was 72px tall above 960 and 112px below
 * it, with the three group centres 47px apart -- two rows. At 320 the calls to
 * action wrapped too, a third row. The room was never the problem.
 *
 * So the assertions below are about the three ways a row can break, and each
 * one has to be closed explicitly rather than by luck:
 *   1. the row is nowrap                    -- nothing stacks
 *   2. the two ends do not shrink           -- the wordmark and the buttons stay whole
 *   3. the wordmark is nowrap itself        -- "CLI" and "Revenue" cannot split
 * and the narrow tier must not reintroduce a second row, nor let the nav
 * shrink to zero width, which is how a nav ends up invisible rather than
 * wrapped -- a worse answer than either.
 *
 * THERE ARE TWO HEADERS, and both are covered here. `PageChrome.jsx` renders
 * the one every console, auth page and dashboard wears. `Landing.jsx` renders
 * a completely separate one of its own -- the front page does not use
 * `PageChrome` -- and it had the same defect in a worse form, because it is
 * two rows at EVERY width including 1440 (the nav sat 45px below the wordmark
 * where there was room to spare) and it carries six links and four buttons
 * rather than three and two.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/* `import.meta.dirname` rather than `process.cwd()`: eslint only grants Node
   globals to `tests/db/**`, so `process` is a no-undef error out here. */
const ROOT = join(import.meta.dirname, '..')
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8')

const chrome = read('src/components/landing/chrome.css')
const pageChrome = read('src/components/landing/PageChrome.jsx')
const landing = read('src/components/landing/landing.css')
const landingPage = read('src/components/landing/Landing.jsx')

/* Strip comments so prose in a rationale can never be read as a declaration. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/* The declarations of one rule, brace-balanced from its selector. */
function rule(src, selector) {
  const start = src.indexOf(selector)
  if (start === -1) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return ''
}

/* A whole @media block, brace-balanced from its condition. */
function media(src, condition) {
  const start = src.indexOf(condition)
  if (start === -1) return ''
  const open = src.indexOf('{', start)
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return ''
}

const css = code(chrome)
const lCss = code(landing)

/* Every @media block at `condition` whose body mentions `needle`.
   landing.css has three `@media (max-width: 900px)` blocks and two at 560px,
   two of them belonging to the footer -- so a plain indexOf on the condition
   silently asserts against the wrong one and proves nothing about the header.
   Requiring a needle makes the assertion bind to the block that actually
   governs the row. */
function mediaBlocks(src, condition, needle) {
  const found = []
  for (let at = src.indexOf(condition); at !== -1; at = src.indexOf(condition, at + 1)) {
    const open = src.indexOf('{', at)
    let depth = 0
    for (let i = open; i < src.length; i += 1) {
      if (src[i] === '{') depth += 1
      else if (src[i] === '}') {
        depth -= 1
        if (depth === 0) {
          if (src.slice(open + 1, i).includes(needle)) found.push(src.slice(open + 1, i))
          break
        }
      }
    }
  }
  return found
}

describe('the header row never becomes two rows', () => {
  it('the row itself is nowrap, so nothing can stack', () => {
    expect(rule(css, '.clrhead-in')).toMatch(/flex-wrap:\s*nowrap/)
    // The old value, spelled out: this is the one line that caused the bug.
    expect(rule(css, '.clrhead-in')).not.toMatch(/flex-wrap:\s*wrap/)
  })

  it('the wordmark and the calls to action are the two things that must not shrink', () => {
    // They are `0 0 auto` on purpose. Anything else lets the flex algorithm
    // hand all the squeeze to whichever end it likes, and a squeezed wordmark
    // is a wordmark that wraps mid-word.
    expect(rule(css, '.clrhead .brand-text')).toMatch(/flex:\s*0 0 auto/)
    expect(rule(css, '.clrhead-cta')).toMatch(/flex:\s*0 0 auto/)
  })

  it('the wordmark cannot break between "CLI" and "Revenue"', () => {
    expect(rule(css, '.clrhead .brand-text')).toMatch(/white-space:\s*nowrap/)
    // Belt and braces: the two spans are separate elements, so nowrap on the
    // anchor is what actually binds them together.
    const brand = pageChrome.slice(pageChrome.indexOf('brand-text'), pageChrome.indexOf('brand-text') + 400)
    expect(brand).toMatch(/<span className="brand-cli">CLI<\/span>/)
    expect(brand).toMatch(/<span className="brand-revenue">Revenue<\/span>/)
  })

  it('the nav is the only part allowed to give way, and only inside its own line', () => {
    const links = rule(css, '.clrhead-links')
    expect(links).toMatch(/flex:\s*1 1 auto/)
    // min-width: 0 is what lets it shrink at all without the row breaking.
    expect(links).toMatch(/min-width:\s*0/)
    // It scrolls sideways rather than pushing the row onto a second line.
    expect(links).toMatch(/overflow-x:\s*auto/)
  })

  it('the narrow screens block does not reintroduce a second row', () => {
    const narrow = media(css, '@media (max-width: 960px)')
    expect(narrow).not.toBe('')
    // This is the pair that moved the nav onto its own line.
    expect(narrow).not.toMatch(/flex-basis:\s*100%/)
    expect(narrow).not.toMatch(/\border:\s*3\b/)
    expect(narrow).toMatch(/\.clrhead-in\s*\{[^}]*padding:/)
  })

  it('at phone widths the row scrolls sideways instead of breaking', () => {
    const phone = media(css, '@media (max-width: 480px)')
    expect(phone).not.toBe('')
    expect(phone).toMatch(/\.clrhead-in\s*\{[^}]*overflow-x:\s*auto/)
    expect(phone).toMatch(/\.clrhead-in\s*\{[^}]*min-height:/)
    // And the nav stops shrinking, so it can never collapse to nothing. A nav
    // that is invisible is a worse answer than a nav that wrapped.
    expect(phone).toMatch(/\.clrhead-links\s*\{[^}]*flex:\s*0 0 auto/)
    expect(phone).toMatch(/\.clrhead-links\s*\{[^}]*overflow:\s*visible/)
  })

  it('no header rule anywhere declares a raw pixel radius', () => {
    // Same contract as the rest of the project: radii go through var().
    const headerRules = css.split('\n')
    for (const line of headerRules) {
      if (!/clrhead|brand-text|brand-cli|brand-revenue/.test(line)) continue
      expect(line).not.toMatch(/border-radius:\s*[1-9]\d*px/)
    }
  })
})

describe('the header is one row of three groups, not a pile of blocks', () => {
  it('the wordmark, the nav and the calls to action are siblings in one row', () => {
    const start = pageChrome.indexOf('className="clrhead-in"')
    const row = pageChrome.slice(start, pageChrome.indexOf('</header>', start))
    expect(row).toMatch(/className="brand-text"/)
    expect(row).toMatch(/className="clrhead-links"/)
    expect(row).toMatch(/className="clrhead-cta"/)
    // Nothing else may join the row: a fourth group is what starts the wrap.
    // The indent is measured off the row's own line rather than hardcoded, so
    // reformatting the file does not silently turn this into a no-op.
    const indent = pageChrome.slice(pageChrome.lastIndexOf('\n', start) + 1, start).match(/^\s*/)[0]
    const childIndent = indent + '  '
    const children = row.match(new RegExp('^' + childIndent + '<(\\w+)', 'gm')) || []
    expect(children.map((c) => c.replace(/^\s+<(\w+).*/, '$1'))).toEqual(['a', 'nav', 'div'])
  })

  it('the calls to action are the only thing pinned to the right edge', () => {
    // margin-left: auto on .clrhead-cta is what opens the slack between the
    // nav and the buttons. If it ever moved to the row, the row would be
    // left-packed and a squeeze would wrap at the far edge instead.
    expect(rule(css, '.clrhead-cta')).toMatch(/margin-left:\s*auto/)
  })
})

describe('the landing header row never becomes two rows', () => {
  it('the row itself is nowrap, so nothing can stack', () => {
    expect(rule(lCss, '.nav-in')).toMatch(/flex-wrap:\s*nowrap/)
    // The old value, spelled out. This one put the nav 45px below the
    // wordmark on a 1440px screen, which is where the report came from.
    expect(rule(lCss, '.nav-in')).not.toMatch(/flex-wrap:\s*wrap/)
  })

  it('the wordmark and the four calls to action are the two things that must not shrink', () => {
    expect(rule(lCss, '.brand-text-landing')).toMatch(/flex:\s*0 0 auto/)
    expect(rule(lCss, '.nav-cta')).toMatch(/flex:\s*0 0 auto/)
    // Four buttons at two different heights looks like a mistake even when it
    // is not one, so the group itself is nowrap as well as unmovable.
    expect(rule(lCss, '.nav-cta')).toMatch(/white-space:\s*nowrap/)
  })

  it('the wordmark cannot break between "CLI" and "Revenue"', () => {
    // Two separate spans, so nowrap on the anchor is what binds them. "CLI"
    // over "Revenue" reads as two different words.
    expect(rule(lCss, '.brand-text-landing')).toMatch(/white-space:\s*nowrap/)
    const start = landingPage.indexOf('brand-text-landing')
    const brand = landingPage.slice(start, start + 400)
    expect(brand).toMatch(/<span className="brand-cli">CLI<\/span>/)
    expect(brand).toMatch(/<span className="brand-revenue">Revenue<\/span>/)
  })

  it('the nav has a shrink floor, because a floorless nav collapses to nothing', () => {
    const links = rule(lCss, '.nav-links')
    expect(links).toMatch(/flex:\s*1 1 auto/)
    expect(links).toMatch(/overflow-x:\s*auto/)
    // `min-width: 0` on its own is not enough and is actively dangerous here:
    // measured after the nowrap change, the nav went to 0px wide at 480, 390
    // and 320 -- nothing wrapped, the links were simply gone, which is a worse
    // answer than a wrapped nav. The floor is what makes "shrink first" safe.
    const floor = Number((links.match(/min-width:\s*(\d+)px/) || [])[1])
    expect(Number.isFinite(floor)).toBe(true)
    expect(floor).toBeGreaterThanOrEqual(200)
  })

  it('the tablet block does not promote the nav onto a row of its own', () => {
    const [tablet] = mediaBlocks(lCss, '@media (max-width:960px)', '.nav-links')
    expect(tablet).toBeDefined()
    expect(tablet).not.toMatch(/flex-basis:\s*100%/)
    expect(tablet).not.toMatch(/\border:\s*3\b/)
    // The links still shrink here, just a little further.
    expect(tablet).toMatch(/gap:\s*10px/)
  })

  it('the phone block does not answer an overflow by wrapping the buttons', () => {
    const [phone] = mediaBlocks(lCss, '@media (max-width:560px)', '.nav-cta')
    expect(phone).toBeDefined()
    expect(phone).not.toMatch(/flex-wrap:\s*wrap/)
    // It shrinks them instead. Four buttons do not fit beside six links at
    // phone width; breaking the line is not the answer, panning is.
    expect(phone).toMatch(/\.nav-cta \.lbtn--sm\{[^}]*height:\s*30px/)
  })

  it('below the floor the whole row pans rather than the nav turning into a sliver', () => {
    const [hand] = mediaBlocks(lCss, '@media (max-width:900px)', '.nav-in')
    expect(hand).toBeDefined()
    expect(hand).toMatch(/overflow-x:\s*auto/)
    // The nav stops shrinking here and takes its natural width back, so the
    // 300px floor above can never squeeze it into an unreadable column.
    expect(hand).toMatch(/\.nav-links\{[^}]*flex:\s*0 0 auto/)
    expect(hand).toMatch(/\.nav-links\{[^}]*overflow:\s*visible/)
  })
})

describe('the landing header is one row of three groups, and it has something to break', () => {
  it('the wordmark, the section links and the calls to action are siblings in one row', () => {
    const start = landingPage.indexOf('className="nav-in"')
    const row = landingPage.slice(start, landingPage.indexOf('</header>', start))
    expect(row).toMatch(/className="brand-text brand-text-landing"/)
    expect(row).toMatch(/className="nav-links"/)
    expect(row).toMatch(/className="nav-cta"/)
    // Indent derived from the row's own line, so reformatting cannot turn
    // this into a silent no-op.
    const indent = landingPage.slice(landingPage.lastIndexOf('\n', start) + 1, start).match(/^\s*/)[0]
    const children = row.match(new RegExp('^' + indent + '  <(\\w+)', 'gm')) || []
    expect(children.map((c) => c.replace(/^\s+<(\w+).*/, '$1'))).toEqual(['a', 'nav', 'div'])
  })

  it('the row really does carry six links and four buttons, so the promises above bite', () => {
    // Worth pinning because the row is narrower than it looks: six links plus
    // four buttons need ~1692px unscaled against a 1232px row at 1440. That is
    // why the fix shrank everyone's padding rather than deleting anything --
    // and it is why "one line" had to be bought, not assumed.
    const start = landingPage.indexOf('<nav className="nav-links"')
    const nav = landingPage.slice(start, landingPage.indexOf('</nav>', start))
    expect((nav.match(/<a href="#/g) || []).length).toBe(6)
    const ctaStart = landingPage.indexOf('className="nav-cta"')
    const cta = landingPage.slice(ctaStart, landingPage.indexOf('</div>', ctaStart))
    expect((cta.match(/<a className="lbtn/g) || []).length).toBe(4)
  })

  it('no landing header rule declares a raw pixel radius', () => {
    for (const line of lCss.split('\n')) {
      if (!/\.nav-in|\.nav-links|\.nav-cta|brand-text-landing/.test(line)) continue
      expect(line).not.toMatch(/border-radius:\s*[1-9]\d*px/)
    }
  })
})