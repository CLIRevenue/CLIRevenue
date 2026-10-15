/**
 * Key-format parity across the three deployables that validate a publisher
 * key.
 *
 * There are three copies of the key regex, on purpose — the Edge runtime,
 * the CLI and the browser SDK ship independently and must not import each
 * other. The cost of that choice is a divergence bug that is invisible from
 * any single file: the minter writes a key, a validator rejects it, and the
 * only symptom is a publisher whose setup reported success and whose site
 * renders nothing.
 *
 * So the duplication is allowed but not undefended. This suite is the
 * contract: the copies may be separate files, but they may not disagree about
 * which strings are publishable keys.
 *
 * Regenerating the corpus is not allowed to change the verdict either — both
 * sides are asked the same question about the same strings, so any
 * disagreement is a bug in one of them rather than a fixture that needs
 * updating.
 */
import { describe, expect, it } from 'vitest'

import {
  ADS_KEY_LENGTH as EDGE_ADS_LENGTH,
  ADS_KEY_PREFIX as EDGE_ADS_PREFIX,
  ADS_KEY_RANDOM_LENGTH as EDGE_ADS_RANDOM_LENGTH,
  isWellFormedAccountKey as edgeAcceptsAccountKey,
  isWellFormedPublisherKey as edgeAccepts,
} from '../supabase/functions/_shared/keyFormat.ts'

import {
  ADS_KEY_LENGTH as SDK_ADS_LENGTH,
  ADS_KEY_PREFIX as SDK_ADS_PREFIX,
  ADS_KEY_RANDOM_LENGTH as SDK_ADS_RANDOM_LENGTH,
  PUBLISHER_KEY_RE as SDK_PUBLISHER_RE,
  isWellFormedPublisherKey as sdkAccepts,
} from '../packages/sdk/src/keyFormat.ts'

/**
 * The CLI copy is the only one of the three that is also reachable from a
 * file the user edits: `verify/key-file.ts` re-exports this module's regex as
 * the pattern that decides whether a key already in `.env.local` is readable.
 * So a divergence here does not just fail a paste -- it makes `setup` re-prompt
 * for a key it has already been given, forever.
 */
import {
  ADS_KEY_LENGTH as CLI_ADS_LENGTH,
  ADS_KEY_PREFIX as CLI_ADS_PREFIX,
  ADS_KEY_RANDOM_LENGTH as CLI_ADS_RANDOM_LENGTH,
  PUBLISHER_KEY_RE as CLI_PUBLISHER_RE,
  isWellFormedAccountKey as cliAcceptsAccountKey,
  isWellFormedPublisherKey as cliAccepts,
} from '../packages/cli/src/verify/keyFormat.ts'

/* ------------------------------------------------------------------ */
/* the constants themselves                                             */
/* ------------------------------------------------------------------ */

/**
 * The prefix and body length are a wire format, not an implementation
 * detail: a key minted by one deployable is pasted into another. If the Edge
 * minter and the SDK validator ever disagree on the numbers, every key
 * produced after the change is broken on arrival.
 */
