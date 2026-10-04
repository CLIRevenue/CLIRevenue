/**
 * Pure helpers for developer publisher provisioning.
 *
 * Everything in this file is deliberately side-effect free and free of any
 * Supabase or Deno import, for two reasons.
 *
 * First, it is testable. `deno test supabase/functions/_shared/` runs every
 * co-located *.test.ts, and the rules that actually matter here — when a raw
 * key may be shown, how a publisher gets its name, how a response is shaped —
 * are rules about data, not about the database.
 *
 * Second, it keeps one implementation of each idea. Key generation and hashing
 * live in publisherAuth.ts because that is where the delivery path reads them
 * from. This module decides what the caller is *allowed to see afterwards*,
 * which is a different question and belongs somewhere else.
 *
 * The load-bearing rule, restated because it is the whole point:
 *
 *   A raw publishable key is a capability, not an identifier. Only sha256(key)
 *   is stored, so the plaintext exists in exactly one place: the response to
 *   the single request that generated it. Every later request must report the
 *   key as issued and stop there. Returning a raw key that the database row
 *   cannot corroborate would be a lie, and persisting the plaintext so the
 *   dashboard can keep showing it would undo the property that makes a leaked
 *   database dump useless.
 */

import { isWellFormedPublisherKey } from "./publisherAuth.ts";

export type KeyEnvironment = "test" | "live";

/** What the browser is shown about the key. `publishableKey` is optional by
 *  construction: it is present only on the response that created the key. */
export type ProvisionedKeyView = {
  env: KeyEnvironment | null;
  label: string | null;
  prefix: string | null;
  createdAt: string | null;
  created: boolean;
  publishableKey?: string;
};

export type ProvisioningResult = {
  publisher: { id: string; name: string; created: boolean };
  key: ProvisionedKeyView;
};

/** What provision_publisher_slot() returns, plus the key this request minted.
 *  `newlyGeneratedKey` is set only by the caller, only on the request that
 *  actually inserted a row. */
export type ProvisioningSlot = {
  publisher_id: string;
  publisher_name: string;
  publisher_created: boolean;
  needs_key: boolean;
  key_id: string | null;
  key_prefix: string | null;
  key_env: KeyEnvironment | null;
  key_label: string | null;
  key_created_at: string | null;
};

/**
 * Derive a publisher name from an account email.
 *
 * The local part is a readable handle for a developer who ends up with more
 * than one publisher, and it is the only part of the address that names them
 * rather than describing where they signed up. The domain is deliberately
 * dropped: publishers.name is displayed in the dashboard and nowhere needs a
 * mail host.
 */
export function publisherNameFromEmail(email: string | null | undefined): string {
  const local = (email ?? "").split("@")[0]?.trim() ?? "";
  return local.length > 0 ? local : "CLIRevenue publisher";
}

/**
 * Decide whether a raw key may appear in the response.
 *
 * Three conditions, all of which must hold, and none of which is negotiable:
 *
 *   1. The caller passed the plaintext it just generated. Anything else -
 *      undefined, null, an empty string - means "this request did not mint
 *      the key" and the answer is no.
 *   2. It is a well-formed publisher key, so a bug that put some other
 *      string in the variable fails closed rather than echoing it.
 *   3. Its environment agrees with the row being reported. A pk_test_ value
 *      must never be presented as the live key or vice versa.
 *
 * This is the only place a raw key is ever put into a response body, which is
 * what makes "shown exactly once" a property of the code rather than a
 * property of the caller remembering.
 */
export function mayRevealPublishableKey(
  rawKey: string | null | undefined,
  env: KeyEnvironment | null,
): rawKey is string {
  if (typeof rawKey !== "string" || rawKey.length === 0) return false;
  if (!isWellFormedPublisherKey(rawKey)) return false;
  if (env !== "test" && env !== "live") return false;
  return rawKey.startsWith(`pk_${env}_`);
}

/**
 * Build the response body from a slot and, if this request minted one, the
 * plaintext it minted.
 *
 * Note what is not here: no key_hash, no key id, and no raw key unless the
 * three conditions in mayRevealPublishableKey hold. The type has no field for
 * a hash, so a caller cannot pass one through even by accident.
 */
export function buildProvisioningResponse(
  slot: ProvisioningSlot,
  newRawKey?: string | null,
): ProvisioningResult {
  const created = typeof newRawKey === "string" && newRawKey.length > 0;
  const key: ProvisionedKeyView = {
    env: slot.key_env,
    label: slot.key_label,
    prefix: slot.key_prefix,
    createdAt: slot.key_created_at,
    created,
  };

  if (created && mayRevealPublishableKey(newRawKey, slot.key_env)) {
    key.publishableKey = newRawKey;
  }

  return {
    publisher: {
      id: slot.publisher_id,
      name: slot.publisher_name,
      created: slot.publisher_created,
    },
    key,
  };
}