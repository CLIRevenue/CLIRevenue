/**
 * wallet — the advertiser and developer credit wallet API.
 *
 * Routes (all bearer-token, authenticated):
 *   GET    /wallet/snapshot     - balance, reservation, month-grant, pending count, notifications
 *   GET    /wallet/transactions - statement of account (ledger), default 50 rows
 *   GET    /wallet/topups       - top-up instruments, default 25 rows
 *   GET    /wallet/notifications - unread and recent notices for this person
 *   POST   /wallet/topups        - record a payment claim (creates a pending top-up, credits nothing)
 *   POST   /wallet/notifications/read - mark notifications read
 *   POST   /wallet/unfreeze-request - file a support request to lift a freeze
 *
 * The browser never asserts money: POST /wallet/topups creates a pending
 * row, and only confirm_wallet_topup (service_role, admin path) credits a
 * balance. The same function is the hook a payment provider's server-to-
 * server verification will call later.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser } from "../_shared/auth.ts";
import {
  apiError,
  isUuid,
  json,
  optionsResponse,
  readJsonObjectBody,
  restPath,
} from "../_shared/http.ts";
import {
  CREDIT_CURRENCY,
  MAX_TOPUP_MINOR,
  MIN_TOPUP_MINOR,
  MONTHLY_GRANT_LIMIT,
  parseAmountToMinor,
  parseFreezeRequest,
  parseGrantRequest,
  parseTopupRequest,
  PAYMENT_METHODS,
  TOPUP_CURRENCIES,
} from "../_shared/walletRules.ts";

const supabase = adminClient();

const UNAUTHENTICATED = () => apiError("UNAUTHENTICATED", "Sign in is required.", 401);
const FORBIDDEN = (message: string) => apiError("FORBIDDEN", message, 403);

/** Resolve the caller's profile (never admin-gated here: any role has a wallet). */
async function myProfile(userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, role, frozen_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return { error: apiError("INTERNAL_ERROR", "Could not load profile.", 500) };
  if (!data) return { error: apiError("NOT_FOUND", "Account not found.", 404) };
  return { profile: data };
}

/** One row per route branch, narrowed so TypeScript does not union a Response into data. */
function dataOrError<T>(result: { data: T | null; error: { message: string } | null }, fallback: T): T | Response {
  if (result.error) {
    console.error("wallet edge error:", result.error.message);
    return apiError("INTERNAL_ERROR", "Could not complete the request.", 500);
  }
  return result.data ?? fallback;
}

async function walletSnapshot(profileId: string) {
  const { data: snapshot, error } = await supabase.rpc("wallet_snapshot", { p_profile_id: profileId });
  if (error) {
    console.error("wallet snapshot error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not load the wallet.", 500);
  }

  const { data: topups, error: topupsError } = await supabase
    .from("wallet_topups")
    .select("id, credits, currency, amount_minor, payment_method, payment_reference, payer_name, status, created_at, rejection_reason")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(10);

  const { data: notifications, error: notificationsError } = await supabase
    .from("user_notifications")
    .select("id, kind, severity, title, body, read_at, created_at, related_freeze_id")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (topupsError || notificationsError) {
    console.error("wallet snapshot children error:", topupsError?.message, notificationsError?.message);
    return apiError("INTERNAL_ERROR", "Could not load the wallet.", 500);
  }

  return json({
    wallet: snapshot,
    topups: topups ?? [],
    notifications: notifications ?? [],
    unreadCount: (notifications ?? []).filter((n) => !n.read_at).length,
  });
}

async function walletLedger(profileId: string, limit: number) {
  const { data, error } = await supabase.rpc("wallet_ledger", { p_profile_id: profileId, p_limit: limit });
  if (error) {
    console.error("wallet ledger error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not load the statement.", 500);
  }
  return json(data ?? { transactions: [], count: 0 });
}

async function walletTopups(profileId: string, limit: number) {
  const { data, error } = await supabase.rpc("wallet_topups_of", { p_profile_id: profileId, p_limit: limit });
  if (error) {
    console.error("wallet topups error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not load top-ups.", 500);
  }
  return json(data ?? { topups: [], count: 0 });
}

async function walletNotifications(profileId: string) {
  const { data, error } = await supabase
    .from("user_notifications")
    .select("id, kind, severity, title, body, read_at, created_at, related_freeze_id")
    .eq("profile_id", profileId)
    .order("read_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("wallet notifications error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not load notifications.", 500);
  }
  return json({ notifications: data ?? [], unreadCount: (data ?? []).filter((n) => !n.read_at).length });
}

