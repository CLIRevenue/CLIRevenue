import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serveWithCors } from "../_shared/http.ts";
import { apiError, json, optionsResponse } from "../_shared/http.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("site_page_views")
      .select("path, view_count, first_seen_at, last_seen_at")
      .order("view_count", { ascending: false });

    if (error) return apiError("INTERNAL_ERROR", "Failed to load page views.", 500);
    return json({ pageViews: data ?? [] });
  }

  if (req.method === "POST") {
    const text = await req.text();
    console.log("Raw body:", text);
    
    let path: string | null = null;
    try {
      const parsed = JSON.parse(text);
      path = parsed?.path;
    } catch {
      return apiError("INVALID_INPUT", "Invalid JSON body.", 400);
    }
    
    if (!path || typeof path !== "string") {
      return apiError("INVALID_INPUT", "Path is required.", 400);
    }

    const { data, error } = await supabase.rpc("increment_page_view", { p_path: path });
    if (error) {
      console.error("RPC error:", error);
      return apiError("INTERNAL_ERROR", "Failed to record page view.", 500);
    }
    return json({ viewCount: data });
  }

  return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
});

serve(handler);
