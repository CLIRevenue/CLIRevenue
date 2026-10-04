/**
 * Header control language: one interaction, not two.
 *
 * The defect: the Developer / Advertiser anchors wore their own
 * `sitehead__nav-link` plate. That plate was larger than the Log in button
 * sitting beside it (13px/8px 12px versus 12.5px/7px 13px) and drew a second
 * `--hair-strong` border box over the dark header — a grey rectangle that
 * read as a badly layered plate once the hard 4px offset shadow landed on
 * it. The lift was copied into App.css as a parallel `a.sitehead__nav-link`
 * entry, so hover happened to match while everything else had drifted: the
 * anchors only ever received the global focus outline and never the
 * `.btn--ghost:focus-visible` ring, so keyboard focus was visibly weaker
 * than it looked on hover.
 *
 * The fix is structural rather than cosmetic: the anchors now carry the same
 * `btn btn--ghost btn--sm` classes as Log in, so rest, hover, press and
 * keyboard focus are identical by construction and cannot drift again.
 * These are source-level assertions because this suite has no DOM
 * (vitest runs with environment: 'node'); the rendered proof is the browser
 * probe recorded in .opencode/wiki/entities/public-header.md.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const read = (p) => readFileSync(join(ROOT, p), 'utf8')

const headerSrc = read('src/components/PublicHeader.jsx')
const appCss = read('src/App.css')

describe('header navigation wears the login control language', () => {
  it('both nav anchors carry the identical Log in class string', () => {
    const login = headerSrc.match(/className="([^"]*)"\s+onClick=\{\(\) => navigateApp\('\/login'\)\}/)
    expect(login).not.toBeNull()
    const classes = login[1].split(/\s+/).filter(Boolean)
    // The anchor pair must be wearing the very same classes, not a lookalike.
    expect(classes).toEqual(['btn', 'btn--ghost', 'btn--sm'])
    for (const href of ['/developer', '/advertiser']) {
      const anchor = headerSrc.match(
        new RegExp(`className="([^"]*)"\\s+href="${href}"`),
      )
      expect(anchor).not.toBeNull()
      expect(anchor[1].split(/\s+/).filter(Boolean)).toEqual(classes)
    }
  })

  it('no header anchor wears the bespoke nav-link plate any more', () => {
    expect(headerSrc).not.toMatch(/className="[^"]*sitehead__nav-link/)
  })

  it('the lift is declared once, on .btn — never re-copied per anchor', () => {
    // A parallel copy of the lift is exactly how the two languages drifted
    // apart in the first place.
    expect(appCss).not.toMatch(/a\.sitehead__nav-link/)
    const liftGroups = appCss.match(/^\s*\.btn,\s*$/gm) || []
    expect(liftGroups).toHaveLength(1)
  })
})

describe('focus never depends on hover', () => {
  it('.btn--ghost defines a focus-visible ring of its own', () => {
    expect(appCss).toMatch(/\.btn--ghost:focus-visible\s*\{/)
    const block = appCss.slice(
      appCss.indexOf('.btn--ghost:focus-visible {'),
      appCss.indexOf('}', appCss.indexOf('.btn--ghost:focus-visible {')),
    )
    // 2px signal ring + 6px wash, so the state is legible with no pointer.
    expect(block).toMatch(/box-shadow:\s*0 0 0 2px var\(--signal-text\),\s*0 0 0 6px var\(--amber-wash\)/)
  })

  it('the keyboard ring is never conditioned on :hover', () => {
    const focusRules = appCss.match(/[^\n]*:focus-visible[^\n]*\{/g) || []
    expect(focusRules.length).toBeGreaterThan(0)
    for (const rule of focusRules) expect(rule).not.toMatch(/:hover/)
  })
})

describe('the inert path chip keeps the inert class', () => {
  it('the masthead chips stay non-interactive spans', () => {
    // The masthead path chip shares the nav-link class for its plate but is
    // a span: it must never pick up an anchor's hover or lift.
    for (const [file, chip] of [
      ['src/components/developer/DeveloperLanding.jsx', 'sdk-top__path'],
      ['src/components/advertiser/AdvertiserLanding.jsx', 'advx-top__path'],
    ]) {
      const src = read(file)
      expect(src).toMatch(new RegExp(`<span className="sitehead__nav-link ${chip}">`))
      expect(src).not.toMatch(new RegExp(`<a className="sitehead__nav-link ${chip}"`))
    }
  })
})