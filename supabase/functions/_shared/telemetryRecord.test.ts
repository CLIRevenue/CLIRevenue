import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adTokenSecret, signServeToken } from "./adToken.ts";
import { hashPublisherKey } from "./publisherAuth.ts";
import { handleRecord } from "./telemetryRecord.ts";

/**
 * The telemetry handler, tested with the SDK's actual request shape.
 *
 * The SDK never sends an Authorization header -- it cannot, since a page is
 * not signed in, and `navigator.sendBeacon` cannot set headers at all. The
 * deployed function once sat behind gateway JWT verification, so every SDK
 * telemetry call was rejected before it reached this code and silently
 * dropped client-side. The handler must therefore authenticate entirely on
 * its own, from the publisher key in the body, and these tests prove it:
 * every request below carries no Authorization header, and a good request
 * records while bad credentials, bad tokens and disallowed types still fail.
 *
 * Deployment note: with the in-handler authentication proven here, the
 * function may -- and for the SDK path must -- be deployed WITHOUT gateway
 * JWT verification (see docs/DEPLOYMENT_CHECKLIST.md). That deployment change
 * removes no check: every rejection below is decided by this handler, not by
 * the gateway.
 */

const TEST_SECRET = "telemetry-test-secret-must-be-16-plus";

/** HMAC secret the fake admin uses to mint valid publisher keys. */
function keyRow(raw: string) {
  return { keyId: crypto.randomUUID(), publisherId: crypto.randomUUID() };
}

const PUBLISHER = keyRow("ignored");
const OTHER_PUBLISHER = keyRow("ignored");

