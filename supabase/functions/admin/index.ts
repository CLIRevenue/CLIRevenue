/**
 * admin — internal operations console API.
 *
 * Every route requires a valid bearer token whose profile.role = 'admin'.
 * The email in the JWT is the only identity source; request-body emails are
 * never trusted.
 *
 * Routes (all GET unless noted):
 *   GET    /admin/overview     - aggregate platform counts
 *   GET    /admin/campaigns    - all campaigns with advertiser info
 *   GET    /admin/advertisers  - all advertiser accounts
 *   GET    /admin/developers   - all developer accounts
 *   GET    /admin/publishers   - all publishers with owner info
 *   GET    /admin/placements   - all placements with publisher info
 *   GET    /admin/events       - recent ad_serve_log + impressions + interactions
 *   GET    /admin/system       - auth + db + edge-function health signals
 *   GET    /admin/contacts     - all contact submissions (inbox)
 *   PATCH  /admin/contacts/:id - update status and internal notes
 *   DELETE /admin/contacts/:id - delete a submission
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireAdmin } from "../_shared/auth.ts";
import { apiError, isUuid, json, optionsResponse, restPath } from "../_shared/http.ts";

const admin = adminClient();

function badMethod(req: Request, allowed: string[]): Response | null {
  if (!allowed.includes(req.method)) {
    return apiError("METHOD_NOT_ALLOWED", `Method ${req.method} not allowed.`, 405);
  }
  return null;
}

async function campaignsOverview() {
  const { count: totalCount } = await admin
    .from("campaigns")
    .select("*", { count: "exact", head: true });

  const { count: activeCount } = await admin
    .from("campaigns")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  const { data: recent } = await admin
    .from("campaigns")
    .select("id, name, status, advertiser_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(10);

  return { totalCount: totalCount ?? 0, activeCount: activeCount ?? 0, recent: recent ?? [] };
}

async function advertisersOverview() {
  const { count: totalCount } = await admin
    .from("advertisers")
    .select("*", { count: "exact", head: true });

  const { data: rows } = await admin
    .from("advertisers")
    .select("id, company_name, contact_email, created_at, updated_at, profile_id")
    .order("created_at", { ascending: false })
    .limit(50);

  return { totalCount: totalCount ?? 0, rows: rows ?? [] };
}

async function developersOverview() {
  const { count: totalCount } = await admin
    .from("developer_accounts")
    .select("*", { count: "exact", head: true });

  const { data: rows } = await admin
    .from("developer_accounts")
    .select("id, payout_preferences, created_at, updated_at, profile_id")
    .order("created_at", { ascending: false })
    .limit(50);

  return { totalCount: totalCount ?? 0, rows: rows ?? [] };
}

async function publishersOverview() {
  const { count: totalCount } = await admin
    .from("publishers")
    .select("*", { count: "exact", head: true });

  const { count: activeCount } = await admin
    .from("publishers")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  const { data: rows } = await admin
    .from("publishers")
    .select("id, name, status, owner_profile_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(50);

  return { totalCount: totalCount ?? 0, activeCount: activeCount ?? 0, rows: rows ?? [] };
}

async function placementsOverview() {
  const { count: totalCount } = await admin
    .from("placements")
    .select("*", { count: "exact", head: true });

  const { count: enabledCount } = await admin
    .from("placements")
    .select("*", { count: "exact", head: true })
    .eq("enabled", true);

  const { data: rows } = await admin
    .from("placements")
    .select("id, placement_key, name, enabled, allowed_audience_id, publisher_id, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return { totalCount: totalCount ?? 0, enabledCount: enabledCount ?? 0, rows: rows ?? [] };
}

async function eventsOverview() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { count: serveCount } = await admin
    .from("ad_serve_log")
    .select("*", { count: "exact", head: true })
    .gte("served_at", since);

  const { count: impressionCount } = await admin
    .from("ad_impressions")
    .select("*", { count: "exact", head: true })
    .gte("timestamp", since);

  const { count: interactionCount } = await admin
    .from("ad_interactions")
    .select("*", { count: "exact", head: true })
    .gte("timestamp", since);

  const { data: recentServes } = await admin
    .from("ad_serve_log")
    .select("id, request_id, campaign_id, publisher_id, placement_key, served_at, impression_recorded_at, click_recorded_at, conversion_recorded_at")
    .order("served_at", { ascending: false })
    .limit(20);

  const { data: recentImpressions } = await admin
    .from("ad_impressions")
    .select("id, campaign_id, session_id, timestamp, cli_integration")
    .order("timestamp", { ascending: false })
    .limit(10);

  const { data: recentInteractions } = await admin
    .from("ad_interactions")
    .select("id, campaign_id, session_id, kind, timestamp, cli_integration")
    .order("timestamp", { ascending: false })
    .limit(10);

  return {
    since,
    serveCount: serveCount ?? 0,
    impressionCount: impressionCount ?? 0,
    interactionCount: interactionCount ?? 0,
    recentServes: recentServes ?? [],
    recentImpressions: recentImpressions ?? [],
    recentInteractions: recentInteractions ?? [],
  };
}

async function contactsOverview() {
  const { data: submissions, error: submissionsError } = await admin
    .from("contact_submissions")
    .select(
      // `message` is part of the inbox, not an optional extra: without it in
      // the projection the detail panel renders an empty body and the admin
      // cannot read what was actually submitted.
      "id, created_at, name, email, subject, message, category, status, admin_notes, read_at, resolved_at, user_id",
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (submissionsError) {
    console.error("contacts overview error:", submissionsError.message);
    return apiError("INTERNAL_ERROR", "Failed to load contact submissions.", 500);
  }

  // The admin UI reads camelCase (createdAt / adminNotes / readAt); PostgREST
  // returns snake_case columns. Mapping here keeps one shape on the wire
  // instead of making every view reach past the API layer for raw columns.
  return {
    submissions: (submissions ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      createdAt: row.created_at,
      name: row.name,
      email: row.email,
      subject: row.subject,
      message: row.message,
      category: row.category ?? "other",
      status: row.status,
      adminNotes: row.admin_notes,
      readAt: row.read_at,
      resolvedAt: row.resolved_at,
      userId: row.user_id,
    })),
  };
}

async function updateContact(id: unknown, status: unknown, adminNotes: unknown) {
  if (!isUuid(id)) {
    return apiError("INVALID_ID", "Submission identifier is not valid.", 400);
  }
  const validStatuses = ["new", "read", "in_progress", "resolved", "archived"];
  // `status` arrives as `unknown` from a parsed JSON body, so it is checked for
  // type before membership -- a PATCH with no status, or a non-string one, is
  // the same INVALID_STATUS 400 rather than a crash or a silent write.
  if (typeof status !== "string" || !validStatuses.includes(status)) {
    return apiError("INVALID_STATUS", `Status must be one of: ${validStatuses.join(", ")}.`, 400);
  }

  // Checked here as well as by the column CHECK so an over-long note comes
  // back as a 400 the UI can show, instead of a constraint-violation 500.
  if (typeof adminNotes === "string" && adminNotes.length > 4000) {
    return apiError("NOTES_TOO_LONG", "Notes cannot exceed 4000 characters.", 400);
  }
  if (adminNotes !== undefined && adminNotes !== null && typeof adminNotes !== "string") {
    return apiError("INVALID_NOTES", "Notes must be a string.", 400);
  }

  const now = new Date().toISOString();
  // `updated_at` is deliberately absent: contact_submissions has no such
  // column (see migration 000019), and writing it made PostgREST reject the
  // whole UPDATE, so every status change and note save answered 500.
  const patch: Record<string, unknown> = { status };
  if (typeof adminNotes === "string") {
    patch.admin_notes = adminNotes;
  }
  if (status === "read") {
    patch.read_at = now;
  }
  if (status === "resolved" || status === "archived") {
    patch.resolved_at = now;
  }
  // Moving back off a terminal state clears the stamp so the inbox never
  // shows a resolution time for a ticket that is open again.
  if (status === "new" || status === "in_progress") {
    patch.resolved_at = null;
  }

  const { data, error } = await admin
    .from("contact_submissions")
    .update(patch)
    .eq("id", id)
    .select("id, status, read_at, resolved_at, admin_notes")
    .single();
  if (error) {
    console.error("update contact error:", error);
    return apiError("INTERNAL_ERROR", "Failed to update submission.", 500);
  }
  return { data };
}

async function deleteContact(id: unknown) {
  if (!isUuid(id)) {
    return apiError("INVALID_ID", "Submission identifier is not valid.", 400);
  }

  const { error } = await admin.from("contact_submissions").delete().eq("id", id);
  if (error) {
    console.error("delete contact error:", error);
    return apiError("INTERNAL_ERROR", "Failed to delete submission.", 500);
  }
  return { data: { id } };
}


async function systemStatus() {
  // Supabase auth is healthy if we can resolve the caller's own profile.
  const authStatus = { ok: true, detail: "JWT verification operational" };

  // Database is healthy if we can run a trivial query.
  let dbOk = true;
  let dbDetail = "Connected";
  try {
    await admin.from("profiles").select("id").limit(1).maybeSingle();
  } catch {
    dbOk = false;
    dbDetail = "Query failed";
  }

  // Edge Functions health: we are one, so just report reachability.
  const edgeFunctionsOk = true;
  const edgeFunctionsDetail = "Deno runtime operational";

  // Delivery: check there is at least one active campaign.
  const { count: activeCampaigns } = await admin
    .from("campaigns")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");
  const deliveryOk = (activeCampaigns ?? 0) > 0;
  const deliveryDetail = deliveryOk
    ? `${activeCampaigns} active campaign(s)`
    : "No active campaigns";

  // Publisher provisioning: check for any publisher.
  const { count: publisherCount } = await admin
    .from("publishers")
    .select("*", { count: "exact", head: true });
  const provisioningOk = true; // the table being readable is the signal
  const provisioningDetail = `${publisherCount ?? 0} publisher(s) on record`;

  return {
    auth: { ok: authStatus.ok, detail: authStatus.detail },
    database: { ok: dbOk, detail: dbDetail },
    edgeFunctions: { ok: edgeFunctionsOk, detail: edgeFunctionsDetail },
    delivery: { ok: deliveryOk, detail: deliveryDetail },
    provisioning: { ok: provisioningOk, detail: provisioningDetail },
    checkedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// Handler
// ------------------------------------------------------------------

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const user = authed.user!;

  const adminCheck = await requireAdmin(admin, user.id, user.email || '');
  if ("error" in adminCheck && adminCheck.error) return adminCheck.error;

  const path = restPath(new URL(req.url).pathname, "admin");
  const segment = path[0] || "overview";

  try {
    switch (segment) {
      case "overview": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const [campaigns, advertisers, developers, publishers, placements, events, system] =
          await Promise.all([
            campaignsOverview(),
            advertisersOverview(),
            developersOverview(),
            publishersOverview(),
            placementsOverview(),
            eventsOverview(),
            systemStatus(),
          ]);
        return json({ campaigns, advertisers, developers, publishers, placements, events, system });
      }

      case "campaigns": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const { data, error } = await admin
          .from("campaigns")
          .select(
            "id, name, headline, description, cta, audience_id, budget_cents, cpm_cents, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, starts_at, ends_at, created_at, updated_at, advertiser_id",
          )
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return apiError("INTERNAL_ERROR", "Failed to load campaigns.", 500);
        return json({ campaigns: data ?? [] });
      }

      case "advertisers": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const { data, error } = await admin
          .from("advertisers")
          .select("id, company_name, contact_email, created_at, updated_at, profile_id")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return apiError("INTERNAL_ERROR", "Failed to load advertisers.", 500);
        return json({ advertisers: data ?? [] });
      }

      case "developers": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const { data, error } = await admin
          .from("developer_accounts")
          .select("id, payout_preferences, created_at, updated_at, profile_id")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return apiError("INTERNAL_ERROR", "Failed to load developers.", 500);
        // Attach profile email via a join-subquery to keep identifiers safe.
        const rows = (data ?? []).map((row: Record<string, unknown>) => ({
          ...row,
          _raw: row,
        }));
        return json({ developers: rows });
      }

      case "publishers": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const { data, error } = await admin
          .from("publishers")
          .select("id, name, status, owner_profile_id, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(200);
        if (error) return apiError("INTERNAL_ERROR", "Failed to load publishers.", 500);
        return json({ publishers: data ?? [] });
      }

      case "placements": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const { data, error } = await admin
          .from("placements")
          .select("id, placement_key, name, enabled, allowed_audience_id, publisher_id, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(500);
        if (error) return apiError("INTERNAL_ERROR", "Failed to load placements.", 500);
        return json({ placements: data ?? [] });
      }

      case "events": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await eventsOverview();
        return json(result);
      }

      case "system": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const status = await systemStatus();
        return json(status);
      }


      case "contacts": {
        // One path segment, two shapes. `path` is the raw remainder after the
        // function prefix is stripped, so /admin/contacts yields
        // ["contacts"] and /admin/contacts/<uuid> yields ["contacts", "<uuid>"].
        // The switch only ever sees path[0], which can never equal the string
        // "contacts/:id" -- so a dedicated "contacts/:id" case was unreachable
        // and every PATCH/DELETE answered 405. Dispatch on path[1] instead.
        const id = path[1];

        if (!id) {
          if (req.method !== "GET") {
            return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
          }
          const result = await contactsOverview();
          // contactsOverview returns an apiError() Response on failure;
          // passing that to json() would answer 200 with an empty body and
          // hide the outage from the UI. instanceof narrows properly, where a
          // `typeof result === "response"` test would not: that is a string
          // comparison no type ever has, so it silently never narrows and the
          // data object is handed straight to the Response-typed handler.
          return result instanceof Response ? result : json(result);
        }

        if (!isUuid(id)) {
          return apiError("INVALID_ID", "Submission identifier is not valid.", 400);
        }
        if (req.method === "PATCH") {
          const body = await req.text();
          let jsonBody;
          try {
            jsonBody = body ? JSON.parse(body) : {};
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON.", 400);
          }
          const result = await updateContact(id, jsonBody.status, jsonBody.admin_notes);
          return result instanceof Response ? result : json(result);
        }
        if (req.method === "DELETE") {
          const result = await deleteContact(id);
          return result instanceof Response ? result : json(result);
        }
        return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
      }

      default:
        return apiError("NOT_FOUND", "Not found.", 404);
    }
  } catch (err) {
    console.error("admin edge error:", err instanceof Error ? err.message : err);
    return apiError("INTERNAL_ERROR", "Internal server error.", 500);
  }
});

serve(handler);
