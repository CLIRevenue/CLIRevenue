/**
 * payouts — developer payout requests against the demo rail.
 *
 * SECURITY / ACCOUNTING
 * The previous implementation:
 *   - called `supabaseUser.auth.setAuth(...)`, removed in supabase-js v2,
 *     so every request answered 500 without ever authenticating;
 *   - computed the balance with `const reserved = 0; // TODO`, so the same
 *     settled rewards could be paid out over and over;
 *   - inserted the payout and the transaction as two unrelated
 *     round-trips, so two concurrent requests both saw the full balance;
 *   - returned `err.message` to the caller.
 *
 * Now: the caller is resolved from their JWT, the developer id is never
 * read from the body, and the whole debit + payout insert runs inside the
 * public.request_payout() RPC — a single transaction that locks the
 * spendable reward rows FOR UPDATE and consumes them, so a second
 * concurrent request blocks and then fails rather than double-spending.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireDeveloper } from "../_shared/auth.ts";
import { apiError, json, optionsResponse, restPath } from "../_shared/http.ts";

const DEFAULT_PROVIDER = "demo-ledger";
const MAX_PAYOUT_CENTS = 10_000_000;

function mapRpcError(message: string) {
  if (message.includes("INSUFFICIENT_BALANCE")) {
    return apiError("INSUFFICIENT_BALANCE", "Not enough settled balance for that payout.", 400);
  }
  if (message.includes("INVALID_AMOUNT")) {
    return apiError("INVALID_AMOUNT", "Amount must be a positive integer (cents).", 400);
  }
  if (message.includes("INVALID_PROVIDER")) {
    return apiError("INVALID_PROVIDER", "Unknown payout provider.", 400);
  }
  return apiError("INTERNAL_ERROR", "Could not create the payout.", 500);
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  // /payouts and /payouts/request are the same operation.
  const rest = restPath(new URL(req.url).pathname, "payouts");
  if (rest.length > 1 || (rest.length === 1 && rest[0] !== "request")) {
    return apiError("NOT_FOUND", "Not found.", 404);
  }

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const dev = await requireDeveloper(admin, authed.user!.id);
  if ("error" in dev && dev.error) return dev.error;
  // Ownership comes from the token, never from the request body.
  const developerId = dev.developer!.id;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return apiError("INVALID_BODY", "JSON body required.", 400);
  }
  if (!body || typeof body !== "object") {
    return apiError("INVALID_BODY", "JSON body required.", 400);
  }

  const rawAmount = body.amount_cents ?? body.amountCents;
  if (typeof rawAmount !== "number" || !Number.isInteger(rawAmount) || rawAmount <= 0) {
    return apiError("INVALID_AMOUNT", "Amount must be a positive integer (cents).", 400);
  }
  if (rawAmount > MAX_PAYOUT_CENTS) {
    return apiError("INVALID_AMOUNT", "Amount exceeds the maximum allowed.", 400);
  }

  const rawProvider = body.provider_id ?? body.providerId;
  if (rawProvider !== undefined && rawProvider !== null &&
    (typeof rawProvider !== "string" || rawProvider.trim() === "")) {
    return apiError("INVALID_PROVIDER", "Unknown payout provider.", 400);
  }
  const providerId = typeof rawProvider === "string" ? rawProvider.trim() : DEFAULT_PROVIDER;

  try {
    const { data, error } = await admin.rpc("request_payout", {
      p_developer_id: developerId,
      p_amount_cents: rawAmount,
      p_provider_id: providerId,
    });
    if (error) {
      console.error("request_payout failed:", error.message);
      return mapRpcError(error.message ?? "");
    }
    return json({
      payout: data?.payout ?? null,
      transaction: data?.transaction ?? null,
    });
  } catch (err) {
    console.error("payouts error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
