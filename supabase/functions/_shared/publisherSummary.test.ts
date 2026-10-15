import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parsePublisherSummary } from "./publisherSummary.ts";

/**
 * Tests for parsing `publisher_summary`'s jsonb.
 *
 * This parser is what stands between a deployment that has run migration
 * 000025 and one that has not, so the cases that matter are the malformed
 * ones. A deployment that has not run the migration never reaches this
 * function - it is short-circuited by the PGRST202 check - but a deployment
 * where the function exists and returns something unexpected still does, and
 * the panel must show zeroes rather than `NaN` or `undefined`.
 */

Deno.test("parsePublisherSummary", async (t) => {
  await t.step("reads the well-formed case", () => {
    assertEquals(
      parsePublisherSummary({
        publisherName: "ada",
        fullName: "Ada Lovelace",
        adsSeen: 12,
        earningsMilliCents: 3400,
        slotCount: 2,
      }),
      {
        fullName: "Ada Lovelace",
        publisherName: "ada",
        adsSeen: 12,
        earningsMilliCents: 3400,
        slotCount: 2,
      },
    );
  });

  await t.step("treats a missing row as all-zero rather than null", async () => {
    // The RPC returns NULL when the publisher does not exist, which the
    // caller only ever gets for a publisher it just authenticated, so this is
    // a defensive answer - but it has to be *an* answer, and zero is the
    // right one: "0 ads seen" is a true statement, `null` would force every
    // renderer to invent its own placeholder.
    const expected = {
      fullName: null,
      publisherName: null,
      adsSeen: 0,
      earningsMilliCents: 0,
      slotCount: 0,
    };
    assertEquals(parsePublisherSummary(null), expected);
    assertEquals(parsePublisherSummary(undefined), expected);
    assertEquals(parsePublisherSummary("nonsense"), expected);
    assertEquals(parsePublisherSummary(7), expected);
  });

  await t.step("zeroes a counter that is not a usable number", () => {
    const parsed = parsePublisherSummary({
      fullName: "Ada",
      adsSeen: "twelve",
      earningsMilliCents: null,
      slotCount: NaN,
    });
    assertEquals(parsed.adsSeen, 0);
    assertEquals(parsed.earningsMilliCents, 0);
    assertEquals(parsed.slotCount, 0);
    // The name survives: one bad column must not blank the whole panel.
    assertEquals(parsed.fullName, "Ada");
  });

  await t.step("refuses a negative counter", () => {
    // A refund-shaped adjustment should not render as "-5 ads seen".
    assertEquals(parsePublisherSummary({ adsSeen: -5 }).adsSeen, 0);
  });

  await t.step("treats a blank name as absent", () => {
    // 000016 auto-creates publishers named "Untitled publisher", and a
    // whitespace-only full_name is not a name.
    assertEquals(parsePublisherSummary({ fullName: "   ", publisherName: "" }), {
      fullName: null,
      publisherName: null,
      adsSeen: 0,
      earningsMilliCents: 0,
      slotCount: 0,
    });
  });

  await t.step("accepts a zero, because zero is a real count", () => {
    const parsed = parsePublisherSummary({ adsSeen: 0, earningsMilliCents: 0, slotCount: 0 });
    assertEquals(parsed.adsSeen, 0);
    assertEquals(parsed.earningsMilliCents, 0);
    assertEquals(parsed.slotCount, 0);
  });
});
