/* Measurable acceptance checks for the CLIRevenue film.
   node verify.mjs [--url http://localhost:5173/]
   Reports overflow, display-type scale, contrast, the ad's presence and
   position, the heading outline, and keyboard reachability. */
import { chromium } from 'playwright'

const url = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:5173/'

const SIZES = [
  { label: '390x844', width: 390, height: 844 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '1440x900', width: 1440, height: 900 },
]

const AUDIT = `(() => {
  const px = (v) => parseFloat(v)
  const srgb = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
  const parse = (s) => {
    const m = s.match(/rgba?\\(([^)]+)\\)/)
    if (!m) return null
    const p = m[1].split(/[\\s,/]+/).filter(Boolean).map(Number)
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }
  }
  const flatten = (c, bg) => c.rgb.map((v, i) => v * c.a + bg[i] * (1 - c.a))
  const ratio = (a, b) => {
    const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
    return (l1 + 0.05) / (l2 + 0.05)
  }
  /* Walk up for the first opaque background, compositing translucent ones. */
  const bgOf = (el) => {
    const stack = []
    let node = el
    while (node && node !== document.documentElement.parentNode) {
      const c = parse(getComputedStyle(node).backgroundColor)
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break }
      node = node.parentElement
    }
    let base = [7, 7, 10]
    for (let i = stack.length - 1; i >= 0; i -= 1) base = flatten(stack[i], base)
    return base
  }
  const contrast = (el) => {
    const cs = getComputedStyle(el)
    const fg = parse(cs.color)
    if (!fg) return null
    const bg = bgOf(el)
    return ratio(flatten(fg, bg), bg)
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && px(cs.opacity) > 0.05
  }
  const insideViewport = (el) => {
    const r = el.getBoundingClientRect()
    return r.left >= -1 && r.right <= innerWidth + 1 && r.top >= -1 && r.bottom <= innerHeight + 1
  }
  const outline = []
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    if (!visible(h)) return
    outline.push(h.tagName + ' ' + (h.getAttribute('aria-label') || h.textContent).trim().slice(0, 58))
  })
  const role = (sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return {
      text: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 70),
      rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      inViewport: insideViewport(el),
    }
  }
  const type = {}
  for (const sel of ['.scene__title', '.closing__headline', '.scene__body', '.terminal__out', '.adslot__headline', '.adslot__label', '.eyebrow']) {
    const el = document.querySelector(sel)
    if (!el) continue
    const cs = getComputedStyle(el)
    type[sel] = {
      size: Math.round(px(cs.fontSize) * 10) / 10,
      track: cs.letterSpacing,
      lineHeight: cs.lineHeight,
      contrast: Math.round((contrast(el) || 0) * 100) / 100,
    }
  }
  const landmarks = []
  document.querySelectorAll('main,header,footer,nav,aside,section[aria-label],[role]').forEach((el) => {
    if (!visible(el)) return
    landmarks.push(el.tagName.toLowerCase() + (el.getAttribute('role') ? '[' + el.getAttribute('role') + ']' : '') + ':' + (el.getAttribute('aria-label') || '').slice(0, 34))
  })
  const focusables = document.querySelectorAll('a[href],button,[tabindex]:not([tabindex="-1"]),input,select,textarea')
  return {
    docScrollW: document.documentElement.scrollWidth,
    innerW: innerWidth,
    horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
    docH: document.body.scrollHeight,
    type,
    outline,
    landmarks: [...new Set(landmarks)],
    ad: role('.adslot'),
    adRegion: role('.adslot__detail-region'),
    account: role('.reward'),
    flow: role('.flow'),
    focusableCount: focusables.length,
    focusableTags: [...focusables].map((f) => f.tagName.toLowerCase() + ':' + (f.textContent || '').trim().slice(0, 22)),
    contrastFloor: (() => {
      const bad = []
      document.querySelectorAll('*').forEach((el) => {
        if (!visible(el)) return
        if (!el.textContent || !el.textContent.trim()) return
        if (el.children.length && ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return
        const c = contrast(el)
        if (c && c < 4.5) bad.push(el.className + ' ' + Math.round(c * 100) / 100)
      })
      return [...new Set(bad)].slice(0, 14)
    })(),
  }
})()`

