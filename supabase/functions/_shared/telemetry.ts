/**
 * The telemetry event model, as the Edge Runtime sees it.
 *
 * The authoritative definition of the catalogue lives in
 * supabase/migrations/000021_telemetry_event_model.sql. This module is the
 * Edge-side mirror of it: the same twelve event names, the same split between
 * what a client may assert and what only the server may assert, and the same
 * privacy allow-list.
 *
 * It is duplicated on purpose rather than imported from the database. The
 * Edge Function has to decide, before it makes a network call, whether an
 * incoming event type is client-assertable and whether its metadata is on the
 * allow-list. Relying on the server to reject a bad type would mean every
 * malformed call costs a round trip, and relying on the server to hold the
 * only copy of the privacy allow-list would mean a mistake in one place
 * silently widens what is collected. tests/telemetry-privacy.test.js asserts
 * the two lists stay identical.
 *
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no field anywhere in this module for a terminal command, a
 * password, clipboard content, a private file path, a microphone or camera
 * capture, a user agent, an IP address or any other device or cross-site
 * identifier. That is the point. The SDK's published privacy contract is that
 * the only publisher context that ever leaves a page is the current URL and
 * the referrer, both of which the delivery endpoint already handles, and this
 * module adds nothing to that. What a publisher learns about its own page
 * from these events is placement key, section id, cta id, visible percentage
 * and dwell time — nothing about the person.
 */

/** The twelve events, in lifecycle order. */
export const TELEMETRY_EVENT_TYPES = [
  "session_started",
  "page_viewed",
  "section_viewed",
  "cta_clicked",
  "ad_requested",
  "campaign_selected",
  "creative_delivered",
  "ad_rendered",
  "visibility_qualified",
  "impression_qualified",
  "event_validated",
  "reward_created",
] as const;

export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];

/**
 * Events a publisher client is allowed to assert.
 *
 * These five are observations, and the browser is the only party that can make
 * them. Their ordering is still checked against rows the server wrote, so an
 * out-of-order event is rejected rather than recorded out of sequence.
 *
 * The other seven are not here on purpose. `visibility_qualified` in
 * particular is server-authored even though it is technically observable in
 * the browser: the impression endpoint is only reachable through the SDK's
 * 50%-for-1s viewability gate, so the server asserting the fact is a stronger
 * statement than trusting a client flag, and it removes the question of what a
 * client should be able to re-assert once per delivery.
 */
export const CLIENT_EVENT_TYPES = [
  "session_started",
  "page_viewed",
  "section_viewed",
  "cta_clicked",
  "ad_rendered",
] as const satisfies readonly TelemetryEventType[];

export type ClientTelemetryEventType = (typeof CLIENT_EVENT_TYPES)[number];

/**
 * Server-only types. A client asking for one of these gets a refusal, not a
 * row. `event_validated` and `reward_created` are the two that matter for
 * money: a reward must never be traceable to something a client asserted.
 */
export const SERVER_ONLY_EVENT_TYPES = TELEMETRY_EVENT_TYPES.filter(
  (type): type is Exclude<TelemetryEventType, ClientTelemetryEventType> =>
    !(CLIENT_EVENT_TYPES as readonly string[]).includes(type),
);

const CLIENT_EVENT_SET: ReadonlySet<string> = new Set<string>(CLIENT_EVENT_TYPES);
const ALL_EVENT_SET: ReadonlySet<string> = new Set<string>(TELEMETRY_EVENT_TYPES);

export function isTelemetryEventType(value: unknown): value is TelemetryEventType {
  return typeof value === "string" && ALL_EVENT_SET.has(value);
}

export function isClientEventType(value: unknown): value is ClientTelemetryEventType {
  return typeof value === "string" && CLIENT_EVENT_SET.has(value);
}

/**
 * Events that must name a delivery. Everything else is session-scoped
 * publisher surface: what happened on the page, with no ad involved.
 */