describe('key format constants agree', () => {
  it('uses one ads prefix in every runtime', () => {
    expect(EDGE_ADS_PREFIX).toBe(SDK_ADS_PREFIX)
    expect(EDGE_ADS_PREFIX).toBe(CLI_ADS_PREFIX)
    expect(EDGE_ADS_PREFIX).toBe('clirevenue_ads_')
  })

  it('uses one ads body length in every runtime', () => {
    expect(EDGE_ADS_RANDOM_LENGTH).toBe(SDK_ADS_RANDOM_LENGTH)
    expect(EDGE_ADS_RANDOM_LENGTH).toBe(CLI_ADS_RANDOM_LENGTH)
    expect(SDK_ADS_RANDOM_LENGTH).toBe(30)
  })

  it('derives the advertised total length rather than hard-coding it', () => {
    // Every runtime exports a total length so a host can check a paste before
    // running a regex. If it drifts from prefix + body it would reject keys
    // that are in fact fine, which is worse than not exporting it at all.
    expect(SDK_ADS_LENGTH).toBe(SDK_ADS_PREFIX.length + SDK_ADS_RANDOM_LENGTH)
    expect(EDGE_ADS_LENGTH).toBe(EDGE_ADS_PREFIX.length + EDGE_ADS_RANDOM_LENGTH)
    expect(CLI_ADS_LENGTH).toBe(CLI_ADS_PREFIX.length + CLI_ADS_RANDOM_LENGTH)
  })

  it('keeps the legacy keys accepted in every runtime', () => {
    // The Edge runtime never exports its regexes -- it mints and authenticates
    // but has no reason to hand a RegExp to a caller. So the legacy format
    // cannot be compared as a literal; it is compared by verdict below, which
    // is the part that actually has to match. This case exists so that if all
    // three sides ever drop legacy support together, the suite says so out
    // loud.
    expect(edgeAccepts(`pk_live_${'a'.repeat(32)}`)).toBe(true)
    expect(sdkAccepts(`pk_live_${'a'.repeat(32)}`)).toBe(true)
    expect(cliAccepts(`pk_live_${'a'.repeat(32)}`)).toBe(true)
  })

  it('exports one combined pattern from the runtimes that have one', () => {
    // The SDK and the CLI both hand out a `PUBLISHER_KEY_RE` for callers that
    // want to match rather than to narrow. If one added the other format and
    // the other did not, every key of that format would pass one runtime's
    // file-reading check and fail the other's.
    for (const [name, re] of [
      ['sdk', SDK_PUBLISHER_RE],
      ['cli', CLI_PUBLISHER_RE],
    ] as const) {
      expect(re.test(validCurrent), `${name} accepts the current format`).toBe(true)
      expect(re.test(validLegacy), `${name} accepts the legacy format`).toBe(true)
      expect(re.test(`clirevenue_account_${'a'.repeat(25)}`), `${name} refuses an account key`).toBe(
        false,
      )
    }
  })
})

/* ------------------------------------------------------------------ */
/* the verdicts                                                         */
/* ------------------------------------------------------------------ */

const validCurrent = 'clirevenue_ads_Ab3kZ9qR7tUvX2mP5sN8dL4jH1gFWy'
const validLegacy = `pk_live_${'a'.repeat(32)}`
const validLegacyB64 = `pk_test_${'-_'.repeat(16)}`

/**
 * Every string either validator might be handed, including the ones that are
 * not keys at all. A validator that throws on a non-string has not rejected
 * it, it has crashed, and the caller sees a TypeError instead of a config
 * error.
 */
const corpus = [
  validCurrent,
  validLegacy,
  validLegacyB64,
  '',
  ' ',
  'clirevenue_ads_',
  'clirevenue_ads',
  'clirevenue_ads_aaaa',
  `${'clirevenue_ads_'}a`.repeat(2),
  `clirevenue_ads_${'a'.repeat(29)}`,
  `clirevenue_ads_${'a'.repeat(30)}`,
  `clirevenue_ads_${'a'.repeat(31)}`,
  `clirevenue_ads_${'a'.repeat(43)}`,
  `clirevenue_ads_${'A'.repeat(30)}`,
  `clirevenue_ads_${'0'.repeat(30)}`,
  `clirevenue_ads_${'-'.repeat(30)}`,
  `clirevenue_ads_${'_'.repeat(30)}`,
  `clirevenue_ads_${'a'.repeat(29)}-`,
  `CLIREVENUE_ADS_${'a'.repeat(30)}`,
  `pk_live_${'a'.repeat(32)}`,
  `pk_test_${'a'.repeat(32)}`,
  `pk_prod_${'a'.repeat(32)}`,
  `pk_live_${'a'.repeat(31)}`,
  `pk_live_${'a'.repeat(33)}`,
  `pk_live_short`,
  `pk_${'a'.repeat(40)}`,
  `clirevenue_account_${'a'.repeat(25)}`,
  `clirevenue_account_${'a'.repeat(24)}`,
  `sb_secret_${'b'.repeat(40)}`,
  `secret_live_${'a'.repeat(40)}`,
  null,
  undefined,
  12345,
  {},
  [],
  true,
  Symbol('key'),
]

