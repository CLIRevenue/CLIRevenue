/**
 * Key formats, in one place.
 *
 * There are two of them and both are accepted forever:
 *
 *   clirevenue_ads_<30>      current. 45 characters.
 *   pk_live_<32+> | pk_test_<32+>   legacy, issued before 2.1. Still verified.
 *
 * Why two: a key is a capability. Accepting the legacy shape forever means an
 * account that provisioned a key last month keeps serving today, and nothing
 * in the delivery path has to know which era a row came from.
 *
 * Why the environment segment was removed from the prefix: `pk_live_` vs
 * `pk_test_` tells anyone holding a test key that a sibling production key
 * exists, and tells them which of two leaked keys is the one worth attacking.
 * The environment is still recorded, in the `key_env` column, where it is
 * useful to the owner and useless to an attacker. See migration 000025.
 *
 * WHY THIS IS A SEPARATE MODULE AND NOT PART OF publisherAuth.ts:
 * keyFormat is pure string/entropy with no database and no HTTP, so it can be
 * unit-tested on its own and imported by the migrations' companion tests. It
 * also exists so there is exactly one definition of "what a key looks like" on
 * the Edge runtime; the SDK and the CLI carry their own copies because neither
 * can import Deno code, and `tests/key-format-parity.test.js` in the root
 * suite fails the build if the three copies ever disagree.
 *
 * CHARACTER SET: base62 (A-Z a-z 0-9), no `-`, `_`, `+`, `/` or `=`. A key is
 * read aloud, pasted from an email and typed by hand; every one of those
 * characters is one somebody will mistype or a transport will mangle. The
 * strict regex turns a mangled paste into an explicit "invalid format" rather
 * than a silent "invalid key" that looks like the account is broken. Case is
 * significant, which is worth the density: 62 symbols over a length that is
 * already far past any brute-force budget.
 */

/** Namespace for the publishable ads key. 15 characters. */
export const ADS_KEY_PREFIX = "clirevenue_ads_";

/** Random base62 characters after the ads prefix. */
export const ADS_KEY_RANDOM_LENGTH = 30;

/** Namespace for the internal account key. 19 characters. */
export const ACCOUNT_KEY_PREFIX = "clirevenue_account_";

/** Random base62 characters after the account prefix. */
export const ACCOUNT_KEY_RANDOM_LENGTH = 25;

/** Total length of a current ads key: 15 + 30 = 45. */
export const ADS_KEY_LENGTH = ADS_KEY_PREFIX.length + ADS_KEY_RANDOM_LENGTH;

/** Total length of an account key: 19 + 25 = 44. */
export const ACCOUNT_KEY_LENGTH =
  ACCOUNT_KEY_PREFIX.length + ACCOUNT_KEY_RANDOM_LENGTH;

/**
 * The alphabet, as a byte array for rejection sampling.
 *
 * 256 is not a multiple of 62, so `byte % 62` would favour the first 8 symbols
 * of the alphabet. Rejecting any byte >= 248 and re-drawing removes that bias
 * at the cost of a 3% retry rate, which is the right trade for a value that is
 * an authentication factor.
 */
const BASE62_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const BASE62_MAX_UNBIASED = 248; // 62 * 4; 248..255 are discarded.

/** Current publishable ads key. */
const ADS_KEY_RE = new RegExp(
  `^${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}$`,
);

/** Legacy publishable key. Kept verbatim from publisherAuth.ts. */
const LEGACY_KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

/** Internal account key. Never published, never sent to a browser. */
const ACCOUNT_KEY_RE = new RegExp(
  `^${ACCOUNT_KEY_PREFIX}[A-Za-z0-9]{${ACCOUNT_KEY_RANDOM_LENGTH}}$`,
);

/**
 * Both publishable formats as one pattern.
 *
 * Exported from the module that *defines* the formats so the SDK copy and the
 * CLI copy have a canonical thing to be diffed against by eye, and so a
 * caller that needs a `RegExp` rather than a function -- a prompt validator, a
 * file reader's `.test()` -- does not become a fourth independent copy of the
 * legacy pattern. The Edge runtime itself only ever uses the predicates below.
 */
export const PUBLISHER_KEY_RE = new RegExp(
  `^(?:${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}|pk_(?:live|test)_[A-Za-z0-9_-]{32,})$`,
);

/** True for either publishable ads key format. */
export function isWellFormedPublisherKey(key: unknown): key is string {
  return typeof key === "string" && (ADS_KEY_RE.test(key) || LEGACY_KEY_RE.test(key));
}

