/**
 * The client-facing half of the telemetry API.
 *
 * Accepts only the five events a browser can actually observe:
 * `session_started`, `page_viewed`, `section_viewed`, `cta_clicked` and
 * `ad_rendered`. Everything else in the catalogue is recorded by the server
 * from the accounting transactions themselves (see migration 000021), and a
 * request for one of those types is refused here before it reaches the
 * database.
 *
 * Authentication is the publisher publishable key, not a user session. A
 * telemetry call is made from a page that is, by definition, not signed in,
 * and the key is a capability: it identifies the publisher, not a person. The
 * database still decides whether this publisher owns the delivery the event
 * claims to be about -- the mismatch is recorded as a risk flag, not silently
 * accepted and not used to redirect anything.
 *
 * Note what this function never reads: no request body field named after a
 * campaign, a creative, a developer, an amount, a risk score or a reward. The
 * RPC assigns all of those, from the serve row.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { adminClient } from "../_shared/auth.ts";
import { apiError, optionsResponse, restPath, serveWithCors } from "../_shared/http.ts";
import { handleRecord } from "../_shared/telemetryRecord.ts";

const handler = serveWithCors(async (req) => {
  const parts = restPath(new URL(req.url).pathname, "telemetry");

  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }
  if ((parts[0] ?? "") !== "") {
    return apiError("NOT_FOUND", "Unknown telemetry route.", 404, {}, req);
  }

  try {
    return await handleRecord(req, adminClient());
  } catch (err) {
    console.error("telemetry: unexpected failure");
    return apiError("INTERNAL_ERROR", "Could not record the event.", 500, {}, req);
  }
});

serve(handler);