describe('every runtime returns the same verdict', () => {
  it.each(corpus)('agrees on %s', (candidate) => {
    // Each side is asked independently, against the Edge runtime's answer as
    // the reference. The per-runtime agreement flags are in the payload on
    // purpose: a bare `toEqual` on the three booleans would fail without
    // saying which copy is the odd one out, and telling a stale validator
    // from a stale minter is the whole point of this file.
    const verdicts = {
      edge: edgeAccepts(candidate),
      sdk: sdkAccepts(candidate),
      cli: cliAccepts(candidate),
    }
    const reference = verdicts.edge
    expect({
      ...verdicts,
      edgeAgrees: verdicts.edge === reference,
      sdkAgrees: verdicts.sdk === reference,
      cliAgrees: verdicts.cli === reference,
    }).toEqual({
      edge: reference,
      sdk: reference,
      cli: reference,
      edgeAgrees: true,
      sdkAgrees: true,
      cliAgrees: true,
    })
  })
})

describe('the shared verdict is the correct one', () => {
  it.each([validCurrent, validLegacy, validLegacyB64])('accepts %s', (key) => {
    expect(edgeAccepts(key)).toBe(true)
    expect(sdkAccepts(key)).toBe(true)
    expect(cliAccepts(key)).toBe(true)
  })

  it.each([
    `clirevenue_ads_${'a'.repeat(29)}`,
    `clirevenue_ads_${'a'.repeat(31)}`,
    `clirevenue_account_${'a'.repeat(25)}`,
    'sb_secret_',
    'pk_prod_short',
  ])('rejects %s', (key) => {
    expect(edgeAccepts(key)).toBe(false)
    expect(sdkAccepts(key)).toBe(false)
    expect(cliAccepts(key)).toBe(false)
  })

  it.each([null, undefined, 12345, {}, true])('rejects the non-string %s', (value) => {
    expect(edgeAccepts(value)).toBe(false)
    expect(sdkAccepts(value)).toBe(false)
    expect(cliAccepts(value)).toBe(false)
  })
})

/**
 * The account key is the one credential both validators must refuse. It is
 * issued by the same signup flow as the ads key, so pasting the wrong one is
 * a realistic mistake, and a validator that accepted it would turn an
 * internal staff credential into a publishable one.
 */
describe('an account key is never a publishable key', () => {
  const accountKey = `clirevenue_account_${'a'.repeat(25)}`

  it.each(['a', 'Z9', '-_7', ''].map((tail) => `clirevenue_account_${'a'.repeat(25)}${tail}`))(
    'the Edge runtime refuses %s',
    (key) => {
      expect(edgeAccepts(key)).toBe(false)
      expect(edgeAcceptsAccountKey(key) === true).toBe(key === accountKey)
    },
  )

  it.each(['a', 'Z9', '-_7', ''].map((tail) => `clirevenue_account_${'a'.repeat(25)}${tail}`))(
    'the CLI refuses %s',
    (key) => {
      // The CLI is the one runtime that shows the difference to the user: it
      // can say "that is an internal account key" rather than "that key was
      // revoked", which is the difference between a five-second fix and a
      // support ticket.
      expect(cliAccepts(key)).toBe(false)
      expect(cliAcceptsAccountKey(key) === true).toBe(key === accountKey)
    },
  )

  it('the SDK refuses it without needing to know the account format', () => {
    // The SDK has no account-key predicate at all, deliberately: it never
    // mints one and never needs to render one. It only has to not match.
    expect(sdkAccepts(accountKey)).toBe(false)
  })
})