/**
 * True only for a current-format ads key.
 *
 * Deliberately typed `boolean`, not `key is string`, and so is
 * `isLegacyAdsKey` below. A type predicate is a claim that a value *of any
 * type* is a string, but these two answer a narrower question -- "is this
 * already-a-string the current format?" -- and when they claim the predicate
 * anyway, TypeScript's aliased-condition analysis narrows the variable to
 * `never` in the code path where the check was false, because the exclusion of
 * `string` from `string` leaves nothing. Chaining the two checks is ordinary,
 * necessary code, so the signature that breaks chaining is the wrong signature.
 *
 * `isWellFormedPublisherKey` and `isWellFormedAccountKey` keep their
 * predicates: they really do accept `unknown` and really do prove it is a
 * string, and they are called on values that arrive from JSON.
 */
export function isCurrentAdsKey(key: unknown): boolean {
  return typeof key === "string" && ADS_KEY_RE.test(key);
}

/** True only for a legacy `pk_live_`/`pk_test_` key. See the note on
 *  `isCurrentAdsKey` for why this is `boolean` and not a type predicate. */
export function isLegacyAdsKey(key: unknown): boolean {
  return typeof key === "string" && LEGACY_KEY_RE.test(key);
}

/** True for an internal account key. */
export function isWellFormedAccountKey(key: unknown): key is string {
  return typeof key === "string" && ACCOUNT_KEY_RE.test(key);
}

/**
 * Random base62 text of an exact length, from the platform CSPRNG.
 *
 * Rejection-sampled: see BASE62_ALPHABET. `crypto.getRandomValues` is
 * available on every runtime these Edge Functions run on, so there is no
 * Math.random fallback here and there should never be one -- this value is an
 * authentication factor and an unsound source would make every key in the
 * system forgeable.
 */
export function randomBase62(length: number): string {
  const out: string[] = [];
  const buf = new Uint8Array(64);
  while (out.length < length) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < length; i++) {
      const byte = buf[i];
      if (byte >= BASE62_MAX_UNBIASED) continue;
      out.push(BASE62_ALPHABET[byte % BASE62_ALPHABET.length]);
    }
  }
  return out.join("");
}

/**
 * Mint a publishable ads key in the current format.
 *
 * The environment is deliberately NOT part of the key. It is recorded in the
 * `key_env` column by the caller, so the dashboard can still show a test key
 * as a test key without the prefix advertising it to whoever holds the key.
 *
 * The raw value is returned and never persisted; only sha256 is stored. See
 * the header of publisherAuth.ts for why that is the property that matters.
 */
export function generateAdsKey(): string {
  return ADS_KEY_PREFIX + randomBase62(ADS_KEY_RANDOM_LENGTH);
}

/**
 * Mint an internal account key.
 *
 * Same capability model as an ads key -- shown exactly once, stored only as a
 * hash -- but this one is never handed to a browser, never embedded in a page
 * and never travels in a delivery request. It exists so the creators can
 * support a publisher by identity rather than by walking their delivery log.
 */
export function generateAccountKey(): string {
  return ACCOUNT_KEY_PREFIX + randomBase62(ACCOUNT_KEY_RANDOM_LENGTH);
}

/**
 * The fragment shown in a dashboard so a human can tell two keys apart.
 *
 * 12 characters is the legacy value and is kept, because that is what every
 * already-stored `key_prefix` contains and re-deriving a different number
 * would make the admin console disagree with the database.
 *
 * A current key needs more: `clirevenue_ads_` is itself 15 characters, so 12
 * would show the namespace and nothing else -- every key would render
 * identically. 24 shows the namespace plus nine key characters, which is
 * enough to recognise "that is the one I pasted" and far too little to be
 * useful to anyone who has already seen the screen.
 *
 * Account keys are matched too, and for a longer reason: their prefix is 19
 * characters, so even 24 would be namespace-plus-five. `clirevenue_account_`
 * plus five base62 characters is 60 bits, which is enough to tell two staff
 * keys apart at a glance without being a usable credential fragment - and 12
 * would have been worse than useless, showing the namespace alone. Both
 * current namespaces therefore get the full 24, which is simply "enough to
 * see some entropy and not the whole secret".
 */
export function keyPrefix(rawKey: string): string {
  if (ADS_KEY_RE.test(rawKey) || ACCOUNT_KEY_RE.test(rawKey)) {
    return rawKey.slice(0, 24);
  }
  return rawKey.slice(0, 12);
}