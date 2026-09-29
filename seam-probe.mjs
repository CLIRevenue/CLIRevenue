/* TEMP: screenshot each scene seam (centered) to inspect for lines. DELETE ME. */
import { chromium } from 'playwright-core'

const base = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(base, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4500)

const seams = await page.evaluate(() => {
  const scenes = [...document.querySelectorAll('.scene')]
  return scenes.slice(1).map((s, i) => ({ i: i + 1, top: s.getBoundingClientRect().top + window.scrollY, id: s.id }))
})
console.log(JSON.stringify(seams))

for (const s of seams) {
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, s.top - 450))
  await page.waitForTimeout(700)
  await page.screenshot({ path: `/tmp/seam-${s.i}-${s.id}.png` })
  console.log('saved seam', s.i, s.id)
}
await browser.close()
