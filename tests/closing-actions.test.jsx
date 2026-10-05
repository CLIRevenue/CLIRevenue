/* =============================================================
   The closing frame
   -------------------------------------------------------------
   The last scene of the film previously ended on a sentence asking
   for something, with nothing on screen a reader could do about it —
   the only call to action in a seven-chapter film, and it was
   passive. These assertions pin the two destinations, their place in
   the chapter's choreography, and the fact that they point at the
   public onboarding routes rather than at signup.

   The hrefs matter most: the closing frame is the last thing a
   visitor reads, and sending it at an account wall would contradict
   the rule the /developer and /advertiser pages already follow, where
   understanding the product never requires an account.
   ============================================================= */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import Cta from '../src/components/scenes/Cta.jsx'
import { ctaScene } from '../src/data/demo.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const hook = readFileSync(`${ROOT}src/hooks/useCinema.js`, 'utf8')
const css = readFileSync(`${ROOT}src/App.css`, 'utf8')

const markup = renderToStaticMarkup(createElement(Cta))

describe('the closing frame offers a way in', () => {
  it('renders a destination per action', () => {
    for (const action of ctaScene.actions) {
      expect(markup).toContain(`href="${action.href}"`)
      expect(markup).toContain(action.label)
      expect(markup).toContain(action.note)
    }
  })

  it('covers both sides of the marketplace', () => {
    expect(ctaScene.actions.map((a) => a.id)).toEqual(['advertiser', 'developer'])
  })

  /* An account wall here would be the one route in the product that
     refuses to explain itself. */
  it('points at the public onboarding pages, not at signup', () => {
    for (const action of ctaScene.actions) {
      expect(action.href).toMatch(/^\/(advertiser|developer)$/)
    }
  })

  it('labels the group and gives each link an accessible name', () => {
    expect(markup).toContain('aria-label="Get started"')
    for (const action of ctaScene.actions) {
      /* The note is inside the link, so the accessible name carries
         both lines — the arrow is aria-hidden so it adds nothing. */
      expect(markup).toMatch(/aria-hidden="true"/)
    }
  })
})

describe('the closing actions are choreographed', () => {
  /* Without a reveal they would be fully painted from the first frame
     of the chapter and the frame would appear to arrive mid-rise with
     its call to action already there. */
  it('are animated by the chapter, not left static', () => {
    expect(hook).toMatch(/rise\('\.closing__action'/)
  })

  /* They land after the ask, because the ask is what they answer. */
  it('arrive after the ask they answer', () => {
    const ask = hook.match(/rise\('\.closing__ask', ([\d.]+)\)/)
    const action = hook.match(/rise\('\.closing__action', ([\d.]+)\)/)
    expect(ask).not.toBeNull()
    expect(action).not.toBeNull()
    expect(Number(action[1])).toBeGreaterThan(Number(ask[1]))
  })

  /* The reveal's start, its stagger and its duration have to fit
     inside one chapter, or the last thing the film does is still in
     motion when the film ends. */
  it('finish inside the chapter', () => {
    const start = Number(hook.match(/rise\('\.closing__action', ([\d.]+)\)/)[1])
    expect(start + 0.06 + 0.24).toBeLessThanOrEqual(1)
  })
})

describe('the closing actions are styled from the existing language', () => {
  it('declares every class the component renders', () => {
    for (const cls of [
      'closing__actions',
      'closing__action',
      'closing__action-copy',
      'closing__action-label',
      'closing__action-note',
      'closing__action-arrow',
    ]) {
      expect(css).toContain(`.${cls}`)
    }
  })

  /* A focus ring is the whole affordance for a keyboard user, and the
     outline is drawn inside the box so the two-column grid does not
     shift when it appears. */
  it('has a visible focus state', () => {
    const rule = css.slice(css.indexOf('.closing__action:focus-visible'))
    expect(rule.slice(0, 200)).toMatch(/outline:/)
  })

  /* Hover movement is exactly what a reduced-motion viewer has asked
     not to see. The colour change stays; the translate does not. */
  it('disables the hover translate under reduced motion', () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.closing__action-arrow\s*\{\s*transform: none !important;/,
    )
  })

  /* Two columns have to become one before the labels and their notes
     start colliding. */
  it('collapses to a single column on narrow screens', () => {
    expect(css).toMatch(
      /@media \(max-width: 560px\)[\s\S]*?\.closing__actions\s*\{\s*grid-template-columns: 1fr;/,
    )
  })
})