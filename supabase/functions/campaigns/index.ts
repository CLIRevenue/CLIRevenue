import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireAdvertiser } from "../_shared/auth.ts";
import {
  activationBlockerMessage,
  canTransition,
  createUnknownFields,
  isCampaignStatus,
  parseBudgetCents,
  parseCpmCents,
  parseLandingUrl,
  patchUnknownFields,
  requireNonEmptyString,
} from "../_shared/campaignRules.ts";
import { apiError, isUuid, json, optionsResponse, restPath } from "../_shared/http.ts";

type AudienceRow = { id: string; label: string };
type CreativeRow = Record<string, unknown>;

/* Routing note: the gateway hands the function the path it was invoked
   on, so `/functions/v1/campaigns/...`, `/campaigns/...` and the legacy
   `/api/campaigns/...` all have to resolve identically. restPath() does
   that; assuming a stripped prefix made every real request 400 with
   "Malformed campaign id". */

function formatCampaign(
  row: Record<string, unknown>,
  audienceMap: Record<string, string>,
  creative: CreativeRow | null = null,
) {
  const audienceId = String(row.audience_id || "");
  const spendMilli = Number(row.spend_milli_cents || 0);
  const budgetCents = Number(row.budget_cents || 0);
  const spendCents = Math.floor(spendMilli / 1000);
  return {
    id: row.id,
    advertiser_id: row.advertiser_id,
    name: row.name,
    headline: row.headline,
    description: row.description,
    cta: row.cta,
    audience_id: audienceId,
    audienceId,
    audience: audienceMap[audienceId] || audienceId,
    budget_cents: budgetCents,
    budgetCents,
    cpm_cents: row.cpm_cents ?? null,
    cpmCents: row.cpm_cents ?? null,
    landing_url: row.landing_url ?? null,
    landingUrl: row.landing_url ?? null,
    spend_milli_cents: spendMilli,
    spend_cents: spendCents,
    spendCents,
    remaining_budget_cents: Math.max(0, budgetCents - spendCents),
    remainingBudgetCents: Math.max(0, budgetCents - spendCents),
    impressions_count: row.impressions_count,
    impressions: row.impressions_count,
    clicks_count: row.clicks_count,
    clicks: row.clicks_count,
    conversions_count: row.conversions_count,
    conversions: row.conversions_count,
    status: row.status,
    starts_at: row.starts_at ?? null,
    ends_at: row.ends_at ?? null,
    /* Creative summary only. The playable URL is deliberately absent here:
       it is minted only by the creatives endpoint (and at delivery time)
       from a short-lived signature. This keeps listing cheap and means a
       campaign list response can never leak a durable object URL. */
    creative: creative ? formatCreativeSummary(creative) : null,
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
    simulated: false,
  };
}

