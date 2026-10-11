import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRateLimiter, isWellFormedPublisherKey } from "./publisherAuth.ts";

/**
 * Rate-limiter behaviour the endpoints rely on.
 *
 * The limiter is an in-memory token bucket per isolate -- these tests pin the
 * semantics (refill math, retry-after hints, bounded key maps) without ever
 * claiming global enforcement. The per-isolate limitation is documented in
 * docs/DEPLOYMENT_CHECKLIST.md.
 */

Deno.test("rate limiter", async (t) => {
  await t.step("allows capacity requests then throttles with a retry hint", async () => {
    let now = 1000;
    const check = createRateLimiter({ capacity: 2, refillPerSecond: 1, now: () => now });
    assertEquals(check("a").allowed, true);
    assertEquals(check("a").allowed, true);
    const denied = check("a");
    assertEquals(denied.allowed, false);
    assertEquals(denied.retryAfterMs > 0, true);
  });

  await t.step("refills over time", async () => {
    let now = 1000;
    const check = createRateLimiter({ capacity: 1, refillPerSecond: 1, now: () => now });
    assertEquals(check("a").allowed, true);
    assertEquals(check("a").allowed, false);
    now += 1500;
    assertEquals(check("a").allowed, true);
  });

  await t.step("isolates budgets per key", async () => {
    const check = createRateLimiter({ capacity: 1, refillPerSecond: 0 });
    assertEquals(check("a").allowed, true);
    assertEquals(check("a").allowed, false);
    assertEquals(check("b").allowed, true);
  });

  await t.step("bounds tracked keys when asked, evicting oldest first", async () => {
    const check = createRateLimiter({ capacity: 1, refillPerSecond: 0, maxKeys: 2 });
    assertEquals(check("a").allowed, true);
    assertEquals(check("b").allowed, true);
    // "c" evicts "a", which restarts at full capacity: the safe direction.
    assertEquals(check("c").allowed, true);
    assertEquals(check("c").allowed, false);
    // "b" survived, so it is still throttled.
    assertEquals(check("b").allowed, false);
  });

  await t.step("rejects malformed publisher keys cheaply", async () => {
    assertEquals(isWellFormedPublisherKey("pk_test_" + "a".repeat(32)), true);
    assertEquals(isWellFormedPublisherKey("pk_live_" + "a".repeat(32)), true);
    assertEquals(isWellFormedPublisherKey(""), false);
    assertEquals(isWellFormedPublisherKey("pk_prod_" + "a".repeat(32)), false);
    assertEquals(isWellFormedPublisherKey("pk_test_short"), false);
    assertEquals(isWellFormedPublisherKey(null), false);
  });
});
