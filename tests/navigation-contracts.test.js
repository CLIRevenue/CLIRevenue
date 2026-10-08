/**
 * Navigation contracts: a link that resolves, and a jump that lands somewhere useful.
 *
 * Two defects lived here, both invisible to a unit test that renders one
 * component in isolation and both obvious the moment a visitor clicked:
 *
 * 1. **Anchors that went nowhere.** Three of the six mechanism cards point
 *    somewhere that does not exist on the page they are rendered on:
 *      - mech_02 → `#developer`, but the id on the public page is `developers`
 *        (`developer` exists nowhere in src/);
 *      - mech_04 → `#delivery`, and `delivery` lives only on the /advertiser
 *        route — the card is rendered on the public page, where the id is absent;
 *      - mech_06 → `#money`, and the split card lives *inside* #money, so the
 *        anchor was a self-anchor that moved the page by zero pixels.
 *    A fourth, `#advertiser`, was the console's own advertiser panel; area 1
 *    removed that panel as a duplicate of film chapter 03, which silently killed
 *    the console masthead's journey step 01.
 *
 * 2. **Anchors that landed at pixel zero.** `scroll-margin-top` was declared on
 *    exactly three rules in the whole app, none of them on the public page's own
 *    anchor containers, while `.sitehead` is `position: fixed`. Every jump on the
 *    public page therefore put the section's chapter number and first line of
 *    copy behind the header.
 *
 * A third, softer one: two in-app anchors (`PublicHeader`'s Developer /
 * Advertiser, and the advertiser page's cross-link) issued full document
 * requests, which reboot the app and replay the entire intro film. The href must
 * stay — it is what makes a link copyable and middle-clickable — but a plain left
 * click belongs to the router. `spaNav` is that rule, and it is tested here as a
 * pure function because vitest runs with `environment: 'node'` and there is no
 * DOM implementation in this project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const SRC = join(ROOT, 'src')
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(jsx?|tsx?|css)$/.test(name)) out.push(full)
  }
  return out
}

const sourceFiles = walk(SRC)
const sourceByPath = new Map(sourceFiles.map((f) => [f.slice(ROOT.length), readFileSync(f, 'utf8')]))

/* Every `id="…"` anywhere in src/, plus every id a component mounts from a
   prop or a data file, collected the same way. */
const allIds = new Set()
const idPattern = /\bid=(?:"([^"]+)"|'([^']+)'|\{\s*`([^`$]+)`)/g
for (const src of sourceByPath.values()) {
  for (const match of src.matchAll(idPattern)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (value) allIds.add(value)
  }
}

/* Static hrefs are the rot-prone ones: they are strings nobody can check.
   `href={` values are either app routes, template-built section ids
   (`#${section.id}` on the developer rail) or already covered elsewhere. */
const staticHashHrefs = []
for (const [path, src] of sourceByPath) {
  for (const match of src.matchAll(/\bhref="(#[^"]*)"/g)) {
    staticHashHrefs.push({ path, href: match[1] })
  }
}

describe('every static in-page anchor resolves to a real id', () => {
  it('the survey found the anchors it was supposed to find', () => {
    // A zero-hit inventory would make every assertion below vacuously true.
    expect(staticHashHrefs.length).toBeGreaterThan(0)
    expect(allIds.has('money')).toBe(true)
    expect(allIds.has('revenue-split')).toBe(true)
  })

  it('no href points at an id that does not exist', () => {
    const broken = staticHashHrefs
      .filter(({ href }) => href.length > 1 && !allIds.has(href.slice(1)))
      .map(({ path, href }) => `${path} -> ${href}`)
    expect(broken).toEqual([])
  })

  it('no anchor points at a bare "#", which resolves to the top of the page', () => {
    // `href="#"` is not a navigation target, it is a scroll-to-top that looks
    // like a link. It was one: the developer page's documentation sentence.
    expect(staticHashHrefs.filter(({ href }) => href === '#')).toEqual([])
  })
})

