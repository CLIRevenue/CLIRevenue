import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { handleInteraction } from "../_shared/events.ts";
import { apiError, optionsResponse } from "../_shared/http.ts";

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  return handleInteraction(req, "click");
});

serve(handler);