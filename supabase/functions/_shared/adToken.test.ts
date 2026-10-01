/**
 * Tests for the server-signed impression token and publisher key handling.
 *
 * These run the real production modules, not copies. Run with: npm run test:deno
 */
import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { signServeToken, verifyServeToken, hmacSha256B64Url } from "./adToken.ts";
import {
  isWellFormedPublisherKey,
  hashPublisherKey,
  generatePublisherKey,
  keyPrefix,
  createRateLimiter,
} from "./publisherAuth.ts";

const SECRET = "test-secret-value-0123456789";

const payload = (over: Partial<Parameters<typeof signServeToken>[1]> = {}) => ({
  v: 1 as const,
  rid: "11111111-1111-4111-8111-111111111111",
  cid: "22222222-2222-4222-8222-222222222222",
  pid: "33333333-3333-4333-8333-333333333333",
  plid: "44444444-4444-4444-8444-444444444444",
  exp: Date.now() + 60_000,
  ...over,
});

Deno.test("a freshly signed token verifies", async () => {
  const p = payload();
  const token = await signServeToken(SECRET, p);
  const result = await verifyServeToken(SECRET, token);
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.payload, p);
});

Deno.test("a token signed with a different secret is rejected", async () => {
  const token = await signServeToken(SECRET, payload());
  const result = await verifyServeToken("a-completely-different-secret", token);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "BAD_SIGNATURE");
});

Deno.test("tampering with the payload invalidates the signature", async () => {
  const token = await signServeToken(SECRET, payload());
  const [body, sig] = token.split(".");

  // Swap in a different campaign id, keeping the original signature: the
  // exact shape of a forged-campaign attack.
  const decoded = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
  decoded.cid = "99999999-9999-4999-8999-999999999999";
  const forgedBody = btoa(JSON.stringify(decoded))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const result = await verifyServeToken(SECRET, `${forgedBody}.${sig}`);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "BAD_SIGNATURE");
});

Deno.test("tampering with the signature is rejected", async () => {
  const token = await signServeToken(SECRET, payload());
  const [body, sig] = token.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  const result = await verifyServeToken(SECRET, `${body}.${flipped}`);
  assertEquals(result.ok, false);
});

Deno.test("an expired token is reported as expired, not as a bad signature", async () => {
  const token = await signServeToken(SECRET, payload({ exp: Date.now() - 1 }));
  const result = await verifyServeToken(SECRET, token);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "EXPIRED");
});

Deno.test("a token expiring exactly now is still valid, one ms later is not", async () => {
  const now = Date.now();
  const token = await signServeToken(SECRET, payload({ exp: now }));
  assertEquals((await verifyServeToken(SECRET, token, now)).ok, true);
  assertEquals((await verifyServeToken(SECRET, token, now + 1)).ok, false);
});

Deno.test("malformed tokens are rejected without decoding", async () => {
  for (const bad of ["", "abc", "a.b.c", "onlyonesegment", null, undefined, 42, {}]) {
    const result = await verifyServeToken(SECRET, bad);
    assertEquals(result.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

Deno.test("a correctly signed token with a non-conforming payload is rejected", async () => {
  // Signature is valid because the server signed it, but the shape is wrong.
  const token = await signServeToken(SECRET, { rid: "x" } as never);
  const result = await verifyServeToken(SECRET, token);
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "BAD_PAYLOAD");
});

Deno.test("different payloads produce different signatures", async () => {
  const a = await hmacSha256B64Url(SECRET, "one");
  const b = await hmacSha256B64Url(SECRET, "two");
  assertNotEquals(a, b);
});

Deno.test("the same input is deterministic", async () => {
  const a = await hmacSha256B64Url(SECRET, "same");
  const b = await hmacSha256B64Url(SECRET, "same");
  assertEquals(a, b);
});

/* ---------------- publisher keys ---------------- */

Deno.test("generated keys are well formed and unique", () => {
  const keys = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const k = generatePublisherKey();
    assertEquals(isWellFormedPublisherKey(k), true);
    assertEquals(keys.has(k), false);
    keys.add(k);
  }
});

Deno.test("malformed keys are rejected before any lookup", () => {
  for (const bad of ["", "nope", "pk_live_short", "pk_prod_aaaaaaaaaaaaaaaaaaaaaaaa", null, 42, {}]) {
    assertEquals(isWellFormedPublisherKey(bad as never), false, `expected ${bad} rejected`);
  }
});

Deno.test("hashing is deterministic, 64 hex chars, and not the raw key", async () => {
  const key = generatePublisherKey();
  const a = await hashPublisherKey(key);
  const b = await hashPublisherKey(key);
  assertEquals(a, b);
  assertEquals(a.length, 64);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
  assertNotEquals(a, key);
  assertNotEquals(a, await hashPublisherKey(generatePublisherKey()));
});

Deno.test("the display prefix is not sufficient to authenticate", async () => {
  const key = generatePublisherKey();
  const prefix = keyPrefix(key);
  assertEquals(isWellFormedPublisherKey(prefix), false);
  assertEquals(await hashPublisherKey(prefix) === await hashPublisherKey(key), false);
});

/* ---------------- rate limiter ---------------- */

Deno.test("the limiter allows a burst then refuses", () => {
  let t = 0;
  const limit = createRateLimiter({ capacity: 3, refillPerSecond: 1, now: () => t });

  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, true);

  const denied = limit("pub-a");
  assertEquals(denied.allowed, false);
  assertEquals(denied.retryAfterMs > 0, true);
});

Deno.test("the limiter is keyed per publisher, not global", () => {
  let t = 0;
  const limit = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => t });

  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, false);
  // A different publisher is unaffected: shared-NAT publishers must not be
  // able to exhaust each other's quota.
  assertEquals(limit("pub-b").allowed, true);
});

Deno.test("the bucket refills over time", () => {
  let t = 0;
  const limit = createRateLimiter({ capacity: 2, refillPerSecond: 2, now: () => t });

  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, false);

  t += 1000; // one second, at 2/sec = 2 tokens
  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, true);
  assertEquals(limit("pub-a").allowed, false);
});

Deno.test("refill never exceeds capacity", () => {
  let t = 0;
  const limit = createRateLimiter({ capacity: 2, refillPerSecond: 100, now: () => t });
  assertEquals(limit("p").allowed, true);
  t += 60_000; // far more than capacity could refill to
  assertEquals(limit("p").allowed, true);
  assertEquals(limit("p").allowed, true);
  assertEquals(limit("p").allowed, false);
});
