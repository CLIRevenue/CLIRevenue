import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ACCOUNT_KEY_LENGTH,
  buildAccountKeyResponse,
  generateAccountKey,
  hashAccountKey,
  isWellFormedAccountKey,
  mayRevealAccountKey,
  mintAccountKey,
  readStoredAccountKey,
} from "./accountKey.ts";

/**
 * Tests for the staff-only account key.
 *
 * The thing being defended here is not "can this function mint a string" - it
 * obviously can. It is that the plaintext exists on exactly one response and
 * cannot be recovered afterwards, and that a publishable key handed to the
 * account-key path by mistake is refused rather than echoed. Every assertion
 * below is one of those two properties.
 */

const PUBLISHABLE_KEY = `clirevenue_ads_${"a".repeat(30)}`;
const LEGACY_PUBLISHABLE_KEY = `pk_test_${"a".repeat(43)}`;

Deno.test("generateAccountKey", async (t) => {
  await t.step("produces a well-formed key of the documented length", () => {
    const key = generateAccountKey();
    assert(isWellFormedAccountKey(key));
    assertEquals(key.length, ACCOUNT_KEY_LENGTH);
    assert(key.startsWith("clirevenue_account_"));
  });

  await t.step("does not repeat", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateAccountKey());
    // A collision here would mean a silent account takeover. 500 draws from a
    // 25-character base62 space is ~1.2e-3 probability of even one collision,
    // so this is a smoke test for a broken generator, not a proof.
    assertEquals(seen.size, 500);
  });

  await t.step("refuses a publishable key, in either format", () => {
    // The two credential kinds must not be interchangeable. If this ever
    // returned true, a publishable key pasted into the staff path would be
    // stored as an account credential and the two would become one principal.
    assertEquals(isWellFormedAccountKey(PUBLISHABLE_KEY), false);
    assertEquals(isWellFormedAccountKey(LEGACY_PUBLISHABLE_KEY), false);
  });
});

Deno.test("mintAccountKey", async (t) => {
  await t.step("pairs the plaintext with its hash in one call", async () => {
    const { rawKey, keyHash, prefix } = await mintAccountKey();
    assertEquals(keyHash, await hashAccountKey(rawKey));
    // 24 characters: the prefix length the rest of the system already uses for
    // current-format keys, so a truncated account key is still recognisable.
    assertEquals(prefix.length, 24);
    assertEquals(prefix, rawKey.slice(0, 24));
  });

  await t.step("never hashes to the plaintext", async () => {
    const { rawKey, keyHash } = await mintAccountKey();
    assertEquals(keyHash === rawKey, false);
    assertEquals(keyHash.length, 64);
  });
});

Deno.test("mayRevealAccountKey", async (t) => {
  await t.step("accepts a real account key", () => {
    assert(mayRevealAccountKey(generateAccountKey()));
  });

  await t.step("refuses a publishable key in either format", () => {
    assertEquals(mayRevealAccountKey(PUBLISHABLE_KEY), false);
    assertEquals(mayRevealAccountKey(LEGACY_PUBLISHABLE_KEY), false);
  });

  await t.step("refuses anything that is not a string", () => {
    assertEquals(mayRevealAccountKey(""), false);
    assertEquals(mayRevealAccountKey(null), false);
    assertEquals(mayRevealAccountKey(undefined), false);
    // A number is only reachable through the `unknown`-facing guard, which is
    // what JSON-parsed input actually arrives as.
    assertEquals(isWellFormedAccountKey(42), false);
    assertEquals(isWellFormedAccountKey({ prefix: "clirevenue_account_" }), false);
    // Almost right: right prefix, one character short.
    assertEquals(mayRevealAccountKey("clirevenue_account_" + "a".repeat(24)), false);
    // Almost right: right length, wrong namespace.
    assertEquals(mayRevealAccountKey("clirevenue_ads___" + "a".repeat(30)), false);
  });
});

Deno.test("buildAccountKeyResponse", async (t) => {
  await t.step("carries the plaintext exactly once, when it minted one", async () => {
    const { rawKey, prefix } = await mintAccountKey();
    const view = buildAccountKeyResponse(null, rawKey);
    assertEquals(view.accountKey, rawKey);
    assertEquals(view.created, true);
    assertEquals(view.prefix, prefix);
  });

  await t.step("reports an existing key without inventing one", () => {
    const view = buildAccountKeyResponse("clirevenue_account_abcdefgh");
    assertEquals(view.created, false);
    assertEquals("accountKey" in view, false);
    assertEquals(view.prefix, "clirevenue_account_abcdefgh");
  });

  await t.step("drops a malformed value rather than passing it on", () => {
    const view = buildAccountKeyResponse(null, PUBLISHABLE_KEY);
    assertEquals("accountKey" in view, false);
    // Still honest about the attempt.
    assertEquals(view.created, true);
  });

  await t.step("treats an empty string as nothing minted", () => {
    const view = buildAccountKeyResponse("clirevenue_account_abcdefgh", "");
    assertEquals(view.created, false);
    assertEquals("accountKey" in view, false);
    assertEquals(view.prefix, "clirevenue_account_abcdefgh");
  });

  await t.step("never carries a hash", async () => {
    const { rawKey, keyHash } = await mintAccountKey();
    const serialised = JSON.stringify(buildAccountKeyResponse(null, rawKey));
    assertEquals(serialised.includes(keyHash), false);
    assertEquals(/hash/i.test(serialised), false);
    assertEquals(serialised.includes("sha256"), false);
  });
});

Deno.test("readStoredAccountKey", async (t) => {
  await t.step("reads the two columns it is asked for", () => {
    assertEquals(
      readStoredAccountKey({
        id: "11111111-1111-4111-8111-111111111111",
        account_key_hash: "deadbeef",
        account_key_prefix: "clirevenue_account_abcdefgh",
      }),
      { accountKeyHash: "deadbeef", accountKeyPrefix: "clirevenue_account_abcdefgh" },
    );
  });

  await t.step("reports a publisher that has never had one as nulls", () => {
    // This is the normal state for every publisher created before this
    // shipped, and it must not throw - the caller branches on it.
    assertEquals(readStoredAccountKey({ id: "x" }), {
      accountKeyHash: null,
      accountKeyPrefix: null,
    });
    assertEquals(readStoredAccountKey(null), {
      accountKeyHash: null,
      accountKeyPrefix: null,
    });
    assertEquals(readStoredAccountKey(undefined), {
      accountKeyHash: null,
      accountKeyPrefix: null,
    });
  });

  await t.step("refuses a non-string rather than passing it on", () => {
    assertEquals(readStoredAccountKey({ account_key_hash: 12345 }), {
      accountKeyHash: null,
      accountKeyPrefix: null,
    });
  });
});
