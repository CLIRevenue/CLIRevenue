import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'

import { AuthProvider } from '../src/components/auth/AuthProvider.jsx'
import Suggestions from '../src/components/suggestions/Suggestions.jsx'

const render = (jsx) => renderToStaticMarkup(<AuthProvider>{jsx}</AuthProvider>)
// renderToStaticMarkup HTML-escapes & and '; normalize them back for assertions.
const text = (html) =>
  html.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"')

describe('Suggestions page', () => {
  test('Developer is selected by default and the developer form renders', () => {
    const html = text(render(<Suggestions />))
    expect(html).toContain("I'm a Developer")
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('Developer suggestions')
    expect(html).toContain('Expansion / Newer CLI')
    expect(html).toContain('Suggestions / Something Broke')
    expect(html).toContain('General Suggestions')
  })

  test('the advertiser form is present but not the active role', () => {
    const html = text(render(<Suggestions />))
    expect(html).toContain('Advertiser suggestions')
    expect(html).toContain('Feature Requests')
    expect(html).toContain('Something Broke')
    expect(html).toContain('Campaigns & Analytics')
    expect(html).toContain('Wallet & Payments')
    expect(html).toContain('General Suggestions')
    // Developer is the initially selected role: exactly one selected tab.
    expect((html.match(/aria-selected="true"/g) || []).length).toBe(1)
  })

  test('developer conditional fields render for the expansion category', () => {
    const html = text(render(<Suggestions />))
    expect(html).toContain('CLI or integration name')
    expect(html).toContain('Requested capability / integration')
    expect(html).toContain('Version (optional)')
  })

  test('core shared fields render for both roles', () => {
    const html = text(render(<Suggestions />))
    expect(html).toContain('Name')
    expect(html).toContain('Email')
    expect(html).toContain('Subject')
    expect(html).toContain('Description')
  })

  test('the role selector exposes two keyboard-focusable tabs', () => {
    const html = text(render(<Suggestions />))
    expect((html.match(/role="tab"/g) || []).length).toBe(2)
    expect(html).toContain('aria-label="Suggestions role"')
  })

  test('submit button and category segmented control render', () => {
    const html = text(render(<Suggestions />))
    expect(html).toContain('Send suggestion')
    expect(html).toContain('aria-label="Suggestion category"')
  })
})
