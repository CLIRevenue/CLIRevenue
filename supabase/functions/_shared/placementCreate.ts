/**
 * Publisher-scoped placement creation for the CLI.
 *
 * The CLI's placement editor needs a `placement_key` that exists on the
 * publisher's account before it can fetch a creative, but until now nothing
 * outside the admin dashboard could create one: `cli/index.ts` only ever read
 * placements, and `placements/index.ts` is a stub. So `clirevenue editor`
 * refused to start for a brand-new publisher and told them to use a dashboard
 * the CLI itself had no way to drive.
 *
 * This module is the whole create path, split the same way `serveAuthz.ts` is:
 *
 *   1. `validatePlacementInput`  -- pure. What a caller may ask for.
 *   2. `authorizePlacementCreate` -- pure. Whose row may be written.
 *   3. `classifyPlacementFailure` -- pure. How a database error is reported.
 *   4. `handleCreatePlacement`   -- the only part that touches a client, and it
 *      takes that client as an argument, so the whole flow is executable in
 *      tests against a fake without a database or a network.
 *
 * The invariant this file exists to defend:
 *
 *   CLIENT INPUT MUST NEVER DETERMINE WHICH PUBLISHER OWNS A PLACEMENT.
 *
 * A caller controls the publisher key, the requested key, the name, and any
 * `publisherId` they care to send. The only trustworthy link between a
 * request and a publisher is `authenticatePublisher`, which resolves the key
 * hash against `publisher_keys` and returns the publisher the key belongs to.
 * So every write here is scoped to that derived id, and a `publisherId` in the
 * body is only ever compared against it -- never used as the filter. The
 * comparison exists solely so a mismatch is a loud 403 instead of a silently
 * ignored field, which would teach integrators that the field works.
 *
 * Deliberately no schema change is required: `placements` already carries
 * `publisher_id`, `placement_key` and `UNIQUE (publisher_id, placement_key)`,
 * which is exactly the shape an idempotent create needs. Geometry is *not*
 * stored here -- width/height/anchor belong to the SDK's client-side layout
 * vocabulary and live in the user's own `clirevenue.config.json`.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { authenticatePublisher } from "./publisherAuth.ts";

/**
 * A placement key has to survive being embedded in a selector, a URL segment
 * and a JSON import, so it is restricted to characters that are safe in all
 * three. This is stricter than the column type (TEXT, unconstrained) on
 * purpose: the delivery path accepts any historical string, and narrowing what
 * can be *created* cannot invalidate a key that already serves traffic.
 */
const PLACEMENT_KEY_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/;

export const PLACEMENT_KEY_MIN_LENGTH = 2;
export const PLACEMENT_KEY_MAX_LENGTH = 64;
export const PLACEMENT_NAME_MAX_LENGTH = 120;

/** PostgREST/Postgres codes this module interprets. */
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** The subset of the placements row this surface is allowed to expose. */
export type PlacementRecord = {
  id: string;
  key: string;
  name: string | null;
  enabled: boolean;
  allowedAudienceId: string | null;
};

export type PlacementCreateInput = {
  placementKey: string;
  name: string | null;
  enabled: boolean;
};

/**
 * Validate a requested placement.
 *
 * Returns every problem rather than the first, so a caller fixing a bad
 * request does not have to iterate one field per round trip. Pure, and
 * deliberately quiet about shape: a field of the wrong type is reported as a
 * problem rather than coerced, because silently accepting `enabled: "yes"` and
 * storing true is how a caller ends up with a configuration they never asked
 * for.
 */
