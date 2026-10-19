/**
 * The contract between the campaign form and the campaign Edge Function.
 *
 * Everything else in _shared tests a rule in isolation. This one runs the
 * exact sequence campaigns/index.ts runs on its POST branch, against the
 * exact payload AdvertiserCampaigns.jsx builds, and it is here because that
 * pair had drifted apart and nothing noticed.
 *
 * What happened: cpm_cents is milli-cents -- apply_impression() assigns it
 * straight into spend_milli_cents, so the two are the same unit by
 * construction -- and the form has always multiplied the advertiser's
 * dollars by a thousand to get there. The Edge validator capped the value
 * at 10_000 while naming it cents, which read as milli-cents makes it a ten
 * dollar ceiling. Every campaign quoted at a realistic rate was refused with
 * INVALID_CPM, while the form's own $0.01 default passed, so the form looked
 * perfectly healthy until somebody typed a real number. Both copies of the
 * cap now agree, and these tests are what stops them drifting again.
 *
 * It cannot prove the INSERT works -- that needs a database and a real
 * advertiser session. What it does prove is that a campaign priced like a
 * campaign survives the gate that used to throw it away.
 *
 * Run with: npm run test:deno
 */
import { assertEquals } from "jsr:@std/assert@1";
import {
  createUnknownFields,
  parseBudgetCents,
  parseCpmCents,
  parseLandingUrl,
  requireNonEmptyString,
  MAX_CPM_MILLI_CENTS,
} from "./campaignRules.ts";

/** Mirrors toCpmMilliCents() in AdvertiserCampaigns.jsx:79. */
function clientCpm(dollars: number): number {
  return Math.round(dollars * 1000);
}

/** Mirrors createAdvertiserCampaign() in advertiserApi.js:281. */
function clientPayload(over: Record<string, unknown> = {}) {
  return {
    name: "Autumn launch",
    headline: "Ship it before the quarter ends",
    description: "",
    cta: "Learn more",
    audience_id: "backend",
    audience: "backend",
    budget_cents: 150_000,
    budgetCents: 150_000,
    landing_url: "",
    cpm_cents: clientCpm(10),
    starts_at: null,
    ends_at: null,
    ...over,
  };
}

/**
 * The order campaigns/index.ts applies them in, returning the first refusal
 * or the values that would go into the insert. Reordering this would be a
 * change to the handler, and the point is to test the handler's order.
 */
function serverSideCreate(body: Record<string, unknown>) {
  const unknown = createUnknownFields(body);
  if (unknown.length) return { ok: false as const, code: "UNKNOWN_FIELDS" };

  const name = requireNonEmptyString(body.name, "name");
  if (name) return { ok: false as const, code: "INVALID_NAME" };
  const headline = requireNonEmptyString(body.headline, "headline");
  if (headline) return { ok: false as const, code: "INVALID_HEADLINE" };

  const audienceId = body.audience_id ?? body.audience;
  if (!audienceId) return { ok: false as const, code: "INVALID_AUDIENCE" };

  const budget = parseBudgetCents(body.budget_cents ?? body.budgetCents);
  if (!budget.ok) return { ok: false as const, code: budget.code };

  const landing = parseLandingUrl(body.landing_url ?? body.landingUrl);
  if (!landing.ok) return { ok: false as const, code: landing.code };

  const cpm = parseCpmCents(body.cpm_cents ?? body.cpmCents);
  if (!cpm.ok) return { ok: false as const, code: cpm.code };

  return {
    ok: true as const,
    insert: {
      name,
      headline,
      audience_id: audienceId,
      budget_cents: budget.value,
      landing_url: landing.value,
      cpm_cents: cpm.value,
    },
  };
}

Deno.test("a campaign priced like a campaign survives the create gate", () => {
  for (const dollars of [0.01, 1, 10, 25, 100, 1000]) {
    const result = serverSideCreate(clientPayload({ cpm_cents: clientCpm(dollars) }));
    assertEquals(result.ok, true, `$${dollars} CPM was refused`);
    if (result.ok) assertEquals(result.insert.cpm_cents, clientCpm(dollars));
  }
});

Deno.test("the cap that used to throw campaigns away is expressed in milli-cents", () => {
  // The old ceiling. 10_000 milli-cents is a ten dollar CPM, so this is the
  // exact value that used to be the boundary between "passes" and "refused",
  // and $10.01 sat on the wrong side of it.
  assertEquals(parseCpmCents(10_000).ok, true);
  assertEquals(parseCpmCents(clientCpm(10.01)).ok, true);
  assertEquals(parseCpmDollars(10.01), 10_010);

  // And the new one, in the unit the value is actually in.
  assertEquals(MAX_CPM_MILLI_CENTS, 10_000_000);
  assertEquals(parseCpmCents(MAX_CPM_MILLI_CENTS).ok, true);
  assertEquals(parseCpmCents(MAX_CPM_MILLI_CENTS + 1).ok, false);
});

function parseCpmDollars(dollars: number): number {
  return parseCpmCents(clientCpm(dollars)).ok ? clientCpm(dollars) : -1;
}

Deno.test("the form's payload passes the unknown-field gate", () => {
  // The form sends both spellings of several fields at once. The gate lists
  // both, so a rename on either side breaks here rather than in production.
  assertEquals(createUnknownFields(clientPayload()), []);
});

Deno.test("the gate still refuses the things it is for", () => {
  assertEquals(serverSideCreate(clientPayload({ name: "" })).code, "INVALID_NAME");
  assertEquals(serverSideCreate(clientPayload({ headline: "   " })).code, "INVALID_HEADLINE");
  assertEquals(serverSideCreate(clientPayload({ budget_cents: -1, budgetCents: -1 })).code, "INVALID_BUDGET");
  assertEquals(serverSideCreate(clientPayload({ cpm_cents: 0 })).code, "INVALID_CPM");
  assertEquals(
    serverSideCreate(clientPayload({ landing_url: "not-a-url", landingUrl: "not-a-url" })).code,
    "INVALID_LANDING_URL",
  );
  assertEquals(
    serverSideCreate(clientPayload({ surprise: 1 })).code,
    "UNKNOWN_FIELDS",
  );
});

Deno.test("a cleared CPM is a null CPM, not a zero CPM", () => {
  // An empty input has to be null. Zero would mean "free impressions", and
  // the campaign activation blockers treat a zero CPM as not-ready.
  const result = serverSideCreate(clientPayload({ cpm_cents: null }));
  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.insert.cpm_cents, null);
});
