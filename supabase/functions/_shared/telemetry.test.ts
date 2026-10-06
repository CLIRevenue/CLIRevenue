/**
 * Tests for the telemetry allow-list and the client/server authorship split.
 *
 * This file is the Edge-side half of a two-place invariant. The same twelve
 * event names and the same seven metadata keys also exist in
 * supabase/migrations/000021_telemetry_event_model.sql, and
 * tests/telemetry-privacy.test.js asserts the two copies agree. If you change
 * one, that test fails and tells you to change the other.
 *
 * Run with: npm run test:deno
 */
import { assertEquals } from "jsr:@std/assert@1";
import {
  CLIENT_EVENT_TYPES,
  SERVER_ONLY_EVENT_TYPES,
  TELEMETRY_EVENT_TYPES,
  TELEMETRY_METADATA_KEYS,
  DELIVERY_BOUND_EVENT_TYPES,
  FORBIDDEN_VALUE_RE,
  isClientEventType,
  isTelemetryEventType,
  isForbiddenMetadataValue,
  screenMetadata,
  telemetrySdkVersion,
  validateTelemetryPayload,
} from "./telemetry.ts";

const SESSION = "sess-abc123";
const KEY = "idem-1";
const REQUEST_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function body(overrides: Record<string, unknown> = {}) {
  return {
    eventType: "page_viewed",
    sessionId: SESSION,
    idempotencyKey: KEY,
    ...overrides,
  };
}

Deno.test("the catalogue is the twelve events in lifecycle order", () => {
  assertEquals(TELEMETRY_EVENT_TYPES.length, 12);
  assertEquals(TELEMETRY_EVENT_TYPES[0], "session_started");
  assertEquals(TELEMETRY_EVENT_TYPES[11], "reward_created");
  assertEquals(new Set(TELEMETRY_EVENT_TYPES).size, 12);
});

Deno.test("client and server-only types partition the catalogue exactly", () => {
  assertEquals(CLIENT_EVENT_TYPES.length + SERVER_ONLY_EVENT_TYPES.length, 12);
  const clientSet = new Set<string>(CLIENT_EVENT_TYPES);
  const serverSet = new Set<string>(SERVER_ONLY_EVENT_TYPES);
  for (const type of CLIENT_EVENT_TYPES) {
    assertEquals(serverSet.has(type), false, `${type} is in both halves`);
  }
  for (const type of SERVER_ONLY_EVENT_TYPES) {
    assertEquals(clientSet.has(type), false, `${type} is in both halves`);
  }
});

Deno.test("event_validated and reward_created are never client-assertable", () => {
  // The reward guarantee rests on this. If either of these ever appears in
  // CLIENT_EVENT_TYPES, the server stops being the only author of money.
  assertEquals(isClientEventType("event_validated"), false);
  assertEquals(isClientEventType("reward_created"), false);
  assertEquals(isClientEventType("visibility_qualified"), false);
  assertEquals(isClientEventType("impression_qualified"), false);
});

Deno.test("an unknown event type is refused as unknown, not as server-only", () => {
  const result = validateTelemetryPayload(body({ eventType: "page_viwewd" }));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "INVALID_EVENT");
});

Deno.test("a known server-only type is refused as SERVER_ONLY_EVENT", () => {
  for (const type of SERVER_ONLY_EVENT_TYPES) {
    const result = validateTelemetryPayload(body({ eventType: type }));
    assertEquals(result.ok, false, `${type} should be refused`);
    if (!result.ok) assertEquals(result.reason, "SERVER_ONLY_EVENT");
  }
});

Deno.test("a non-object body is refused before any field is read", () => {
  for (const input of [null, undefined, 42, "page_viewed", ["page_viewed"]]) {
    const result = validateTelemetryPayload(input);
    assertEquals(result.ok, false);
    if (!result.ok) assertEquals(result.reason, "INVALID_REQUEST");
  }
});