export function validatePlacementInput(raw: unknown): {
  ok: boolean;
  value?: PlacementCreateInput;
  problems: string[];
} {
  const problems: string[] = [];
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const rawKey = body.placementKey;
  let placementKey = "";
  if (typeof rawKey !== "string") {
    problems.push("placementKey must be a string.");
  } else {
    placementKey = rawKey.trim();
    if (placementKey.length < PLACEMENT_KEY_MIN_LENGTH) {
      problems.push(`placementKey must be at least ${PLACEMENT_KEY_MIN_LENGTH} characters.`);
    } else if (placementKey.length > PLACEMENT_KEY_MAX_LENGTH) {
      problems.push(`placementKey must be at most ${PLACEMENT_KEY_MAX_LENGTH} characters.`);
    } else if (!PLACEMENT_KEY_RE.test(placementKey)) {
      problems.push(
        "placementKey may contain only lowercase letters, digits, hyphens and underscores, " +
          "and must start with a letter or digit.",
      );
    }
  }

  let name: string | null = null;
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== "string") {
      problems.push("name must be a string.");
    } else {
      const trimmed = body.name.trim();
      if (trimmed.length > PLACEMENT_NAME_MAX_LENGTH) {
        problems.push(`name must be at most ${PLACEMENT_NAME_MAX_LENGTH} characters.`);
      } else if (trimmed.length > 0) {
        name = trimmed;
      }
    }
  }

  let enabled = true;
  if (body.enabled !== undefined && body.enabled !== null) {
    if (typeof body.enabled !== "boolean") {
      problems.push("enabled must be a boolean.");
    } else {
      enabled = body.enabled;
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return { ok: true, value: { placementKey, name, enabled }, problems: [] };
}

export type PlacementCreateAuthzFailure = "PUBLISHER_MISMATCH";

export type PlacementCreateAuthzInput = {
  /** Publisher the key authenticated as. Derived from the key hash, never sent. */
  authenticatedPublisherId: string;
  /** `publisherId` from the request body, if the caller sent one at all. */
  claimedPublisherId?: unknown;
};

export type PlacementCreateAuthzResult =
  | { ok: true }
  | { ok: false; failure: PlacementCreateAuthzFailure };

/**
 * Decide whether the request may proceed, and on whose behalf.
 *
 * The rule is narrow on purpose: a caller that omits `publisherId` is fine
 * (the field is never load-bearing), and a caller that sends one which
 * disagrees with the key is refused. Refusing is the whole point -- accepting
 * the field silently would make the API look like it supports caller-directed
 * writes while the row it actually wrote belonged to somebody else.
 */
export function authorizePlacementCreate(
  input: PlacementCreateAuthzInput,
): PlacementCreateAuthzResult {
  const claimed = input.claimedPublisherId;
  if (claimed === undefined || claimed === null) return { ok: true };
  if (typeof claimed !== "string") return { ok: false, failure: "PUBLISHER_MISMATCH" };
  if (claimed !== input.authenticatedPublisherId) {
    return { ok: false, failure: "PUBLISHER_MISMATCH" };
  }
  return { ok: true };
}

export type PlacementCreateFailureCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "DUPLICATE_PLACEMENT"
  | "PUBLISHER_MISMATCH"
  | "INVALID_PLACEMENT"
  | "INTERNAL_ERROR";

/** The limiter shape `createRateLimiter` returns, narrowed to what is used. */
export type PlacementCreateLimiter = (
  key: string,
) => { allowed: boolean; retryAfterMs: number };

export type PlacementCreateOptions = {
  /**
   * Injected so the caller owns the policy (how many creates per publisher)
   * and so a test can drive the limit without waiting on a real clock.
   */
  limit?: PlacementCreateLimiter;
};

/** Map a PostgREST error onto the code this API reports. */
export function classifyPlacementFailure(error: { code?: string | null } | null): PlacementCreateFailureCode {
  const code = error?.code ?? null;
  if (code === UNIQUE_VIOLATION) return "DUPLICATE_PLACEMENT";
  if (code === FOREIGN_KEY_VIOLATION) return "INVALID_PLACEMENT";
  return "INTERNAL_ERROR";
}

/** Shape a row for the wire. Identical to what the GET route returns. */
export function toPlacementRecord(row: Record<string, unknown>): PlacementRecord {
  return {
    id: String(row.id ?? ""),
    key: String(row.placement_key ?? ""),
    name: typeof row.name === "string" ? row.name : null,
    enabled: row.enabled !== false,
    allowedAudienceId:
      typeof row.allowed_audience_id === "string" ? row.allowed_audience_id : null,
  };
}

const PLACEMENT_COLUMNS = "id, placement_key, name, enabled, allowed_audience_id";

/** A transport-free result; the edge function turns this into a Response. */
export type PlacementCreateResult =
  | { status: 200; code: null; message: null; body: { publisherId: string; placement: PlacementRecord; created: boolean } }
  | { status: 429; code: "RATE_LIMITED"; message: string; retryAfterMs: number; body: null }
  | { status: 400 | 401 | 403 | 500; code: PlacementCreateFailureCode; message: string; body: null };

/**
 * Read the status and code out of a Response that `authenticatePublisher`
 * already produced.
 *
 * That helper returns a Response because its other callers hand it straight
 * back to the browser. Returning one from here too would make this function
 * untestable without a Response-consuming caller, so the response is decoded
 * instead. Both fields are read rather than assumed: a 500 means the key lookup
 * itself failed, and reporting that as 401 would tell a publisher with a
 * perfectly good key that it was revoked.
 */
async function decodeApiError(res: Response): Promise<{ status: 400 | 401 | 500; code: PlacementCreateFailureCode }> {
  const status = res.status === 500 ? 500 : 401;
  let code: PlacementCreateFailureCode = status === 500 ? "INTERNAL_ERROR" : "UNAUTHORIZED";
  try {
    const payload = (await res.clone().json()) as { code?: string } | null;
    if (payload && typeof payload.code === "string") {
      code = payload.code as PlacementCreateFailureCode;
    }
  } catch {
    /* A non-JSON error body keeps the conservative default. */
  }
  return { status, code };
}

/**
 * Create one placement for the authenticated publisher.
 *
 * `admin` is injected rather than constructed here so this whole flow runs in
 * tests against a fake client. It must be a service-role client: `placements`
 * grants INSERT to `service_role` only (000014), and there is no policy that
 * would let a request-scoped role write -- which is why the caller
 * authenticates with a publishable key and then writes with the service role,
 * exactly as every other publisher-facing route in this repo does.
 *
 * `alreadyExists` is resolved by reading the row back rather than by trusting
 * the constraint error, and that read is scoped to the derived publisher id.
 * So a duplicate key belonging to a *different* publisher is simply not found:
 * the uniqueness constraint is per publisher, and the create stays scoped to
 * this one. That is what lets two publishers both hold a placement called
 * `home` without either being able to read or overwrite the other's.
 *
 * The rate limit is applied *after* authentication, keyed by the derived
 * publisher id, because the thing worth protecting is a publisher creating
 * placements in a loop -- an unauthenticated flood never reaches the insert,
 * it dies at the key lookup above. This is the ordering the delivery and
 * telemetry routes already use.
 */
export async function handleCreatePlacement(
  admin: SupabaseClient,
  rawKey: unknown,
  body: unknown,
  options: PlacementCreateOptions = {},
): Promise<PlacementCreateResult> {
  const auth = await authenticatePublisher(admin, rawKey);
  if ("error" in auth) {
    const failure = await decodeApiError(auth.error);
    return {
      status: failure.status,
      code: failure.code,
      message:
        failure.status === 401
          ? "A valid publisher key is required."
          : "Could not verify the publisher key.",
      body: null,
    };
  }

  const publisherId = auth.identity.publisherId;

  const limited = options.limit?.(publisherId);
  if (limited && !limited.allowed) {
    return {
      status: 429,
      code: "RATE_LIMITED",
      message: "Too many placement creations. Retry after the indicated delay.",
      retryAfterMs: limited.retryAfterMs,
      body: null,
    };
  }

  const authz = authorizePlacementCreate({
    authenticatedPublisherId: publisherId,
    claimedPublisherId: (body as { publisherId?: unknown } | null | undefined)?.publisherId,
  });
  if (!authz.ok) {
    return {
      status: 403,
      code: "PUBLISHER_MISMATCH",
      message: "The publisher key does not belong to that publisher.",
      body: null,
    };
  }

  const validation = validatePlacementInput(body);
  if (!validation.ok || !validation.value) {
    return {
      status: 400,
      code: "INVALID_PLACEMENT",
      message: validation.problems.join(" "),
      body: null,
    };
  }

  const { placementKey, name, enabled } = validation.value;

  const { data, error } = await admin
    .from("placements")
    .insert({ publisher_id: publisherId, placement_key: placementKey, name, enabled })
    .select(PLACEMENT_COLUMNS)
    .single();

  if (!error && data) {
    return {
      status: 200,
      code: null,
      message: null,
      body: {
        publisherId,
        placement: toPlacementRecord(data as Record<string, unknown>),
        created: true,
      },
    };
  }

  const classified = classifyPlacementFailure(error as { code?: string | null } | null);

  if (classified === "DUPLICATE_PLACEMENT") {
    // A retry, or two CLI processes racing. Read the row back, scoped to this
    // publisher, and answer 200 with `created: false` rather than an error:
    // the resource the caller asked for exists and belongs to them, so
    // failing the request would report a problem where there is none.
    const existing = await admin
      .from("placements")
      .select(PLACEMENT_COLUMNS)
      .eq("publisher_id", publisherId)
      .eq("placement_key", placementKey)
      .limit(1)
      .maybeSingle();

    if (existing.error) {
      console.error("placement duplicate read-back failed:", existing.error.message);
      return {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Could not create the placement.",
        body: null,
      };
    }

    const row = existing.data as Record<string, unknown> | null;
    if (!row) {
      // The constraint fired on something other than this publisher's key.
      // Reporting it as a duplicate would point the caller at the wrong row.
      return {
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Could not create the placement.",
        body: null,
      };
    }

    return {
      status: 200,
      code: null,
      message: null,
      body: { publisherId, placement: toPlacementRecord(row), created: false },
    };
  }

  console.error("placement insert failed:", (error as { message?: string } | null)?.message);
  return {
    status: 500,
    code: classified,
    message: "Could not create the placement.",
    body: null,
  };
}