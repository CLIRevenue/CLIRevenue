/**
 * Cosmetic and structural polish, pinned as invariants.
 *
 * Nothing in here is a visual taste call. Each assertion guards a specific
 * defect that was in the tree and has been fixed, chosen because it is the kind
 * of rot that comes back silently:
 *
 * 1. **Inline style objects in the admin console.** Five of them, and two of
 *    them were *byte-identical* copies of the same muted status pill. That is
 *    the failure mode to fear: a copy is not a bug until someone adds a fourth
 *    and forgets the modifier. The console is otherwise 100% CSS-driven, so any
 *    new inline style in it is a regression in how it is maintained.
 * 2. **A colour map where a tone map belonged.** `StatusPill` coloured the pill
 *    body from a status→colour map but left `.adm-status-pill__dot` on the base
 *    (green, pulsing) style, so four of five contact statuses rendered a live
 *    green dot next to muted text — "resolved" was the only status that looked
 *    like itself.
 * 3. **Two names for one page.** The shared `AccountPage` was "Settings" in
 *    the admin sidebar and "Account" in the other two dashboards.
 * 4. **A dead 300-line component.** `AdvertiserConsole` was imported nowhere
 *    after area 1 removed the duplicate advertiser panel, and it held the last
 *    `id="advertiser"` in the tree.
 *
 * There is deliberately NO assertion about colours, spacing, type scale or
 * layout. Those are the parts of the black/white/red system a redesign would
 * touch, and a test that freezes them would make the next redesign a fight. What
 * is frozen here is the *maintenance* contract: one class per state instead of
 * one copy per site, one name per page, and no dead files.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const ADMIN = join(SRC, 'components/admin')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

/** Strip block and line comments so a rule that *documents* a palette is not
 *  mistaken for one that hardcodes it. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')

/** Extract a balanced `sel { … }` block. Slicing to the next `}` — which is
 *  what the older assertions here did — truncates at the first nested or
 *  at-rule brace and silently checks a prefix instead of the block. */
function cssBlock(src, sel) {
  const at = src.indexOf(sel)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return null
}

/** The custom properties a block declares, lowercased. */
function declaredTokens(block) {
  return new Set([...block.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1].toLowerCase()))
}

/** Blank out a block so what is left is "the rest of the file". */
function withoutBlock(src, block) {
  return src.replace(block, ' ')
}

function walk(dir, ext) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full, ext))
    else if (ext.test(name)) out.push(full)
  }
  return out
}

const adminJsx = walk(ADMIN, /\.jsx$/)
  .map((f) => [f.slice(ROOT.length), readFileSync(f, 'utf8')])
const cssFiles = walk(SRC, /\.css$/)
  .map((f) => [f.slice(ROOT.length), readFileSync(f, 'utf8')])
const adminCss = read('src/components/admin/AdminConsole.css')
const consoleSrc = read('src/components/admin/AdminConsole.jsx')

