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
    expect(contacts).toMatch(/adm-status-pill \$\{tone\}/)
    expect(contacts).toMatch(/adm-status-pill__dot/)
  })

  it('falls back rather than rendering an unstyled unknown status', () => {
    expect(contacts).toMatch(/STATUS_TONE\[status\] \?\? STATUS_TONE\.new/)
  })
})

describe('one page has one name', () => {
  it('the admin sidebar calls it Account, not Settings', () => {
    expect(consoleSrc).toMatch(/account:\s*\{\s*label:\s*['"]Account['"]/)
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
    // Three literal radii pre-date this pass (1px hairline, 2px, 3px). A new
    // literal is how a design system stops being one. Tokens are the rule.
    const literals = []
    for (const [path, src] of cssFiles) {
      for (const m of src.matchAll(/border-radius:\s*([^;]+);/g)) {
        for (const px of m[1].matchAll(/(\d+)px/g)) literals.push({ path, value: px[1] })
      }
    }
    const above = literals.filter((l) => Number(l.value) > 3)
    expect(above).toEqual([])
    expect([...new Set(literals.map((l) => l.value))].sort()).toEqual(['1', '2', '3'])
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
    // Many component stylesheets can rely on it; only one has to define it.
    expect(read('src/index.css')).toMatch(
      /:focus-visible\s*\{\s*outline:\s*2px solid var\(--signal-text\)/
    )
  })

  it('the palette is one accent on black and white', () => {
    // The identity is black / white / one red. The cheapest way to notice a
    // fourth hue arriving is to check that every literal in the root token
    // block is black, white, or the signal red — including the rgba forms,
    // which is where a "slightly warmer grey" would first appear.
    const index = read('src/index.css')
    const root = index.slice(index.indexOf(':root'), index.indexOf('}', index.indexOf(':root')))
    const allowed = new Set(['#000000', '#ffffff', '#ff1f2d'])
    const hexes = [...root.matchAll(/#[0-9a-fA-F]{3,8}/g)].map((m) => m[0].toLowerCase())
    expect(hexes.filter((h) => !allowed.has(h))).toEqual([])

    const rgba = [...root.matchAll(/rgba?\(([^)]+)\)/g)].map((m) => m[1].split(',').slice(0, 3).join(',').trim())
    for (const rgb of rgba) {
      const [r, g, b] = rgb.split(',').map((n) => Number(n.trim()))
      expect(r === g && g === b || (r === 255 && g === 31 && b === 45)).toBe(true)
    }
  })
})