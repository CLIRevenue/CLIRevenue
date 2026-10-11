/**
 * The CLI's backend surface.
 *
 * Two routes, both scoped to the publisher that the request's publishable key
 * resolves to:
 *
 *   GET  /cli/placements  list the publisher's placements (read-only, and the
 *                          call `verifyKey` makes during `clirevenue setup`)
 *   POST /cli/placements  create one placement for that publisher
 *
 * The create route exists because the placement editor needs a
 * `placement_key` that exists on the publisher's account before it can fetch
 * a creative, and nothing outside the admin dashboard could create one. The
 * decision logic is in `_shared/placementCreate.ts` so it is testable without
 * a database or a network; this file owns routing, HTTP and rate-limit policy.
 *
 * The publisher is derived from the key hash by `authenticatePublisher`, never
 * read from the request body -- see the header of `placementCreate.ts` for why
 * that is the invariant worth defending.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { json, apiError, optionsResponse, restPath, serveWithCors, readJsonObjectBody } from "../_shared/http.ts";
import { adminClient } from "../_shared/auth.ts";
import { authenticatePublisher, createRateLimiter } from "../_shared/publisherAuth.ts";
import { handleCreatePlacement, type PlacementRecord } from "../_shared/placementCreate.ts";

/**
 * Write budget for the create route.
 *
 * Deliberately far tighter than `rateLimitDelivery` (capacity 120, refill 2/s):
 * creating a placement is something a person does a handful of times while
 * wiring up a site, whereas delivery is the hot path a live page generates
 * thousands of times an hour. Sharing the delivery budget would let a bug in a
 * publisher's page starve them of placement creation entirely.
 */
const rateLimitCliWrites = createRateLimiter({ capacity: 20, refillPerSecond: 1 });

const PLACEMENT_COLUMNS = "id, placement_key, name, enabled, allowed_audience_id";

type PlacementRow = {
  id: string;
  placement_key: string;
  name: string | null;
  enabled: boolean;
  allowed_audience_id: string | null;
};

function toRecord(p: PlacementRow): PlacementRecord {
  return {
    id: p.id,
    key: p.placement_key,
    name: p.name,
    enabled: p.enabled,
    allowedAudienceId: p.allowed_audience_id,
  };
}

/**
 * Resolve the caller's publisher key.
 *
 * Preferred: the `x-clirevenue-publisher-key` header. A credential in a
 * query string ends up in gateway logs, proxy logs and shell history, so new
 * clients (the CLI, the editor) send the header. The legacy
 * `?publisherKey=` query parameter is retained because every published CLI
 * in the field sends it; see docs/DEPLOYMENT_CHECKLIST.md for the
 * deprecation plan. The header wins when both are present so a client in
 * transition cannot be confused by a stale query string.
 */
function readPublisherKey(req: Request, url: URL): string {
  const header = req.headers.get("x-clirevenue-publisher-key")?.trim() ?? "";
  if (header) return header;
  return url.searchParams.get("publisherKey")?.trim() ?? "";
}

/**
 * Parse a JSON body, tolerating an empty one.
 *
 * A malformed body is `null` rather than an exception: the CLI is the caller
 * here, and a stack trace in a terminal is a worse answer than a 400 it can
 * print. Sizes are capped first: a CLI write body is a few hundred bytes, so
 * anything past the shared limit is rejected without being parsed.
 * `publisher_keys/index.ts` uses the same convention.
 */
async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  const read = await readJsonObjectBody(req, { emptyAsObject: true });
  if (!read.ok) throw read.response;
  return read.body;
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  const url = new URL(req.url);
  // restPath() collapses /functions/v1/cli/placements, /cli/placements and
  // /api/cli/placements onto the same branch. The route used to be matched
  // with a raw endsWith("/placements"), which also matched /admin/placements
  // if that path were ever routed here -- the gateway sends the function name
  // verbatim, so the prefix is not guaranteed to be stripped.
  const segments = restPath(url.pathname, "cli");
  if (segments.length !== 1 || segments[0] !== "placements") {
    return apiError("NOT_FOUND", "Unknown CLI route.", 404, {}, req);
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }

  const admin = adminClient();

  if (req.method === "GET") {
    // The read path is dual: the header is preferred, the query string is
    // legacy (see readPublisherKey). A missing key is a 400 on both, because
    // nothing was supplied at all.
    const publisherKey = readPublisherKey(req, url);

    if (!publisherKey) {
      return apiError("INVALID_REQUEST", "publisherKey is required.", 400, {}, req);
    }

    const auth = await authenticatePublisher(admin, publisherKey);
    if ("error" in auth) return auth.error;

    const { data: placements, error: placementsError } = await admin
      .from("placements")
      .select(PLACEMENT_COLUMNS)
      .eq("publisher_id", auth.identity.publisherId)
      .order("placement_key", { ascending: true });

    if (placementsError) {
      console.error("placements query failed:", placementsError.message);
      return apiError("INTERNAL_ERROR", "Could not load placements.", 500, {}, req);
    }

    return json(
      {
        publisherId: auth.identity.publisherId,
        placements: ((placements ?? []) as PlacementRow[]).map(toRecord),
      },
      200,
      req,
    );
  }

  // POST. The key travels in the body, as it does on every other
  // publisher-facing call (`ads`, `telemetry`): a credential in a query string
  // ends up in gateway logs and browser history, and this route is a write.
  // An oversized body is refused with its 413 before JSON parsing.
  let body: Record<string, unknown> | null;
  try {
    body = await readJson(req);
  } catch (thrown) {
    return thrown as Response;
  }
  if (!body) {
    return apiError("INVALID_REQUEST", "A JSON body is required.", 400, {}, req);
  }

  const result = await handleCreatePlacement(admin, body.publisherKey, body, {
    limit: rateLimitCliWrites,
  });

  if (result.status === 200) {
    return json(result.body, 200, req);
  }

  if (result.status === 429) {
    return apiError(
      result.code,
      result.message,
      429,
      { retry_after_ms: result.retryAfterMs },
      req,
    );
  }

  return apiError(result.code, result.message, result.status, {}, req);
});

serve(handler);