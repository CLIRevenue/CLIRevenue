import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { handleImpression, handleInteraction } from "../_shared/events.ts";
import { apiError, optionsResponse, restPath } from "../_shared/http.ts";

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  const parts = restPath(new URL(req.url).pathname, "events");
  const kind = parts[0];
  if (kind === "impression") return handleImpression(req);
  if (kind === "interaction" || kind === "click") return handleInteraction(req, "click");
  if (kind === "conversion") return handleInteraction(req, "conversion");
  return apiError("NOT_FOUND", "Not found.", 404);
});

serve(handler);