Deno.test("snake_case field names are accepted alongside camelCase", () => {
  const result = validateTelemetryPayload({
    event_type: "page_viewed",
    session_id: SESSION,
    idempotency_key: KEY,
  });
  assertEquals(result.ok, true);
});

Deno.test("a malformed sessionId is refused", () => {
  for (const sessionId of ["", "  ", "has space", "a".repeat(201), "emoji-😀"]) {
    const result = validateTelemetryPayload(body({ sessionId }));
    assertEquals(result.ok, false, `sessionId ${JSON.stringify(sessionId)} should be refused`);
    if (!result.ok) assertEquals(result.reason, "INVALID_EVENT");
  }
});

Deno.test("a missing or overlong idempotencyKey is refused", () => {
  assertEquals(validateTelemetryPayload(body({ idempotencyKey: "" })).ok, false);
  assertEquals(validateTelemetryPayload(body({ idempotencyKey: undefined })).ok, false);
  assertEquals(validateTelemetryPayload(body({ idempotencyKey: "k".repeat(201) })).ok, false);
});

Deno.test("a non-string requestId is refused", () => {
  const result = validateTelemetryPayload(body({ requestId: 7 }));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "INVALID_REQUEST");
});

Deno.test("a delivery-bound event without a requestId is refused", () => {
  const result = validateTelemetryPayload(body({ eventType: "ad_rendered" }));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "INVALID_REQUEST");
});

Deno.test("a delivery-bound event with a requestId passes", () => {
  const result = validateTelemetryPayload(body({ eventType: "ad_rendered", requestId: REQUEST_ID }));
  assertEquals(result.ok, true);
});

Deno.test("ad_rendered and cta_clicked are the only delivery-bound types", () => {
  assertEquals(DELIVERY_BOUND_EVENT_TYPES.has("ad_rendered"), true);
  assertEquals(DELIVERY_BOUND_EVENT_TYPES.has("cta_clicked"), true);
  assertEquals(DELIVERY_BOUND_EVENT_TYPES.has("page_viewed"), false);
  assertEquals(DELIVERY_BOUND_EVENT_TYPES.has("session_started"), false);
});

Deno.test("a malformed surface is refused", () => {
  const result = validateTelemetryPayload(body({ surface: "home page!" }));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "INVALID_EVENT");
});

Deno.test("a non-ISO occurredAt is refused", () => {
  const result = validateTelemetryPayload(body({ occurredAt: "not-a-date" }));
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.reason, "INVALID_EVENT");
});

Deno.test("an ISO occurredAt passes", () => {
  const result = validateTelemetryPayload(body({ occurredAt: "2026-01-01T00:00:00.000Z" }));
  assertEquals(result.ok, true);
});

Deno.test("unknown metadata keys are dropped rather than failing the event", () => {
  // A newer SDK must not be able to lose an event just because the Edge
  // Function has not heard of one of its fields.
  const result = validateTelemetryPayload(
    body({ metadata: { sectionId: "hero", somethingFromTheFuture: "x" } }),
  );
  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.metadata, { sectionId: "hero" });
  }
});

Deno.test("only allow-listed metadata keys survive screening", () => {
  const screened = screenMetadata({
    sectionId: "hero",
    ctaId: "learn-more",
    placementKey: "sidebar",
    visiblePercent: 82,
    dwellMs: 4200,
    adSize: "300x250",
    trigger: "scroll",
    email: "reader@example.com",
    userAgent: "Mozilla/5.0",
    url: "https://example.com/private",
  });
  assertEquals(Object.keys(screened).sort(), [
    "adSize",
    "ctaId",
    "dwellMs",
    "placementKey",
    "sectionId",
    "trigger",
    "visiblePercent",
  ]);
});

Deno.test("a forbidden value under an allow-listed key is dropped", () => {
  const screened = screenMetadata({ ctaId: "sudo rm -rf /" });
  assertEquals(screened, {});
});

