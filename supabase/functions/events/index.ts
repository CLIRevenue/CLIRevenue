import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleImpression, handleInteraction } from "../_shared/events.ts";
import { apiError, optionsResponse } from "../_shared/http.ts";

function rest(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "events") parts.shift();
  if (parts[0] === "api" && parts[1] === "events") parts.splice(0, 2);
  else if (parts[0] === "api") parts.shift();
  return parts;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  const parts = rest(new URL(req.url).pathname);
  const kind = parts[0];
  if (kind === "impression") return handleImpression(req);
  if (kind === "interaction" || kind === "click") return handleInteraction(req, "click");
  if (kind === "conversion") return handleInteraction(req, "conversion");
  return apiError("NOT_FOUND", "Not found.", 404);
});
