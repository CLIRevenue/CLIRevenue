/* TEMP probe v3: full-page screenshot → find rows DARKER than the page
   background (#050505) across most of the width → locate them in the
   document and hit-test the DOM. Uses Lenis for reliable scrolling.
   DELETE ME later. */
import { chromium } from 'playwright-core'

const base = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(base, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4500)

// freeze smooth scrolling
await page.evaluate(() => window.__clirLenis?.stop?.())

const buf = await page.screenshot({ fullPage: true })
const total = await page.evaluate(() => document.documentElement.scrollHeight)
console.log('total height', total)

const rows = await page.evaluate(async (b64) => {
  const img = new Image()
  img.src = 'data:image/png;base64,' + b64
  await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width
  c.height = img.height
  const ctx = c.getContext('2d')
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, c.width, c.height).data
  const out = []
  for (let y = 0; y < c.height; y++) {
    const lum = []
    let black = 0
    for (let x = 0; x < c.width; x += 4) {
      const o = (y * c.width + x) * 4
      const l = d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114
      lum.push(l)
      if (l <= 1.5) black++
    }
    lum.sort((a, b) => a - b)
    out.push({ med: lum[lum.length >> 1], blackFrac: black / lum.length })
  }
  return out
}, buf.toString('base64'))

// Blacker-than-background full-width rows (bg is #050505 → lum 5)
const suspects = []
for (let y = 0; y < rows.length; y++) {
  if (rows[y].blackFrac >= 0.75 && rows[y].med <= 2) suspects.push(y)
}
// group into bands
const bands = []
for (const y of suspects) {
  const last = bands[bands.length - 1]
  if (last && y - last.end <= 4) last.end = y
  else bands.push({ start: y, end: y })
}
console.log('black-ish bands (docY):')
for (const b of bands) console.log(JSON.stringify(b), 'thickness', b.end - b.start + 1)
console.log('count', bands.length)

// Also: rows notably darker than their neighborhood (light env, dark line)
const soft = []
for (let y = 40; y < rows.length - 40; y++) {
  if (rows[y].blackFrac < 0.75) continue
  let up = 0
  let dn = 0
  for (let k = 5; k <= 30; k++) {
    up += rows[y - k].med
    dn += rows[y + k].med
  }
  up /= 26
  dn /= 26
  if (up - rows[y].med >= 4 && dn - rows[y].med >= 4) soft.push({ y, med: rows[y].med, up: Math.round(up), dn: Math.round(dn) })
}
console.log('soft dark rows:', soft.length)
console.log(JSON.stringify(soft.slice(0, 40)))
await browser.close()
