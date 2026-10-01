/**
 * get_active_campaign — public ad delivery read.
 *
 * This is the delivery surface the SDK will consume, so it stays
 * unauthenticated (deploy with `--no-verify-jwt`, since the gateway
 * otherwise rejects anonymous callers before the handler runs) and it is
 * CORS-open.
 *
 * Two things it must not do:
 *   1. Leak advertiser accounting. It used to return budget_cents,
 *      spend_milli_cents and the impression/click/conversion counters to
 *      any caller. Delivery needs a creative and an eligibility verdict,
 *      not the advertiser's ledger, so the payload is now limited to the
 *      creative plus the identity needed to render an honest label.
 *   2. Fill when the campaign is not eligible. Eligibility (status,
 *      schedule, remaining budget, optional audience match) is decided
 *      here, server-side, and every failure returns the same generic
 *      no-fill response so callers cannot probe another advertiser's
 *      state. No-fill cases: draft, pending_review, rejected, paused,
 *      completed, archived, before starts_at, after ends_at, over budget,
 *      audience mismatch, or no eligible campaign.
 *
 * Selection is over the eligible *set*, not a single global pointer. A
 * platform-wide `active_campaign_id` made the last advertiser to press
 * "select" decide what every publisher on the network saw; eligibility now
 * lives on the campaign row it describes, and the pointer is gone (see
 * docs/MULTI_TENANT_CAMPAIGN_SELECTION.md). Ordering is created_at, then id:
 * stable, so identical requests resolve identically, and deterministic, so
 * nothing about delivery depends on shared state. Fairness/rotation/bidding
 * are deliberately out of scope for MVP.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient } from "../_shared/auth.ts";
import { apiError, corsFor, json, optionsResponse } from "../_shared/http.ts";
import { CANDIDATE_WINDOW, pickEligible } from "../_shared/eligibility.ts";

function noFill(req?: Request): Response {
  // A no-fill is a normal delivery outcome, not an exceptional one. The
  // publisher has to be able to read it, so it carries the real request's
  // origin rather than the first allow-listed one.
  return apiError("NO_FILL", "No campaign is eligible for this request.", 404, {}, req);
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }

  try {
    const url = new URL(req.url);
    const requestedAudience = url.searchParams.get("audience");

    /*
     * There is deliberately no `campaign_id` parameter here any more.
     *
     * It was an optional filter that let any caller pin delivery to one
     * specific advertiser's campaign. It could not spend money -- this
     * endpoint records no impression, and impressions are only accepted
     * through ads/impression against a signed serve record -- but it let a
     * third party target and enumerate individual campaigns, which is exactly
     * "the client chooses the campaign" that the serve-record architecture
     * exists to prevent. Audience stays: it is a targeting hint, not a
     * pointer at a particular advertiser.
     */

    const admin = adminClient();
    let query = admin
      .from("campaigns")
      .select(
        "id, name, headline, description, cta, audience_id, status, starts_at, ends_at, budget_cents, spend_milli_cents",
      )
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CANDIDATE_WINDOW);
    if (requestedAudience) query = query.eq("audience_id", requestedAudience);

    const { data: candidates, error: candidatesError } = await query;
    if (candidatesError) {
      console.error("get_active_campaign query failed:", candidatesError.message);
      return apiError("INTERNAL_ERROR", "Delivery is unavailable.", 500, {}, req);
    }

    const now = Date.now();
    // Generic T is inferred from the row type, so the selected campaign keeps
    // its name/headline/cta/audience fields for the delivery payload below.
    const campaign = pickEligible(candidates ?? [], now);
    if (!campaign) return noFill(req);

    const { data: audience } = await admin
      .from("audiences")
      .select("label")
      .eq("id", campaign.audience_id)
      .maybeSingle();

    // Delivery payload only: no budget, spend, or counters.
    const body = JSON.stringify({
      id: campaign.id,
      name: campaign.name,
      headline: campaign.headline,
      description: campaign.description,
      cta: campaign.cta,
      audience_id: campaign.audience_id,
      audience: audience?.label ?? campaign.audience_id,
      simulated: false,
    });

    return new Response(body, {
      status: 200,
      headers: {
        ...corsFor(req),
        "Content-Type": "application/json",
        // A fill decision is per-request; never cache it.
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("get_active_campaign error:", err instanceof Error ? err.message : err);
    return json({ error: { code: "INTERNAL_ERROR", message: "Delivery is unavailable." } }, 500, req);
  }
});

serve(handler);
