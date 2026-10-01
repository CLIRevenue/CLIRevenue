import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { authorizeServe, type ServeTokenClaims } from "./serveAuthz.ts";

/**
 * Attack tests for the serve-token authorization boundary.
 *
 * These cover the half of the delivery attack surface that cannot be reached
 * from SQL: everything between "the client sent this JSON" and "the RPC is
 * allowed to name a serve".
 *
 * Each test is one of the ways a publisher could try to have an impression,
 * click or conversion billed to a campaign they do not own.
 */

const PUBLISHER_A = "11111111-1111-4111-8111-111111111111";
const PUBLISHER_B = "22222222-2222-4222-8222-222222222222";
const SERVE_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SERVE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CAMPAIGN_OWNED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CAMPAIGN_VICTIM = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const claimsFor = (over: Partial<ServeTokenClaims> = {}): ServeTokenClaims => ({
  rid: SERVE_1,
  pid: PUBLISHER_A,
  cid: CAMPAIGN_OWNED,
  ...over,
});

Deno.test("serve authz", async (t) => {
  await t.step("1. a valid serve authorizes the impression", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: claimsFor(),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: true });
  });

  await t.step("2. a tampered token is rejected before anything else is consulted", () => {
    // tokenVerified is false when HMAC verification or expiry checking fails.
    const res = authorizeServe({
      tokenVerified: false,
      claims: claimsFor(),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "TOKEN_INVALID" });
  });

  await t.step("2b. a verified-looking token with no claims is still rejected", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: null,
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "TOKEN_INVALID" });
  });

  await t.step("3. a token minted for another serve cannot be reused (replay)", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: claimsFor({ rid: SERVE_2 }),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "REQUEST_ID_MISMATCH" });
  });

  await t.step("4. a mismatched requestId is rejected", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: claimsFor(),
      bodyRequestId: SERVE_2,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "REQUEST_ID_MISMATCH" });
  });

  await t.step("5. publisher A cannot use publisher B's serve token", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: claimsFor({ pid: PUBLISHER_B }),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "PUBLISHER_MISMATCH" });
  });

  await t.step("5b. the mirror case is refused too", () => {
    const res = authorizeServe({
      tokenVerified: true,
      claims: claimsFor({ pid: PUBLISHER_A }),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_B,
    });
    assertEquals(res, { ok: false, failure: "PUBLISHER_MISMATCH" });
  });

  await t.step("6. the campaign claim is never an input to the decision", () => {
    // Whatever the token claims, and whatever the body would like to say,
    // the decision depends only on rid and pid. A token naming a victim
    // campaign still authorizes the same serve, which is safe precisely
    // because the RPC re-derives the campaign from the serve row rather
    // than from the token.
    const withVictim = authorizeServe({
      tokenVerified: true,
      claims: claimsFor({ cid: CAMPAIGN_VICTIM }),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    const withOwned = authorizeServe({
      tokenVerified: true,
      claims: claimsFor({ cid: CAMPAIGN_OWNED }),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(withVictim, withOwned);
  });

  await t.step("7. an unverified token is rejected even when rid and pid match", () => {
    // Guards against a future refactor checking claims before the signature.
    const res = authorizeServe({
      tokenVerified: false,
      claims: claimsFor(),
      bodyRequestId: SERVE_1,
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res.ok, false);
  });

  await t.step("8. failure is reported before the requestId comparison, to avoid leaking which serves exist", () => {
    const res = authorizeServe({
      tokenVerified: false,
      claims: null,
      // A requestId that does not exist. The failure must still be
      // TOKEN_INVALID, not REQUEST_ID_MISMATCH, so the error cannot be used
      // to enumerate request ids.
      bodyRequestId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      authenticatedPublisherId: PUBLISHER_A,
    });
    assertEquals(res, { ok: false, failure: "TOKEN_INVALID" });
  });

  await t.step("9. every failure mode is a distinct, closed set", () => {
    const failures = new Set<string>();
    const inputs = [
      { tokenVerified: false, claims: null, bodyRequestId: SERVE_1, authenticatedPublisherId: PUBLISHER_A },
      { tokenVerified: true, claims: claimsFor(), bodyRequestId: SERVE_2, authenticatedPublisherId: PUBLISHER_A },
      { tokenVerified: true, claims: claimsFor(), bodyRequestId: SERVE_1, authenticatedPublisherId: PUBLISHER_B },
    ];
    for (const input of inputs) {
      const res = authorizeServe(input);
      assertEquals(res.ok, false);
      if (!res.ok) failures.add(res.failure);
    }
    assertEquals([...failures].sort(), ["PUBLISHER_MISMATCH", "REQUEST_ID_MISMATCH", "TOKEN_INVALID"]);
  });
});