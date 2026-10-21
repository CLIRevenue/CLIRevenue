/**
 * Tests for the real delivery eligibility predicates.
 *
 * These replace tests/budget-units.test.js, which defined its own
 * canServe()/toSpendCents() helpers and asserted on those. It exercised no
 * production code, so it would have kept passing even if the delivered
 * comparison were wrong -- which is exactly the kind of false confidence the
 * budget-unit investigation produced.
 *
 * Run with: npm run test:deno
 */
import { assertEquals } from "jsr:@std/assert@1";
import {
  withinBudget,
  withinSchedule,
  isEligible,
  pickEligible,
  pickServable,
  CANDIDATE_WINDOW,
} from "./eligibility.ts";

const active = { status: "active", spend_milli_cents: 0, budget_cents: 10000 };

Deno.test("an open schedule is always in window", () => {
  assertEquals(withinSchedule({ starts_at: null, ends_at: null }, Date.now()), true);
});

Deno.test("a future start is not in window, a past start is", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const future = new Date(now + 60_000).toISOString();
  const past = new Date(now - 60_000).toISOString();
  assertEquals(withinSchedule({ starts_at: future, ends_at: null }, now), false);
  assertEquals(withinSchedule({ starts_at: past, ends_at: null }, now), true);
});

Deno.test("an elapsed end date is not in window", () => {
  const now = Date.parse("2026-01-01T00:00:00Z");
  const past = new Date(now - 60_000).toISOString();
  assertEquals(withinSchedule({ starts_at: null, ends_at: past }, now), false);
});

Deno.test("budget compares milli-cents against cents scaled to milli-cents", () => {
  // 10000 cents is $100. If the right-hand side were left unscaled this
  // would pass a campaign that had already spent 10000x its budget.
  assertEquals(withinBudget({ spend_milli_cents: 0, budget_cents: 10000 }), true);
  assertEquals(withinBudget({ spend_milli_cents: 9_999_999, budget_cents: 10000 }), true);
  // Exactly at the ceiling is not servable.
  assertEquals(withinBudget({ spend_milli_cents: 10_000_000, budget_cents: 10000 }), false);
  assertEquals(withinBudget({ spend_milli_cents: 99_999_999, budget_cents: 10000 }), false);
});

Deno.test("a one-cent spend is still detectable against a cent budget", () => {
  // 1 cent = 1000 milli-cents. Comparing in cents on both sides would read
  // 10000 < 10000 and stop the campaign a whole cent early.
  assertEquals(withinBudget({ spend_milli_cents: 1000, budget_cents: 10000 }), true);
  assertEquals(withinBudget({ spend_milli_cents: 9_999_000, budget_cents: 10000 }), true);
  assertEquals(withinBudget({ spend_milli_cents: 10_000_000, budget_cents: 10000 }), false);
});

Deno.test("numeric strings from the database compare correctly", () => {
  // PostgREST returns bigint/numeric as strings, so the predicates must not
  // rely on the values arriving as JS numbers.
  assertEquals(withinBudget({ spend_milli_cents: "5000", budget_cents: "10000" }), true);
  assertEquals(withinBudget({ spend_milli_cents: "10000000", budget_cents: "10000" }), false);
});

Deno.test("only an active campaign is eligible", () => {
  const now = Date.now();
  for (const status of ["draft", "paused", "completed", "archived", null, undefined]) {
    assertEquals(isEligible({ ...active, status }, now), false);
  }
  assertEquals(isEligible({ ...active, status: "active" }, now), true);
});

Deno.test("pickEligible returns the first eligible candidate in order", () => {
  const now = Date.now();
  const exhausted = { ...active, status: "active" as const, id: "a", spend_milli_cents: 10_000_000 };
  const servable = { ...active, status: "active" as const, id: "b" };
  assertEquals(pickEligible([exhausted, servable], now)?.id, "b");
});

Deno.test("pickEligible returns null when nothing is servable", () => {
  const now = Date.now();
  const all = [
    { ...active, status: "paused" as const },
    { ...active, status: "active" as const, spend_milli_cents: 10_000_000 },
  ];
  assertEquals(pickEligible(all, now), null);
  assertEquals(pickEligible([], now), null);
});

Deno.test("the candidate window is a deliberate, bounded walk", () => {
  assertEquals(CANDIDATE_WINDOW, 25);
});

/* The ad text, at the point of delivery. The database constrains the headline
   for every write, but the constraint was added NOT VALID so that campaigns
   written before the 60-character rule existed are not destroyed by the
   upgrade. Such a row exists, it must not be served, and the campaigns
   behind it still must be. */
Deno.test("a campaign whose headline is too long is not served", () => {
  const now = Date.now();
  const legacy = {
    ...active,
    status: "active" as const,
    id: "a",
    headline: "x".repeat(61),
  };
  assertEquals(pickServable([legacy], now), null);
});

Deno.test("a campaign with an empty headline is not served", () => {
  const now = Date.now();
  const empty = { ...active, status: "active" as const, id: "a", headline: "   " };
  assertEquals(pickServable([empty], now), null);
});

Deno.test("an invalid campaign does not stop the valid one behind it being served", () => {
  const now = Date.now();
  const legacy = {
    ...active,
    status: "active" as const,
    id: "a",
    headline: "x".repeat(80),
  };
  const servable = { ...active, status: "active" as const, id: "b", headline: "A real headline" };
  const picked = pickServable([legacy, servable], now);
  assertEquals(picked?.campaign.id, "b");
  assertEquals(picked?.headline, "A real headline");
});

Deno.test("the served headline is the normalised one", () => {
  const now = Date.now();
  const servable = {
    ...active,
    status: "active" as const,
    id: "a",
    headline: "  caf\u00e9  ",
  };
  assertEquals(pickServable([servable], now)?.headline, "caf\u00e9");
});

Deno.test("a campaign that is eligible but has no headline at all is not served", () => {
  /* The column is NOT NULL, but the delivery payload is untrusted input and
     a row from before the column was tightened should not become an ad. */
  const now = Date.now();
  const noHeadline = { ...active, status: "active" as const, id: "a" };
  assertEquals(pickServable([noHeadline], now), null);
});
