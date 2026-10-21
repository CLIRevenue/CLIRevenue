/**
 * Ad-text parity across the three deployables that measure an advertisement.
 *
 * The 60-character rule is stated in four places: the database (a CHECK
 * constraint on `public.campaigns`), the Edge runtime, the browser SDK and
 * the dashboard. The three code copies cannot be merged — the Edge runtime,
 * the SDK and the dashboard ship independently — and the database is not a
 * JavaScript runtime at all.
 *
 * The cost of that choice is a divergence bug that is invisible from any
 * single file. The dashboard shows a counter that says 58/60, the API
 * accepts, the database accepts, and the SDK refuses to render it: the
 * advertiser sees a green tick and the publisher sees an empty slot. Or the
 * other direction, which is worse: the counter says 62/60 and the form
 * blocks, but the campaign already exists in the database at 62 characters
 * because the constraint was written against a different normalisation.
 *
 * So the duplication is allowed but not undefended. This suite is the
 * contract: the copies may be separate files, but they may not disagree
 * about what an ad text is, how long it is, or whether it is acceptable.
 *
 * The database's copy of the rule is checked in `tests/db/ad-text.test.js`,
 * which runs the same corpus through a real Postgres and compares
 * `char_length(normalize(headline, NFC))` against the JavaScript answer.
 * This file cannot do that: it runs in the unit job, which does not boot a
 * database.
 */
import { describe, expect, it } from 'vitest'

import {
  AD_TEXT_REQUIRED as EDGE_REQUIRED,
  AD_TEXT_TOO_LONG as EDGE_TOO_LONG,
  MAX_AD_TEXT_LENGTH as EDGE_MAX,
  countAdTextLength as edgeCount,
  normalizeAdText as edgeNormalize,
  validateAdText as edgeValidate,
} from '../supabase/functions/_shared/adText.ts'

import {
  AD_TEXT_REQUIRED as SDK_REQUIRED,
  AD_TEXT_TOO_LONG as SDK_TOO_LONG,
  MAX_AD_TEXT_LENGTH as SDK_MAX,
  countAdTextLength as sdkCount,
  normalizeAdText as sdkNormalize,
  resolveAdDestination as sdkResolveDestination,
  validateAdText as sdkValidate,
} from '../packages/sdk/src/adText.ts'

import {
  AD_TEXT_REQUIRED as UI_REQUIRED,
  AD_TEXT_TOO_LONG as UI_TOO_LONG,
  MAX_AD_TEXT_LENGTH as UI_MAX,
  countAdTextLength as uiCount,
  normalizeAdText as uiNormalize,
  validateAdText as uiValidate,
} from '../src/lib/adText.js'

/* ------------------------------------------------------------------ */
/* the constants themselves                                             */
/* ------------------------------------------------------------------ */

describe('the ad-text constants agree', () => {
  it('uses one maximum length in every runtime', () => {
    expect(EDGE_MAX).toBe(SDK_MAX)
    expect(EDGE_MAX).toBe(UI_MAX)
    expect(EDGE_MAX).toBe(60)
  })

  it('uses one pair of refusal codes in every runtime', () => {
    expect(EDGE_REQUIRED).toBe(SDK_REQUIRED)
    expect(EDGE_REQUIRED).toBe(UI_REQUIRED)
    expect(EDGE_TOO_LONG).toBe(SDK_TOO_LONG)
    expect(EDGE_TOO_LONG).toBe(UI_TOO_LONG)
    expect(EDGE_REQUIRED).toBe('AD_TEXT_REQUIRED')
    expect(EDGE_TOO_LONG).toBe('AD_TEXT_TOO_LONG')
  })
})

/* ------------------------------------------------------------------ */
/* the corpus                                                          */
/* ------------------------------------------------------------------ */

/**
 * Everything a person might type into an advertisement.
 *
 * The interesting entries are the ones where "length" is ambiguous: emoji
 * (two UTF-16 code units, one code point), combining accents (two code
 * points, one glyph), zero-width joiners, non-breaking spaces, and the
 * whitespace-only string that every naive `if (!text)` check gets wrong.
 */