Deno.test("surface is recorded as a dedicated metadata entry", () => {
  assertEquals(screenMetadata(undefined, "pricing"), { surface: "pricing" });
});

Deno.test("structural and null metadata values are dropped", () => {
  const screened = screenMetadata({
    sectionId: { nested: "value" },
    ctaId: ["a", "b"],
    dwellMs: null,
    visiblePercent: Number.NaN,
    adSize: 42,
    trigger: true,
  });
  assertEquals(screened, { adSize: 42, trigger: true });
});

Deno.test("an overlong metadata value is dropped", () => {
  assertEquals(screenMetadata({ sectionId: "x".repeat(200) }), {});
  assertEquals(screenMetadata({ sectionId: "x".repeat(120) }), { sectionId: "x".repeat(120) });
});

Deno.test("non-object metadata is ignored rather than fatal", () => {
  assertEquals(screenMetadata("nope"), {});
  assertEquals(screenMetadata(["nope"]), {});
  assertEquals(screenMetadata(null), {});
});

Deno.test("nothing shaped like a password, terminal, clipboard or capture passes", () => {
  // The screen matches shapes, not meanings. `password=hunter2` is caught
  // because of its label; a bare `hunter2` is not, because no pattern can
  // tell a pasted secret from an opaque id. The structural guarantee is the
  // key allow-list -- there is no key that could carry a secret at all --
  // and this regex only mops up the labelled cases that slip past a key.
  const hostile = [
    "password=hunter2",
    "Bearer sk_live_abcdef",
    "api_key=abcdef",
    "clipboard contents",
    "password: letmein",
    "cat ~/.ssh/id_rsa",
    "cat .env",
    "/etc/shadow",
    "/home/someone/.bashrc",
    "read from /var/log/syslog",
    "my private notes",
    "mic capture",
    "camera capture",
    "screen capture",
    "keylog",
    "reader@example.com",
    "mailto:reader@example.com",
    "5551234567",
    "sudo apt install",
    "rm -rf /",
    "curl http://evil.example",
    "wget http://evil.example",
    "npx publish",
    "chmod 777",
  ];
  for (const value of hostile) {
    assertEquals(isForbiddenMetadataValue(value), true, `${value} should be refused`);
  }
});

Deno.test("ordinary metadata values are not falsely flagged", () => {
  const fine = [
    "hero",
    "learn-more",
    "sidebar",
    "300x250",
    "scroll",
    "pricing",
    "cta-primary",
  ];
  for (const value of fine) {
    assertEquals(isForbiddenMetadataValue(value), false, `${value} should be allowed`);
  }
});

Deno.test("the SDK version is read from the header, not the body", () => {
  const req = new Request("https://api.clirevenue.in/telemetry", {
    headers: { "X-CLIRevenue-SDK-Version": "clirevenue-sdk@1.0.2" },
  });
  assertEquals(telemetrySdkVersion(req), "clirevenue-sdk@1.0.2");
});

Deno.test("a missing or malformed SDK version becomes null so the RPC flags it", () => {
  assertEquals(telemetrySdkVersion(new Request("https://x/")), null);
  const blank = new Request("https://x/", { headers: { "X-CLIRevenue-SDK-Version": "   " } });
  assertEquals(telemetrySdkVersion(blank), null);
  const hostile = new Request("https://x/", {
    headers: { "X-CLIRevenue-SDK-Version": "1.0.2'; drop table--" },
  });
  assertEquals(telemetrySdkVersion(hostile), null);
});

Deno.test("type guards agree with the exported lists", () => {
  for (const type of TELEMETRY_EVENT_TYPES) {
    assertEquals(isTelemetryEventType(type), true);
  }
  assertEquals(isTelemetryEventType("not_an_event"), false);
  assertEquals(isTelemetryEventType(undefined), false);
  assertEquals(isTelemetryEventType(7), false);
  assertEquals(TELEMETRY_METADATA_KEYS.length, 7);
});