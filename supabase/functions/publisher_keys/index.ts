/**
 * publisher_keys — manage a developer's publisher keys.
 *
 * The contract, in order:
 *
 *   1. Authenticate the caller from the Bearer token (developer's JWT).
 *   2. Require the developer role through the shared guard, which also proves
 *      the developer_accounts row exists.
 *   3. Get the developer's publisher (there should be exactly one, or we can
 *      take the first one if multiple? But the system ensures one per profile).
 *   4. Depending on the HTTP method:
 *        GET: list all keys for the publisher (excluding revoked? or include
 *             revoked with status). Return metadata only: id, key_prefix,
 *             label, created_at, last_used_at, revoked_at, key_env.
 *        POST: create a new key for the publisher.
 *              Requires a label in the body (optional?).
 *              Generates a new test key (we never create live keys via page
 *              load; live keys are a commercial decision).
 *              Returns the raw key exactly once (on the response that created
 *              it) and the metadata.
 *        DELETE: revoke a key. Requires key_id in the body.
 *              Sets revoked_at to now. Returns success.
 *
 *   5. For POST, we must ensure we never return the raw key except on the
 *      response that created it. We follow the same pattern as
 *      provision_publisher: generate, hash, insert, and return the raw key
 *      only in the response that did the insert.
 *
 *   6. We never expose key_hash in any response.
 *
 *   7. We use the existing publisherAuth helpers for key generation and
 *      hashing to keep a single source of truth.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

import { adminClient, getJwtUser, requireDeveloper } from "../_shared/auth.ts";
import {
  apiError,
  json,
  optionsResponse,
  restPath,
  serveWithCors,
} from "../_shared/http.ts";
import {
  generatePublisherKey,
  hashPublisherKey,
  keyPrefix,
} from "../_shared/publisherAuth.ts";

const KEY_ENV = "test" as const;

/** PostgREST unique_violation. Expected on the key insert when two requests
 *  race; we retry once. */
const UNIQUE_VIOLATION = "23505";

const INSUFFICIENT_PRIVILEGE = "42501";

/** PostgREST PGRST116: "JSON object requested, multiple (or no) rows returned".
 *  `.single()` reports the same code for zero rows and for more than one, so
 *  it describes a lookup that found nothing to own, never a fault. */
const NOT_SINGLE = "PGRST116";

/**
 * True when a PostgREST error is the unique_violation (23505) we expect from
 * `publisher_keys_active_env_key`.
 *
 * The cast is unavoidable and deliberately narrow: PostgREST hands back a bare
 * JSON object, so the code is a runtime property of an `unknown`. Anything
 * that is not an object with a string `code` is simply not a unique violation.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

/**
 * Carries a 23505 out of `createKey` so the handler can answer with the
 * existing row's metadata instead of a bare 500.
 *
 * Throwing the raw PostgREST error used to work for the `code` check and
 * nothing else: the handler had no way to tell "this publisher already has an
 * active key in this environment" apart from a genuine fault, so both became
 * the same 500. A developer clicking "create key" twice got a server error
 * with no indication that the thing they wanted already exists.
 */
class ActiveKeyExistsError extends Error {
  constructor(readonly existing: KeyRow) {
    super("An active key already exists for this environment.");
    this.name = "ActiveKeyExistsError";
  }
}

type KeyRow = {
  id: string;
  key_prefix: string;
  key_env: "test" | "live" | null;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const KEY_COLUMNS = "id, key_prefix, key_env, label, created_at, last_used_at, revoked_at";

function asKeyRow(data: unknown): KeyRow | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.key_prefix === "string"
    ? ({
        id: row.id,
        key_prefix: row.key_prefix,
        key_env: row.key_env === "test" || row.key_env === "live" ? row.key_env : null,
        label: typeof row.label === "string" ? row.label : null,
        created_at: typeof row.created_at === "string" ? row.created_at : null,
        last_used_at: typeof row.last_used_at === "string" ? row.last_used_at : null,
        revoked_at: typeof row.revoked_at === "string" ? row.revoked_at : null,
      } as KeyRow)
    : null;
}

