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
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient } from "../_shared/auth.ts";
import { adTokenSecret, verifyServeToken } from "../_shared/adToken.ts";
import {
  apiError,
  isUuid,
  json,
  optionsResponse,
  restPath,
  serveWithCors,
} from "../_shared/http.ts";
import { authenticatePublisher, createRateLimiter } from "../_shared/publisherAuth.ts";
import { authorizeServe } from "../_shared/serveAuthz.ts";
import {
  isForbiddenMetadataValue,
  telemetrySdkVersion,
  validateTelemetryPayload,
} from "../_shared/telemetry.ts";

/**
 * A tighter bucket than delivery, on purpose.
 *
 * The delivery limiter's capacity exists to damp abuse on a path that does
 * real work and creates real rows. Telemetry is cheap but it is still a write,
 * and a flood of it is the cheapest way to make the table expensive. The
 * database enforces a durable per-session ceiling as well; this one just keeps
 * a misbehaving caller from getting as far as the database.
 */
const checkTelemetryRate = createRateLimiter({ capacity: 60, refillPerSecond: 1 });

/** Codes the RPC raises, mapped to what an HTTP caller should see. */
const RPC_ERROR_STATUS: Record<string, number> = {
  SERVER_ONLY_EVENT: 400,
  OUT_OF_ORDER: 409,
  RATE_LIMITED: 429,
  INVALID_METADATA: 400,
  INVALID_EVENT: 400,
  SERVE_NOT_FOUND: 404,
};

const RPC_ERROR_MESSAGE: Record<string, string> = {
  SERVER_ONLY_EVENT: "That event type is recorded by the server and cannot be asserted by a client.",
  OUT_OF_ORDER: "That event arrived before the event it depends on.",
  RATE_LIMITED: "Too many events from this session. Slow down.",
  INVALID_METADATA: "Telemetry metadata is not on the allow-list.",
  INVALID_EVENT: "The event payload is malformed.",
  SERVE_NOT_FOUND: "No delivery matches that requestId.",
};

function rpcCode(err: unknown): string | null {
  const record = err !== null && typeof err === "object" ? (err as Record<string, unknown>) : {};
  const text = typeof record["message"] === "string" ? record["message"] : "";
  for (const code of Object.keys(RPC_ERROR_STATUS)) {
    if (text.includes(code)) return code;
  }
  return null;
}

/**
 * Confirms the delivery-bound events really are about a delivery this
 * publisher owns.
 *
 * The token is the same server-signed serve token the impression path uses, so
 * a client cannot point `ad_rendered` at somebody else's serve by guessing a
 * request id. `authorizeServe` reports an invalid token before it compares
 * request ids, which keeps a caller from probing which ids exist.
 */
async function authorizeDelivery(
  req: Request,
  body: Record<string, unknown>,
  publisherId: string,
  deliveryBound: boolean,
): Promise<Response | null> {
  if (!deliveryBound) return null;

  const requestId = body.requestId ?? body.request_id;
  const token = body.impressionToken ?? body.impression_token;

  if (typeof token !== "string" || !token) {
    return apiError(
      "INVALID_TOKEN",
      "This event is about a delivery, so it must carry the serve token it was issued with.",
      401,
      {},
      req,
    );
  }

  const secret = adTokenSecret();
  if (!secret) {
    return apiError(
      "INTERNAL_ERROR",
      "Serve token verification is not configured.",
      503,
      {},
      req,
    );
  }

  const verified = await verifyServeToken(secret, token);
  const decision = authorizeServe({
    tokenVerified: verified.ok,
    claims: verified.ok ? verified.payload : null,
    bodyRequestId: typeof requestId === "string" ? requestId : "",
    authenticatedPublisherId: publisherId,
  });

  if (!decision.ok) {
    const message = decision.failure === "TOKEN_INVALID"
      ? "The serve token is missing, malformed, expired or not signed by this server."
      : decision.failure === "PUBLISHER_MISMATCH"
        ? "Token does not match this publisher."
        : "Token does not match this delivery.";
    return apiError("INVALID_TOKEN", message, 401, {}, req);
  }

  return null;
}

