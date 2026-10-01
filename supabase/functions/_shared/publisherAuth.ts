/**
 * Publisher authentication.
 *
 * A publishable key is a capability: possession of the raw string is the
 * authorisation to request ads. It is not an identifier, so the API accepts a
 * key and never a publisherId -- an id is enumerable and would let any caller
 * read another publisher's placements and delivery pattern.
 *
 * Only sha256(key) is stored. The raw value is returned once when a key is
 * created and is unrecoverable afterwards, which is what makes a leaked
 * database dump useless for impersonating publishers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiError } from "./http.ts";

/** Format a publishable key so an obviously-wrong value is rejected cheaply. */
const KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

export function isWellFormedPublisherKey(key: unknown): key is string {
  return typeof key === "string" && KEY_RE.test(key);
}

const hex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** sha256 of the raw key, hex. Deterministic, so lookup is one index probe. */
export async function hashPublisherKey(rawKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawKey));
  return hex(new Uint8Array(digest));
}

/** Mint a new publishable key. The raw value is never persisted. */
export function generatePublisherKey(env: "live" | "test" = "live"): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `pk_${env}_${btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** Short fragment for display in a dashboard. Not an authenticator. */
export function keyPrefix(rawKey: string): string {
  return rawKey.slice(0, 12);
}

export type PublisherIdentity = {
  publisherId: string;
  publisherKeyId: string;
  placementId: string | null;
  placementKey: string | null;
  placementEnabled: boolean | null;
  allowedAudienceId: string | null;
};

/**
 * Resolve a raw key to a publisher, and optionally a placement within it.
 *
 * Every failure returns the same 401 so a caller cannot distinguish an
 * unknown key from a revoked one from a suspended publisher, and cannot use
 * response differences to enumerate valid keys. `publisherId` in the request
 * body is never read.
 */
export async function authenticatePublisher(
  admin: SupabaseClient,
  rawKey: unknown,
  placementKey?: unknown,
): Promise<{ identity: PublisherIdentity } | { error: Response }> {
  const unauthorized = () =>
    apiError("UNAUTHORIZED", "A valid publisher key is required.", 401);

  if (!isWellFormedPublisherKey(rawKey)) return { error: unauthorized() };

  const keyHash = await hashPublisherKey(rawKey);
  const { data, error } = await admin
    .from("publisher_keys")
    .select(
      "id, publisher_id, revoked_at, publishers!inner(id, status)",
    )
    .eq("key_hash", keyHash)
    .maybeSingle();

  if (error) {
    console.error("publisher key lookup failed:", error.message);
    return {
      error: apiError("INTERNAL_ERROR", "Delivery is unavailable.", 500),
    };
  }
  if (!data) return { error: unauthorized() };
  if (data.revoked_at) return { error: unauthorized() };

  const publisher = Array.isArray(data.publishers)
    ? data.publishers[0]
    : (data.publishers as unknown as { id: string; status: string });
  if (!publisher || publisher.status !== "active") return { error: unauthorized() };

  let placementId: string | null = null;
  let placementKeyOut: string | null = null;
  let placementEnabled: boolean | null = null;
  let allowedAudienceId: string | null = null;

  if (placementKey !== undefined && placementKey !== null) {
    if (typeof placementKey !== "string" || !placementKey.trim()) {
      return { error: apiError("INVALID_PLACEMENT", "placementKey must be a non-empty string.", 400) };
    }
    const { data: placement, error: pErr } = await admin
      .from("placements")
      .select("id, placement_key, enabled, allowed_audience_id")
      .eq("publisher_id", publisher.id)
      .eq("placement_key", placementKey.trim())
      .maybeSingle();
    if (pErr) {
      console.error("placement lookup failed:", pErr.message);
      return { error: apiError("INTERNAL_ERROR", "Delivery is unavailable.", 500) };
    }
    if (!placement) {
      return {
        error: apiError("INVALID_PLACEMENT", "Unknown placement for this publisher.", 400),
      };
    }
    if (!placement.enabled) {
      return { error: apiError("PLACEMENT_DISABLED", "This placement is disabled.", 403) };
    }
    placementId = placement.id;
    placementKeyOut = placement.placement_key;
    placementEnabled = placement.enabled;
    allowedAudienceId = placement.allowed_audience_id ?? null;
  }

  // Best-effort usage stamp. A failure here must not fail the request, so it
  // is deliberately not awaited into the response path's error handling.
  try {
    await admin.from("publisher_keys").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
  } catch {
    /* usage telemetry is not worth failing a delivery over */
  }

  return {
    identity: {
      publisherId: publisher.id,
      publisherKeyId: data.id,
      placementId,
      placementKey: placementKeyOut,
      placementEnabled,
      allowedAudienceId,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 *
 * Keyed by publisher, not by IP: a publisher's budget and its advertiser's
 * spend are the thing being protected, and many publishers share NAT egress
 * so IP limiting would punish unrelated tenants.
 *
 * Known limitation, stated rather than hidden: this is an in-memory token
 * bucket in a single Edge Runtime isolate. Supabase runs many isolates, so the
 * effective ceiling is roughly (per-isolate rate x isolate count) and a burst
 * can spread across them. That is adequate for MVP abuse damping, not for
 * billing-grade quotas. A shared store is the fix and is deliberately out of
 * scope here.
 * ------------------------------------------------------------------ */

type Bucket = { tokens: number; updatedAt: number };

export function createRateLimiter({
  capacity = 120,
  refillPerSecond = 2,
  now = () => Date.now(),
} = {}) {
  const buckets = new Map<string, Bucket>();

  return function check(key: string): { allowed: boolean; retryAfterMs: number } {
    const t = now();
    const bucket = buckets.get(key) ?? { tokens: capacity, updatedAt: t };
    const elapsed = Math.max(0, t - bucket.updatedAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed / 1000) * refillPerSecond);
    bucket.updatedAt = t;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      buckets.set(key, bucket);
      return { allowed: true, retryAfterMs: 0 };
    }
    buckets.set(key, bucket);
    const waitMs = Math.ceil(((1 - bucket.tokens) / refillPerSecond) * 1000);
    return { allowed: false, retryAfterMs: waitMs };
  };
}

/** Process-wide limiter instance shared by the delivery routes. */
export const rateLimitDelivery = createRateLimiter();
