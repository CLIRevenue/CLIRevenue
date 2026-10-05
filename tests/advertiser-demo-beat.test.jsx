/* =============================================================
   The advertiser scene's choreography
   -------------------------------------------------------------
   `advertiserDemoBeat` is the only per-scene beat in the film whose
   targets are classes rather than semantic elements: the scene's
   panels are identified entirely by `advertiser-demo__*`, and
   `pick()` returns an empty array for a selector that matches
   nothing — silently. A renamed class would therefore drop a panel
   out of the animation with no error, and the scene would render
   with a heading and a terminal that move and a dashboard that does
   not.

   These assertions pin the wiring and the target list to the markup,
   so that failure is loud.
   ============================================================= */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import AdvertiserDemo from '../src/components/scenes/AdvertiserDemo.jsx'
import { SCENES } from '../src/lib/sequence.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const hook = readFileSync(`${ROOT}src/hooks/useCinema.js`, 'utf8')
const markup = renderToStaticMarkup(createElement(AdvertiserDemo))

/* Every selector the beat reveals, in the order it reveals them. */
const TARGETS = [
  '.advertiser-demo__slot',
  '.advertiser-demo__annotation',
  '.advertiser-demo__board',
  '.advertiser-demo__td',
  '.advertiser-demo__feed-row',
  '.advertiser-demo__flow-step',
  '.advertiser-demo__ledger-step',
]

/* Every `class="..."` attribute in the rendered scene, split into its
   individual classes. Matching the attribute as a whole would only
   find classes that happen to come first in the attribute, and most of
   this scene's classes are the second name on their element. */
function classAttributes() {
  return [...markup.matchAll(/class="([^"]+)"/g)].map((m) => m[1].trim().split(/\s+/))
}

function countClass(cls) {
  return classAttributes().filter((names) => names.includes(cls)).length
}

/* The body of one function, from its `function` keyword to the start of
   the next top-level `function` declaration. Slicing to the end of the
   file instead would pull every later beat's `at()` into the call. */
function beatBody() {
  const start = hook.indexOf('function advertiserDemoBeat')
  const rest = hook.slice(start + 1)
  const next = rest.indexOf('\nfunction ')
  return next === -1 ? rest : rest.slice(0, next)
}

describe('the advertiser scene is choreographed', () => {
  it('routes the scene through its own beat', () => {
    expect(hook).toMatch(/case 'advertiserDemo':\s*\n\s*return advertiserDemoBeat\(/)
  })

  it('defines the beat', () => {
    expect(hook).toMatch(/function advertiserDemoBeat\(/)
  })

  it.each(TARGETS)('animates %s, which the scene renders', (selector) => {
    expect(countClass(selector.slice(1))).toBeGreaterThan(0)
  })

  /* One selector for both row families keeps the tables and the feed
     on a single stagger. If one of them stops rendering, the other
     still animates and the defect is invisible — so assert both. */
  it('renders more than one campaign row and feed row to stagger', () => {
    expect(countClass('advertiser-demo__td')).toBeGreaterThan(1)
    expect(countClass('advertiser-demo__feed-row')).toBeGreaterThan(1)
  })

  /* The chapter must complete inside its own window. The last reveal
     starts at 0.76 and runs for 0.18 of the chapter, so it finishes
     at 0.94 — deliberately short of 1.0, because a reveal still
     running when the next chapter opens is a reveal the viewer never
     finishes reading. */
  it('finishes its last reveal before the chapter ends', () => {
    const starts = [...beatBody().matchAll(/\bat\(([\d.]+)\)/g)].map((m) => Number(m[1]))
    expect(starts.length).toBeGreaterThan(0)
    expect(Math.max(...starts) + 0.2).toBeLessThan(1)
  })

  /* Chapter starts must be monotonic, or a later panel would appear
     before one the film has already introduced above it. */
  it('stages its panels in reading order', () => {
    const starts = [...beatBody().matchAll(/\bat\(([\d.]+)\)/g)].map((m) => Number(m[1]))
    expect(starts).toEqual([...starts].sort((a, b) => a - b))
  })
})

describe('the film registers the scene', () => {
  it('keeps the chapter list in the order the stage renders it', () => {
    expect(SCENES).toEqual([
      'wait',
      'ad',
      'advertiserDemo',
      'money',
      'experience',
      'incentive',
      'cta',
    ])
  })

  /* The store keys its snapshot off SCENES, so an id in the stage but
     not in the chapter list would never receive progress and its
     terminal would sit at chapter-local zero forever. */
  it('publishes progress for every scene the stage renders', () => {
    const cinema = readFileSync(`${ROOT}src/components/Cinema.jsx`, 'utf8')
    /* Only the scene components inside `<main className="stage">` are
       chapters. Intro and TerminalEmission are siblings of the stage
       and are deliberately not in SCENES, so matching every
       self-closing capitalised element would count them. */
    const stage = cinema.slice(
      cinema.indexOf('<main className="stage"'),
      cinema.indexOf('</main>'),
    )
    const rendered = [...stage.matchAll(/<([A-Z][A-Za-z]*)\s*\/>/g)].map((m) => m[1])
    expect(rendered).toHaveLength(SCENES.length)
    expect(rendered).toContain('AdvertiserDemo')
  })
})