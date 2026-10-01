import { adminClient, getJwtUser, requireDeveloper, rpcCodeFromError } from "./auth.ts";
import { apiError, isUuid, json } from "./http.ts";

/*
 * Developer-authenticated event recording.
 *
 * BREAKING CHANGE, and it is deliberate.
 *
 * This handler used to take `campaign_id` from the request body and pass it
 * straight to apply_impression / apply_interaction. Any caller holding a
 * developer token could therefore attribute an impression to any active
 * campaign and spend another advertiser's budget, and could claim a click
 * against a campaign it was never served.
 *
 * It now requires `request_id`, and resolves the campaign from the
 * ad_serve_log row that the delivery layer wrote. A request body containing
 * `campaign_id` is ignored completely -- not validated, not used as a
 * fallback, simply never read. The only campaign the accounting can see is
 * the one the server chose at delivery.
 *
 * Authorisation here is "this serve belongs to the authenticated developer",
 * which is a different trust domain from the publisher-key path in
 * ads/index.ts. The publisher id passed to the RPC is the serve's own, so the
 * RPC's publisher check is satisfied trivially on this path; the real check is
 * the developer-ownership comparison below, made before the RPC is called.
 */

function mapRpcError(err: { message?: string } | null) {
  const code = rpcCodeFromError(err);
  if (code === "CAMPAIGN_NOT_FOUND") return apiError(code, "Campaign not found.", 404);
  if (code === "CAMPAIGN_NOT_SERVABLE") {
    return apiError(code, "Campaign is not eligible to receive this event.", 400);
  }
  if (code === "BUDGET_EXCEEDED") {
    return apiError(code, "Campaign budget has been exhausted.", 400);
  }
  if (code === "INVALID_EVENT") return apiError(code, "Event payload is invalid.", 400);
  if (code === "CLICK_WITHOUT_IMPRESSION") {
    return apiError(
      code,
      "A click requires an impression recorded for this session.",
      400,
    );
  }
  if (code === "SERVE_NOT_FOUND") return apiError(code, "Unknown ad request.", 404);
  if (code === "SERVE_EXPIRED") return apiError(code, "This ad request is no longer valid.", 400);
  if (code === "IMPRESSION_KEY_REUSED" || code === "INTERACTION_KEY_REUSED") {
    return apiError(code, "That idempotency key was already used for a different request.", 409);
  }
  return apiError("INTERNAL_ERROR", "Could not record event.", 500);
}

async function readBody(req: Request) {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

type ServeRow = {
  request_id: string;
  publisher_id: string;
  developer_id: string | null;
};

/**
 * Resolve a request id to a serve owned by this developer.
 *
 * A serve belonging to another developer reports the same 404 as a serve that
 * does not exist, so this cannot be used to discover which request ids exist.
 */
async function resolveServe(
  admin: ReturnType<typeof adminClient>,
  body: Record<string, unknown>,
  developerId: string,
): Promise<{ serve: ServeRow } | { error: Response }> {
  const requestId = body.request_id ?? body.requestId;
  if (!isUuid(requestId)) {
    return { error: apiError("INVALID_EVENT", "request_id must be a UUID.", 400) };
  }
  const { data, error } = await admin
    .from("ad_serve_log")
    .select("request_id, publisher_id, developer_id")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) {
    console.error("serve lookup failed:", error.message);
    return { error: apiError("INTERNAL_ERROR", "Could not record event.", 500) };
  }
  if (!data || data.developer_id !== developerId) {
    return { error: apiError("SERVE_NOT_FOUND", "Unknown ad request.", 404) };
  }
  return { serve: data as unknown as ServeRow };
}

function requireStrings(body: Record<string, unknown>, fields: string[]): string[] | null {
  const out: string[] = [];
  for (const field of fields) {
    const v = body[field];
    if (typeof v !== "string" || !v.trim()) return null;
    out.push(v.trim());
  }
  return out;
}

export async function handleImpression(req: Request): Promise<Response> {
  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;

  const body = await readBody(req);
  if (!body || typeof body !== "object") {
    return apiError("INVALID_EVENT", "JSON body required.", 400);
  }

  const resolved = await resolveServe(admin, body, dev.developer!.id);
  if ("error" in resolved) return resolved.error;

  const required = requireStrings(body, ["cli_integration", "session_id", "idempotency_key"]);
  if (!required) {
    return apiError(
      "INVALID_EVENT",
      "cli_integration, session_id, and idempotency_key are required.",
      400,
    );
  }
  const [cli, sessionId, idem] = required;

  const { data, error } = await admin.rpc("record_serve_impression", {
    p_request_id: resolved.serve.request_id,
    p_publisher_id: resolved.serve.publisher_id,
    p_cli_integration: cli,
    p_session_id: sessionId,
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);

  // A replay is a success, not a 4xx. The SDK retries the same logical event
  // with the same key after a timeout or a 5xx, and must not abandon it.
  return json({
    success: true,
    status: data?.duplicate ? "duplicate" : "recorded",
    request_id: resolved.serve.request_id,
    impression_id: data?.impression_id ?? null,
  }, 200, req);
}

export async function handleInteraction(
  req: Request,
  routeKind: "click" | "conversion" = "click",
): Promise<Response> {
  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;

  const body = await readBody(req);
  if (!body || typeof body !== "object") {
    return apiError("INVALID_EVENT", "JSON body required.", 400);
  }

  const resolved = await resolveServe(admin, body, dev.developer!.id);
  if ("error" in resolved) return resolved.error;

  const [idem] = requireStrings(body, ["idempotency_key"]) ?? [];
  if (!idem) {
    return apiError("INVALID_EVENT", "idempotency_key is required.", 400);
  }

  /*
   * The kind is decided by the route, never by the payload. A caller posting
   * to a click route with {"kind":"conversion"} is recorded as a click: the
   * body field is never read. The two routes call different RPCs, which have
   * separate guards and separate counters, so there is no flag to flip.
   */
  const fn = routeKind === "conversion" ? "record_serve_conversion" : "record_serve_click";
  const { data, error } = await admin.rpc(fn, {
    p_request_id: resolved.serve.request_id,
    p_publisher_id: resolved.serve.publisher_id,
    p_idempotency_key: idem,
  });
  if (error) return mapRpcError(error);

  return json({
    success: true,
    status: data?.duplicate ? "duplicate" : "recorded",
    kind: routeKind,
    request_id: resolved.serve.request_id,
    reward_accrued: data?.reward_accrued ?? null,
  }, 200, req);
}
