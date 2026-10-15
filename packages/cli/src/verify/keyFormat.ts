/**
 * Publisher key format — the CLI's third copy.
 *
 * The same constants live in `supabase/functions/_shared/keyFormat.ts` (which
 * mints) and `packages/sdk/src/keyFormat.ts` (which validates at runtime in a
 * browser). This one validates the key a developer pastes into `setup`.
 *
 * The duplication is deliberate and mirrors `packages/cli/src/project/geometry.ts`
 * vs the SDK's `src/layout.ts`: the Edge runtime, the CLI and the SDK are
 * three separately released deployables with no shared workspace, so an import
 * between them is a coupling that buys nothing. The parity test that keeps the
 * three honest is `tests/key-format-parity.test.ts` at the repo root — it is
 * the only place that can reach all three, because it runs in the root vitest
 * project rather than in any package's own suite.
 *
 * Unlike the Edge copy this file generates nothing: the CLI is handed a key
 * that already exists, and the only question it can answer is whether the
 * paste is intact. The format definitions are the whole reason it exists.
 */

/**
 * Base62, and why not the base64url the Edge minter used to emit.
 *
 * These keys are pasted by hand, from an email, into a terminal prompt. The
 * characters `-`, `_`, `/`, `+`, `=` are all near each other on some layouts
 * and are the characters people mistype. Dropping them removes a class of
 * support question no amount of server-side tolerance can fix.
 */
export const ADS_KEY_PREFIX = 'clirevenue_ads_';
export const ADS_KEY_RANDOM_LENGTH = 30;
/** 15 + 30. A length check here gives a better message than a regex miss. */
export const ADS_KEY_LENGTH = ADS_KEY_PREFIX.length + ADS_KEY_RANDOM_LENGTH;

export const ACCOUNT_KEY_PREFIX = 'clirevenue_account_';
export const ACCOUNT_KEY_RANDOM_LENGTH = 25;
export const ACCOUNT_KEY_LENGTH =
  ACCOUNT_KEY_PREFIX.length + ACCOUNT_KEY_RANDOM_LENGTH;

/**
 * The pre-2026 format. Accepted forever — a publisher key is deployed to
 * third-party sites that hold the old string until somebody redeploys, and
 * dropping the pattern would break every one of them on upgrade with no action
 * they took. Only minting is new-format.
 */
const LEGACY_KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

/** Exactly the 30 base62 characters after the prefix — no length range. */
const ADS_KEY_RE = new RegExp(
  `^${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}$`,
);

const ACCOUNT_KEY_RE = new RegExp(
  `^${ACCOUNT_KEY_PREFIX}[A-Za-z0-9]{${ACCOUNT_KEY_RANDOM_LENGTH}}$`,
);

/**
 * Both accepted formats as one pattern.
 *
 * Exists so `verify/key-file.ts` can validate a paste read off disk with the
 * same rule `verifyKey` applies, rather than growing its own third copy of
 * the legacy pattern. A stale copy there is not a cosmetic problem: it would
 * make `setup` silently reject the key it wrote on the previous run and
 * re-prompt forever.
 */
export const PUBLISHER_KEY_RE = new RegExp(
  `^(?:${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}|pk_(?:live|test)_[A-Za-z0-9_-]{32,})$`,
);

/**
 * These two answer "is this already-a-string in the current format?", which is
 * not a claim that proves `string` — so they return plain booleans. Declaring
 * them `key is string` narrows the caller's variable to `never`, because
 * excluding `string` from `string` leaves nothing.
 */
export function isCurrentAdsKey(key: unknown): boolean {
  return typeof key === 'string' && ADS_KEY_RE.test(key);
}

export function isLegacyAdsKey(key: unknown): boolean {
  return typeof key === 'string' && LEGACY_KEY_RE.test(key);
}

/**
 * Accept any publisher key the CLI understands: current or legacy.
 *
 * A type predicate, because the paste arrives from a readline prompt as a
 * plain `string` but this is also the seam other callers (and tests) point
 * arbitrary values at; narrowing here means `verifyKey` can hand the value
 * straight to a request header.
 *
 * The account key (`clirevenue_account_`) is deliberately NOT accepted. A
 * developer and a member of staff sign up through the same form, so an account
 * key landing in the setup prompt is a realistic mistake — and the correct
 * outcome is a format error naming the mistake, not a 401 that reads as a
 * revoked key.
 *
 * The name is spelled the same as the other two copies because
 * `tests/key-format-parity.test.ts` compares them by name. Renaming one copy
 * alone would make that test pass while silently comparing nothing.
 */
export function isWellFormedPublisherKey(key: unknown): key is string {
  return (
    typeof key === 'string' &&
    (ADS_KEY_RE.test(key) || LEGACY_KEY_RE.test(key))
  );
}

/**
 * Exists so `setup` can name the mistake. Nothing in the shipped CLI mints an
 * account key or accepts one; this is recognition, never authorisation.
 */
export function isWellFormedAccountKey(key: unknown): key is string {
  return typeof key === 'string' && ACCOUNT_KEY_RE.test(key);
}
