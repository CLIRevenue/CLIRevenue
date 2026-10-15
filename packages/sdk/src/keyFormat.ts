/**
 * Publisher key format.
 *
 * A publisher key is a capability: it lives in a website's source, it is
 * fetched by every reader of that page, and the server accepts it in place of
 * an identity. That is why the shape below is validated up front rather than
 * discovered at the first delivery — a rejected key must fail at `init()`,
 * where the host can see the message, and never silently render no ads.
 *
 * ## Two formats, on purpose
 *
 *   `clirevenue_ads_` + 30 base62   the current format
 *   `pk_live_` / `pk_test_` + 32+   every key minted before the change
 *
 * The legacy branch is not dead code and must not be deleted. A publisher key
 * is deployed to third-party sites, and those sites hold the old string until
 * somebody logs in and redeploys. Dropping the legacy pattern would break
 * every one of them on upgrade, from the publisher's side, with no action they
 * took and no way to diagnose it. Both patterns stay accepted indefinitely;
 * only minting is new-format.
 *
 * ## Three copies of this file
 *
 * The same three constants exist in `supabase/functions/_shared/keyFormat.ts`
 * (minting) and `packages/cli/src/verify/key.ts` (setup-time validation). The
 * duplication is deliberate and mirrors `src/layout.ts` vs
 * `packages/cli/src/project/geometry.ts`: the Edge runtime, the CLI and the
 * browser SDK are three separate deployables with three separate release
 * cycles, and a shared workspace import between them is a coupling that buys
 * nothing. What does buy something is a test that asserts the three agree —
 * see `tests/key-format-parity.test.ts`. A divergence here is a key that
 * mints successfully and is then rejected by the consumer.
 */

/**
 * Base62, and why not the base64url the Edge minter used to emit.
 *
 * These keys are pasted by hand, from an email, into a terminal prompt. The
 * characters `-`, `_`, `/`, `+`, `=` are all near each other on some layouts
 * and are the characters people mistype. Dropping them removes a class of
 * support question that no amount of server-side tolerance can fix.
 */
export const ADS_KEY_PREFIX = "clirevenue_ads_";
export const ADS_KEY_RANDOM_LENGTH = 30;
/** 15 + 30. Exported so a consumer can check a paste length before a regex. */
export const ADS_KEY_LENGTH = ADS_KEY_PREFIX.length + ADS_KEY_RANDOM_LENGTH;

/** The pre-2026 format, kept accepted forever. See the header. */
export const LEGACY_KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

/** Exactly the 30 base62 characters after the prefix — no length range. */
export const ADS_KEY_RE = new RegExp(
  `^${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}$`,
);

/**
 * Both accepted formats as one pattern.
 *
 * For the callers that need a `RegExp` rather than a function — a validator
 * passed to an input prompt, a `.test()` in a file reader. Those callers are
 * exactly where a *fourth* copy of the legacy pattern would otherwise grow,
 * and a stale copy there is a key setup refuses to read back.
 */
export const PUBLISHER_KEY_RE = new RegExp(
  `^(?:${ADS_KEY_PREFIX}[A-Za-z0-9]{${ADS_KEY_RANDOM_LENGTH}}|pk_(?:live|test)_[A-Za-z0-9_-]{32,})$`,
);

/**
 * Accept any key this SDK understands: current or legacy.
 *
 * `key is string` because the input genuinely is `unknown` — a config value
 * read from JSON, an env var, or `localStorage` can be anything at all, and
 * the caller needs the narrowing to reach `this.publisherKey = key`.
 *
 * The account key (`clirevenue_account_`) is deliberately NOT accepted. It is
 * a staff credential that never reaches a website; if one is pasted here the
 * correct outcome is a rejection at `init()`, not a confusing 401 later.
 *
 * The name is spelled the same as the other two copies because
 * `tests/key-format-parity.test.ts` compares them by name. Renaming one copy
 * alone would make that test pass while silently comparing nothing.
 */
export function isWellFormedPublisherKey(key: unknown): key is string {
  return (
    typeof key === "string" &&
    (ADS_KEY_RE.test(key) || LEGACY_KEY_RE.test(key))
  );
}