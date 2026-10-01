import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireAdvertiser } from "../_shared/auth.ts";
import { apiError, isUuid, json, optionsResponse } from "../_shared/http.ts";

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
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

  /* Deprecated. This used to write the global
     platform_settings.active_campaign_id, so one advertiser selecting a
     campaign decided what every publisher was served. Selection is local UI
     state now and there is no shared pointer to write. Ownership was proven
     by the advertiser_id filter above, so this echoes the caller's own
     campaign and changes nothing for anyone else. */
  return json({ campaign: { id: campaign.id }, selected: true, global: false });
});

serve(handler);