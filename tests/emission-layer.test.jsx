/* =============================================================
   CLIRevenue — terminal emission layer tests
   -------------------------------------------------------------
   The particle model itself is covered in emission-model.test.js,
   in plain node, because it is deliberately free of the DOM. What is
   left to pin here is the seam: the markup the layer renders, the fact
   that it renders at all under server rendering (there is no DOM in
   this project's test environment, so a component that touched
   `window` during render would fail loudly and a good one must not),
   and the stylesheet guarantees that cannot be observed from behaviour
   at all — chiefly that a full-viewport canvas is click-through.
   ============================================================= */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import TerminalEmission from '../src/components/TerminalEmission.jsx'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

/** Source with comments stripped, so prose cannot satisfy a check. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|--)/.test(line))
    .join('\n')

const markup = renderToStaticMarkup(<TerminalEmission />)
const component = code('src/components/TerminalEmission.jsx')
const cinema = code('src/components/Cinema.jsx')
const css = read('src/App.css')

describe('emission layer markup', () => {
  test('renders exactly one canvas for the whole film', () => {
    const canvases = markup.match(/<canvas/g) || []
    expect(canvases).toHaveLength(1)
  })

  test('is decorative to assistive technology', () => {
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('role="presentation"')
  })

  test('carries the class the stylesheet targets', () => {
    expect(markup).toContain('class="emission"')
  })

  test('renders without a DOM, so it is safe to server-render', () => {
    // The assertion is that reaching this line at all: the component
    // read `window` during render, this would have thrown in node.
    expect(typeof markup).toBe('string')
    expect(markup.length).toBeGreaterThan(0)
  })
})

describe('emission layer wiring', () => {
  test('finds its surfaces from the DOM instead of taking props', () => {
    // The reason no scene component had to change: the layer discovers
    // `.terminal` rather than being handed one.
    expect(component).toContain("SURFACE = '.terminal'")
    expect(component).toContain('querySelectorAll(SURFACE)')
  })

  test('derives the emission origin from the top-right of each surface', () => {
    expect(component).toContain('rect.right - INSET_X')
    expect(component).toContain('rect.top + INSET_Y')
  })

  test('reads the playhead rather than running on its own clock', () => {
    expect(component).toContain('getSceneProgress')
  })

  test('holds a single rAF loop and a single canvas', () => {
    const rafs = component.match(/requestAnimationFrame/g) || []
    // one start in the loop head, one in frame(), one in the cleanup
    expect(rafs.length).toBeLessThanOrEqual(3)
    expect(component.match(/getContext\(/g) || []).toHaveLength(1)
  })

  test('does not allocate per particle or read layout per particle', () => {
    // The only layout read in the frame loop is the surface rect; the
    // particle draw path must not contain one.
    const drawLoop = component.slice(component.indexOf('function frame'))
    const rects = drawLoop.match(/getBoundingClientRect/g) || []
    expect(rects).toHaveLength(1)
  })

  test('skips the paint entirely when the field is empty', () => {
    expect(component).toContain('field.count > 0')
  })

  test('clears the canvas when the field drains, so no frame is stranded', () => {
    expect(component).toMatch(/painted[\s\S]{0,200}clearRect/)
  })

  test('pauses on a hidden tab and drops the clock', () => {
    expect(component).toContain('document.hidden')
    expect(component).toContain("addEventListener('visibilitychange'")
  })
})

describe('Cinema mounts the layer outside the stage', () => {
  test('Cinema renders it', () => {
    expect(cinema).toContain('<TerminalEmission />')
  })

  test('it is a sibling of the stage, not a child of it', () => {
    // Inside the stage it would be captured by the stage's
    // scroll-driven transform and swept up by the gsap.context.
    const stage = cinema.indexOf('<main className="stage"')
    const close = cinema.indexOf('</main>')
    const layer = cinema.indexOf('<TerminalEmission />')
    expect(stage).toBeGreaterThan(-1)
    expect(close).toBeGreaterThan(stage)
    expect(layer).toBeGreaterThan(close)
  })
})

describe('emission stylesheet contract', () => {
  test('the canvas cannot intercept pointer input', () => {
    // A full-viewport overlay without this swallows every click, drag
    // and text selection on the page. This is the single most
    // important declaration in the block.
    const start = css.indexOf('.emission {')
    const block = css.slice(start, css.indexOf('\n}', start))
    expect(block).toContain('pointer-events: none')
  })

  test('the layer is viewport-fixed and paints above the stage', () => {
    const start = css.indexOf('.emission {')
    const block = css.slice(start, css.indexOf('\n}', start))
    expect(block).toContain('position: fixed')
    expect(block).toContain('z-index: 2')
    // `contain: strict` would also contain `size`, which sizes the box
    // as though it had no contents — fine while the box is pinned by
    // `inset: 0`, and a trap the day it is not.
    expect(block).not.toContain('contain: strict')
    expect(block).toContain('contain: layout paint style')
  })

  test('reduced motion removes the layer and the shimmer', () => {
    const query = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'))
    expect(query).toContain('.emission')
    expect(query).toContain('.stage .hero__title')
    expect(query).toContain('animation: none !important')
  })

  test('the shimmer is mostly flat, not a continuous glow', () => {
    // The rest state and the first 62% of the cycle have to be the
    // same value, or every frame repaints for the whole duration.
    const start = css.indexOf('@keyframes clr-shimmer {')
    const frames = css.slice(start, start + 200)
    expect(frames).toContain('0%,')
    expect(frames).toContain('62%')
  })

  test('the shimmer stays inside the existing palette', () => {
    // No new hues: white and the one signal red, which is what
    // --paper and --signal already are.
    const block = css.slice(css.indexOf('§27'))
    const colours = block.match(/rgba\([^)]+\)/g) || []
    expect(colours.length).toBeGreaterThan(0)
    for (const colour of colours) {
      expect(colour).toMatch(/^rgba\((255, 255, 255|255, 31, 45), [\d.]+\)$/)
    }
  })

  test('the hero heading shimmers through a filter, because its lines are clipped', () => {
    // `.hero__title span` is `overflow: hidden` — the film reveals
    // those lines by clipping — so a text-shadow on the span would be
    // cropped away with the glyphs.
    expect(css).toContain('clr-shimmer-drop')
    const hero = css.slice(css.indexOf('.stage .hero__title {'))
    expect(hero.slice(0, 200)).toContain('clr-shimmer-drop')
  })

  test('every layer selector is scoped to the film or the layer', () => {
    // App.css is imported by the console and the dashboards too, so an
    // unscoped selector here would shimmer their type as well.
    const block = css.slice(css.indexOf('§27'))
    const bare = block.match(/^\.[a-z][^{]*\{$/gm) || []
    expect(bare.length).toBeGreaterThan(0)
    for (const selector of bare) {
      expect(selector.startsWith('.stage') || selector.startsWith('.emission')).toBe(true)
    }
  })
})
