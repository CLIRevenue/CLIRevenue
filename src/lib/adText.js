/* The ad-text contract: one line of copy, at most 60 characters.
 *
 * This is the dashboard's copy of a rule that is stated in four places — the
 * database (`char_length(normalize(headline, NFC))` on `public.campaigns`),
 * the Edge runtime (`supabase/functions/_shared/adText.ts`), the browser SDK
 * (`packages/sdk/src/adText.ts`) and this file. The copies cannot be merged:
 * the dashboard, the Edge runtime and the SDK are three separate deployables
 * with three separate release cycles. What buys something is
 * `tests/ad-text-parity.test.js`, which fails the build if the copies ever
 * disagree. A divergence here is a form that lets the advertiser write 60
 * characters and the API that refuses them.
 *
 * THE RULE
 * --------
 * An ad is text. No image, no logo, no long description, no secondary
 * promotional copy. The text is measured in Unicode code points, counted on
 * the NFC-normalised, edge-trimmed form of the string:
 *
 *   1. `trim()` removes leading and trailing whitespace. Whitespace inside
 *      the text is preserved — it is part of the copy.
 *   2. `normalize('NFC')` composes the text into its canonical form, so the
 *      same advertisement has one length regardless of how the advertiser's
 *      keyboard produced the accents.
 *   3. The length is the number of code points, not the number of UTF-16 code
 *      units and not the number of bytes.
 *
 * NFC *composes*, so normalisation can only ever shorten a text, never
 * lengthen it: "e" followed by a combining acute is two code points before
 * normalisation and one after. A text that is 61 code points raw can be 60
 * once composed, and it is the 60 that counts — because that is the form the
 * advertisement is stored and served in.
 *
 * Counting code points rather than grapheme clusters is a deliberate
 * trade: the family emoji 👨‍👩‍👧 is one glyph but five code points, so a
 * grapheme count would be friendlier to a reader. It has no implementation in
 * PostgreSQL without an extension, though, and the database is one of the
 * four places this rule is enforced. Code points are the one unit every
 * layer computes exactly the same way. */

export const MAX_AD_TEXT_LENGTH = 60

export const AD_TEXT_REQUIRED = 'AD_TEXT_REQUIRED'
export const AD_TEXT_TOO_LONG = 'AD_TEXT_TOO_LONG'

/* The canonical form of an ad text: trimmed, then NFC-normalised. A
   non-string is not an ad text, so it normalises to the empty string and is
   reported as missing rather than as a type error at the call site. */
export function normalizeAdText(value) {
  if (typeof value !== 'string') return ''
  return value.trim().normalize('NFC')
}

/* Count Unicode code points in a string.
   Written as an explicit loop over the UTF-16 code units because that is the
   only representation JavaScript has: a supplementary character arrives as
   two code units, and the pair counts once. `String.prototype.length` would
   count it twice, which is exactly the disagreement this contract exists to
   prevent. */
export function countCodePoints(text) {
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index)
    if (code !== undefined && code > 0xffff) index += 1
    count += 1
  }
  return count
}

/* The length of an ad text, measured the way the contract defines it. The
   input is normalised first, so the number this returns is the number the
   counter shows and the number the database will compute. */
export function countAdTextLength(value) {
  return countCodePoints(normalizeAdText(value))
}

/* Validate an ad text against the contract.
   Returns the normalised text on success so a caller never normalises twice,
   and an actionable message on failure so the form can say what to change.
   Nothing is ever truncated: an over-long advertisement is refused, not
   quietly shortened, because a shortened advertisement is an advertisement
   the advertiser did not approve. */
export function validateAdText(value) {
  const normalized = normalizeAdText(value)
  const length = countCodePoints(normalized)

  if (length === 0) {
    return { ok: false, code: AD_TEXT_REQUIRED, message: 'Ad text is required.', length }
  }

  if (length > MAX_AD_TEXT_LENGTH) {
    return {
      ok: false,
      code: AD_TEXT_TOO_LONG,
      message: `Ad text must be ${MAX_AD_TEXT_LENGTH} characters or fewer (this one is ${length}).`,
      length,
    }
  }

  return { ok: true, value: normalized, length }
}
