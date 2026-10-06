/* =============================================================
   Responsive contract for the polished surfaces
   -------------------------------------------------------------
   The film's mobile behaviour is load-bearing and must not regress,
   so these assertions are deliberately narrow: they check that each
   wide surface has a documented collapse point, not that any specific
   pixel value is used.

   They read the stylesheets rather than a rendered layout because a
   real horizontal-overflow measurement needs a layout engine driving
   a real viewport, and a test that fakes one proves nothing about the
   engine. What this does catch is the failure mode that actually
   happens when someone edits a grid: a `repeat(2, ...)` or a fixed
   `min-width` with no breakpoint under it, which is invisible in
   review and only shows up on a phone.
   ============================================================= */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const app = readFileSync(`${ROOT}src/App.css`, 'utf8')
const demo = readFileSync(`${ROOT}src/components/scenes/AdvertiserDemo.css`, 'utf8')
const promo = readFileSync(`${ROOT}src/components/PromoAd.css`, 'utf8')

/** Every file under `dir` whose name matches `pattern`, recursively. */
function listFiles(dir, pattern) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...listFiles(full, pattern))
    else if (pattern.test(entry)) out.push(full)
  }
  return out
}

/* The block of media queries at or below `width`, so an assertion can
   ask "does this surface collapse by 480px?" without matching an
   unrelated breakpoint higher up the file. */
function blocksUpTo(css, width) {
  const out = []
  const re = /@media \(max-width: (\d+)px\) \{/g
  let m
  while ((m = re.exec(css))) {
    if (Number(m[1]) > width) continue
    /* Walk braces to find the end of this at-rule. */
    let depth = 1
    let i = re.lastIndex
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    out.push(css.slice(re.lastIndex, i))
  }
  return out.join('\n')
}

describe('the advertiser scene collapses', () => {
  it('breaks its campaign table into a stacked layout', () => {
    expect(blocksUpTo(demo, 760)).toContain('.advertiser-demo__th')
    expect(blocksUpTo(demo, 760)).toMatch(
      /\.advertiser-demo__td \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto;/,
    )
  })

  it('folds the four-column figure band down to one column', () => {
    expect(blocksUpTo(demo, 900)).toMatch(
      /\.advertiser-demo__annotations \{[^}]*repeat\(2, minmax\(0, 1fr\)\);/,
    )
    expect(blocksUpTo(demo, 480)).toMatch(
      /\.advertiser-demo__annotations \{[^}]*grid-template-columns: 1fr;/,
    )
  })

  it('stacks the two boards and the four workflow steps', () => {
    expect(blocksUpTo(demo, 980)).toMatch(
      /\.advertiser-demo__split \{[^}]*grid-template-columns: 1fr;/,
    )
    expect(blocksUpTo(demo, 860)).toMatch(
      /\.advertiser-demo__flow-track \{[^}]*repeat\(2, minmax\(0, 1fr\)\);/,
    )
    expect(blocksUpTo(demo, 460)).toMatch(
      /\.advertiser-demo__flow-track \{[^}]*grid-template-columns: 1fr;/,
    )
  })

  it('honours reduced motion', () => {
    expect(demo).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

describe('the closing actions collapse', () => {
  it('goes from two columns to one', () => {
    expect(blocksUpTo(app, 560)).toMatch(
      /\.closing__actions \{[^}]*grid-template-columns: 1fr;/,
    )
  })

  it('does not exceed the width of the mark above it', () => {
    expect(app).toMatch(
      /\.closing__actions \{[^}]*min-width: min\(100%, 420px\);/,
    )
  })

  /* The actions sit inside a centred column that is already capped by
     the mark, so they must not introduce a second cap that would
     disagree with it at wide sizes. */
  it('is fluid above the breakpoint', () => {
    const rule = app.slice(app.indexOf('.closing__actions {'))
    expect(rule.slice(0, 240)).toContain('width: 100%')
  })
})

describe('the promoted ads collapse', () => {
  it('stacks the inline variant on narrow screens', () => {
    expect(blocksUpTo(promo, 640)).toMatch(
      /\.promo-ad--inline \{[^}]*flex-direction: column;/,
    )
  })

  it('honours reduced motion', () => {
    expect(promo).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })
})

describe('the film keeps its gutter', () => {
  /* `clamp()` rather than a fixed padding value, because the scenes
     sit inside a stage that is translated with the playhead: a fixed
     gutter would let the text reach the viewport edge on the
     narrowest phones. */
  it('sizes scene padding from the gutter token', () => {
    expect(app).toMatch(/^\.scene \{[\s\S]*?padding: 112px var\(--gutter\);/m)
  })
})

/* =============================================================
   Custom property integrity
   -------------------------------------------------------------
   `var(--x)` with no `--x` defined anywhere is not a build error and
   not a runtime exception. It computes to nothing, so the declaration
   that used it is simply dropped -- which is how a hover state can
   silently lose its background and leave, say, black button text on
   whatever happens to be behind it.

   This caught `--adm-amber-bright`, used by the contact inbox save
   button on hover and defined nowhere. It is a narrow check on
   purpose: it only asks that a property a stylesheet names is
   defined somewhere in src/, not that the values look right.
   ============================================================= */

describe('custom property integrity', () => {
  const cssFiles = listFiles(join(ROOT, 'src'), /\.css$/)

  it('finds the stylesheets to check', () => {
    expect(cssFiles.length).toBeGreaterThan(8)
  })

  it('defines every custom property a stylesheet uses', () => {
    const sources = cssFiles.map((file) => readFileSync(file, 'utf8'))
    const defined = new Set()
    for (const source of sources) {
      for (const m of source.matchAll(/(--[a-z0-9-]+)\s*:/gi)) defined.add(m[1])
    }

    const missing = []
    for (const [index, source] of sources.entries()) {
      for (const m of source.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
        if (!defined.has(m[1])) {
          missing.push(`${m[1]} used in ${cssFiles[index].replace(ROOT, '')}`)
        }
      }
    }

    expect(missing, missing.join('\n')).toEqual([])
  })
})
