/**
 * The staff-only account key.
 *
 * A publisher has two credentials in this system, and the difference is the
 * whole point of this file.
 *
 * The publishable key (`clirevenue_ads_...`) is a *capability for delivery*.
 * It goes into a website, where anybody can read it. It may be handed out,
 * rotated and revoked, and the server refuses it once it is revoked.
 *
 * The account key (`clirevenue_account_...`) is a *staff capability*. It
 * exists so the CLIRevenue team can act on a publisher's account without a
 * human pasting a row out of the database into a support ticket. It is not
 * shown to the developer, is not written to their dashboard, and is minted
 * only on a route that already required `profiles.role = 'admin'`.
 *
 * Why that separation is worth enforcing in code rather than in a runbook:
 *
 *   - The two live in different tables. `publisher_keys.key_hash` is checked on
 *     every ad request; `publishers.account_key_hash` is never read by the
 *     delivery path at all. Putting them in one table would make a mistake in
 *     a SELECT list a credential leak.
 *   - Different prefixes mean a paste into the wrong box fails closed at the
 *     regex rather than resolving to the wrong principal.
 *   - The publishable key's format stopped carrying `pk_live_`/`pk_test_`
 *     because that segment leaked the billing environment. The account key had
 *     no such segment to begin with and never needed one.
 *
 * Same storage rule as the publishable key, for the same reason: only sha256
 * is persisted. There is no code path anywhere in this repository that can
 * read an account key back after the response that minted it. That is not a
 * missing feature - it is the feature. A database dump yields no staff
 * capability at all.
 *
 * Everything here is pure and free of Supabase and Deno imports so
 * `deno test supabase/functions/_shared/` can cover the decision rules.
 */
import {
  ACCOUNT_KEY_LENGTH,
  generateAccountKey,
  isWellFormedAccountKey,
  keyPrefix,
} from "./keyFormat.ts";
import { hashPublisherKey } from "./publisherAuth.ts";

export { ACCOUNT_KEY_LENGTH, generateAccountKey, isWellFormedAccountKey };

/**
 * What the caller is shown after a mint attempt.
 *
 * `accountKey` is optional by construction, exactly like
 * `ProvisionedKeyView.publishableKey`: it is populated only on the response
 * that created the key, and `deno test` asserts that every other path leaves
 * the field absent rather than present-and-empty. An absent field is the
 * honest answer to "you have a key but it was shown to someone else".
 */
export type AccountKeyView = {
  /** True when this request inserted the row. */
  created: boolean;
  /** Non-secret display fragment, always safe to log. */
  prefix: string | null;
  accountKey?: string;
};

/**
 * sha256 of an account key, hex encoded.
 *
 * A named wrapper rather than a call to `hashPublisherKey` at the call sites
 * so the two credential kinds read differently in review, but there is still
 * exactly one hashing implementation - the same class of duplication
 * `publisherAuth.ts` exists to prevent.
 */
export async function hashAccountKey(rawKey: string): Promise<string> {
  return hashPublisherKey(rawKey);
}

/**
 * Mint a brand-new account key and its stored hash together.
 *
 * They are produced by one call because producing a plaintext without its
 * hash is the one mistake that is unrecoverable: the plaintext would be shown
 * once and then belong to nobody. Producing a hash without ever intending to
 * return the plaintext is merely useless.
 */
export async function mintAccountKey(): Promise<{
  rawKey: string;
  keyHash: string;
  prefix: string;
}> {
  const rawKey = generateAccountKey();
  const keyHash = await hashAccountKey(rawKey);
  return { rawKey, keyHash, prefix: keyPrefix(rawKey) };
}

/**
 * Decide whether a raw account key may appear in a response.
 *
 * Mirrors `mayRevealPublishableKey` and fails closed the same way, for the
 * same reason: a bug that leaves something unexpected in `rawKey` must not
 * echo it. There is no environment to cross-check here, so the two remaining
 * checks are "this request minted something" and "it is really an account key
 * and not a publishable one pasted in by mistake" - the `clirevenue_account_`
 * prefix is what separates the two, and that is exactly the check that makes
 * this safe to call with an argument of unknown provenance.
 */
export function mayRevealAccountKey(
  rawKey: string | null | undefined,
): rawKey is string {
  return typeof rawKey === "string" && isWellFormedAccountKey(rawKey);
}

/**
 * Build the response for a mint attempt.
 *
 * `existingPrefix` is what was already stored before this request, and is
 * echoed back unchanged when nothing was minted - staff need to see that the
 * account already has a key, and the prefix is enough to recognise which one
 * without being enough to use it.
 */
export function buildAccountKeyResponse(
  existingPrefix: string | null,
  rawKey?: string | null,
): AccountKeyView {
  const created = typeof rawKey === "string" && rawKey.length > 0;
  const view: AccountKeyView = {
    created,
    prefix: created ? keyPrefix(rawKey) : existingPrefix,
  };
  if (created && mayRevealAccountKey(rawKey)) {
    view.accountKey = rawKey;
  }
  return view;
}

/**
 * Shape the row read back from `publishers` into the two values the mint
 * routine actually needs.
 *
 * Returns nulls rather than throwing when the row is missing, because the
 * caller has already validated the publisher id and a "no account key yet"
 * answer is a normal state for every publisher created before this shipped.
 */
export function readStoredAccountKey(row: unknown): {
  accountKeyHash: string | null;
  accountKeyPrefix: string | null;
} {
  if (!row || typeof row !== "object") {
    return { accountKeyHash: null, accountKeyPrefix: null };
  }
  const record = row as Record<string, unknown>;
  return {
    accountKeyHash: typeof record.account_key_hash === "string" ? record.account_key_hash : null,
    accountKeyPrefix: typeof record.account_key_prefix === "string" ? record.account_key_prefix : null,
  };
}