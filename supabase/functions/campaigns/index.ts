import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, getJwtUser, requireAdvertiser } from "../_shared/auth.ts";
import {
  canTransition,
  createUnknownFields,
  isCampaignStatus,
  parseBudgetCents,
  patchUnknownFields,
  requireNonEmptyString,
} from "../_shared/campaignRules.ts";
import { apiError, isUuid, json, optionsResponse } from "../_shared/http.ts";

type AudienceRow = { id: string; label: string };

function parsePath(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "campaigns") parts.shift();
  if (parts[0] === "api" && parts[1] === "campaigns") {
    parts.splice(0, 2);
  } else if (parts[0] === "api") {
    parts.shift();
  }
  return parts;
}

function formatCampaign(row: Record<string, unknown>, audienceMap: Record<string, string>) {
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
    created_at: row.created_at,
    createdAt: row.created_at,
    updated_at: row.updated_at,
    updatedAt: row.updated_at,
    simulated: false,
  };
}

const SELECT_COLS =
  "id, advertiser_id, name, headline, description, cta, audience_id, budget_cents, cpm_cents, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, starts_at, ends_at, created_at, updated_at";

async function audienceMap(admin: ReturnType<typeof adminClient>) {
  const { data } = await admin.from("audiences").select("id, label");
  return Object.fromEntries((data as AudienceRow[] | null || []).map((a) => [a.id, a.label]));
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

serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const adv = await requireAdvertiser(admin, authed.user!.id);
  if ("error" in adv && adv.error) return adv.error;
  const advertiserId = adv.advertiser!.id;
  const rest = parsePath(new URL(req.url).pathname);
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
      const campaigns = (data || []).map((row) => formatCampaign(row, map));
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

      const insert = {
        advertiser_id: advertiserId,
        name: String(body.name).trim(),
        headline: String(body.headline).trim(),
        description: body.description == null ? null : String(body.description),
        cta: body.cta ? String(body.cta) : "Learn more",
        audience_id: audienceId,
        budget_cents: budget.value,
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
      return json({ campaign: formatCampaign(created, map) }, 201);
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
        return json({ campaign: formatCampaign(existing, map) });
      }

      if (method === "DELETE" && rest.length === 1) {
        const result = await archiveCampaign(admin, existing, advertiserId);
        if ("error" in result && result.error) return result.error;
        const map = await audienceMap(admin);
        return json({ campaign: formatCampaign(result.campaign!, map), archived: true });
      }

      if (method === "POST" && rest.length === 2 && rest[1] === "archive") {
        const result = await archiveCampaign(admin, existing, advertiserId);
        if ("error" in result && result.error) return result.error;
        const map = await audienceMap(admin);
        return json({ campaign: formatCampaign(result.campaign!, map), archived: true });
      }

      if (method === "POST" && rest.length === 2 && rest[1] === "select") {
        const { data: settings, error: settingsError } = await admin
          .from("platform_settings")
          .select("id")
          .maybeSingle();
        if (settingsError || !settings) {
          return apiError("INTERNAL_ERROR", "Could not update active campaign.", 500);
        }
        const { data: updated, error: updateError } = await admin
          .from("platform_settings")
          .update({ active_campaign_id: campaignId })
          .eq("id", settings.id)
          .select("active_campaign_id")
          .single();
        if (updateError) return apiError("INTERNAL_ERROR", "Could not update active campaign.", 500);
        return json({ active_campaign_id: updated.active_campaign_id });
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
          const nextBudget = (filtered.budget_cents as number | undefined) ?? existing.budget_cents;
          if (body.status === "active" && existing.status !== "active" && nextBudget <= 0) {
            return apiError("INVALID_BUDGET", "Budget must be greater than 0 to activate.", 400);
          }
          filtered.status = body.status;
        }

        if (Object.keys(filtered).length === 0) {
          const map = await audienceMap(admin);
          return json({ campaign: formatCampaign(existing, map) });
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
        return json({ campaign: formatCampaign(updated, map) });
      }
    }

    return apiError("NOT_FOUND", "Not found.", 404);
  } catch (err) {
    console.error(err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});
