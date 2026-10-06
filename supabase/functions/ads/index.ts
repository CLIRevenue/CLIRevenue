import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "../_shared/auth.ts";
import { apiError, corsFor, isUuid, json, optionsResponse, restPath } from "../_shared/http.ts";
import { isEligible } from "../_shared/eligibility.ts";
import { adTokenSecret, signServeToken, verifyServeToken } from "../_shared/adToken.ts";
import { authenticatePublisher, rateLimitDelivery } from "../_shared/publisherAuth.ts";
import { authorizeServe } from "../_shared/serveAuthz.ts";

const SERVE_TTL_MS = 30 * 60 * 1000;
const SDK_VERSION_HEADER = "x-clirevenue-sdk-version";

type Candidate = {
  id: string;
  name: string;
  headline: string;
  description: string | null;
  cta: string | null;
  audience_id: string;
  landing_url: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  budget_cents: number;
  spend_milli_cents: number;
  cpm_cents: number;
};

function noFill(req: Request): Response {
  return new Response(null, { status: 204, headers: { ...corsFor(req) } });
}

function readContext(body: Record<string, unknown>): { url: string | null; referrer: string | null } {
  const clip = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 2048) : null;
  return {
    url: clip(body.url),
    referrer: clip(body.referrer),
  };
}

/**
 * The publisher's page-load session, as the SDK minted it.
 *
 * Read on the delivery path, not just on the impression path, because it is
 * only useful if it is stored with the serve: the telemetry lifecycle for a
 * delivery is written by a trigger that fires inside this insert, so a session
 * the server never received leaves every delivery event in a synthetic
 * per-serve session and the page's real session aggregate empty.
 *
 * It is opaque and untrusted — an in-memory id the SDK generates per page load
 * and never persists — and it is used only as a grouping key. It cannot name a
 * campaign, cannot change an amount, and the RPC takes the session for a
 * delivery-bound event from this column rather than from the request, so a
 * client cannot use it to steer attribution. Absent or malformed is fine: the
 * server then falls back to a synthetic per-serve session, which is recorded
 * with a SYNTHETIC_SESSION risk flag.
 */
