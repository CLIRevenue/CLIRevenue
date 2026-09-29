/* TEMP A/B probe — find near-black full-width rows on '/', with and without
   the Atmosphere layer, at several scroll depths. DELETE after Phase 3. */
import { chromium } from 'playwright-core'

const base = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

async function scan(label) {
  await page.goto(base, { waitUntil: 'load' }).catch(() => {})
  await page.waitForTimeout(4000)
  if (label === 'WITHOUT atmos') {
    await page.evaluate(() => document.querySelector('.atmos')?.remove())
    await page.waitForTimeout(300)
  }
  const docH = await page.evaluate(() => document.documentElement.scrollHeight)
  const stops = [0, 900, 2200, Math.floor(docH * 0.45), Math.floor(docH * 0.7), docH - 900]
  const all = []
  for (const y of stops) {
    await page.evaluate((yy) => window.scrollTo(0, yy), y)
    await page.waitForTimeout(800)
    const shot = await page.screenshot()
    const rows = await page.evaluate(async (b64) => {
      const img = new Image()
      img.src = 'data:image/png;base64,' + b64
      await img.decode()
      const W = img.width
      const H = img.height
      const c = document.createElement('canvas')
      c.width = W
      c.height = H
      const ctx = c.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0)
      const d = ctx.getImageData(0, 0, W, H).data
      const out = []
      for (let yy = 0; yy < H; yy++) {
        let black = 0
        let n = 0
        for (let x = 0; x < W; x += 4) {
          const o = (yy * W + x) * 4
          const l = d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114
          n++
          if (l <= 2.5) black++
        }
        const frac = black / n
        if (frac >= 0.5) {
          // identify elements at the darkest x positions
          const names = []
          for (let x = 40; x <= W - 40; x += 200) {
            const els = document.elementsFromPoint(x, yy)
            for (const el of els) {
              const cls = String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(' ')[0]
              const name = el.tagName.toLowerCase() + (cls ? '.' + cls : '')
              if (!names.includes(name)) names.push(name)
            }
          }
          out.push({ y: yy, frac: Math.round(frac * 100) / 100, els: names.slice(0, 6) })
        }
      }
      return out
    }, shot.toString('base64'))
    for (const r of rows) all.push({ docY: y + r.y, vpY: r.y, frac: r.frac, els: r.els })
  }
  console.log(`\n===== ${label} : near-black rows (>=50% of width) =====`)
  const seen = new Set()
  for (const r of all) {
    const key = Math.round(r.vpY / 8) + ':' + Math.round(r.frac * 4)
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`vpY=${r.vpY} frac=${r.frac} els=${JSON.stringify(r.els)}`)
  }
  console.log(`total rows: ${all.length}`)
}

await scan('WITH atmos')
await scan('WITHOUT atmos')
await browser.close()
