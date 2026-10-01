/**
 * settle_rewards — accrued -> available.
 *
 * SECURITY: this endpoint moves money in the reward ledger, so it is not
 * publicly callable. It previously accepted any request, including a bare
 * anonymous JWT, and updated a `settledAt` column that does not exist
 * (the column is `settled_at`), so settlement silently failed 500 for
 * every caller. Both are fixed here:
 *
 *   1. A caller must be one of
 *        - a signed-in developer, in which case only that developer's own
 *          accrued rewards are eligible (`p_developer_id` is derived from
 *          the JWT, never from the body); or
 *        - a holder of the SETTLEMENT_SECRET header, which may settle
 *          platform-wide. The secret path is disabled entirely when the
 *          env var is unset, so a misconfigured deploy fails closed.
 *   2. The transition happens inside public.apply_settlement(), a
 *      SECURITY DEFINER RPC that locks the rows it flips and writes the
 *      audit trail in the same transaction.
 *
 * Settling early is not an accounting loss — the settlement window is
 * enforced server-side against reward_ledger.created_at — but it must
 * never be an unauthenticated, unlogged mutation.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireDeveloper } from "../_shared/auth.ts";
import { apiError, isUuid, json, optionsResponse } from "../_shared/http.ts";
import { constantTimeEqual } from "../_shared/secrets.ts";

const DEFAULT_SETTLEMENT_MS = 5000;

function settlementMs(): number {
  const raw = Number.parseInt(Deno.env.get("SETTLEMENT_MS") ?? "", 10);
  if (!Number.isFinite(raw) || raw < 0) return DEFAULT_SETTLEMENT_MS;
  return raw;
}

/** Constant-time check of the privileged settlement secret.
 *  Returns false when no secret is configured (fail closed). */
function hasSettlementSecret(req: Request): boolean {
  const expected = Deno.env.get("SETTLEMENT_SECRET");
  if (!expected) return false;
  return constantTimeEqual(expected, req.headers.get("x-settlement-secret") ?? "");
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  let scopeDeveloperId: string | null = null;
  let platformWide = false;

  if (hasSettlementSecret(req)) {
    platformWide = true;
  } else {
    const authed = await getJwtUser(req);
    if ("error" in authed && authed.error) {
      return apiError(
        "UNAUTHENTICATED",
        "Settlement requires a signed-in developer or a settlement secret.",
        401,
      );
    }
    const admin = adminClient();
    const dev = await requireDeveloper(admin, authed.user!.id);
    if ("error" in dev && dev.error) return dev.error;
    // Never trust a developer id from the body — only the token's own.
    scopeDeveloperId = dev.developer!.id;
  }

  try {
    // An explicit body scope='all' is accepted only on the secret path.
    if (platformWide) {
      try {
        const body = await req.json();
        if (body && typeof body === "object" && isUuid((body as { developer_id?: unknown }).developer_id)) {
          scopeDeveloperId = String((body as { developer_id: string }).developer_id);
          platformWide = false;
        }
      } catch {
        // No body: platform-wide pass, which is what cron wants.
      }
    }

    const admin = adminClient();
    const { data, error } = await admin.rpc("apply_settlement", {
      p_settlement_ms: settlementMs(),
      p_developer_id: platformWide ? null : scopeDeveloperId,
    });
    if (error) {
      console.error("apply_settlement failed:", error.message);
      return apiError("INTERNAL_ERROR", "Could not run the settlement pass.", 500);
    }

    const settledCount = Number(data?.settled_count ?? 0);
    return json({
      settled_count: settledCount,
      settled_cents: Number(data?.settled_cents ?? 0),
      scope: platformWide ? "platform" : "developer",
    });
} catch (err) {
      // Log detail server-side; never return it to the caller.
      console.error("settle_rewards error:", err instanceof Error ? err.message : err);
      return apiError("INTERNAL_ERROR", "Internal server error.", 500);
    }
  });

serve(handler);
