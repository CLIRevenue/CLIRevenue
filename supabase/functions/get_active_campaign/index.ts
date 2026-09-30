import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";
import { apiError, json, optionsResponse } from "../_shared/http.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "GET") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }
  try {
    const admin = adminClient();
    const { data: settings, error: settingsError } = await admin
      .from("platform_settings")
      .select("active_campaign_id")
      .maybeSingle();
    if (settingsError) {
      return apiError("INTERNAL_ERROR", "Failed to fetch platform settings.", 500);
    }
    if (!settings?.active_campaign_id) {
      return apiError("CAMPAIGN_NOT_FOUND", "No active campaign set.", 404);
    }
    const { data: campaign, error: campaignError } = await admin
      .from("campaigns")
      .select(
        "id, name, headline, description, cta, audience_id, budget_cents, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, starts_at, ends_at, created_at, updated_at",
      )
      .eq("id", settings.active_campaign_id)
      .maybeSingle();
    if (campaignError || !campaign) {
      return apiError("CAMPAIGN_NOT_FOUND", "Active campaign not found.", 404);
    }
    const servable =
      campaign.status === "active" &&
      (campaign.starts_at == null || new Date(campaign.starts_at).getTime() <= Date.now()) &&
      (campaign.ends_at == null || new Date(campaign.ends_at).getTime() >= Date.now()) &&
      campaign.spend_milli_cents < campaign.budget_cents * 1000;
    if (!servable) {
      return apiError("CAMPAIGN_NOT_SERVABLE", "The selected campaign is not eligible to serve.", 404);
    }
    const { data: audience } = await admin
      .from("audiences")
      .select("label")
      .eq("id", campaign.audience_id)
      .maybeSingle();
    const spendCents = Math.floor(campaign.spend_milli_cents / 1000);
    return json({
      id: campaign.id,
      name: campaign.name,
      headline: campaign.headline,
      description: campaign.description,
      cta: campaign.cta,
      audience_id: campaign.audience_id,
      audience: audience?.label || campaign.audience_id,
      budgetCents: campaign.budget_cents,
      spendCents,
      impressions: campaign.impressions_count,
      clicks: campaign.clicks_count,
      conversions: campaign.conversions_count,
      status: campaign.status,
      createdAt: campaign.created_at,
      updatedAt: campaign.updated_at,
    });
  } catch (err) {
    console.error(err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});
