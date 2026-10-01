/**
 * auth — the signed-in user's own session identity.
 *
 * The previous implementation called `supabaseUser.auth.setAuth(token)`,
 * which was removed in supabase-js v2, so it answered
 * 500 {"details":"supabaseUser.auth.setAuth is not a function"} for every
 * request (verifiable on the deployed project). It also leaked
 * `err.message` and sent no CORS headers.
 *
 * Now: the caller is resolved with getUser(token) through the shared
 * helper, only the caller's own id/email/role are returned, and failures
 * are logged server-side and returned as a generic, controlled error.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser } from "../_shared/auth.ts";
import { apiError, json, optionsResponse } from "../_shared/http.ts";

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const user = authed.user!;

  try {
    const admin = adminClient();
    const { data: profile, error } = await admin
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("auth profile lookup failed:", error.message);
      return apiError("INTERNAL_ERROR", "Could not load the account.", 500);
    }

    return json({
      user: {
        id: user.id,
        email: user.email ?? null,
        role: profile?.role ?? null,
      },
      // A valid token is what "connected" means in the console.
      connected: true,
    });
  } catch (err) {
    console.error("auth error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
