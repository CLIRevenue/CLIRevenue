import { chromium } from 'playwright'

const browser = await chromium.launch({
  executablePath: process.env.HOME + '/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  args: ['--no-sandbox'],
  headless: false  // visible browser for visual inspection
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', m => console.log('[page]', m.text()))
page.on('pageerror', e => console.log('[pageerror]', e.message))

await page.goto('http://localhost:8901/', { waitUntil: 'load' })
await page.waitForFunction(() => !document.documentElement.classList.contains('intro-lock'), null, { timeout: 12000 })
await page.waitForTimeout(1000)

console.log('=== INTRO DONE, STARTING ORBIT DIAGNOSIS ===')

// Scroll to product simulation masthead
const mastY = await page.evaluate(() => {
  const prod = document.querySelector('#product')
  return prod.getBoundingClientRect().top + scrollY - 200
})
await page.evaluate(y => scrollTo(0, y), mastY)
await page.waitForTimeout(1000)

// === TEST A: Check orbit element existence and computed styles ===
const orbitDiagnosis = await page.evaluate(() => {
  const orbit = document.querySelector('.orbit')
  const ring = document.querySelector('.orbit__ring')
  const panels = document.querySelectorAll('.orbit__panel')
  
  if (!orbit) return { orbit: 'NOT FOUND' }
  if (!ring) return { ring: 'NOT FOUND' }
  
  const getComputed = (el) => {
    const cs = getComputedStyle(el)
    return {
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      transform: cs.transform,
      transformStyle: cs.transformStyle,
      perspective: cs.perspective,
      position: cs.position,
      zIndex: cs.zIndex,
      width: cs.width,
      height: cs.height,
      overflow: cs.overflow,
      filter: cs.filter,
      backfaceVisibility: cs.backfaceVisibility,
      rect: el.getBoundingClientRect(),
      inViewport: el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0
    }
  }
  
  // Walk ancestors from first panel
  const panel0 = panels[0]
  const ancestors = []
  let n = panel0
  while (n && n !== document.documentElement) {
    const cs = getComputedStyle(n)
    ancestors.push({
      tag: n.tagName.toLowerCase(),
      class: n.className,
      id: n.id,
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      overflow: cs.overflow,
      clipPath: cs.clipPath,
      transform: cs.transform,
      position: cs.position,
      zIndex: cs.zIndex,
      rect: n.getBoundingClientRect(),
    })
    n = n.parentElement
  }
  
  return {
    orbit: getComputed(orbit),
    ring: getComputed(ring),
    panels: Array.from(panels).map((p, i) => ({
      index: i,
      class: p.className,
      dataActive: p.dataset.active,
      ...getComputed(p),
      translateZ: p.style.getPropertyValue('transform') || 'none',
    })),
    ancestors,
    viewport: { width: innerWidth, height: innerHeight, scrollY: scrollY }
  }
})

console.log('=== ORBIT DIAGNOSIS ===')
console.log(JSON.stringify(orbitDiagnosis, null, 2))

// === SCREENSHOT 1: Before any modifications ===
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-before.png', fullPage: false })
console.log('Screenshot saved: orbit-before.png')

// === TEST B: Force visibility ===
await page.addStyleTag({ content: `/* TEST A: Force visibility */
.orbit, .orbit__ring, .orbit__panel {
  opacity: 1 !important;
  visibility: visible !important;
}
` })
await page.waitForTimeout(500)
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-testA.png', fullPage: false })
console.log('Screenshot saved: orbit-testA.png')

// === TEST B: Remove 3D transforms ===
await page.addStyleTag({ content: `/* TEST B: Remove 3D */
.orbit__panel {
  transform: none !important;
  position: relative !important;
  opacity: 1 !important;
  visibility: visible !important;
  left: auto !important;
  top: auto !important;
}
.orbit__ring {
  transform: none !important;
  transform-style: flat !important;
  height: auto !important;
}
.orbit {
  perspective: none !important;
}
` })
await page.waitForTimeout(500)
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-testB.png', fullPage: false })
console.log('Screenshot saved: orbit-testB.png')

// === TEST C: Highlight orbit container ===
await page.addStyleTag({ content: `/* TEST C: Highlight */
.orbit {
  outline: 4px solid lime !important;
  background: rgba(0, 255, 0, 0.1) !important;
}
.orbit__ring {
  outline: 3px solid cyan !important;
}
.orbit__panel {
  outline: 2px solid magenta !important;
  background: rgba(255, 0, 255, 0.1) !important;
}
` })
await page.waitForTimeout(500)
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-testC.png', fullPage: false })
console.log('Screenshot saved: orbit-testC.png')

// === TEST D: Disable overflow clipping ===
await page.addStyleTag({ content: `/* TEST D: No overflow clipping */
* { overflow: visible !important; }
` })
await page.waitForTimeout(500)
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-testD.png', fullPage: false })
console.log('Screenshot saved: orbit-testD.png')

// === TEST E: Reset z-index ===
await page.addStyleTag({ content: `/* TEST E: Reset z-index */
.orbit, .orbit__ring, .orbit__panel, .masthead, .console__inner, .console {
  z-index: auto !important;
}
` })
await page.waitForTimeout(500)
await page.screenshot({ path: '/home/invincible/projects/cli-ad-demo/orbit-testE.png', fullPage: false })
console.log('Screenshot saved: orbit-testE.png')

console.log('=== DIAGNOSIS COMPLETE ===')
await browser.close()
