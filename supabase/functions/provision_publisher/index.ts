/**
 * provision_publisher — give a signed-in developer their publisher and their
 * first publishable key, without an operator, a SQL console or a second page.
 *
 * The contract, in order:
 *
 *   1. Authenticate the caller from the Bearer token. There is no body field
 *      that names a user, so there is nothing to escalate with. A caller can
 *      provision for exactly one publisher: their own.
 *   2. Require the developer role through the shared guard, which also proves
 *      the developer_accounts row exists.
 *   3. Ask the database for the publisher, creating it only if it is absent.
 *      The read-then-create happens inside provision_publisher_slot() under a
 *      row lock, so two requests arriving together queue rather than each
 *      insert a publisher.
 *   4. Mint a key only when there is no active test key, and only through the
 *      existing publisherAuth helpers, so generation and hashing stay in one
 *      place.
 *   5. Return the raw key on exactly one response — the one that created it.
 *
 * Two deliberate non-features.
 *
 * No rotation. Re-running this never invalidates an existing key. A lost key
 * is a broken integration, and silently minting a second one would leave a
 * live capability nobody is tracking, so replacement is a future explicit
 * action with its own audit trail rather than a side effect of a page load.
 *
 * No key material in storage. Only sha256(key) and a 12-character prefix are
 * written, which is what makes a database dump worthless to an attacker. The
 * cost is that step 5 happens once, and the dashboard is built to say so.
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
import {
  buildProvisioningResponse,
  publisherNameFromEmail,
  type ProvisioningSlot,
} from "../_shared/provisioning.ts";

/** The environment provisioned here. A live key is a commercial decision with
 *  billing attached, so it is never minted by a page load. */
const KEY_ENV = "test" as const;

const KEY_LABEL = "signup";

/** PostgREST unique_violation. Expected on the key insert when two requests
 *  race; not expected on the publisher slot, which is why that one retries. */
const UNIQUE_VIOLATION = "23505";

const INSUFFICIENT_PRIVILEGE = "42501";

type KeyRow = {
  id: string;
  key_prefix: string;
  key_env: "test" | "live" | null;
  label: string | null;
  created_at: string;
};

const KEY_COLUMNS = "id, key_prefix, key_env, label, created_at";

function asSlot(data: unknown): ProvisioningSlot | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (typeof row.publisher_id !== "string" || typeof row.publisher_name !== "string") {
    return null;
  }
  return {
    publisher_id: row.publisher_id,
    publisher_name: row.publisher_name,
    publisher_created: row.publisher_created === true,
    needs_key: row.needs_key === true,
    key_id: typeof row.key_id === "string" ? row.key_id : null,
    key_prefix: typeof row.key_prefix === "string" ? row.key_prefix : null,
    key_env: row.key_env === "test" || row.key_env === "live" ? row.key_env : null,
    key_label: typeof row.key_label === "string" ? row.key_label : null,
    key_created_at:
      typeof row.key_created_at === "string" ? row.key_created_at : null,
  };
}

/** Read the active key for an environment, oldest first, so a repeated call
 *  reports the same key the first call created. */
async function readActiveKey(
  admin: ReturnType<typeof adminClient>,
  publisherId: string,
): Promise<KeyRow | null> {
  const { data, error } = await admin
    .from("publisher_keys")
    .select(KEY_COLUMNS)
    .eq("publisher_id", publisherId)
    .is("revoked_at", null)
    .eq("key_env", KEY_ENV)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`read active key: ${error.message}`);
  return (data as KeyRow | null) ?? null;
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405, {}, req);
  }

  const url = new URL(req.url);
  // No sub-resources. Probed rather than assumed: the gateway may or may not
  // have stripped the function prefix, and a future /rotate must be an
  // explicit route rather than an accident of path handling.
  if (restPath(url.pathname, "provision_publisher").length > 0) {
    return apiError("NOT_FOUND", "Not found.", 404, {}, req);
  }

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;

  const admin = adminClient();

  // The owner id comes from the verified token, never from a request field.
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;
  const profileId = dev.profile!.id;

  const publisherName = publisherNameFromEmail(authed.user!.email);

  try {
    // Two attempts. The function serialises on the developer row, so the
    // unique violation it guards against should not happen; one retry turns a
    // lost race into the same answer rather than an error the page shows.
    let slot: ProvisioningSlot | null = null;
    for (let attempt = 0; attempt < 2 && slot === null; attempt += 1) {
      const { data, error } = await admin.rpc("provision_publisher_slot", {
        p_owner_profile_id: profileId,
        p_publisher_name: publisherName,
      });
      if (!error) {
        slot = asSlot(data);
        if (slot === null) {
          console.error("provision_publisher: unexpected slot shape");
          return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
        }
        break;
      }
      if (error.code === INSUFFICIENT_PRIVILEGE) {
        return apiError("FORBIDDEN", "Provisioning is not available to this account.", 403, {}, req);
      }
      if (error.code !== UNIQUE_VIOLATION) {
        console.error("provision_publisher slot error:", error.message);
        return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
      }
    }

    if (slot === null) {
      return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
    }

    if (!slot.needs_key) {
      // Already provisioned. Report the existing key's metadata and stop: the
      // plaintext was shown once, to whoever caused it to be created.
      return json(buildProvisioningResponse(slot), 200, req);
    }

    const rawKey = generatePublisherKey(KEY_ENV);
    const keyHash = await hashPublisherKey(rawKey);

    const { data: inserted, error: insertError } = await admin
      .from("publisher_keys")
      .insert({
        publisher_id: slot.publisher_id,
        key_hash: keyHash,
        key_prefix: keyPrefix(rawKey),
        key_env: KEY_ENV,
        label: KEY_LABEL,
      })
      .select(KEY_COLUMNS)
      .single();

    if (insertError) {
      if (insertError.code !== UNIQUE_VIOLATION) {
        console.error("provision_publisher key insert error:", insertError.message);
        return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
      }

      // Lost the race. The other request's key is the real one; this request
      // generated a plaintext that was never stored, so it must not be
      // returned. Reporting the existing key keeps the response honest and
      // keeps exactly one live key per environment.
      const winner = await readActiveKey(admin, slot.publisher_id);
      if (winner === null) {
        console.error("provision_publisher: key conflict with no active key");
        return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
      }
      return json(
        buildProvisioningResponse({
          ...slot,
          needs_key: false,
          key_id: winner.id,
          key_prefix: winner.key_prefix,
          key_env: winner.key_env,
          key_label: winner.label,
          key_created_at: winner.created_at,
        }),
        200,
        req,
      );
    }

    const row = inserted as KeyRow;
    return json(
      buildProvisioningResponse(
        {
          ...slot,
          needs_key: false,
          key_id: row.id,
          key_prefix: row.key_prefix,
          key_env: row.key_env,
          key_label: row.label,
          key_created_at: row.created_at,
        },
        rawKey,
      ),
      200,
      req,
    );
  } catch (err) {
    console.error(
      "provision_publisher error:",
      err instanceof Error ? err.message : err,
    );
    return apiError("INTERNAL_ERROR", "Internal server error.", 500, {}, req);
  }
});

serve(handler);