describe('an anchor never crosses a route boundary', () => {
  /* `delivery` is a real id, but only on /advertiser. An anchor that names it
     from the public page is a link that works for one visitor and silently
     fails for every other, which is the shape of bug that survives a click
     test and dies in front of a user. */
  const ROUTE_SCOPED_IDS = ['delivery', 'documentation', 'install', 'flow-title']

  it('no file that renders on the public page anchors to a route-scoped id', () => {
    const publicPageFiles = [
      'src/components/PromoAd.jsx',
      'src/components/console/ConsoleMasthead.jsx',
      'src/components/scenes/TheWait.jsx',
      'src/components/scenes/TheAd.jsx',
      'src/components/scenes/TheMoney.jsx',
      'src/components/scenes/TheExperience.jsx',
      'src/components/scenes/TheIncentive.jsx',
      'src/components/scenes/AdvertiserDemo.jsx',
      'src/components/conv/Conversion.jsx',
      'src/components/console/Console.jsx',
    ]
    const offenders = []
    for (const path of publicPageFiles) {
      const src = read(path)
      for (const id of ROUTE_SCOPED_IDS) {
        if (src.includes(`"#${id}"`)) offenders.push(`${path} -> #${id}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the id that was misspelled is not resurrected anywhere', () => {
    // `#developer` versus `#developers` is a one-character difference that no
    // reader would notice and no amount of clicking would explain.
    expect(allIds.has('developer')).toBe(false)
    expect(allIds.has('developers')).toBe(true)
    const offenders = [...sourceByPath.entries()]
      .filter(([, src]) => /href="#developer"/.test(src))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })
})

describe('the six mechanism cards resolve to what their copy promises', () => {
  const promo = read('src/components/PromoAd.jsx')

  function cards() {
    return [...promo.matchAll(/cta:\s*'([^']+)',\s*\n\s*href:\s*'(#[^']+)'/g)].map((m) => ({
      cta: m[1],
      href: m[2],
    }))
  }

  it('all six are collected', () => {
    expect(cards()).toHaveLength(6)
  })

  it('every card CTA lands on a real id', () => {
    expect(cards().filter((c) => !allIds.has(c.href.slice(1)))).toEqual([])
  })

  it('no card CTA is a self-anchor', () => {
    /* Only the split card was one: it is rendered inside #money, so #money
       was the single target that provably moved the page by zero pixels. Its
       replacement is the flow diagram the card describes, which sits directly
       above it in the same chapter. mech_01 also targets #money, and that one
       is correct — it is rendered a chapter earlier and means "read the
       funding model", which is the next chapter. */
    const split = cards().find((c) => c.cta === 'Verify the split')
    expect(split.href).toBe('#revenue-split')
    const funding = cards().find((c) => c.cta === 'Read the funding model')
    expect(funding.href).toBe('#money')
  })

  it('the split target is the diagram, not the chapter', () => {
    const flow = read('src/components/RevenueFlow.jsx')
    expect(flow).toMatch(/className="revenue-flow" id="revenue-split"/)
  })
})

describe('the console journey resolves', () => {
  const masthead = read('src/components/console/ConsoleMasthead.jsx')

  it('every journey step anchors to a real id', () => {
    const hrefs = [...masthead.matchAll(/href:\s*'(#[^']+)'/g)].map((m) => m[1])
    expect(hrefs).toHaveLength(4)
    expect(hrefs.filter((h) => !allIds.has(h.slice(1)))).toEqual([])
  })

  it('all four parties survive the removal of the console advertiser panel', () => {
    // The panel was the target of step 01. Retargeting it at film chapter 03
    // keeps a component titled "One loop. Four parties." showing four parties,
    // instead of silently dropping the advertiser to make an anchor resolve.
    expect(masthead).toMatch(/label: 'Advertiser'/)
    expect(masthead).toMatch(/href: '#advertiserDemo'/)
    expect(masthead).not.toMatch(/href: '#advertiser'/)
  })

  it('the comment above the journey no longer claims every anchor is local', () => {
    expect(masthead).not.toMatch(/Each one is a real anchor into the console below/)
  })
})

describe('an anchor lands content below the fixed header', () => {
  const appCss = read('src/App.css')

  /* `.sitehead` is position: fixed on every public route. Its height is ~53px
     (10px padding either side of a 33px .btn--sm), and the landing routes
     already settled on 88px / 72px for the same reason, so the public page
     reuses those values rather than inventing a third scale. */
  const containers = [
    ['src/App.css', '.scene'],
    ['src/App.css', '.block'],
    ['src/App.css', '.conv'],
    ['src/components/RevenueFlow.css', '.revenue-flow'],
  ]

  it('every public-page anchor container declares a scroll offset', () => {
    for (const [file, selector] of containers) {
      const css = read(file)
      const block = css.slice(css.indexOf(`${selector} {`))
      const body = block.slice(0, block.indexOf('}'))
      expect(body, `${selector} in ${file}`).toMatch(/scroll-margin-top:\s*88px/)
    }
  })

  it('the offset is the same value the landing routes use', () => {
    expect(read('src/components/developer/DeveloperLanding.css')).toMatch(
      /\.sdk-page \[id\]\s*\{\s*\n\s*scroll-margin-top: 88px;/,
    )
    expect(read('src/components/advertiser/AdvertiserLanding.css')).toMatch(
      /\.advx-page \[id\]\s*\{\s*\n\s*scroll-margin-top: 88px;/,
    )
  })

  it('the offset compacts on small screens, where the header compacts', () => {
    const small = appCss.slice(appCss.lastIndexOf('@media (max-width: 760px)'))
    for (const selector of ['.scene', '.block', '.conv', '.revenue-flow']) {
      expect(small).toContain(selector)
    }
    expect(small).toMatch(/scroll-margin-top: 72px/)
  })

  it('no rule anywhere in src/ hard-codes an anchor offset the app does not share', () => {
    // Two competing numbers for the same job is how the 48px and the 88px
    // drifted apart in the first place.
    const values = new Set()
    for (const [path, src] of sourceByPath) {
      if (!path.endsWith('.css')) continue
      for (const m of src.matchAll(/scroll-margin-top:\s*(\d+)px/g)) values.add(m[1])
    }
    expect([...values].sort()).toEqual(['72', '88'])
  })
})

describe('smooth scrolling is preserved', () => {
  const useCinema = read('src/hooks/useCinema.js')

  it('Lenis still handles anchors on the public page', () => {
    expect(useCinema).toMatch(/anchors:\s*true/)
  })

  it('the fix is CSS-only: no scroll arithmetic was added to JS', () => {
    /* scroll-margin-top is honoured by both Lenis and native anchor jumps, so
       the correct fix had no JavaScript in it at all. A JS offset would have
       fought Lenis and broken the native path on the two landing routes. */
    for (const [path, src] of sourceByPath) {
      if (!/\.(jsx?|tsx?)$/.test(path)) continue
      if (path === 'src/components/RevenueFlow.jsx') continue
      expect(src, path).not.toMatch(/scroll-margin|scrollMargin/)
    }
    expect(read('src/components/RevenueFlow.jsx')).not.toMatch(/scroll-margin|scrollMargin/)
  })
})

describe('spaNav: an in-app anchor navigates without a document request', () => {
  const originalWindow = globalThis.window
  const originalPopState = globalThis.PopStateEvent

  function click(overrides = {}) {
    let prevented = false
    const target = {
      getAttribute: () => ('href' in overrides ? overrides.href : '/advertiser'),
    }
    const event = {
      defaultPrevented: false,
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      currentTarget: target,
      preventDefault() {
        prevented = true
        this.defaultPrevented = true
      },
      ...overrides.event,
    }
    return { event, wasPrevented: () => prevented }
  }

  let pushed
  beforeEach(() => {
    pushed = []
    /* navigateApp ends in `new PopStateEvent('popstate')`, and node has no
       DOM: the stub records the push and swallows the notification, which is
       all this suite asserts on. */
    globalThis.PopStateEvent = class {
      constructor(type) {
        this.type = type
      }
    }
    globalThis.window = {
      history: { pushState: (_s, _t, next) => pushed.push(next) },
      dispatchEvent: () => {},
    }
  })
  afterEach(() => {
    globalThis.window = originalWindow
    globalThis.PopStateEvent = originalPopState
  })

  async function handler() {
    const mod = await import('../src/hooks/useAppRoute.js')
    return mod.spaNav
  }

  it('a plain left click is handed to the router', async () => {
    const spaNav = await handler()
    const { event, wasPrevented } = click()
    spaNav(event)
    expect(wasPrevented()).toBe(true)
    expect(pushed).toEqual(['/advertiser'])
  })

  it('modifier clicks are left to the browser as new-tab requests', async () => {
    const spaNav = await handler()
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
      pushed = []
      const { event, wasPrevented } = click({ event: { [key]: true } })
      spaNav(event)
      expect(wasPrevented(), key).toBe(false)
      expect(pushed, key).toEqual([])
    }
  })

  it('middle click and right click are not navigations', async () => {
    const spaNav = await handler()
    for (const button of [1, 2]) {
      pushed = []
      const { event, wasPrevented } = click({ event: { button } })
      spaNav(event)
      expect(wasPrevented(), `button ${button}`).toBe(false)
      expect(pushed, `button ${button}`).toEqual([])
    }
  })

  it('a caller can veto a specific link without the helper knowing', async () => {
    const spaNav = await handler()
    const { event, wasPrevented } = click({ event: { defaultPrevented: true } })
    spaNav(event)
    expect(wasPrevented()).toBe(false)
    expect(pushed).toEqual([])
  })

  it('in-page anchors fall through to the browser', async () => {
    // #workbench is a same-page jump the browser (and Lenis) already own;
    // pushing a history entry for it would move the URL out from under the
    // film. The handler must not claim it.
    const spaNav = await handler()
    const { event, wasPrevented } = click({ href: '#workbench' })
    spaNav(event)
    expect(wasPrevented()).toBe(false)
    expect(pushed).toEqual([])
  })

  it('a missing href cannot become a navigation to "/undefined"', async () => {
    const spaNav = await handler()
    const { event, wasPrevented } = click({ href: null })
    spaNav(event)
    expect(wasPrevented()).toBe(false)
    expect(pushed).toEqual([])
  })
})

describe('the in-app anchors that were throwing away the SPA are intercepted', () => {
  it('the header keeps both a real href and the interception', () => {
    const src = read('src/components/PublicHeader.jsx')
    expect(src).toMatch(/import \{ navigateApp, spaNav \} from '\.\.\/hooks\/useAppRoute\.js'/)
    for (const href of ['/developer', '/advertiser']) {
      expect(src).toMatch(
        new RegExp(`<a className="btn btn--ghost btn--sm" href="${href}" onClick=\\{spaNav\\}>`),
      )
    }
  })

  it('href stays immediately after className, so the control-language test can still read it', () => {
    /* tests/header-control-language.test.js matches
       `className="([^"]*)"\s+href="/developer"` to prove the anchors wear the
       same classes as Log in. Reordering these two attributes would silently
       turn that suite into "the anchor was not found". */
    const src = read('src/components/PublicHeader.jsx')
    expect(src).toMatch(/className="btn btn--ghost btn--sm"\s+href="\/developer"/)
  })

  it('the advertiser cross-link to the developer page navigates in-app too', () => {
    const src = read('src/components/advertiser/AdvertiserLanding.jsx')
    expect(src).toMatch(/<a className="adv-link" href="\/developer" onClick=\{spaNav\}>/)
  })

  it('the developer page no longer offers a link to the page it is on', () => {
    const src = read('src/components/developer/DeveloperLanding.jsx')
    expect(src).not.toMatch(/href="#"/)
    // The sentence still says where the reference lives; it is prose now.
    expect(src).toMatch(/docs\/developer\//)
    expect(src).toMatch(/getting-started, installation, sdk, placements,/)
  })
})

describe('the route table still owns the destinations the CTAs promise', () => {
  const app = read('src/App.jsx')

  it('the closing chapter sends an advertiser and a developer to their own onboarding', () => {
    expect(app).toMatch(/AdvertiserLanding/)
    expect(app).toMatch(/DeveloperLanding/)
    const cta = read('src/components/scenes/Cta.jsx')
    expect(cta).toMatch(/ctaScene/)
  })

  it('the two onboarding routes are reachable without a signed-in role', () => {
    /* /app/advertiser is behind RequireRole; /advertiser is the public
       onboarding page and must stay open, or the CTA that points at it is a
       dead end for the anonymous visitor it was written for. */
    expect(app).not.toMatch(/path="\/advertiser"[^>]*RequireRole/)
    expect(app).not.toMatch(/path="\/developer"[^>]*RequireRole/)
  })

  it('the dashboard and account destinations come from the shared role map', () => {
    expect(read('src/components/auth/authState.js')).toMatch(/ROLE_HOME/)
    expect(read('src/components/auth/authState.js')).toMatch(/admin: '\/app\/admin'/)
    expect(read('src/components/auth/authState.js')).toMatch(/dashboardHref/)
    expect(read('src/components/auth/authState.js')).toMatch(/accountHref/)
  })

  it('the admin settings entry resolves to a page, not to an empty handler', () => {
    const console_ = read('src/components/admin/AdminConsole.jsx')
    expect(console_).not.toMatch(/onClick=\{\(\) => \{\}\}/)
    expect(console_).toMatch(/account: AdminAccount/)
  })
})