export const DELIVERY_BOUND_EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "ad_rendered",
  "cta_clicked",
]);

/**
 * The only metadata keys that may be recorded, in addition to `surface`,
 * which is a dedicated column rather than a metadata entry.
 *
 * Seven keys, all of which describe the page rather than the person. A key
 * outside this list has no way in: the Edge Function rejects it before the
 * call, and the database rejects it again in a CHECK constraint.
 */
export const TELEMETRY_METADATA_KEYS = [
  "sectionId",
  "ctaId",
  "placementKey",
  "visiblePercent",
  "dwellMs",
  "adSize",
  "trigger",
] as const;

const METADATA_KEY_SET: ReadonlySet<string> = new Set<string>(TELEMETRY_METADATA_KEYS);

/** Mirrors the max in telemetry_metadata_is_allowed(). */
export const TELEMETRY_METADATA_MAX_KEYS = 8;

/** Mirrors the max in telemetry_metadata_is_allowed(). */
export const TELEMETRY_METADATA_MAX_VALUE_LENGTH = 120;

/**
 * Mirrors the value screen in telemetry_metadata_is_allowed().
 *
 * The key allow-list is already exhaustive for keys, so this only has to
 * catch a payload smuggled through an allow-listed key — `ctaId` carrying a
 * pasted command line, say.
 */
export const FORBIDDEN_VALUE_RE =
  /(pass|secret|token|api[_-]?key|bearer|clipboard|terminal|command|shell|\.ssh|\.env|\/etc\/|\/home\/|\/root\/|\/var\/|private|mic|camera|capture|keylog|@|mailto:|\d{9,}|(^|[^a-z])(sudo|rm|curl|wget|npx|chmod)([^a-z]|$))/i;

/** Session ids and idempotency keys must look like this. Mirrors the RPC. */
export const TELEMETRY_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/;

/** Mirrors the SDK version screen in the RPC. */
export const TELEMETRY_SDK_VERSION_RE = /^[A-Za-z0-9@._+-]{1,40}$/;

export const TELEMETRY_SURFACE_RE = /^[A-Za-z0-9._:-]{1,64}$/;

/** Lowercase form of the SDK's `X-CLIRevenue-SDK-Version`, as HTTP delivers it. */
export const TELEMETRY_SDK_VERSION_HEADER = "x-clirevenue-sdk-version";

export type TelemetryMetadataValue = string | number | boolean;

export type TelemetryMetadata = Record<string, TelemetryMetadataValue>;

export type TelemetryValidation =
  | { ok: true; eventType: ClientTelemetryEventType; metadata: TelemetryMetadata }
  | { ok: false; reason: string; message: string };

/**
 * Screens a client event before it costs a network call.
 *
 * Order matters for the tests as much as for the caller: an unknown type is
 * refused as unknown, a known-but-server-only type is refused as
 * server-only, because those are two very different bugs and the caller logs
 * them differently.
 *
 * metadata is unknown on purpose. A client sends JSON, and `JSON.parse` will
 * happily hand back an array or a nested object where an object was expected,
 * so this has to survive whatever arrives rather than trust a type that came
 * from the wire.
 */
