/**
 * The ad-text contract: one line of copy, at most 60 characters, and one
 * clickable destination.
 *
 * THE RULE
 * --------
 * An ad is text. The current release serves no image, no logo, no long
 * description, no secondary promotional copy and no other creative element.
 * The text itself is measured in **Unicode code points**, counted on the
 * **NFC-normalised, edge-trimmed** form of the string:
 *
 *   1. `String.prototype.trim()` removes leading and trailing whitespace.
 *      Whitespace inside the text is preserved — it is part of the copy.
 *   2. `String.prototype.normalize("NFC")` composes the text into its
 *      canonical form. "é" typed as `e` + combining acute is two code
 *      points; the same character precomposed is one. Without this step the
 *      same advertisement would have two different lengths depending on how
 *      the advertiser's keyboard produced it.
 *   3. The length is the number of **code points** in that form, not the
 *      number of UTF-16 code units and not the number of bytes.
 *
 * NFC *composes*, so normalisation can only ever shorten a text, never
 * lengthen it: "e" followed by a combining acute is two code points before
 * normalisation and one after. A text that is 61 code points raw can be 60
 * once composed, and it is the 60 that counts — because that is the form the
 * advertisement is stored and served in.
 *
 * WHY CODE POINTS AND NOT GRAPHEMES
 * ---------------------------------
 * A user-perceived "character" is a grapheme cluster: the family emoji
 * 👨‍👩‍👧 is one glyph but five code points, and a flag is one glyph but two.
 * Counting graphemes would be the friendliest rule for a reader, but it has
 * no implementation in PostgreSQL without an extension, and the database is
 * one of the three places this rule has to be enforced. Code points are the
 * one unit every layer can compute exactly the same way:
 *
 *   - JavaScript / Deno: the loop in `countCodePoints` below.
 *   - PostgreSQL: `char_length(normalize(headline, NFC))` — `char_length`
 *     counts characters, and in a UTF-8 database a character is a code point.
 *
 * The rule is therefore stated in code points everywhere, and the counting
 * helper is duplicated per runtime with a parity test that keeps the copies
 * from drifting apart. See `tests/ad-text-parity.test.js`.
 *
 * WHAT THIS DOES *NOT* COUNT
 * ---------------------------
 * Bytes. `Buffer.byteLength` and `octet_length` disagree with this rule for
 * every non-ASCII character, and a 60-character advertisement is not 60 bytes
 * of anything.
 */

/** The maximum length of an ad's text, in Unicode code points. */
export const MAX_AD_TEXT_LENGTH = 60;

/** Machine-readable reason an ad text was refused. */
export const AD_TEXT_REQUIRED = "AD_TEXT_REQUIRED";
export const AD_TEXT_TOO_LONG = "AD_TEXT_TOO_LONG";

/**
 * The canonical form of an ad text: trimmed, then NFC-normalised.
 *
 * A non-string is not an ad text, so it normalises to the empty string and
 * is reported as missing rather than as a type error at the call site.
 */
export function normalizeAdText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().normalize("NFC");
}

/**
 * Count Unicode code points in a string.
 *
 * Written as an explicit loop over the UTF-16 code units because that is the
 * only representation JavaScript has: a supplementary character arrives as
 * two code units, and the pair counts once. `String.prototype.length` would
 * count it twice, which is exactly the disagreement this contract exists to
 * prevent.
 */
export function countCodePoints(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.codePointAt(index);
    if (code !== undefined && code > 0xffff) index += 1;
    count += 1;
  }
  return count;
}

/**
 * The length of an ad text, measured the way the contract defines it.
 *
 * The input is normalised first, so the number this returns is the number the
 * database will compute for the same string and the number the advertiser's
 * counter shows.
 */
export function countAdTextLength(value: unknown): number {
  return countCodePoints(normalizeAdText(value));
}

export type AdTextValidation =
  | { ok: true; value: string; length: number }
  | {
    ok: false;
    code: typeof AD_TEXT_REQUIRED | typeof AD_TEXT_TOO_LONG;
    message: string;
    length: number;
  };

/**
 * Validate an ad text against the contract.
 *
 * Returns the normalised text on success so a caller never has to normalise
 * twice, and an actionable message on failure so a form can show the user
 * what to change. Nothing is ever truncated: an over-long advertisement is
 * refused, not quietly shortened, because a shortened advertisement is an
 * advertisement the advertiser did not approve.
 */
export function validateAdText(value: unknown): AdTextValidation {
  const normalized = normalizeAdText(value);
  const length = countCodePoints(normalized);

  if (length === 0) {
    return {
      ok: false,
      code: AD_TEXT_REQUIRED,
      message: "Ad text is required.",
      length,
    };
  }

  if (length > MAX_AD_TEXT_LENGTH) {
    return {
      ok: false,
      code: AD_TEXT_TOO_LONG,
      message: `Ad text must be ${MAX_AD_TEXT_LENGTH} characters or fewer (this one is ${length}).`,
      length,
    };
  }

  return { ok: true, value: normalized, length };
}

/* ------------------------------------------------------------------ */
/* the destination                                                     */
/* ------------------------------------------------------------------ */

/**
 * Schemes an ad may link to.
 *
 * `https` is the one to use and the only one a modern browser will treat as
 * a secure destination. `http` is accepted because the server accepts it for
 * a campaign's landing URL, and a publisher whose campaign was allowed to go
 * live must not silently receive no ad — but nothing else is.
 *
 * Everything outside this list is refused, and the refusal is total: a
 * `javascript:` destination in an ad slot is a script injection into every
 * page that renders the ad.
 */
const ALLOWED_DESTINATION_PROTOCOLS = new Set(["https:", "http:"]);

/**
 * Resolve an ad's destination into a URL that is safe to put in an `href`.
 *
 * Returns `null` for anything that is not an absolute http(s) URL. A
 * relative URL is refused rather than resolved against the current document:
 * a destination that means something different depending on which page
 * renders the ad is not a destination.
 */
export function resolveAdDestination(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (!ALLOWED_DESTINATION_PROTOCOLS.has(url.protocol)) return null;
  return url;
}