function readTelemetrySession(body: Record<string, unknown>): string | null {
  const v = body.sessionId;
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  if (!trimmed || trimmed.length > 200) return null;
  return /^[A-Za-z0-9._:-]+$/.test(trimmed) ? trimmed : null;
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed = await req.json();
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function rpcErrorCode(err: { message?: string } | null): string | null {
  const msg = err?.message || "";
  const codes = [
    "SERVE_NOT_FOUND",
    "SERVE_EXPIRED",
    "IMPRESSION_KEY_REUSED",
    "INTERACTION_KEY_REUSED",
    "CLICK_WITHOUT_IMPRESSION",
    "CAMPAIGN_NOT_FOUND",
    "CAMPAIGN_NOT_SERVABLE",
    "BUDGET_EXCEEDED",
    "INVALID_EVENT",
  ];
  return codes.find((c) => msg.includes(c)) || null;
}

async function handleDeliver(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await readJson(req);
  if (!body) return apiError("INVALID_REQUEST", "JSON body required.", 400, {}, req);

  const auth = await authenticatePublisher(admin, body.publisherKey, body.placementKey);
  if ("error" in auth) return auth.error;
  const identity = auth.identity;

  const limit = rateLimitDelivery(identity.publisherId);
  if (!limit.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many delivery requests for this publisher key.",
      429,
      { retry_after_ms: limit.retryAfterMs },
      req,
    );
  }

  if (!identity.placementId) {
    return apiError("INVALID_PLACEMENT", "placementKey is required.", 400, {}, req);
  }

  const secret = adTokenSecret();
  if (!secret) {
    console.error("AD_TOKEN_SECRET is not configured; refusing to serve.");
    return apiError("INTERNAL_ERROR", "Delivery is unavailable.", 503, {}, req);
  }

  const sdkVersion = req.headers.get(SDK_VERSION_HEADER)?.trim() || null;

  let query = admin
    .from("campaigns")
    .select(
      "id, name, headline, description, cta, audience_id, landing_url, " +
      "status, starts_at, ends_at, budget_cents, spend_milli_cents, cpm_cents",
    )
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(25);

  if (identity.allowedAudienceId) {
    query = query.eq("audience_id", identity.allowedAudienceId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("delivery candidate query failed:", error.message);
    return apiError("INTERNAL_ERROR", "Delivery is unavailable.", 500, {}, req);
  }

  const now = Date.now();
  const campaign = ((data ?? []) as unknown as Candidate[]).find((c) => isEligible(c, now));
  if (!campaign) return noFill(req);

  const requestId = crypto.randomUUID();
  const expiresAt = now + SERVE_TTL_MS;

  const developerId = await resolveDeveloperId(req, admin);

  const { data: serveRow, error: serveError } = await admin
    .from("ad_serve_log")
    .insert({
      request_id: requestId,
      publisher_id: identity.publisherId,
      placement_id: identity.placementId,
      campaign_id: campaign.id,
      developer_id: developerId,
      placement_key: identity.placementKey,
      sdk_version: sdkVersion,
      context_url: readContext(body).url,
      context_referrer: readContext(body).referrer,
      telemetry_session_id: readTelemetrySession(body),
      cost_milli_cents: campaign.cpm_cents,
      served_at: new Date(now).toISOString(),
      expires_at: new Date(expiresAt).toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (serveError) {
    console.error("ad_serve_log insert failed:", serveError.message);
    return apiError("INTERNAL_ERROR", "Delivery is unavailable.", 500, {}, req);
  }

  const token = await signServeToken(secret, {
    v: 1,
    rid: requestId,
    cid: campaign.id,
    pid: identity.publisherId,
    plid: identity.placementId,
    exp: expiresAt,
    sv: sdkVersion ?? undefined,
  });

  return json(
    {
      requestId,
      ad: {
        id: campaign.id,
        name: campaign.name,
        headline: campaign.headline,
        description: campaign.description,
        cta: campaign.cta,
        audience: campaign.audience_id,
        landingUrl: campaign.landing_url,
      },
      impressionToken: token,
      expiresAt: new Date(expiresAt).toISOString(),
    },
    200,
    req,
  );
}

async function resolveDeveloperId(req: Request, admin: SupabaseClient): Promise<string | null> {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const supabase = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data } = await supabase.auth.getUser(token);
    if (!data?.user) return null;
    const { data: dev } = await admin
      .from("developer_accounts")
      .select("id")
      .eq("profile_id", data.user.id)
      .maybeSingle();
    return dev?.id ?? null;
  } catch {
    return null;
  }
}

async function handleImpression(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await readJson(req);
  if (!body) return apiError("INVALID_REQUEST", "JSON body required.", 400, {}, req);

  const auth = await authorizeTracking(req, admin, body);
  if (!auth.ok) return auth.error;

  const idem = requireIdempotencyKey(body);
  if (!idem) return apiError("INVALID_REQUEST", "idempotencyKey is required.", 400, {}, req);

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim().slice(0, 200)
      : null;
  if (!sessionId) return apiError("INVALID_REQUEST", "sessionId is required.", 400, {}, req);

  const cliIntegration =
    typeof body.cliIntegration === "string" && body.cliIntegration.trim()
      ? body.cliIntegration.trim().slice(0, 100)
      : "clirevenue-sdk";

  const { data, error } = await admin.rpc("record_serve_impression", {
    p_request_id: auth.requestId,
    p_publisher_id: auth.publisherId,
    p_cli_integration: cliIntegration,
    p_session_id: sessionId,
    p_idempotency_key: idem,
  });

  if (error) {
    const code = rpcErrorCode(error);
    if (code) {
      console.error(`record_serve_impression refused: ${code}`);
      return apiError(code, impressionMessage(code), statusForCode(code), {}, req);
    }
    console.error("record_serve_impression failed:", error.message);
    return apiError("INTERNAL_ERROR", "Could not record the impression.", 500, {}, req);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return json(
    {
      success: true,
      status: result.duplicate ? "duplicate" : "recorded",
      requestId: auth.requestId,
      impressionId: result.impression_id ?? null,
    },
    200,
    req,
  );
}

async function handleClick(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await readJson(req);
  if (!body) return apiError("INVALID_REQUEST", "JSON body required.", 400, {}, req);

  const auth = await authorizeTracking(req, admin, body);
  if (!auth.ok) return auth.error;

  const idem = requireIdempotencyKey(body);
  if (!idem) return apiError("INVALID_REQUEST", "idempotencyKey is required.", 400, {}, req);

  const { data, error } = await admin.rpc("record_serve_click", {
    p_request_id: auth.requestId,
    p_publisher_id: auth.publisherId,
    p_idempotency_key: idem,
  });

  if (error) {
    const code = rpcErrorCode(error);
    if (code) {
      return apiError(code, clickMessage(code), statusForCode(code), {}, req);
    }
    console.error("record_serve_click failed:", error.message);
    return apiError("INTERNAL_ERROR", "Could not record the click.", 500, {}, req);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return json(
    {
      success: true,
      status: result.duplicate ? "duplicate" : "recorded",
      requestId: auth.requestId,
      rewardAccrued: result.reward_accrued ?? null,
    },
    200,
    req,
  );
}

async function handleConversion(req: Request, admin: SupabaseClient): Promise<Response> {
  const body = await readJson(req);
  if (!body) return apiError("INVALID_REQUEST", "JSON body required.", 400, {}, req);

  const auth = await authorizeTracking(req, admin, body);
  if (!auth.ok) return auth.error;

  const idem = requireIdempotencyKey(body);
  if (!idem) return apiError("INVALID_REQUEST", "idempotencyKey is required.", 400, {}, req);

  const { data, error } = await admin.rpc("record_serve_conversion", {
    p_request_id: auth.requestId,
    p_publisher_id: auth.publisherId,
    p_idempotency_key: idem,
  });

  if (error) {
    const code = rpcErrorCode(error);
    if (code) {
      return apiError(code, clickMessage(code), statusForCode(code), {}, req);
    }
    console.error("record_serve_conversion failed:", error.message);
    return apiError("INTERNAL_ERROR", "Could not record the conversion.", 500, {}, req);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return json(
    {
      success: true,
      status: result.duplicate ? "duplicate" : "recorded",
      requestId: auth.requestId,
    },
    200,
    req,
  );
}

function statusForCode(code: string): number {
  switch (code) {
    case "SERVE_NOT_FOUND":
      return 404;
    case "SERVE_EXPIRED":
    case "CLICK_WITHOUT_IMPRESSION":
    case "IMPRESSION_KEY_REUSED":
    case "INTERACTION_KEY_REUSED":
    case "INVALID_EVENT":
    case "CAMPAIGN_NOT_SERVABLE":
    case "BUDGET_EXCEEDED":
      return 400;
    case "CAMPAIGN_NOT_FOUND":
      return 404;
    default:
      return 400;
  }
}

function impressionMessage(code: string): string {
  switch (code) {
    case "SERVE_NOT_FOUND":
      return "Unknown ad request.";
    case "SERVE_EXPIRED":
      return "This ad request is no longer valid.";
    case "BUDGET_EXCEEDED":
      return "The campaign budget has been exhausted.";
    case "CAMPAIGN_NOT_SERVABLE":
      return "The campaign is not eligible to receive this event.";
    default:
      return "The impression could not be recorded.";
  }
}

function clickMessage(code: string): string {
  switch (code) {
    case "SERVE_NOT_FOUND":
      return "Unknown ad request.";
    case "CLICK_WITHOUT_IMPRESSION":
      return "A click requires a recorded impression for this ad request.";
    case "SERVE_EXPIRED":
      return "This ad request is no longer valid.";
    default:
      return "The interaction could not be recorded.";
  }
}

function requireIdempotencyKey(body: Record<string, unknown>): string | null {
  const key = body.idempotencyKey;
  return typeof key === "string" && key.trim() ? key.trim().slice(0, 200) : null;
}

async function authorizeTracking(
  req: Request,
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ ok: true; requestId: string; publisherId: string } | { ok: false; error: Response }> {
  const auth = await authenticatePublisher(admin, body.publisherKey);
  if ("error" in auth) return { ok: false, error: auth.error };
  const identity = auth.identity;

  const limit = rateLimitDelivery(identity.publisherId);
  if (!limit.allowed) {
    return {
      ok: false,
      error: apiError(
        "RATE_LIMITED",
        "Too many requests for this publisher key.",
        429,
        { retry_after_ms: limit.retryAfterMs },
        req,
      ),
    };
  }

  const requestId = body.requestId;
  if (!isUuid(requestId)) {
    return { ok: false, error: apiError("INVALID_REQUEST", "requestId must be a UUID.", 400, {}, req) };
  }

  const secret = adTokenSecret();
  if (!secret) {
    return { ok: false, error: apiError("INTERNAL_ERROR", "Delivery is unavailable.", 503, {}, req) };
  }

  const verified = await verifyServeToken(secret, body.impressionToken);

  const decision = authorizeServe({
    tokenVerified: verified.ok,
    claims: verified.ok ? verified.payload : null,
    bodyRequestId: requestId,
    authenticatedPublisherId: identity.publisherId,
  });

  if (!decision.ok) {
    const message = decision.failure === "TOKEN_INVALID"
      ? "The impression token is missing, invalid or expired."
      : decision.failure === "REQUEST_ID_MISMATCH"
      ? "Token does not match requestId."
      : "Token does not match this publisher.";
    return { ok: false, error: apiError("INVALID_TOKEN", message, 401, {}, req) };
  }

  return { ok: true, requestId, publisherId: identity.publisherId };
}

serve(async (req) => {
  const parts = restPath(new URL(req.url).pathname, "ads");
  const route = parts[0] ?? "";

  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }

  const admin = adminClient();

  switch (route) {
    case "deliver":
      return handleDeliver(req, admin);
    case "impression":
      return handleImpression(req, admin);
    case "click":
      return handleClick(req, admin);
    case "conversion":
      return handleConversion(req, admin);
    default:
      return apiError("NOT_FOUND", "Unknown ads route.", 404, {}, req);
  }
});
