import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { handleImpression } from "../_shared/events.ts";
import { apiError, optionsResponse } from "../_shared/http.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  return handleImpression(req);
});