/**
 * Resolve the caller's publisher.
 *
 * Zero rows is an expected answer, not an error. publishers.owner_profile_id
 * is nullable and is written only by provision_publisher_slot(), so a
 * developer who has not provisioned yet simply owns nothing and the caller
 * answers 404. `.single()` would raise PGRST116 for that case, so the query
 * is narrowed to at most one row instead: `.maybeSingle()` yields null when
 * there is nothing and no longer raises when there is exactly one, which is
 * what `.single()` did correctly.
 *
 * The extra `.limit(1)` is what keeps this safe if a row ever slipped past
 * the partial unique index publishers_owner_profile_id_key (000016): a
 * duplicate degrades to the first row instead of turning a page load into a
 * 500. Ownership is still the filter -- this never adopts a publisher that
 * belongs to somebody else, or one with a NULL owner_profile_id.
 */
async function getPublisherId(
  admin: ReturnType<typeof adminClient>,
  profileId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("publishers")
    .select("id")
    .eq("owner_profile_id", profileId)
    .limit(1)
    .maybeSingle();
  if (error) {
    // maybeSingle() only surfaces a genuine query failure.
    throw new Error(`get publisher: ${error.message}`);
  }
  return (data as { id: string | null } | null)?.id ?? null;
}

async function listKeys(
  admin: ReturnType<typeof adminClient>,
  publisherId: string,
): Promise<KeyRow[]> {
  const { data, error } = await admin
    .from("publisher_keys")
    .select(KEY_COLUMNS)
    .eq("publisher_id", publisherId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`list keys: ${error.message}`);
  return (data as KeyRow[]) ?? [];
}

/**
 * Reads the publisher's one active key for an environment, or null.
 *
 * Scoped by `publisher_id` and `key_env` and filtered to `revoked_at IS NULL`
 * to mirror `publisher_keys_active_env_key` exactly. If this ever disagrees
 * with the index the handler answers 500 instead of a confident-but-wrong 409,
 * which is the right way to be wrong: it tells the user to retry rather than
 * telling them to revoke a key that is not there.
 *
 * Only `KEY_COLUMNS` is selected, so no `key_hash` and no raw key can leave
 * this function.
 */
async function readActiveKey(
  admin: ReturnType<typeof adminClient>,
  publisherId: string,
  env: "test" | "live",
): Promise<KeyRow | null> {
  const { data, error } = await admin
    .from("publisher_keys")
    .select(KEY_COLUMNS)
    .eq("publisher_id", publisherId)
    .eq("key_env", env)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`read active key: ${error.message}`);
  return asKeyRow(data);
}

async function createKey(
  admin: ReturnType<typeof adminClient>,
  publisherId: string,
  label: string | null,
): Promise<{ row: KeyRow; rawKey: string }> {
  const rawKey = generatePublisherKey(KEY_ENV);
  const keyHash = await hashPublisherKey(rawKey);

  const { data, error } = await admin
    .from("publisher_keys")
    .insert({
      publisher_id: publisherId,
      key_hash: keyHash,
      key_prefix: keyPrefix(rawKey),
      key_env: KEY_ENV,
      label: label ?? null,
    })
    .select(KEY_COLUMNS)
    .single();

  if (error) {
    // `publisher_keys_active_env_key` (000016) allows exactly one unrevoked key
    // per (publisher_id, key_env). So a 23505 here means the publisher already
    // has an active key in this environment, which is a conflict the user can
    // act on -- not a server fault. Read the row back so the handler can name
    // it. If the read finds nothing, the 23505 came from somewhere else (a
    // key_hash collision is astronomically unlikely but not impossible) and the
    // caller correctly answers 500 rather than pointing at a row that is not
    // there.
    if (isUniqueViolation(error)) {
      const existing = await readActiveKey(admin, publisherId, KEY_ENV);
      if (existing) throw new ActiveKeyExistsError(existing);
    }
    throw error;
  }

  const row = data as KeyRow;
  return { row, rawKey };
}

