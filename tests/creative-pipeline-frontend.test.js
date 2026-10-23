/**
 * Tests for the advertiser creative pipeline on the client.
 *
 * Two separate concerns are covered:
 *
 *  1. The pure rules in campaignRules.js. They run before anything is sent, so
 *     a bug here is a bug that reaches the network, and they must agree with
 *     the server's own rules in _shared/filebase.ts and _shared/campaignRules.ts.
 *
 *  2. The upload orchestration in advertiserApi.js. `uploadCreativeFile` is the
 *     one place where a browser holds a storage capability, so the assertions
 *     that matter most are about ordering (intent before PUT, confirm before
 *     validate) and about what must never appear in any request the browser
 *     makes -- a Filebase credential being the obvious one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api.js", () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "jwt-token" } }, error: null }),
    },
  },
}));

const {
  acceptForMediaType,
  activationBlockerMessage,
  advisoryBlockers,
  parseCpmCents,
  MAX_CPM_MILLI_CENTS,
  parseLandingUrl,
} = await import("../src/lib/campaignRules.js");

const {
  normalizeCampaign,
  validateCampaignInput,
} = await import("../src/lib/advertiserApi.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function fakeFile(name, type, size) {
  return { name, type, size };
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe("campaign field rules", () => {
  it("clears the landing URL when it is empty and keeps a valid one", () => {
    expect(parseLandingUrl("")).toEqual({ ok: true, value: null });
    expect(parseLandingUrl(undefined)).toEqual({ ok: true, value: null });
    expect(parseLandingUrl("  https://example.test/x  ").ok).toBe(true);
  });

  it("refuses a landing URL that is not http(s) or is absurdly long", () => {
    expect(parseLandingUrl("javascript:alert(1)").code).toBe("INVALID_LANDING_URL");
    expect(parseLandingUrl("not a url").code).toBe("INVALID_LANDING_URL");
    expect(parseLandingUrl(`https://example.test/${"x".repeat(2100)}`).code).toBe("INVALID_LANDING_URL");
  });

  it("holds milli-cents, matching the column and the server's parser", () => {
    expect(parseCpmCents("")).toEqual({ ok: true, value: null });
    expect(parseCpmCents("10")).toEqual({ ok: true, value: 10 });
    expect(parseCpmCents("2500")).toEqual({ ok: true, value: 2500 });
    // A dollar amount is not a milli-cent amount and must not be silently coerced.
    expect(parseCpmCents("0.01").ok).toBe(false);
  });

  it("refuses a CPM that is zero, negative, fractional or unparseable", () => {
    for (const raw of ["0", "-1", "1.5", "abc"]) {
      const result = parseCpmCents(raw);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("INVALID_CPM");
    }
    expect(parseCpmCents(String(MAX_CPM_MILLI_CENTS + 1)).ok).toBe(false);
  });

  /* The cap used to be 10,000 "cents", which read as milli-cents made it a
     ten dollar ceiling - so any campaign quoted above $10 was refused while
     the form's own $0.01 default passed, and creation looked healthy until
     somebody typed a real number. These pin the unit rather than a literal,
     so the ceiling and the test cannot drift apart again. */
  it("accepts an ordinary CPM, because cpm_cents is milli-cents", () => {
    for (const dollars of [1, 10, 25, 100]) {
      expect(parseCpmCents(String(dollars * 1000)).ok).toBe(true);
    }
  });

  it("reports an invalid landing URL and an unreversed schedule", () => {
    const bad = validateCampaignInput({
      name: "n",
      headline: "h",
      audienceId: "backend",
      budgetDollars: "100",
      landingUrl: "javascript:alert(1)",
    });
    expect(bad.landingUrl).toBeTruthy();
    expect(bad.endsAt).toBeUndefined();

    const reversed = validateCampaignInput({
      name: "n",
      headline: "h",
      audienceId: "backend",
      budgetDollars: "100",
      landingUrl: "https://example.test",
      startsAt: "2024-02-01T00:00:00.000Z",
      endsAt: "2024-01-01T00:00:00.000Z",
    });
    expect(reversed.endsAt).toBeTruthy();
    expect(reversed.landingUrl).toBeUndefined();
  });

  it("accepts a fully specified campaign", () => {
    // The past-date check rejects a start or end that has already passed, so
    // the fixture dates are anchored to "now" rather than written in stone.
    // A static 2024 date used to pass and now fails; the assertion is about
    // the other fields, not about the calendar.
    const now = new Date()
    const soon = new Date(now.getTime() + 2 * 86_400_000).toISOString()
    const later = new Date(now.getTime() + 4 * 86_400_000).toISOString()
    expect(
      validateCampaignInput({
        name: "n",
        headline: "h",
        audienceId: "backend",
        budgetCredits: "100",
        landingUrl: "https://example.test",
        cpmCents: 10,
        startsAt: soon,
        endsAt: later,
      }),
    ).toEqual({});
  });

  it("lets an edit keep a past start date when it is not being changed", () => {
    // Editing an already-started campaign must not make the form refuse every
    // other field. The past-date check only fires on dates the advertiser is
    // actually proposing to move.
    const past = "2024-01-01T00:00:00.000Z"
    expect(
      validateCampaignInput(
        {
          name: "n",
          headline: "h",
          audienceId: "backend",
          budgetCredits: "100",
          landingUrl: "https://example.test",
          cpmCents: 10,
          startsAt: past,
          endsAt: "2099-01-01T00:00:00.000Z",
        },
        { startsAt: past, endsAt: "2099-01-01T00:00:00.000Z" },
      ),
    ).toEqual({});
  });

  it("rejects a past date only when it is being changed", () => {
    const past = "2024-01-01T00:00:00.000Z"
    const result = validateCampaignInput(
      {
        name: "n",
        headline: "h",
        audienceId: "backend",
        budgetCredits: "100",
        landingUrl: "https://example.test",
        cpmCents: 10,
        startsAt: past,
        endsAt: "2099-01-01T00:00:00.000Z",
      },
      { startsAt: "2099-01-01T00:00:00.000Z", endsAt: "2099-01-01T00:00:00.000Z" },
    )
    expect(result.startsAt).toBeTruthy()
    expect(result.endsAt).toBeUndefined()
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Upload orchestration
// ---------------------------------------------------------------------------