const corpus = [
  '',
  ' ',
  '   ',
  '\t\n ',
  'Buy now',
  'x'.repeat(59),
  'x'.repeat(60),
  'x'.repeat(61),
  'x'.repeat(600),
  '  padded  ',
  '\n\ttabbed\n',
  'a b c',
  '\u00e9', // precomposed e-acute: one code point
  'e\u0301', // decomposed: e + combining acute, two code points
  'e\u0301'.repeat(30), // thirty decomposed pairs
  'e\u0301'.repeat(31), // thirty-one decomposed pairs
  '\u00e9'.repeat(60), // sixty precomposed
  '\u00e9'.repeat(61),
  '\ud83d\ude00', // one code point, two UTF-16 units
  '\ud83d\ude00'.repeat(60),
  '\ud83d\ude00'.repeat(61),
  '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}', // one glyph, five code points
  '\u{1f468}\u200d\u{1f469}\u200d\u{1f467}'.repeat(20), // one hundred code points
  '\u{1f1fa}\u{1f1f8}', // one glyph, two code points
  '\u{1f1fa}\u{1f1f8}'.repeat(30),
  'cafe\u0301', // NFD
  'cafe\u00e9', // NFC
  '\u200b\u200b\u200b', // three zero-width spaces
  '\u00a0nbsp', // a non-breaking space
  '𝕳𝖊𝖑𝖑𝖔 𝕱𝖗𝖔𝖒 𝖙𝖍𝖊 𝖕𝖑𝖆𝖓𝖊𝖙', // mathematical alphanumerics
  '𝕳𝖊𝖑𝖑𝖔 𝕱𝖗𝖔𝖒 𝖙𝖍𝖊 𝕴𝖆𝖑𝖑', // sixty code points, two UTF-16 units each
  '𝕳𝖊𝖑𝖑𝖔 𝕱𝖗𝖔𝖒 𝖙𝖍𝖊 𝕴𝖆𝖑𝖑𝖆',
  'Ünïcödé Cämpaign',
  '日本語のテキスト',
  '日本語のテキスト'.repeat(10),
  '🚀'.repeat(59),
  '🚀'.repeat(60),
  '🚀'.repeat(61),
  null,
  undefined,
  12345,
  {},
  [],
  true,
]

/* ------------------------------------------------------------------ */
/* the counts                                                          */
/* ------------------------------------------------------------------ */

describe('every runtime counts an ad text the same way', () => {
  it.each(corpus)('agrees on the length of %s', (candidate) => {
    const edge = edgeCount(candidate)
    expect(sdkCount(candidate), 'the SDK agrees with the Edge runtime').toBe(edge)
    expect(uiCount(candidate), 'the dashboard agrees with the Edge runtime').toBe(edge)
  })

  it.each(corpus)('agrees on the normalised form of %s', (candidate) => {
    const edge = edgeNormalize(candidate)
    expect(sdkNormalize(candidate)).toBe(edge)
    expect(uiNormalize(candidate)).toBe(edge)
  })
})

/* ------------------------------------------------------------------ */
/* the verdicts                                                        */
/* ------------------------------------------------------------------ */

describe('every runtime returns the same verdict', () => {
  it.each(corpus)('agrees on the verdict for %s', (candidate) => {
    const edge = edgeValidate(candidate)
    const sdk = sdkValidate(candidate)
    const ui = uiValidate(candidate)

    // The comparison is on the whole verdict, not just the boolean. Two
    // runtimes can both refuse a string and still disagree about *why*,
    // and the reason is what the advertiser is shown.
    expect(sdk.ok).toBe(edge.ok)
    expect(ui.ok).toBe(edge.ok)
    expect(sdk.code).toBe(edge.code)
    expect(ui.code).toBe(edge.code)
    expect(sdk.length).toBe(edge.length)
    expect(ui.length).toBe(edge.length)
    expect(sdk.message).toBe(edge.message)
    expect(ui.message).toBe(edge.message)

    if (edge.ok) {
      expect(sdk.value).toBe(edge.value)
      expect(ui.value).toBe(edge.value)
    }
  })
})

