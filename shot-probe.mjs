/* TEMP visual inspection probe — screenshot key page regions. DELETE ME later. */
import { chromium } from 'playwright-core'

const base = process.env.SHOT_URL || 'http://localhost:5174/'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto(base, { waitUntil: 'networkidle' }).catch(() => {})
await page.waitForTimeout(4500) // let the intro boot overlay clear

const shots = JSON.parse(process.env.SHOTS || '[]')
// Default: landing top + scroll stops
const stops = shots.length ? shots : [
  { name: 'top', y: 0 },
  { name: 'scene2', y: 1.2 },
  { name: 'scene3', y: 2.4 },
  { name: 'console-masthead', sel: '.masthead' },
  { name: 'orbit', sel: '.orbit__sticky' },
  { name: 'rewards', sel: '#rewards' },
  { name: 'conv', sel: '.conv' },
]

for (const s of stops) {
  if (s.sel) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (el) window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - 40)
    }, s.sel)
  } else {
    await page.evaluate((y) => window.scrollTo(0, y * window.innerHeight), s.y)
  }
  await page.waitForTimeout(900)
  await page.screenshot({ path: `/tmp/shot-${s.name}.png` })
  console.log('saved', s.name)
}
await browser.close()
