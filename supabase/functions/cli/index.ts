import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { json, apiError } from "../_shared/http.ts";
import { adminClient } from "../_shared/auth.ts";
import { authenticatePublisher } from "../_shared/publisherAuth.ts";

serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const pathname = url.pathname;

  if (pathname.endsWith("/placements") || pathname.endsWith("/placements/")) {
    const publisherKey = url.searchParams.get("publisherKey")?.trim() ?? "";

    if (!publisherKey) {
      return apiError("INVALID_REQUEST", "publisherKey is required.", 400);
    }

    const admin = adminClient();
    const auth = await authenticatePublisher(admin, publisherKey);
    if ("error" in auth) return auth.error;

    const { data: placements, error: placementsError } = await admin
      .from("placements")
      .select("id, placement_key, name, enabled, allowed_audience_id")
      .eq("publisher_id", auth.identity.publisherId)
      .order("placement_key", { ascending: true });

    if (placementsError) {
      console.error("placements query failed:", placementsError.message);
      return apiError("INTERNAL_ERROR", "Could not load placements.", 500);
    }

    return json({
      publisherId: auth.identity.publisherId,
      placements: (placements ?? []).map((p) => ({
        id: p.id,
        key: p.placement_key,
        name: p.name,
        enabled: p.enabled,
        allowedAudienceId: p.allowed_audience_id,
      })),
    });
  }

  return apiError("NOT_FOUND", "Unknown CLI route.", 404);
});