describe('the shared verdict is the correct one', () => {
  it('accepts a text of exactly 60 characters', () => {
    const text = 'x'.repeat(60)
    for (const validate of [edgeValidate, sdkValidate, uiValidate]) {
      const result = validate(text)
      expect(result.ok).toBe(true)
      expect(result.length).toBe(60)
    }
  })

  it('refuses a text of 61 characters', () => {
    const text = 'x'.repeat(61)
    for (const validate of [edgeValidate, sdkValidate, uiValidate]) {
      const result = validate(text)
      expect(result.ok).toBe(false)
      expect(result.code).toBe('AD_TEXT_TOO_LONG')
      expect(result.length).toBe(61)
    }
  })

  it('refuses an empty text', () => {
    for (const validate of [edgeValidate, sdkValidate, uiValidate]) {
      const result = validate('')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('AD_TEXT_REQUIRED')
    }
  })

  it('refuses a text that is only whitespace', () => {
    // The database's CHECK constraint counts the *stored* string, and the
    // stored string is the trimmed one, so a whitespace-only headline is
    // zero characters there and must be zero characters here.
    for (const validate of [edgeValidate, sdkValidate, uiValidate]) {
      const result = validate('   \t\n ')
      expect(result.ok).toBe(false)
      expect(result.code).toBe('AD_TEXT_REQUIRED')
      expect(result.length).toBe(0)
    }
  })

  it('counts an emoji once, not twice', () => {
    // "😀" is one code point and two UTF-16 code units. Counting UTF-16
    // units would refuse a 60-emoji advertisement at 30.
    const result = edgeValidate('😀'.repeat(60))
    expect(result.ok).toBe(true)
    expect(result.length).toBe(60)
  })

  it('counts a decomposed accent as the character it renders as', () => {
    // 59 plain letters plus one combining acute is 60 code points before
    // normalisation and 59 after it, because NFC *composes* the pair into a
    // single precomposed letter and gives a code point back. Normalisation
    // can therefore only ever shorten the count, never lengthen it — which
    // is the safe direction, but it means the count has to be taken from the
    // normalised string and not from the raw one.
    //
    // The database normalises the same way, so the two agree at 59.
    const decomposed = 'e'.repeat(59) + '\u0301'
    expect(decomposed.length).toBe(60) // UTF-16 units, and code points
    expect(edgeCount(decomposed)).toBe(59) // code points, after NFC
    expect(edgeValidate(decomposed).ok).toBe(true)
  })

  it('refuses a decomposed text that normalises to 61 code points', () => {
    // 61 plain letters plus one combining acute: NFC composes the last
    // pair, so the normalised form is 61 code points and one over the limit.
    const decomposed = 'e'.repeat(61) + '\u0301'
    expect(decomposed.length).toBe(62)
    expect(edgeCount(decomposed)).toBe(61)
    expect(edgeValidate(decomposed).code).toBe('AD_TEXT_TOO_LONG')
  })

  it('measures the same copy the same way whichever way it was typed', () => {
    // The whole point of normalising: the same advertisement, typed two
    // ways, has one length. Without NFC the counter would read 59 for one
    // keyboard and 60 for the other, and the advertiser would have no way
    // to know which one the database is going to see.
    const composed = 'caf\u00e9'
    const decomposed = 'cafe\u0301'
    expect(composed).not.toBe(decomposed)
    expect(edgeCount(composed)).toBe(4)
    expect(edgeCount(decomposed)).toBe(4)
    expect(edgeNormalize(decomposed)).toBe(edgeNormalize(composed))
  })

  it('never truncates: the returned value is the whole input or nothing', () => {
    const tooLong = 'x'.repeat(61)
    const result = edgeValidate(tooLong)
    expect(result.ok).toBe(false)
    expect('value' in result).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* the destination                                                     */
/* ------------------------------------------------------------------ */

/**
 * The destination is the other half of an advertisement and the other half
 * of the injection surface. Only the SDK has a copy of this rule, because it
 * is the only place a URL reaches an `href`.
 */
describe('the SDK only resolves safe destinations', () => {
  it.each([
    'https://example.test/landing',
    'http://example.test/landing',
    'https://example.test/landing?a=1&b=2#top',
    'https://example.test',
  ])('accepts %s', (url) => {
    expect(sdkResolveDestination(url)).not.toBeNull()
  })

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'blob:https://example.test/abc',
    'mailto:someone@example.test',
    'tel:+15550100',
    '/relative/path',
    'example.test/landing',
    '//example.test/landing',
    '',
    '   ',
    '   javascript:alert(1)   ',
    null,
    undefined,
    42,
    {},
  ])('refuses %s', (url) => {
    expect(sdkResolveDestination(url)).toBeNull()
  })

  it('does not let a whitespace-padded javascript URL through', () => {
    // The SDK trims before parsing. `new URL(" javascript:alert(1) ")` is a
    // valid URL with the javascript scheme, so trimming is what stops the
    // padding from being an evasion.
    expect(sdkResolveDestination('  javascript:alert(1)')).toBeNull()
  })
})
