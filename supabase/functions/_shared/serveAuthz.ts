/**
 * Serve-token authorization decision.
 *
 * Extracted from ads/index.ts so the single most important security boundary
 * in the delivery path is directly executable in tests.
 *
 * The invariant this file exists to defend:
 *
 *   CLIENT INPUT MUST NEVER DETERMINE WHICH CAMPAIGN IS BILLED.
 *
 * A publisher controls `requestId`, `campaignId`, `publisherId` and
 * `impressionToken` -- every field in the tracking request body. The only
 * trustworthy binding between a serve and the campaign it billed is the HMAC
 * serve token minted at delivery time, which the server signed and the client
 * cannot forge or edit.
 *
 * So authorization is a comparison against the token, never a trust of the
 * body:
 *
 *   1. the token must verify (signature + expiry) -- checked by the caller,
 *      which passes the already-verified result in;
 *   2. token.rid must equal the body's requestId, so a token cannot be
 *      replayed against a different serve;
 *   3. token.pid must equal the publisher the API key authenticated as, so
 *      publisher A cannot spend publisher B's serve token.
 *
 * Only when all three hold is the body's requestId allowed to name a serve.
 * The campaign is then resolved inside the RPC from the serve row, so no
 * client-supplied value ever reaches the billing decision.
 *
 * Deliberately pure: no I/O, no environment, no database. Everything the
 * decision needs is passed in. That is what makes the attack tests cheap and
 * exhaustive.
 */

/** Claims carried by a signed serve token. */
export type ServeTokenClaims = {
  /** The serve request id this token was minted for. */
  rid: string;
  /** The publisher id this token was minted for. */
  pid: string;
  /** Campaign the serve selected. Informational; never trusted from the body. */
  cid?: string;
  /** Expiry, epoch millis. Verified by the caller before this point. */
  exp?: number;
};

/** Why authorization failed. Each maps to one 401 in the handler. */
export type ServeAuthzFailure =
  | "TOKEN_INVALID"
  | "REQUEST_ID_MISMATCH"
  | "PUBLISHER_MISMATCH";

export type ServeAuthzInput = {
  /**
   * Result of HMAC verification and expiry checking, already performed by the
   * caller. `false` short-circuits everything else.
   */
  tokenVerified: boolean;
  /** Verified claims. Ignored when `tokenVerified` is false. */
  claims: ServeTokenClaims | null;
  /** `requestId` from the request body -- client-controlled, never trusted. */
  bodyRequestId: string;
  /** Publisher the API key authenticated as -- derived from the key hash. */
  authenticatedPublisherId: string;
};

export type ServeAuthzResult =
  | { ok: true }
  | { ok: false; failure: ServeAuthzFailure };

/**
 * Decide whether a tracking call may proceed to name a serve.
 *
 * Order matters for information leakage: an invalid token is reported as
 * such before the requestId is even compared, so a caller cannot use the
 * error to probe which request ids exist.
 */
export function authorizeServe(input: ServeAuthzInput): ServeAuthzResult {
  const { tokenVerified, claims, bodyRequestId, authenticatedPublisherId } = input;

  if (!tokenVerified || !claims) {
    return { ok: false, failure: "TOKEN_INVALID" };
  }

  // A token minted for serve A must not be replayed against serve B.
  if (claims.rid !== bodyRequestId) {
    return { ok: false, failure: "REQUEST_ID_MISMATCH" };
  }

  // Publisher A must not be able to burn publisher B's serve.
  if (claims.pid !== authenticatedPublisherId) {
    return { ok: false, failure: "PUBLISHER_MISMATCH" };
  }

  return { ok: true };
}