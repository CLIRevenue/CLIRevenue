import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { apiError } from "./http.ts";

export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

export async function getJwtUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { error: apiError("UNAUTHENTICATED", "Sign in is required.", 401) };
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return { error: apiError("UNAUTHENTICATED", "Sign in is required.", 401) };
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return { error: apiError("UNAUTHENTICATED", "Invalid or expired session.", 401) };
  }
  return { user: data.user, token };
}

export async function requireAdvertiser(admin: SupabaseClient, userId: string) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load profile.", 500) };
  }
  if (!profile) {
    return { error: apiError("FORBIDDEN", "No profile for this account.", 403) };
  }
  if (profile.role !== "advertiser" && profile.role !== "admin") {
    return { error: apiError("FORBIDDEN", "Advertiser access required.", 403) };
  }
  const { data: advertiser, error: advError } = await admin
    .from("advertisers")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (advError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load advertiser.", 500) };
  }
  if (!advertiser) {
    return { error: apiError("FORBIDDEN", "Advertiser account not found.", 403) };
  }
  return { profile, advertiser };
}

export async function requireDeveloper(admin: SupabaseClient, userId: string) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load profile.", 500) };
  }
  if (!profile || profile.role !== "developer") {
    return { error: apiError("FORBIDDEN", "Developer access required.", 403) };
  }
  const { data: developer, error: devError } = await admin
    .from("developer_accounts")
    .select("id")
    .eq("profile_id", userId)
    .maybeSingle();
  if (devError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load developer account.", 500) };
  }
  if (!developer) {
    return { error: apiError("FORBIDDEN", "Developer account not found.", 403) };
  }
  return { profile, developer };
}

export function rpcCodeFromError(err: { message?: string } | null): string | null {
  const msg = err?.message || "";
  const codes = [
    "CAMPAIGN_NOT_FOUND",
    "CAMPAIGN_NOT_SERVABLE",
    "BUDGET_EXCEEDED",
    "DUPLICATE_EVENT",
    "INVALID_EVENT",
    "CLICK_WITHOUT_IMPRESSION",
  ];
  return codes.find((c) => msg.includes(c)) || null;
}