async function handleRecord(req: Request, admin: SupabaseClient): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return apiError("INVALID_REQUEST", "Telemetry body must be a JSON object.", 400, {}, req);
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return apiError("INVALID_REQUEST", "Telemetry body must be JSON.", 400, {}, req);
  }

  // The publisher key is a capability and lives in the body, as it does on
  // every other publisher-facing call. An empty or missing key fails with the
  // same 401 as a wrong one, so the endpoint cannot be used to find out which
  // keys exist.
  const publisherKey = body.publisherKey;
  const auth = await authenticatePublisher(admin, publisherKey, undefined);
  if ("error" in auth) return auth.error;

  const limited = checkTelemetryRate(auth.identity.publisherId);
  if (!limited.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many telemetry events. Retry after the indicated delay.",
      429,
      { retry_after_ms: limited.retryAfterMs },
      req,
    );
  }

  const validation = validateTelemetryPayload(body);
  if (!validation.ok) {
    // Note which: an unknown type is a client bug, a server-only type is an
    // attempt (or a broken integration) to assert something the server owns,
    // and the server deserves to see them separately in its logs.
    if (validation.reason === "SERVER_ONLY_EVENT") {
      console.error("telemetry: refused a client-asserted server-only event");
    }
    return apiError(validation.reason, validation.message, 400, {}, req);
  }

  const requestId = body.requestId ?? body.request_id;
  if (requestId !== undefined && requestId !== null && !isUuid(String(requestId))) {
    return apiError("INVALID_REQUEST", "requestId must be a UUID.", 400, {}, req);
  }

  for (const [key, value] of Object.entries(validation.metadata)) {
    if (typeof value === "string" && isForbiddenMetadataValue(value)) {
      console.error(`telemetry: refused event with a forbidden metadata value in ${key}`);
      return apiError(
        "INVALID_METADATA",
        "Telemetry metadata is not on the allow-list.",
        400,
        {},
        req,
      );
    }
  }

  const denied = await authorizeDelivery(
    req,
    body,
    auth.identity.publisherId,
    validation.eventType === "ad_rendered",
  );
  if (denied) return denied;

  const occurredAt = body.occurredAt ?? body.occurred_at;

  const { data, error } = await admin.rpc("record_telemetry_event", {
    p_event_type: validation.eventType,
    p_session_id: String(body.sessionId ?? body.session_id),
    p_idempotency_key: String(body.idempotencyKey ?? body.idempotency_key),
    p_delivery_id: typeof requestId === "string" && requestId ? requestId : null,
    p_occurred_at: typeof occurredAt === "string" ? occurredAt : null,
    p_sdk_version: telemetrySdkVersion(req),
    p_metadata: validation.metadata,
    // Passed for cross-checking only. The RPC resolves campaign, creative and
    // developer from the serve row and never from anything a client sent.
    p_publisher_id: auth.identity.publisherId,
    p_surface: typeof body.surface === "string" ? body.surface : null,
  });

  if (error) {
    const code = rpcCode(error);
    if (code) {
      return apiError(
        code,
        RPC_ERROR_MESSAGE[code],
        RPC_ERROR_STATUS[code],
        code === "RATE_LIMITED" ? { retry_after_ms: 1000 } : {},
        req,
      );
    }
    console.error("telemetry: record_telemetry_event failed");
    return apiError("INTERNAL_ERROR", "Could not record the event.", 500, {}, req);
  }

  const result = (data ?? {}) as Record<string, unknown>;
  return json(
    {
      success: true,
      status: result.duplicate ? "duplicate" : "recorded",
      event_id: result.event_id,
      event_type: result.event_type,
      sequence: result.sequence,
      delivery_id: result.delivery_id,
      validation_state: result.validation_state,
    },
    200,
    req,
  );
}

serveWithCors(async (req) => {
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