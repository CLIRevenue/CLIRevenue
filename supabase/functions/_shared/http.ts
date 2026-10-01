/*
 * CORS
 *
 * There are three audiences for these functions and they do not want the
 * same policy:
 *   - public ad delivery (get_active_campaign, and later the SDK's serve
 *     endpoint) must be callable from third-party developer applications;
 *   - the authenticated advertiser/developer APIs (campaigns, rewards,
 *     payouts, auth) are bearer-token calls;
 *   - privileged internals (settle_rewards) are never called by a browser.
 *
 * None of these reads a cookie, so a wildcard origin cannot leak a
 * credential — the token is always explicit. A deployment that still
 * wants a hard origin boundary sets APP_ORIGINS to a comma-separated
 * allow-list, and every response then echoes only those origins.
 */
import { AsyncLocalStorage } from "node:async_hooks";

function denoEnv(key: string): string | undefined {
  try {
    const deno = (globalThis as { Deno?: { env?: { get(k: string): string | undefined } } }).Deno;
    return deno?.env?.get(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function allowedOrigins(): string[] {
  return (denoEnv("APP_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * The in-flight request, for code that cannot be handed a `Request`.
 *
 * Why this exists: building a correct response requires echoing the caller's
 * Origin, which is only readable from the Request. Threading that Request
 * through every helper is the obvious fix, but the error paths are where it
 * matters most -- an authentication failure is exactly the response an
 * attacker's browser reads -- and those are the paths most likely to have
 * been written without it. As written, 100 of 128 apiError() call sites did
 * not pass a Request, so with an allow-list configured an auth failure
 * answered with the *first* allow-listed origin rather than the caller's.
 *
 * A plain module-level variable would be wrong: Edge Functions handle
 * requests concurrently, so two in-flight requests would clobber each other.
 * AsyncLocalStorage is per-async-context, so each request sees only its own.
 *
 * `serveWithCors` below is the one place this is populated. Passing `req`
 * explicitly still wins and is preferred where it is already available.
 */
const requestScope = new AsyncLocalStorage<Request>();

/** Run `fn` with `req` ambient, so corsFor() can echo the right origin. */
export function withRequestScope<T>(req: Request, fn: () => T): T {
  return requestScope.run(req, fn);
}

/**
 * The Origin header of the request currently being handled, if known.
 * Returns "" when there is no request in scope.
 */
function ambientOrigin(): string {
  const req = requestScope.getStore();
  if (!req) return "";
  try {
    return req.headers.get("origin") ?? "";
  } catch {
    return "";
  }
}

/**
 * The origin to allow for this request.
 *
 * Fails CLOSED. When an allow-list is configured and the request's Origin is
 * not on it -- including when the origin cannot be determined at all --
 * this returns "". An empty Access-Control-Allow-Origin makes the browser
 * reject the response, which is the correct outcome for an unknown caller.
 *
 * It deliberately does NOT fall back to `allowed[0]`. Doing so would hand a
 * disallowed origin an Access-Control-Allow-Origin naming a different,
 * allow-listed site: confusing, and a foothold for origin-confusion bugs
 * elsewhere. A browser only matches its own origin, so this cannot be used
 * to read another origin's response -- but leaking another site's name in a
 * header is still a defect, and the loud failure is better than the quiet
 * mislabel.
 */
export function originFor(req?: Request): string {
  const allowed = allowedOrigins();
  // No allow-list configured: these functions read no cookie, and the
  // caller always presents its token explicitly, so a wildcard leaks no
  // credential. This is the default and the current deployment posture.
  if (!allowed.length) return "*";
  const origin = req ? (req.headers.get("origin") ?? "") : ambientOrigin();
  if (!origin) return "";
  return allowed.includes(origin) ? origin : "";
}

export function corsFor(req?: Request): Record<string, string> {
  const origin = originFor(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-settlement-secret, x-idempotency-key, x-clirevenue-sdk-version",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  };
  // An unknown origin gets NO Access-Control-Allow-Origin at all, rather than
  // an empty or wrong one. The browser then blocks the response, which is the
  // fail-closed behaviour originFor() documents.
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  if (allowedOrigins().length) headers["Vary"] = "Origin";
  return headers;
}

/**
 * Wrap a Deno `serve` handler so the request is ambient for the whole call
 * tree, including error paths that were never handed a Request.
 *
 * Every response builder -- json(), apiError(), optionsResponse() -- reads the
 * ambient request, so this is what makes an APP_ORIGINS allow-list honoured
 * everywhere rather than only where `req` happened to be threaded through.
 *
 * The origin must be copied to a plain string before the ALS run: the Request
 * object is only valid for the duration of its own fetch event.
 */
export function serveWithCors(handler: (req: Request) => Response | Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get("origin") ?? "";
    return await withRequestScope(
      // A stand-in carrying only the header we need, so no body/stream is held.
      new Request(req.url, { headers: { origin } }),
      () => handler(req),
    );
  };
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), "Content-Type": "application/json" },
  });
}

export function apiError(
  code: string,
  message: string,
  status: number,
  extra: Record<string, unknown> = {},
  req?: Request,
): Response {
  /*
   * `req` must be threaded through to json(), or corsFor(undefined) is used
   * and originFor falls back to allowed[0] -- telling a browser it is the
   * first allow-listed origin no matter who it actually is. That turns every
   * error response into an opaque CORS failure for every other allowed
   * origin, so callers cannot read the error code.
   */
  return json({ error: { code, message }, code, ...extra }, status, req);
}

export function optionsResponse(req?: Request): Response {
  return new Response("ok", { status: 200, headers: corsFor(req) });
}

/**
 * Resolve the route a function is handling.
 *
 * An Edge Function sees the path it was invoked on, verbatim. That means
 * the same handler is reachable as
 *   /functions/v1/rewards                 (gateway path, what the browser uses)
 *   /functions/v1/rewards/api/rewards     (legacy layout the old client used)
 *   /api/rewards                          (documented contract)
 * and all three must land on the same branch. Do not assume the prefix is
 * stripped: probe every shape here instead.
 */
export function restPath(pathname: string, fnName: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "functions" && parts[1] === "v1") parts.splice(0, 2);
  while (parts.length && (parts[0] === fnName || parts[0] === "api")) parts.shift();
  return parts;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