function formatCreativeSummary(row: CreativeRow) {
  return {
    id: row.id ?? null,
    status: row.status ?? "pending",
    media_type: row.media_type ?? null,
    mediaType: row.media_type ?? null,
    mime_type: row.mime_type ?? null,
    mimeType: row.mime_type ?? null,
    file_size_bytes: row.file_size_bytes ?? null,
    fileSizeBytes: row.file_size_bytes ?? null,
    width: row.width ?? null,
    height: row.height ?? null,
    duration_ms: row.duration_ms ?? null,
    durationMs: row.duration_ms ?? null,
    label: row.label ?? null,
    updated_at: row.updated_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

const SELECT_COLS =
  "id, advertiser_id, name, headline, description, cta, audience_id, budget_cents, cpm_cents, landing_url, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, starts_at, ends_at, created_at, updated_at";

const CREATIVE_COLS =
  "id, campaign_id, advertiser_id, status, media_type, mime_type, file_size_bytes, extension, width, height, duration_ms, poster_object_key, checksum, label, created_at, updated_at";

async function audienceMap(admin: ReturnType<typeof adminClient>) {
  const { data } = await admin.from("audiences").select("id, label");
  return Object.fromEntries((data as AudienceRow[] | null || []).map((a) => [a.id, a.label]));
}

/* One slot per campaign (000021 minted it with a UNIQUE campaign_id). Reads
   are scoped by advertiser_id so a cross-tenant id can never resolve, and the
   query shape mirrors the ownership rule the write paths use. */
async function creativeByCampaign(
  admin: ReturnType<typeof adminClient>,
  campaignIds: string[],
  advertiserId: string,
) {
  if (campaignIds.length === 0) return new Map<string, CreativeRow>();
  const { data, error } = await admin
    .from("campaign_creatives")
    .select(CREATIVE_COLS)
    .eq("advertiser_id", advertiserId)
    .in("campaign_id", campaignIds);
  if (error) return new Map<string, CreativeRow>();
  const map = new Map<string, CreativeRow>();
  for (const row of (data as unknown as CreativeRow[] | null || [])) {
    map.set(String(row.campaign_id), row);
  }
  return map;
}

/* Activation gate. campaign_activation_blockers() is a SECURITY DEFINER RPC
   so the rules live next to the columns they read; the browser cannot call it
   and cannot skip it, because this is the only path that writes 'active'. */
async function activationBlockers(
  admin: ReturnType<typeof adminClient>,
  campaignId: string,
) {
  const { data, error } = await admin.rpc("campaign_activation_blockers", {
    p_campaign_id: campaignId,
  });
  if (error) {
    return {
      failed: true as const,
      response: apiError("INTERNAL_ERROR", "Could not validate campaign.", 500),
    };
  }
  const list = Array.isArray(data) ? data.map((c) => String(c)) : [];
  return { failed: false as const, blockers: list };
}

async function loadOwnedCampaign(
  admin: ReturnType<typeof adminClient>,
  campaignId: string,
  advertiserId: string,
) {
  const { data, error } = await admin
    .from("campaigns")
    .select(SELECT_COLS)
    .eq("id", campaignId)
    .eq("advertiser_id", advertiserId)
    .maybeSingle();
  if (error) return { error: apiError("INTERNAL_ERROR", "Could not load campaign.", 500) };
  if (!data) return { error: apiError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404) };
  return { campaign: data };
}

async function archiveCampaign(
  admin: ReturnType<typeof adminClient>,
  campaign: Record<string, unknown>,
  advertiserId: string,
) {
  if (campaign.status === "archived") return { campaign };
  if (!canTransition(campaign.status as "draft", "archived")) {
    return {
      error: apiError(
        "INVALID_STATUS_TRANSITION",
        `Cannot archive a campaign in status "${campaign.status}".`,
        400,
      ),
    };
  }
  const { data, error } = await admin
    .from("campaigns")
    .update({ status: "archived" })
    .eq("id", campaign.id)
    .eq("advertiser_id", advertiserId)
    .select(SELECT_COLS)
    .single();
  if (error) return { error: apiError("INTERNAL_ERROR", "Could not archive campaign.", 500) };
  return { campaign: data };
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const adv = await requireAdvertiser(admin, authed.user!.id);
  if ("error" in adv && adv.error) return adv.error;
  const advertiserId = adv.advertiser!.id;
  const rest = restPath(new URL(req.url).pathname, "campaigns");
  const method = req.method;

  try {
    if (method === "GET" && rest.length === 0) {
      const { data, error } = await admin
        .from("campaigns")
        .select(SELECT_COLS)
        .eq("advertiser_id", advertiserId)
        .order("created_at", { ascending: false });
      if (error) return apiError("INTERNAL_ERROR", "Failed to fetch campaigns.", 500);
      const map = await audienceMap(admin);
      const rows = (data || []) as Record<string, unknown>[];
      const creatives = await creativeByCampaign(
        admin,
        rows.map((r) => String(r.id)),
        advertiserId,
      );
      const campaigns = rows.map((row) =>
        formatCampaign(row, map, creatives.get(String(row.id)) || null)
      );
      return json({ campaigns });
    }

    if (method === "POST" && rest.length === 0) {
      let body: Record<string, unknown>;
      try {
        body = await req.json();
      } catch {
        return apiError("INVALID_EVENT", "JSON body required.", 400);
      }
      const unknown = createUnknownFields(body);
      if (unknown.length) {
        return apiError("UNKNOWN_FIELDS", `Unsupported fields: ${unknown.join(", ")}.`, 400);
      }
      const nameErr = requireNonEmptyString(body.name, "name");
      const headlineErr = requireNonEmptyString(body.headline, "headline");
      if (nameErr) return apiError("MISSING_FIELDS", "Campaign name is required.", 400);
      if (headlineErr) return apiError("MISSING_FIELDS", "Headline is required.", 400);
      const audienceId = body.audience_id ?? body.audience;
      if (typeof audienceId !== "string" || !audienceId.trim()) {
        return apiError("INVALID_AUDIENCE", "Select an audience.", 400);
      }
      const budgetRaw = body.budget_cents ?? body.budgetCents;
      const budget = parseBudgetCents(budgetRaw);
      if (!budget.ok) return apiError(budget.code, budget.message, 400);

      const { data: audience, error: audErr } = await admin
        .from("audiences")
        .select("id")
        .eq("id", audienceId)
        .maybeSingle();
      if (audErr) return apiError("INTERNAL_ERROR", "Could not validate audience.", 500);
      if (!audience) return apiError("INVALID_AUDIENCE", "Select an audience.", 400);

      const landing = parseLandingUrl(body.landing_url ?? body.landingUrl);
      if (!landing.ok) return apiError(landing.code, landing.message, 400);
      const cpm = parseCpmCents(body.cpm_cents ?? body.cpmCents);
      if (!cpm.ok) return apiError(cpm.code, cpm.message, 400);

      const insert = {
        advertiser_id: advertiserId,
        name: String(body.name).trim(),
        headline: String(body.headline).trim(),
        description: body.description == null ? null : String(body.description),
        cta: body.cta ? String(body.cta) : "Learn more",
        audience_id: audienceId,
        budget_cents: budget.value,
        cpm_cents: cpm.value,
        landing_url: landing.value,
        spend_milli_cents: 0,
        impressions_count: 0,
        clicks_count: 0,
        conversions_count: 0,
        status: "draft",
        starts_at: body.starts_at ?? null,
        ends_at: body.ends_at ?? null,
      };
      const { data: created, error: insertError } = await admin
        .from("campaigns")
        .insert([insert])
        .select(SELECT_COLS)
        .single();
      if (insertError) return apiError("INTERNAL_ERROR", "Campaign could not be created.", 500);
      const map = await audienceMap(admin);
      const creatives = await creativeByCampaign(
        admin,
        [String((created as unknown as Record<string, unknown>).id)],
        advertiserId,
      );
      const createdRow = created as unknown as Record<string, unknown>;
      return json(
        {
          campaign: formatCampaign(
            createdRow,
            map,
            creatives.get(String(createdRow.id)) || null,
          ),
        },
        201,
      );
    }

    if (rest.length >= 1) {
      const campaignId = rest[0];
      if (!isUuid(campaignId)) {
        return apiError("INVALID_ID", "Malformed campaign id.", 400);
      }
      const loaded = await loadOwnedCampaign(admin, campaignId, advertiserId);
      if ("error" in loaded && loaded.error) return loaded.error;
      const existing = loaded.campaign!;

      if (method === "GET" && rest.length === 1) {
        const map = await audienceMap(admin);
        const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
        return json({ campaign: formatCampaign(existing, map, creatives.get(campaignId) || null) });
      }

      if (method === "DELETE" && rest.length === 1) {
        const result = await archiveCampaign(admin, existing, advertiserId);
        if ("error" in result && result.error) return result.error;
        const map = await audienceMap(admin);
        const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
        return json({
          campaign: formatCampaign(
            result.campaign!,
            map,
            creatives.get(campaignId) || null,
          ),
          archived: true,
        });
      }

      if (method === "POST" && rest.length === 2 && rest[1] === "archive") {
        const result = await archiveCampaign(admin, existing, advertiserId);
        if ("error" in result && result.error) return result.error;
        const map = await audienceMap(admin);
        const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
        return json({
          campaign: formatCampaign(
            result.campaign!,
            map,
            creatives.get(campaignId) || null,
          ),
          archived: true,
        });
      }

      if (method === "POST" && rest.length === 2 && rest[1] === "select") {
        /* Selection is local UI state. This used to write the single
           global platform_settings.active_campaign_id, which meant the
           last advertiser to press "select" decided what every publisher
           on the network was served — one advertiser's click on their own
           campaign changed what another advertiser's campaign could be
           delivered as. There is no shared pointer to write any more; the
           row this reaches has already been resolved through
           loadOwnedCampaign, so the caller's ownership is proven and the
           request has no cross-tenant effect. Kept as a route so stale
           callers get a correct answer instead of a 404. */
        const map = await audienceMap(admin);
        const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
        return json({
          campaign: formatCampaign(existing, map, creatives.get(campaignId) || null),
          selected: true,
          global: false,
        });
      }

      if (method === "PATCH" && rest.length === 1) {
        let body: Record<string, unknown>;
        try {
          body = await req.json();
        } catch {
          return apiError("INVALID_EVENT", "JSON body required.", 400);
        }
        const unknown = patchUnknownFields(body);
        if (unknown.length) {
          return apiError("UNKNOWN_FIELDS", `Cannot update: ${unknown.join(", ")}.`, 400);
        }

        const filtered: Record<string, unknown> = {};
        if (body.name !== undefined) {
          const err = requireNonEmptyString(body.name, "name");
          if (err) return apiError("MISSING_FIELDS", "Campaign name is required.", 400);
          filtered.name = String(body.name).trim();
        }
        if (body.headline !== undefined) {
          const err = requireNonEmptyString(body.headline, "headline");
          if (err) return apiError("MISSING_FIELDS", "Headline is required.", 400);
          filtered.headline = String(body.headline).trim();
        }
        if (body.description !== undefined) filtered.description = body.description;
        if (body.cta !== undefined) filtered.cta = body.cta;
        if (body.starts_at !== undefined) filtered.starts_at = body.starts_at;
        if (body.ends_at !== undefined) filtered.ends_at = body.ends_at;
        const audienceId = body.audience_id ?? body.audience;
        if (audienceId !== undefined) {
          if (typeof audienceId !== "string" || !audienceId.trim()) {
            return apiError("INVALID_AUDIENCE", "Select an audience.", 400);
          }
          const { data: audience, error: audErr } = await admin
            .from("audiences")
            .select("id")
            .eq("id", audienceId)
            .maybeSingle();
          if (audErr) return apiError("INTERNAL_ERROR", "Could not validate audience.", 500);
          if (!audience) return apiError("INVALID_AUDIENCE", "Select an audience.", 400);
          filtered.audience_id = audienceId;
        }
        if (body.budget_cents !== undefined || body.budgetCents !== undefined) {
          const budget = parseBudgetCents(body.budget_cents ?? body.budgetCents);
          if (!budget.ok) return apiError(budget.code, budget.message, 400);
          filtered.budget_cents = budget.value;
        }
        if (body.landing_url !== undefined || body.landingUrl !== undefined) {
          const landing = parseLandingUrl(body.landing_url ?? body.landingUrl);
          if (!landing.ok) return apiError(landing.code, landing.message, 400);
          filtered.landing_url = landing.value;
        }
        if (body.cpm_cents !== undefined || body.cpmCents !== undefined) {
          const cpm = parseCpmCents(body.cpm_cents ?? body.cpmCents);
          if (!cpm.ok) return apiError(cpm.code, cpm.message, 400);
          filtered.cpm_cents = cpm.value;
        }
        if (body.status !== undefined) {
          if (!isCampaignStatus(body.status)) {
            return apiError("INVALID_STATUS", "Unsupported campaign status.", 400);
          }
          if (!canTransition(existing.status, body.status)) {
            return apiError(
              "INVALID_STATUS_TRANSITION",
              `Cannot change status from "${existing.status}" to "${body.status}".`,
              400,
            );
          }
          if (body.status === "active" && existing.status !== "active") {
            /* Every other rule the gate needs is evaluated in one place, so
               the check and the accounting RPCs can never disagree. Apply the
               field edits first: activating and fixing a missing landing URL
               in the same request has to be possible, and it must be judged on
               the values the campaign will actually go live with. */
            const pending = { ...filtered };
            if (Object.keys(pending).length > 0) {
              const { data: probe, error: probeError } = await admin
                .from("campaigns")
                .update(pending)
                .eq("id", campaignId)
                .eq("advertiser_id", advertiserId)
                .select(SELECT_COLS)
                .maybeSingle();
              if (probeError || !probe) {
                return apiError("INTERNAL_ERROR", "Failed to update campaign.", 500);
              }
            }
            const blockers = await activationBlockers(admin, campaignId);
            if (blockers.failed) return blockers.response;
            if (blockers.blockers.length) {
              return apiError(
                "CAMPAIGN_NOT_ACTIVATABLE",
                activationBlockerMessage(blockers.blockers[0]),
                400,
                { blockers: blockers.blockers },
              );
            }
            filtered.status = "active";
          } else {
            filtered.status = body.status;
          }
        }

        if (Object.keys(filtered).length === 0) {
          const map = await audienceMap(admin);
          const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
          return json({
            campaign: formatCampaign(existing, map, creatives.get(campaignId) || null),
          });
        }

        const { data: updated, error: updateError } = await admin
          .from("campaigns")
          .update(filtered)
          .eq("id", campaignId)
          .eq("advertiser_id", advertiserId)
          .select(SELECT_COLS)
          .single();
        if (updateError) return apiError("INTERNAL_ERROR", "Failed to update campaign.", 500);
        const map = await audienceMap(admin);
        const creatives = await creativeByCampaign(admin, [campaignId], advertiserId);
        const updatedRow = updated as unknown as Record<string, unknown>;
        return json({ campaign: formatCampaign(updatedRow, map, creatives.get(campaignId) || null) });
      }
    }

    return apiError("NOT_FOUND", "Not found.", 404);
  } catch (err) {
    console.error(err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
