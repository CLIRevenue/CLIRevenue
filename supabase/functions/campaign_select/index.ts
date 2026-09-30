import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, getJwtUser, requireAdvertiser } from "../_shared/auth.ts";
import { apiError, isUuid, json, optionsResponse } from "../_shared/http.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }
  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const adv = await requireAdvertiser(admin, authed.user!.id);
  if ("error" in adv && adv.error) return adv.error;

  const parts = new URL(req.url).pathname.split("/").filter(Boolean);
  const selectAt = parts.lastIndexOf("select");
  const campaignId = selectAt > 0 ? parts[selectAt - 1] : "";
  if (!isUuid(campaignId)) {
    return apiError("INVALID_ID", "Malformed campaign id.", 400);
  }

  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("id, advertiser_id")
    .eq("id", campaignId)
    .eq("advertiser_id", adv.advertiser!.id)
    .maybeSingle();
  if (campaignError) return apiError("INTERNAL_ERROR", "Could not load campaign.", 500);
  if (!campaign) return apiError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);

  const { data: settings, error: settingsError } = await admin
    .from("platform_settings")
    .select("id")
    .maybeSingle();
  if (settingsError || !settings) {
    return apiError("INTERNAL_ERROR", "Failed to fetch platform settings.", 500);
  }
  const { data: updated, error: updateError } = await admin
    .from("platform_settings")
    .update({ active_campaign_id: campaignId })
    .eq("id", settings.id)
    .select("active_campaign_id")
    .single();
  if (updateError) return apiError("INTERNAL_ERROR", "Failed to update active campaign.", 500);
  return json({ active_campaign_id: updated.active_campaign_id });
});