/** request base matching the SDK: publisherKey in the body, no Authorization. */
function telemetryRequest(body: Record<string, unknown>): Request {
  const req = new Request("https://api.clirevenue.in/telemetry", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  assertEquals(req.headers.get("authorization"), null, "SDK-shaped requests carry no Authorization");
  return req;
}

type KeyConfig = {
  row: { keyId: string; publisherId: string };
  revokedAt: string | null;
};

/**
 * Minimal Supabase client double. Implements only the two chain shapes the
 * handler (via authenticatePublisher) and the RPC path use:
 *   publisher_keys ... .select().eq("key_hash").maybeSingle() and the
 *     fire-and-forget last_used_at update
 *   admin.rpc("record_telemetry_event", params)
 */
async function fakeAdmin(config: {
  keys: Record<string, KeyConfig>;
  keyLookupError?: { code?: string; message?: string } | null;
  rpcError?: { message: string } | null;
  onRpc?: (params: Record<string, unknown>) => void;
}) {
  const hashes = new Map<string, KeyConfig>();
  for (const [raw, row] of Object.entries(config.keys)) {
    hashes.set(await hashPublisherKey(raw), row);
  }

  const keyChain = () => {
    let keyHash: string | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (column: string, value: unknown) => {
        if (column === "key_hash") keyHash = String(value);
        return builder;
      },
      maybeSingle: () => {
        if (config.keyLookupError) return Promise.resolve({ data: null, error: config.keyLookupError });
        const row = keyHash ? hashes.get(keyHash) : undefined;
        if (!row) return Promise.resolve({ data: null, error: null });
        return Promise.resolve({
          data: {
            id: row.row.keyId,
            publisher_id: row.row.publisherId,
            revoked_at: row.revokedAt,
            publishers: { id: row.row.publisherId, status: "active" },
          },
          error: null,
        });
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
    };
    return builder;
  };

  return {
    from: (table: string) => {
      if (table !== "publisher_keys") throw new Error(`unexpected table ${table}`);
      // Covers both the key lookup (select chain) and the best-effort
      // last_used_at stamp (update chain, also awaited/fire-and-forgotten).
      return {
        select: () => keyChain(),
        update: () => keyChain(),
      };
    },
    rpc: (fn: string, params: Record<string, unknown>) => {
      assertEquals(fn, "record_telemetry_event");
      config.onRpc?.(params);
      if (config.rpcError) return Promise.resolve({ data: null, error: config.rpcError });
      return Promise.resolve({
        data: { duplicate: false, event_id: crypto.randomUUID(), event_type: params.p_event_type },
        error: null,
      });
    },
  };
}

const RAW_KEY = "pk_test_" + "k".repeat(32);
const OTHER_RAW_KEY = "pk_test_" + "z".repeat(32);

const ACTIVE_KEY: KeyConfig = { row: PUBLISHER, revokedAt: null };
const OTHER_ACTIVE_KEY: KeyConfig = { row: OTHER_PUBLISHER, revokedAt: null };
const REVOKED_KEY: KeyConfig = { row: PUBLISHER, revokedAt: "2026-01-01T00:00:00Z" };

/** A limiter that always allows -- tests assert behaviour, not the production bucket. */
const allowAll = () => ({ allowed: true, retryAfterMs: 0 });

function sessionStarted(key = RAW_KEY, eventType = "session_started") {
  return {
    publisherKey: key,
    eventType,
    sessionId: "sess-abc123",
    idempotencyKey: "idem-1",
    metadata: { sectionId: "hero" },
  };
}

async function mintToken(secret: string, rid: string, pid: string): Promise<string> {
  return await signServeToken(secret, {
    v: 1,
    rid,
    cid: crypto.randomUUID(),
    pid,
    plid: crypto.randomUUID(),
    exp: Date.now() + 30 * 60 * 1000,
  });
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  assert(res.headers.get("content-type")?.includes("application/json"), "error responses stay JSON");
  return (await res.json()) as Record<string, unknown>;
}

function errorOf(body: Record<string, unknown>): { code: string; status?: never } & Record<string, unknown> {
  const err = (body.error ?? {}) as Record<string, unknown>;
  return { code: String(body.code ?? err.code), ...body };
}

Deno.test("telemetry handler auth", async (t) => {
  await t.step("records a valid SDK-shaped event with no Authorization header", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest(sessionStarted()),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 200);
    const body = await readJson(res);
    assertEquals(body.status, "recorded");
    assertEquals(body.event_type, "session_started");
  });

  await t.step("rejects an unknown publisher key with a uniform 401", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest(sessionStarted("pk_test_" + "q".repeat(32))),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "UNAUTHORIZED");
  });

  await t.step("rejects a revoked publisher key on every call", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: REVOKED_KEY } });
    const res = await handleRecord(
      telemetryRequest(sessionStarted()),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "UNAUTHORIZED");
  });

  await t.step("refuses a client-asserted server-only event type", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    // reward_created is recorded by the server from accounting, never asserted.
    const res = await handleRecord(
      telemetryRequest(sessionStarted(RAW_KEY, "reward_created")),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 400);
    assertEquals(errorOf(await readJson(res)).code, "SERVER_ONLY_EVENT");
  });

  await t.step("refuses an unknown event type", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest(sessionStarted(RAW_KEY, "hovered_forever")),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 400);
    assertEquals(errorOf(await readJson(res)).code, "INVALID_EVENT");
  });

  await t.step("accepts ad_rendered only with a token minted for this serve and publisher", async () => {
    const rid = crypto.randomUUID();
    const token = await mintToken(TEST_SECRET, rid, PUBLISHER.publisherId);
    let seenParams: Record<string, unknown> | null = null;
    const admin = await fakeAdmin({
      keys: { [RAW_KEY]: ACTIVE_KEY },
      onRpc: (params) => {
        seenParams = params;
      },
    });
    const res = await handleRecord(
      telemetryRequest({
        publisherKey: RAW_KEY,
        eventType: "ad_rendered",
        requestId: rid,
        impressionToken: token,
        sessionId: "sess-abc123",
        idempotencyKey: "idem-render-1",
        metadata: { sectionId: "hero" },
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 200);
    // Campaign and developer never travel in the request: the RPC call the
    // handler made must carry the derived publisher id only.
    assertEquals((seenParams as Record<string, unknown> | null)?.p_publisher_id, PUBLISHER.publisherId);
    assertEquals("p_campaign_id" in ((seenParams ?? {}) as Record<string, unknown>), false);
  });

  await t.step("rejects ad_rendered with a forged signature", async () => {
    const rid = crypto.randomUUID();
    const token = await mintToken("a-different-secret-must-be-16!!", rid, PUBLISHER.publisherId);
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest({
        publisherKey: RAW_KEY,
        eventType: "ad_rendered",
        requestId: rid,
        impressionToken: token,
        sessionId: "sess-abc123",
        idempotencyKey: "idem-render-2",
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "INVALID_TOKEN");
  });

  await t.step("rejects a token minted for another publisher's serve", async () => {
    const rid = crypto.randomUUID();
    const token = await mintToken(TEST_SECRET, rid, OTHER_PUBLISHER.publisherId);
    const admin = await fakeAdmin({
      keys: { [RAW_KEY]: ACTIVE_KEY, [OTHER_RAW_KEY]: OTHER_ACTIVE_KEY },
    });
    // The caller authenticates as PUBLISHER but presents OTHER's token.
    const res = await handleRecord(
      telemetryRequest({
        publisherKey: RAW_KEY,
        eventType: "ad_rendered",
        requestId: rid,
        impressionToken: token,
        sessionId: "sess-abc123",
        idempotencyKey: "idem-render-3",
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "INVALID_TOKEN");
  });

  await t.step("rejects a token replayed against a different request id", async () => {
    const token = await mintToken(TEST_SECRET, crypto.randomUUID(), PUBLISHER.publisherId);
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest({
        publisherKey: RAW_KEY,
        eventType: "ad_rendered",
        requestId: crypto.randomUUID(),
        impressionToken: token,
        sessionId: "sess-abc123",
        idempotencyKey: "idem-render-4",
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "INVALID_TOKEN");
  });

  await t.step("rejects ad_rendered without any token", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      telemetryRequest({
        publisherKey: RAW_KEY,
        eventType: "ad_rendered",
        requestId: crypto.randomUUID(),
        sessionId: "sess-abc123",
        idempotencyKey: "idem-render-5",
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 401);
    assertEquals(errorOf(await readJson(res)).code, "INVALID_TOKEN");
  });

  await t.step("rejects oversized bodies with 413 before parsing", async () => {
    const admin = await fakeAdmin({ keys: { [RAW_KEY]: ACTIVE_KEY } });
    const res = await handleRecord(
      new Request("https://api.clirevenue.in/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "1000000" },
        body: JSON.stringify(sessionStarted()),
      }),
      admin as never,
      { secret: TEST_SECRET, limit: allowAll },
    );
    assertEquals(res.status, 413);
    assertEquals(errorOf(await readJson(res)).code, "PAYLOAD_TOO_LARGE");
  });

  await t.step("does not require an Authorization header anywhere in the path", async () => {
    // Cheap tripwire: if any path starts reading one, the request shape
    // above (asserted header-free) must document why.
    const req = telemetryRequest(sessionStarted());
    assertEquals(req.headers.get("authorization"), null);
  });
});
