/**
 * delete_account — self-service account deletion.
 *
 * The caller is resolved from their own JWT only; the body is never
 * consulted for a user id, so an account can only ever delete itself.
 * The service-role key is used solely here, inside the Edge Function, for
 * the authenticated caller's own id; auth.users deletion cascades to
 * public.profiles and every role/ledger row beneath it.
 *
 * Hardened while rewriting: shared CORS headers (honours APP_ORIGINS),
 * controlled error bodies instead of `err.message`, and a generic failure
 * message for the delete itself.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiError, json, optionsResponse } from "../_shared/http.ts";

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") {
    return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return apiError("UNAUTHENTICATED", "Sign in is required.", 401);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseUser = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !user) {
      return apiError("UNAUTHENTICATED", "Invalid or expired session.", 401);
    }

    const supabaseAdmin = createClient(url, serviceKey);
    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      console.error("delete_account failed:", deleteError.message);
      return apiError("INTERNAL_ERROR", "Could not delete the account.", 500);
    }

    return json({ deleted: true, user_id: user.id }, 200, req);
  } catch (err) {
    console.error("delete_account error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);