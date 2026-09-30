import { adminClient, getJwtUser, requireDeveloper, rpcCodeFromError } from "./auth.ts";
import { apiError, isUuid, json } from "./http.ts";

const REWARD_PER_CLICK_CENTS = 18;

function mapRpcError(err: { message?: string } | null) {
  const code = rpcCodeFromError(err);
  if (code === "CAMPAIGN_NOT_FOUND") {
    return apiError(code, "Campaign not found.", 404);
  }
  if (code === "CAMPAIGN_NOT_SERVABLE") {
    return apiError(code, "Campaign is not eligible for this event.", 400);
  }
  if (code === "BUDGET_EXCEEDED") {
    return apiError(code, "Campaign budget has been exhausted.", 400);
  }
  if (code === "INVALID_EVENT") {
    return apiError(code, "Event payload is invalid.", 400);
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
  const campaignId = body.campaign_id;
  const cli = body.cli_integration;
  const sessionId = body.session_id;
  const idem = body.idempotency_key;
  if (!isUuid(campaignId)) {
    return apiError("INVALID_EVENT", "campaign_id must be a UUID.", 400);
  }
  if (typeof cli !== "string" || !cli.trim() || typeof sessionId !== "string" || !sessionId.trim() ||
    typeof idem !== "string" || !idem.trim()) {
    return apiError("INVALID_EVENT", "cli_integration, session_id, and idempotency_key are required.", 400);
  }

  const { data, error } = await admin.rpc("apply_impression", {
    p_campaign_id: campaignId,
    p_developer_id: dev.developer!.id,
    p_cli_integration: cli.trim(),
    p_session_id: sessionId.trim(),
    p_idempotency_key: idem.trim(),
  });
  if (error) return mapRpcError(error);
  if (data?.duplicate) {
    return json({
      success: true,
      duplicate: true,
      code: "DUPLICATE_EVENT",
      impression_id: data.impression_id,
    }, 409);
  }
  return json({ success: true, impression_id: data.impression_id });
}

export async function handleInteraction(req: Request, defaultKind: "click" | "conversion" = "click"): Promise<Response> {
  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;

  const body = await readBody(req);
  if (!body || typeof body !== "object") {
    return apiError("INVALID_EVENT", "JSON body required.", 400);
  }
  const campaignId = body.campaign_id;
  const cli = body.cli_integration;
  const sessionId = body.session_id;
  const idem = body.idempotency_key;
  const kind = body.kind === "conversion" || defaultKind === "conversion" ? "conversion" : "click";
  const impressionId = body.impression_id ?? null;

  if (!isUuid(campaignId)) {
    return apiError("INVALID_EVENT", "campaign_id must be a UUID.", 400);
  }
  if (impressionId != null && !isUuid(impressionId)) {
    return apiError("INVALID_EVENT", "impression_id must be a UUID.", 400);
  }
  if (typeof cli !== "string" || !cli.trim() || typeof sessionId !== "string" || !sessionId.trim() ||
    typeof idem !== "string" || !idem.trim()) {
    return apiError("INVALID_EVENT", "cli_integration, session_id, and idempotency_key are required.", 400);
  }

  const { data, error } = await admin.rpc("apply_interaction", {
    p_campaign_id: campaignId,
    p_developer_id: dev.developer!.id,
    p_cli_integration: cli.trim(),
    p_session_id: sessionId.trim(),
    p_idempotency_key: idem.trim(),
    p_impression_id: impressionId,
    p_kind: kind,
    p_reward_cents: kind === "click" ? REWARD_PER_CLICK_CENTS : 0,
  });
  if (error) return mapRpcError(error);
  if (data?.duplicate) {
    return json({
      success: true,
      duplicate: true,
      code: "DUPLICATE_EVENT",
      interaction_id: data.interaction_id,
    }, 409);
  }
  return json({
    success: true,
    interaction_id: data.interaction_id,
    kind,
    reward_accrued: data.reward_accrued ?? null,
  });
}