describe('the admin console has no inline style objects', () => {
  it('carries zero `style={{ … }}` in any admin component', () => {
    const offenders = adminJsx.filter(([, src]) => /style=\{\{/.test(src))
    expect(offenders.map(([p]) => p)).toEqual([])
  })

  it('the sidebar section heading is separated by its own class padding', () => {
    // It carried `style={{ marginTop: 16 }}` on top of `.adm-sidebar__section`'s
    // own `padding: 18px 0 6px 0`, which rendered a 34px separator — double the
    // one every other heading gets.
    expect(consoleSrc).not.toMatch(/style=\{\{\s*marginTop/)
    expect(consoleSrc).toMatch(/<div className="adm-sidebar__section">Operations<\/div>/)
    expect(adminCss).toMatch(/\.adm-sidebar__section\s*\{/)
  })
})

describe('state is expressed as a CSS modifier, not a copy', () => {
  it('declares the muted and amber pill variants', () => {
    expect(adminCss).toMatch(/\.adm-status-pill--muted\s*\{/)
    expect(adminCss).toMatch(/\.adm-status-pill--amber\s*\{/)
  })

  it('a muted pill does not pulse', () => {
    // The pill is a neutral state. The dot kept the base `adm-pulse`
    // animation, which is what made it read as live.
    const rule = adminCss.slice(
      adminCss.indexOf('.adm-status-pill--muted .adm-status-pill__dot')
    )
    expect(rule.slice(0, 200)).toMatch(/animation:\s*none/)
  })

  it('uses the muted variant for the row-count pills', () => {
    for (const path of [
      'src/components/admin/AdminCampaigns.jsx',
      'src/components/admin/AdminContacts.jsx',
    ]) {
      expect(read(path)).toMatch(/adm-status-pill adm-status-pill--muted/)
    }
  })

  it('declares a shared note class and uses it in both places that need one', () => {
    expect(adminCss).toMatch(/\.adm-note\s*\{/)
    expect(read('src/components/admin/AdminSystem.jsx')).toMatch(/className="adm-note"/)
    expect(read('src/components/admin/AdminPublishers.jsx')).toMatch(
      /className="adm-note adm-note--lead"/
    )
  })
})

describe('a status pill follows its tone on every part of itself', () => {
  const contacts = read('src/components/admin/AdminContacts.jsx')

  it('maps statuses to tone classes, not to colour values', () => {
    expect(contacts).not.toMatch(/STATUS_STYLE/)
    expect(contacts).toMatch(/STATUS_TONE/)
  })

  it('covers exactly the five contact_statuses labels', () => {
    const block = contacts.slice(
      contacts.indexOf('const STATUS_TONE'),
      contacts.indexOf('const STATUS_TONE') + 400
    )
    const labels = [...block.matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1])
    // `supabase/migrations/000019_contact_submissions.sql` defines the enum as
    // new | read | in_progress | resolved | archived.
    expect(labels.sort()).toEqual(['archived', 'in_progress', 'new', 'read', 'resolved'])
  })

  it('applies the tone to the pill so the dot inherits it', () => {
    expect(contacts).toMatch(/adm-status-pill \${tone}/)
    expect(contacts).toMatch(/adm-status-pill__dot/)
  })

  it('falls back rather than rendering an unstyled unknown status', () => {
    expect(contacts).toMatch(/STATUS_TONE\s*\[\s*status\s*\]\s*\?\s*\?\s*STATUS_TONE\s*\.\s*new/)
  })
})

describe('one page has one name', () => {
  it('the admin sidebar calls it Account, not Settings', () => {
    expect(consoleSrc).toMatch(/account:\s*{\s*label:\s*['"]Account['"]/)
    expect(consoleSrc).not.toMatch(/label:\s*['"]Settings['"]/)
  })

  it('all three dashboards agree on the word', () => {
    for (const path of [
      'src/components/advertiser/AdvertiserApp.jsx',
      'src/components/developer/DeveloperApp.jsx',
    ]) {
      expect(read(path)).toMatch(/id:\s*['"]account['"],\s*label:\s*['"]Account['"]/)
    }
  })
})

describe('no dead component is left holding an anchor', () => {
  it('the advertiser console component is gone', () => {
    expect(existsSync(join(SRC, 'components/console/AdvertiserConsole.jsx'))).toBe(false)
  })

  it('nothing under src/ still references it', () => {
    const hits = []
    for (const f of walk(SRC, /\.(jsx?|tsx?)$/)) {
      const src = readFileSync(f, 'utf8')
      if (src.includes('AdvertiserConsole')) hits.push(f.slice(ROOT.length))
    }
    expect(hits).toEqual([])
  })

  it('the anchors it used to own are owned by nobody now', () => {
    // `#advertiser` was its own id, so an href to it silently resolved to the
    // top of the document once it was removed. `#workbench` had the same risk.
    const jsx = walk(SRC, /\.(jsx?|tsx?)$/)
    for (const f of jsx) {
      const src = readFileSync(f, 'utf8')
      expect(src).not.toMatch(/\bid="advertiser"/)
      expect(src).not.toMatch(/href="#advertiser"/)
      expect(src).not.toMatch(/href="#workbench"/)
    }
  })
})

describe('existing polish is not quietly lost', () => {
  it('every admin table still renders an empty state', () => {
    // An empty table with no empty state renders as a header row and a blank
    // page, which reads as a broken dashboard rather than as "no data yet".
    const tables = [
      'AdminAdvertisers.jsx',
      'AdminCampaigns.jsx',
      'AdminContacts.jsx',
      'AdminDevelopers.jsx',
      'AdminEvents.jsx',
      'AdminOverview.jsx',
      'AdminPlacements.jsx',
      'AdminPublishers.jsx',
      'AdminSystem.jsx',
    ]
    for (const name of tables) {
      expect(read(`src/components/admin/${name}`)).toMatch(/adm-empty/)
    }
    expect(adminCss).toMatch(/\.adm-empty\s*\{/)
  })

  it('radius stays tokenised', () => {
    // Two things are being kept, and neither is "these three literals exist":
    //   - a raw literal above the hairline threshold is a design decision made
    //     in a component file, which is how a design system stops being one;
    //   - the one exception is a value that is itself a step on the radius
    //     scale, read from index.css so widening the scale is not a fight.
    // `--radius-pill` is excluded from the scale set: it is the round-pill
    // sentinel and would otherwise licence any literal up to 9999px.
    const scale = [...read('src/index.css').matchAll(/--radius(?:-[a-z0-9]+)?\s*:\s*([\d.]+)px/gi)]
      .filter((m) => !/--radius-pill\b/.test(m[0]))
      .map((m) => Number(m[1]))
    expect(scale.length).toBeGreaterThan(0)
    const allowed = new Set(scale.map(String))

    const HAIRLINE = 3
    const offenders = []
    for (const [path, src] of cssFiles) {
      const code = stripComments(src)
      for (const m of code.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
        for (const px of m[1].matchAll(/(\d+)px/g)) {
          const n = Number(px[1])
          if (n > HAIRLINE && !allowed.has(String(n))) {
            offenders.push(`${path.replace(ROOT, '')}: ${n}px is neither a hairline nor a radius token`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('the radius scale itself still exists', () => {
    const index = read('src/index.css')
    for (const token of [
      '--radius:',
      '--radius-sm:',
      '--radius-md:',
      '--radius-lg:',
      '--radius-xl:',
      '--radius-pill:',
    ]) {
      expect(index).toContain(token)
    }
  })

   it('focus is still visible through one global rule', () => {
     // Many component stylesheets rely on it; only one has to define it.
     // What must not drift is the *shape* of the guarantee: one global rule,
     // a ring thick enough to see, and a colour that comes from a token
     // rather than a literal (a literal cannot follow the theme).
     const index = stripComments(read('src/index.css'))
     const globals = [...index.matchAll(/(^|[},;\s])(:focus-visible)\s*\{([^}]*)\}/g)]
       .map((m) => m[3])
     expect(globals.length).toBeGreaterThan(0)

     const ring = globals.find((body) => /outline\s*:/i.test(body))
     expect(ring).toBeTruthy()
     expect(ring).toMatch(/outline\s*:\s*(?:(\d+)px\s+)?(?:solid|dashed|dotted|double)/i)

     const width = Number((ring.match(/outline\s*:\s*(\d+)px/i) || [])[1] || 0)
     expect(width).toBeGreaterThanOrEqual(2)

     // The outline's colour half has to be a token reference, so the ring
     // follows the theme instead of being welded to one palette.
     const outlineDecl = ring.match(/outline\s*:[^;]+/i)[0]
     expect(outlineDecl).toMatch(/var\(\s*--[a-z0-9-]+\s*\)/i)
     expect(outlineDecl).not.toMatch(/#[0-9a-f]{3,8}/i)
   })
});

describe('the design token system is in place', () => {
  // The palette is the redesignable part. What must not drift is that the
  // two themes describe the same system: same semantic names, declared once
  // per theme, with a colour-scheme each, so nothing falls back to the
  // wrong theme's value. Asserting specific hexes here would only make the
  // next redesign a fight -- which is what this file's own docblock says.
  const SEMANTIC = [
    '--bg',
    '--surface',
    '--text',
    '--signal',
    '--accent-blue',
    '--accent-violet',
    '--accent-purple',
    '--accent-green',
    '--accent-error',
  ]

  it('defines the dark theme tokens in :root', () => {
    const index = read('src/index.css')
    const root = cssBlock(index, ':root')
    expect(root).toBeTruthy()
    expect(root).toMatch(/color-scheme\s*:\s*dark/i)

    const declared = declaredTokens(root)
    const missing = SEMANTIC.filter((t) => !declared.has(t))
    expect(missing).toEqual([])

    // Declared is not the same as given a value: `--bg: ;` would pass a name
    // check and render nothing.
    const empty = SEMANTIC.filter((t) => {
      const m = root.match(new RegExp(`${t}\\s*:\\s*([^;]+);`, 'i'))
      return m && !m[1].trim()
    })
    expect(empty).toEqual([])
  })

  it('defines the light theme tokens in .light-theme', () => {
    const index = read('src/index.css')
    const light = cssBlock(index, '.light-theme')
    expect(light).toBeTruthy()
    expect(light).toMatch(/color-scheme\s*:\s*light/i)

    const lightTokens = declaredTokens(light)
    for (const token of SEMANTIC) {
      expect(lightTokens.has(token)).toBe(true)
    }

    // Parity: a token the dark theme sets and the light theme does not is a
    // token that silently keeps its dark value in light mode. The radius
    // scale is the one documented exception -- it is a scale, not a colour.
    const root = cssBlock(index, ':root')
    const darkOnly = [...declaredTokens(root)]
      .filter((t) => !lightTokens.has(t) && !t.startsWith('--radius'))
      .sort()
    expect(darkOnly).toEqual([])

    const lightOnly = [...lightTokens]
      .filter((t) => !declaredTokens(root).has(t))
      .sort()
    expect(lightOnly).toEqual([])
  })

  it('does not contain hardcoded colors outside of tokens and gradients', () => {
    // Colours live in the token blocks, in a gradient(), or in the comment
    // that documents the palette. A hex anywhere else in this file is a
    // value that will not follow the theme.
    const index = read('src/index.css')
    const outside = withoutBlock(withoutBlock(index, cssBlock(index, ':root')), cssBlock(index, '.light-theme'))
    const code = stripComments(outside)
    const gradients = [...code.matchAll(/(?:linear|radial|conic)-gradient\([^;]*\)/gi)].map((m) => m[0])
    const residue = code.replace(/(?:linear|radial|conic)-gradient\([^;]*\)/gi, ' ')
    const stray = [...residue.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0].toLowerCase())

    expect({ stray, gradients: gradients.length >= 0 }).toEqual({ stray: [], gradients: true })
  })
});