export function validateTelemetryPayload(body: unknown): TelemetryValidation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      reason: "INVALID_REQUEST",
      message: "Telemetry body must be a JSON object.",
    };
  }

  const input = body as Record<string, unknown>;
  const rawType = input.eventType ?? input.event_type;

  if (!isTelemetryEventType(rawType)) {
    return {
      ok: false,
      reason: "INVALID_EVENT",
      message: "Unknown telemetry event type.",
    };
  }

  if (!isClientEventType(rawType)) {
    return {
      ok: false,
      reason: "SERVER_ONLY_EVENT",
      message: `${rawType} is recorded by the server and cannot be asserted by a client.`,
    };
  }

  const sessionId = input.sessionId ?? input.session_id;
  if (typeof sessionId !== "string" || !TELEMETRY_ID_RE.test(sessionId)) {
    return {
      ok: false,
      reason: "INVALID_EVENT",
      message: "sessionId is missing or malformed.",
    };
  }

  const idempotencyKey = input.idempotencyKey ?? input.idempotency_key;
  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.length === 0 ||
    idempotencyKey.length > 200
  ) {
    return {
      ok: false,
      reason: "INVALID_EVENT",
      message: "idempotencyKey is missing or too long.",
    };
  }

  const requestId = input.requestId ?? input.request_id;
  if (requestId !== undefined && requestId !== null && typeof requestId !== "string") {
    return { ok: false, reason: "INVALID_REQUEST", message: "requestId must be a string." };
  }

  if (DELIVERY_BOUND_EVENT_TYPES.has(rawType) && (typeof requestId !== "string" || !requestId)) {
    return {
      ok: false,
      reason: "INVALID_REQUEST",
      message: `${rawType} requires the delivery requestId it is about.`,
    };
  }

  let surface: string | undefined;
  if (input.surface !== undefined && input.surface !== null) {
    if (typeof input.surface !== "string" || !TELEMETRY_SURFACE_RE.test(input.surface)) {
      return { ok: false, reason: "INVALID_EVENT", message: "surface is malformed." };
    }
    surface = input.surface;
  }

  let occurredAt: string | undefined;
  if (input.occurredAt !== undefined && input.occurredAt !== null) {
    if (typeof input.occurredAt !== "string" || Number.isNaN(Date.parse(input.occurredAt))) {
      return { ok: false, reason: "INVALID_EVENT", message: "occurredAt must be an ISO timestamp." };
    }
    occurredAt = input.occurredAt;
  }

  return {
    ok: true,
    eventType: rawType,
    metadata: screenMetadata(input.metadata, surface),
  };
}

/**
 * Applies the allow-list.
 *
 * Unknown keys are dropped rather than rejected, because a newer SDK sending a
 * field this Edge Function has never heard of should not fail the whole event
 * — the safe direction is to keep the seven known keys and lose the new one.
 * A value that trips the forbidden screen, on the other hand, is rejected:
 * dropping it silently would hide the fact that something sensitive arrived,
 * and the caller deserves to know its own instrumentation is wrong.
 */
export function screenMetadata(raw: unknown, surface?: string): TelemetryMetadata {
  const out: TelemetryMetadata = {};
  if (typeof surface === "string") out.surface = surface;

  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) return out;

  const entries = Object.entries(raw as Record<string, unknown>);
  for (const [key, value] of entries.slice(0, TELEMETRY_METADATA_MAX_KEYS)) {
    if (!METADATA_KEY_SET.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "boolean") {
      out[key] = value;
      continue;
    }
    if (typeof value !== "string") continue;
    if (value.length === 0 || value.length > TELEMETRY_METADATA_MAX_VALUE_LENGTH) continue;
    if (FORBIDDEN_VALUE_RE.test(value)) continue;
    out[key] = value;
  }

  return out;
}

/** True when a metadata value would be refused by the database. */
export function isForbiddenMetadataValue(value: string): boolean {
  return FORBIDDEN_VALUE_RE.test(value);
}

/**
 * Reads the SDK version off a request.
 *
 * Read from the header rather than the body for the same reason the delivery
 * endpoint does: a body field can be forged by any caller, while the header is
 * at least set by the same SDK build that set the rest of the request. It is
 * still only an attribution hint, and the RPC records its absence as a
 * NO_SDK_VERSION risk flag rather than treating it as a reason to refuse.
 */
export function telemetrySdkVersion(req: Request): string | null {
  const raw = req.headers.get(TELEMETRY_SDK_VERSION_HEADER);
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return TELEMETRY_SDK_VERSION_RE.test(trimmed) ? trimmed : null;
}