async function revokeKey(
  admin: ReturnType<typeof adminClient>,
  publisherId: string,
  keyId: string,
): Promise<void> {
  // First, check that the key belongs to the publisher to prevent revoking
  // another publisher's key.
  //
  // Not `.single()`: an unknown key_id, or one belonging to another
  // publisher, matches zero rows and `.single()` raises PGRST116, which would
  // surface as a 500 and make the "Key not found" 404 below unreachable.
  // `.limit(1).maybeSingle()` asks the same question without demanding a row.
  const { data, error } = await admin
    .from("publisher_keys")
    .select("id")
    .eq("id", keyId)
    .eq("publisher_id", publisherId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`verify key: ${error.message}`);
  }
  if (!data) {
    throw new Error("Key not found or does not belong to this publisher");
  }

  const { error: updateError } = await admin
    .from("publisher_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    // Scoped again so the write cannot outlive the check above.
    .eq("publisher_id", publisherId);

  if (updateError) throw new Error(`revoke key: ${updateError.message}`);
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }

  const url = new URL(req.url);
  // We expect the function to be called at /publisher_keys
  if (restPath(url.pathname, "publisher_keys").length > 0) {
    return apiError("NOT_FOUND", "Not found.", 404, {}, req);
  }

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;

  const admin = adminClient();

  // The developer id comes from the verified token.
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;
  const profileId = dev.profile!.id;

  // Not provisioned yet is a 404, not a 500: it means the developer has not
  // called provision_publisher, and it is the state the dashboard is in for
  // the first visit. A real lookup failure still answers 500, but through
  // apiError so the caller gets JSON with CORS headers instead of an
  // unhandled rejection surfaced as SB-Error-Code: EDGE_FUNCTION_ERROR.
  let publisherId: string | null = null;
  try {
    publisherId = await getPublisherId(admin, profileId);
  } catch (err) {
    console.error("publisher_keys: publisher lookup failed:", err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
  }
  if (!publisherId) {
    return apiError("NOT_FOUND", "Publisher not found for this developer.", 404, {}, req);
  }

  if (req.method === "GET") {
    try {
      const keys = await listKeys(admin, publisherId);
      // We want to return masked metadata: we already have key_prefix (12 chars)
      // and we are not returning key_hash. We also want to show whether the key
      // is revoked (revoked_at is not null).
      return json({ keys }, 200, req);
    } catch (err) {
      console.error("publisher_keys list error:", err);
      return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
    }
  } else if (req.method === "POST") {
    // Expect a JSON body with an optional label
    let body: { label?: string } | null = null;
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : null;
      if (!body || typeof body !== "object") body = {};
    } catch {
      body = {};
    }
    const label = typeof body.label === "string" ? body.label?.trim() ?? null : null;

    try {
      // We allow creating a key only if we want to support multiple keys.
      // The provision_publisher function already creates a key if none exists.
      // Here we allow creating additional keys.
      const { row, rawKey } = await createKey(admin, publisherId, label);
      return json(
        {
          key: {
            ...row,
            // We do not return key_hash
            // We return the raw key only in this response
            publishableKey: rawKey,
          },
        },
        200,
        req,
      );
    } catch (err) {
      console.error("publisher_keys create error:", err);
      if (err instanceof ActiveKeyExistsError) {
        // 409 with metadata only: the caller learns which key is in the way and
        // what to do about it. No hash and no raw key -- the raw key exists
        // only on the response that created it.
        return apiError(
          "KEY_EXISTS",
          "An active key already exists for this environment. Revoke it before creating a replacement.",
          409,
          { existingKey: err.existing },
          req,
        );
      }
      return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
    }
  } else if (req.method === "DELETE") {
    // Expect a JSON body with key_id
    let body: { key_id?: string } | null = null;
    try {
      const text = await req.text();
      body = text ? JSON.parse(text) : null;
      if (!body || typeof body !== "object") body = {};
    } catch {
      body = {};
    }
    const keyId = typeof body.key_id === "string" ? body.key_id : null;
    if (!keyId) {
      return apiError("BAD_REQUEST", "Missing key_id", 400, {}, req);
    }

    try {
      await revokeKey(admin, publisherId, keyId);
      return json({ success: true }, 200, req);
    } catch (err) {
      console.error("publisher_keys revoke error:", err);
      if (
        err &&
        typeof err === "object" &&
        "message" in err &&
        // @ts-ignore: err.message might not be known to TS
        err.message === "Key not found or does not belong to this publisher"
      ) {
        return apiError("NOT_FOUND", "Key not found", 404, {}, req);
      }
      return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
    }
  } else {
    // This should not happen because we already filtered the method
    return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
  }
});

serve(handler);