async function createTopup(profileId: string, body: Record<string, unknown>) {
  const parsed = parseTopupRequest(body);
  if (!parsed.ok) {
    return apiError("INVALID_REQUEST", "Top-up request is not well formed.", 400, { errors: parsed.errors });
  }

  const { value } = parsed;
  const idempotencyKey = `topup:${crypto.randomUUID()}`;

  const amountMinor = parseAmountToMinor(value.amount);
  if (!amountMinor.ok) {
    return apiError("INVALID_REQUEST", "Invalid top-up amount.", 400, { errors: amountMinor.errors });
  }

  const { data, error } = await supabase.rpc("create_wallet_topup", {
    p_profile_id: profileId,
    p_amount_minor: amountMinor.value,
    p_currency: value.currency,
    p_payment_method: value.paymentMethod,
    p_payment_reference: value.paymentReference || null,
    p_payer_name: value.payerName,
    p_payer_email: value.payerEmail,
    p_payer_address: value.payerAddress || null,
    p_payer_phone: value.payerPhone || null,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    console.error("create wallet topup error:", error.message);
    if (error.message === "WALLET_FROZEN") return apiError("WALLET_FROZEN", "This wallet is frozen and cannot receive top-ups.", 403);
    if (error.message === "UNKNOWN_CURRENCY") return apiError("UNKNOWN_CURRENCY", "That currency is not available.", 400);
    if (error.message === "AMOUNT_TOO_SMALL") return apiError("AMOUNT_TOO_SMALL", "The smallest top-up is 1.00.", 400);
    return apiError("INTERNAL_ERROR", "Could not record the top-up.", 500);
  }

  const result = data as { ok: boolean; duplicate: boolean; topup: Record<string, unknown> };
  return json({ ok: true, duplicate: result.duplicate ?? false, topup: result.topup }, result.duplicate ? 200 : 201);
}

async function markNotificationsRead(profileId: string, body: Record<string, unknown>) {
  const ids = body && Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === "string") : null;
  const { data, error } = await supabase.rpc("mark_notifications_read", { p_ids: ids ?? null });
  if (error) {
    console.error("mark notifications read error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not mark notifications read.", 500);
  }
  return json({ marked: data ?? 0 });
}

async function requestUnfreeze(profileId: string, body: Record<string, unknown>) {
  const freezeId = body && typeof body.freeze_id === "string" ? body.freeze_id : null;
  const subject = body && typeof body.subject === "string" ? body.subject : null;
  const message = body && typeof body.body === "string" ? body.body : null;
  const userEmail = body && typeof body.user_email === "string" ? body.user_email : null;

  if (!freezeId || !isUuid(freezeId)) {
    return apiError("INVALID_ID", "A valid freeze identifier is required.", 400);
  }
  if (!message || message.trim().length < 3) {
    return apiError("EMPTY_BODY", "Tell us what happened, in a few words.", 400);
  }

  const { data, error } = await supabase.rpc("request_unfreeze", {
    p_profile_id: profileId,
    p_freeze_id: freezeId,
    p_subject: subject || null,
    p_body: message,
    p_user_email: userEmail || null,
  });
  if (error) {
    console.error("request unfreeze error:", error.message);
    if (error.message === "FREEZE_NOT_FOUND") return apiError("NOT_FOUND", "No freeze with that id.", 404);
    if (error.message === "NOT_YOUR_FREEZE") return apiError("FORBIDDEN", "That freeze is not yours.", 403);
    if (error.message === "FREEZE_ALREADY_RELEASED") return apiError("FREEZE_ALREADY_RELEASED", "That freeze has already been lifted.", 400);
    return apiError("INTERNAL_ERROR", "Could not file the request.", 500);
  }
  return json({ ok: true, request: data });
}

const handler = serveWithCors(async (req): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const user = authed.user!;

  const { error: profileError, profile: prof } = await myProfile(user.id);
  if (profileError) return profileError;
  const profileId = prof.id;

  const path = restPath(new URL(req.url).pathname, "wallet");
  const segment = path[0] || "snapshot";

  try {
    switch (segment) {
      case "snapshot": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        return walletSnapshot(profileId);
      }

      case "transactions": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const url = new URL(req.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "50"), 1), 500);
        return walletLedger(profileId, limit);
      }

      case "topups": {
        if (req.method === "GET") {
          const url = new URL(req.url);
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 1), 200);
          return walletTopups(profileId, limit);
        }
        if (req.method === "POST") {
          const body = await readJsonObjectBody(req);
          if (!body.ok) return body.response;
          return createTopup(profileId, body.body ?? {});
        }
        return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      }

      case "notifications": {
        if (req.method === "GET") {
          return walletNotifications(profileId);
        }
        if (req.method === "POST") {
          const body = await readJsonObjectBody(req);
          if (!body.ok) return body.response;
          return markNotificationsRead(profileId, body.body ?? {});
        }
        return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      }

      case "unfreeze-request": {
        if (req.method !== "POST") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const body = await readJsonObjectBody(req);
        if (!body.ok) return body.response;
        return requestUnfreeze(profileId, body.body ?? {});
      }

      default:
        return apiError("NOT_FOUND", "Not found.", 404);
    }
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  } catch (err) {
    console.error("wallet edge error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