const browser = await chromium.launch()
const failures = []
const gate = (size, label, condition) => {
  if (condition) failures.push(size + ' ' + label)
}
for (const size of SIZES) {
  const page = await browser.newPage({ viewport: size, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(500)
  /* Reduced-motion pass: the concept must be fully legible with no film. */
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForTimeout(400)
  const reduced = await page.evaluate(AUDIT)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForTimeout(13000)
  /* Sample at 42% of the *film*, not of the document. The product
     console appended below the stage grows the document, so a
     document-relative probe would stop describing the mid-film frame. */
  const filmEnd = await page.evaluate(() => {
    const stage = document.querySelector('.stage')
    return stage
      ? Math.max(0, stage.offsetHeight - innerHeight)
      : document.body.scrollHeight - innerHeight
  })
  await page.evaluate((y) => window.scrollTo(0, y), Math.round(filmEnd * 0.42))
  await page.waitForTimeout(600)
  const mid = await page.evaluate(AUDIT)

  /* Scroll so a named chapter is centred, which is the only honest way
     to ask "is the ad actually on screen when the ad is playing". */
  const seek = async (id) => {
    const y = await page.evaluate((sid) => {
      const el = document.querySelector('[data-scene="' + sid + '"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return Math.max(0, Math.round(scrollY + r.top + r.height / 2 - innerHeight / 2))
    }, id)
    if (y === null) return null
    await page.evaluate((v) => window.scrollTo(0, v), y)
    await page.waitForTimeout(500)
    return page.evaluate(AUDIT)
  }
  const scenes = await page.evaluate(() =>
    [...document.querySelectorAll('[data-scene]')].map((s) => s.dataset.scene))
  const centred = {}
  for (const id of scenes) centred[id] = await seek(id)

  console.log('\n================ ' + size.label + ' ================')
  console.log('docHeight           ' + mid.docH)
  console.log('horizontalOverflow  ' + mid.horizontalOverflow + (mid.horizontalOverflow > 0 ? '  <-- FAIL' : '  ok'))
  console.log('focusableCount      ' + mid.focusableCount)
  console.log('focusables          ' + JSON.stringify(mid.focusableTags))
  console.log('lowContrast(<4.5)   ' + (mid.contrastFloor.length ? 'FAIL ' + JSON.stringify(mid.contrastFloor) : 'none'))
  console.log('-- display type --')
  for (const [k, v] of Object.entries(mid.type)) {
    console.log('  ' + k.padEnd(20) + v.size + 'px  ls ' + v.track + '  lh ' + v.lineHeight + '  contrast ' + v.contrast)
  }
  console.log('-- key objects (mid-film) --')
  for (const k of ['ad', 'adRegion', 'account', 'flow']) {
    console.log('  ' + k.padEnd(9) + JSON.stringify(mid[k]))
  }
  console.log('-- per chapter, when that chapter is centred --')
  for (const [id, snap] of Object.entries(centred)) {
    const parts = []
    for (const k of ['ad', 'account', 'flow']) {
      const o = snap[k]
      if (!o) continue
      const cs = k === 'ad' ? '' : ''
      parts.push(k + (o.inViewport ? ' ON-SCREEN' : ' off(' + o.rect[1] + ')') + ' ' + o.rect[2] + 'x' + o.rect[3] + cs)
    }
    const lo = snap.contrastFloor.length ? ' LOWCONTRAST ' + JSON.stringify(snap.contrastFloor) : ''
    const of_ = snap.horizontalOverflow > 0 ? ' OVERFLOW' : ''
    console.log('  ' + id.padEnd(12) + (parts.join('  ') || '—') + lo + of_)
  }
  console.log('-- reduced motion: whole concept present? --')
  console.log('  hOverflow          ' + reduced.horizontalOverflow)
  console.log('  ad                 ' + JSON.stringify(reduced.ad))
  console.log('  account            ' + JSON.stringify(reduced.account))
  console.log('  flow               ' + JSON.stringify(reduced.flow))
  console.log('  lowContrast        ' + (reduced.contrastFloor.length ? 'FAIL ' + JSON.stringify(reduced.contrastFloor) : 'none'))
  console.log('  headingOutline     ')
  for (const line of reduced.outline) console.log('    ' + line)
  console.log('  landmarks          ' + JSON.stringify(reduced.landmarks))
  if (errors.length) console.log('  CONSOLE ERRORS     ' + errors.join(' | '))

  /* Exit gate: horizontal overflow and any sub-4.5:1 text are hard
     failures at every viewport, in every pass. */
  gate(size.label, 'horizontalOverflow ' + mid.horizontalOverflow, mid.horizontalOverflow > 0)
  gate(size.label, 'lowContrast mid', mid.contrastFloor.length > 0)
  gate(size.label, 'lowContrast reduced', reduced.contrastFloor.length > 0)
  gate(size.label, 'reduced horizontalOverflow ' + reduced.horizontalOverflow, reduced.horizontalOverflow > 0)
  for (const [id, snap] of Object.entries(centred)) {
    gate(size.label, 'lowContrast @' + id, snap.contrastFloor.length > 0)
    gate(size.label, 'overflow @' + id, snap.horizontalOverflow > 0)
  }

  await page.close()
}
await browser.close()

if (failures.length) {
  console.log('\nFAILED CHECKS')
  for (const f of failures) console.log('  ' + f)
  process.exit(1)
}
console.log('\nall gate checks passed')
