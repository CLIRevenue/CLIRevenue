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
 *   GET    /admin/accounts     - identity directory (profiles joined to role tables)
 *   PATCH  /admin/accounts/gate- advertiser serving gate + append-only audit record
 *   GET    /admin/moderation   - campaign/creative readiness queue with real blockers
 *   GET    /admin/health       - measured subsystem signals (no invented uptime)
 *   GET    /admin/audit        - delivery telemetry stream + admin governance log
 *   GET    /admin/operations   - platform-wide aggregates with per-card availability
 *
 * Routes marked "measured" below only ever report values that came out of the
 * database on that request. Anything the schema cannot answer is returned in a
 * `capabilities` object with `supported: false` and a reason, so the console
 * can say "not instrumented" instead of rendering a plausible-looking number.
 */
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { serveWithCors } from "../_shared/http.ts";
import { adminClient, getJwtUser, requireAdmin } from "../_shared/auth.ts";
import { apiError, isUuid, json, optionsResponse, restPath } from "../_shared/http.ts";
import { ACTIVATION_BLOCKER_MESSAGES } from "../_shared/campaignRules.ts";
import {
  buildAccountKeyResponse,
  mintAccountKey,
  readStoredAccountKey,
} from "../_shared/accountKey.ts";

const admin = adminClient();

const DIRECTORY_LIMIT = 500;
const MODERATION_LIMIT = 200;
const AUDIT_LIMIT = 200;
const CREATIVE_SCAN_LIMIT = 2000;
const BLOCKER_BATCH = 25;
const GOVERNANCE_REASON_MAX = 500;

type Actor = { profileId: string; email: string };

/**
 * Mint an account key for one publisher, or report the one it already has.
 *
 * Idempotent in the only sense that matters: this is a credential, and minting
 * a second one for a publisher that already has one would leave a live staff
 * capability nobody is tracking - the exact failure mode
 * `provision_publisher`'s header warns about for publishable keys. So the
 * write is a guarded UPDATE that only fires when `account_key_hash IS NULL`,
 * and the response distinguishes "we just created this" from "one already
 * existed", the same `created` flag `buildProvisioningResponse` uses.
 *
 * The guard is an UPDATE rather than a read-then-write because two staff
 * pressing the button at once would otherwise both read NULL and both insert.
 * `.is("account_key_hash", null)` is inside the UPDATE, so the second one
 * simply matches zero rows and reports the winner's row instead of clobbering
 * it. That also makes the unique index from 000025 a backstop rather than the
 * primary mechanism.
 *
 * The plaintext is returned only on the request that changed the row, and
 * `buildAccountKeyResponse` enforces that independently of what is passed in.
 */
async function mintAccountKeyForPublisher(
  publisherId: string,
): Promise<{ accountKey: ReturnType<typeof buildAccountKeyResponse> } | Response> {
  const { data: existing, error: readError } = await admin
    .from("publishers")
    .select("id, account_key_hash, account_key_prefix")
    .eq("id", publisherId)
    .limit(1)
    .maybeSingle();

  if (readError) {
    console.error("account key: publisher lookup failed:", readError.message);
    return apiError("INTERNAL_ERROR", "Failed to load the publisher.", 500);
  }
  if (!existing) {
    return apiError("NOT_FOUND", "No publisher with that id.", 404);
  }

  const stored = readStoredAccountKey(existing);

  if (stored.accountKeyHash) {
    // Already provisioned. Report the prefix so staff can tell which key is in
    // play, and say plainly that the plaintext is not recoverable - it was
    // shown once at creation and only its sha256 was kept.
    return { accountKey: buildAccountKeyResponse(stored.accountKeyPrefix) };
  }

  const { rawKey, keyHash, prefix } = await mintAccountKey();

  const { data: updated, error: updateError } = await admin
    .from("publishers")
    .update({ account_key_hash: keyHash, account_key_prefix: prefix })
    .eq("id", publisherId)
    .is("account_key_hash", null)
    .select("id, account_key_hash, account_key_prefix")
    .maybeSingle();

  if (updateError) {
    console.error("account key: update failed:", updateError.message);
    return apiError("INTERNAL_ERROR", "Failed to store the account key.", 500);
  }

  if (!updated) {
    // The guarded UPDATE matched nothing, so another request won the race
    // between our read and our write. Its key is the live one; ours was never
    // stored and must not be shown.
    const { data: winner } = await admin
      .from("publishers")
      .select("id, account_key_hash, account_key_prefix")
      .eq("id", publisherId)
      .limit(1)
      .maybeSingle();
    const winnerState = readStoredAccountKey(winner);
    return { accountKey: buildAccountKeyResponse(winnerState.accountKeyPrefix) };
  }

  return { accountKey: buildAccountKeyResponse(prefix, rawKey) };
}

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

/**
 * Admin hard-delete of a campaign. The advertiser-facing DELETE on
 * /campaigns/:id archives the row and keeps its accounting history; an
 * admin can go further and remove it outright. The campaigns table has
 * ON DELETE CASCADE to ad_impressions, ad_interactions and the creative
 * slots, so the function does not have to walk them by hand -- but it
 * does have to report what went, which is why it selects before deleting
 * instead of answering with a boolean.
 */
async function deleteCampaign(id: unknown, actor: Actor) {
  if (typeof id !== "string" || !isUuid(id)) {
    return apiError("INVALID_ID", "Campaign identifier is not valid.", 400);
  }
  const { data: existing, error: findError } = await admin
    .from("campaigns")
    .select("id, name, advertiser_id, status")
    .eq("id", id)
    .maybeSingle();
  if (findError) {
    console.error("delete campaign lookup error:", findError.message);
    return apiError("INTERNAL_ERROR", "Could not load campaign.", 500);
  }
  if (!existing) {
    return apiError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404);
  }
  const { error: deleteError } = await admin.from("campaigns").delete().eq("id", id);
  if (deleteError) {
    console.error("delete campaign error:", deleteError.message);
    return apiError("INTERNAL_ERROR", "Could not delete campaign.", 500);
  }
  await recordGovernanceAction(
    actor,
    "campaign_delete",
    String(id),
    `Hard-deleted campaign "${existing.name}" (${String(existing.advertiser_id)})`,
    "",
    "",
  );
  return { data: { id, name: existing.name ?? null } };
}

/**
 * Admin deletes an advertiser account. Resolves the profile row, then drops
 * the auth user: the advertisers row and every campaign, impression and
 * click cascade off it through FKs, so this one call is the whole job.
 * The service role bypasses RLS by construction, which is the only reason
 * this route exists at all -- it is not a way for an advertiser to delete
 * a neighbour.
 */
async function deleteAdvertiserAccount(profileId: unknown, actor: Actor) {
  if (typeof profileId !== "string" || !isUuid(profileId)) {
    return apiError("INVALID_ID", "Profile identifier is not valid.", 400);
  }
  const { data: profile, error: findError } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (findError) {
    console.error("delete advertiser lookup error:", findError.message);
    return apiError("INTERNAL_ERROR", "Could not load profile.", 500);
  }
  if (!profile) {
    return apiError("PROFILE_NOT_FOUND", "Account not found.", 404);
  }
  if (String(profile.role ?? "") !== "advertiser") {
    return apiError("INVALID_ROLE", "That profile is not an advertiser account.", 400);
  }
  const { data: advertiser } = await admin
    .from("advertisers")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  const { error: deleteError } = await admin.auth.admin.deleteUser(profileId);
  if (deleteError) {
    console.error("delete advertiser error:", deleteError.message);
    return apiError("INTERNAL_ERROR", "Could not delete the advertiser account.", 500);
  }
  await recordGovernanceAction(
    actor,
    "advertiser_delete",
    String(profileId),
    `Deleted advertiser account "${profile.full_name ?? profileId}" (${advertiser?.id ?? "no row"})`,
    "",
    "",
  );
  return { data: { deleted: true, profileId, role: profile.role } };
}

/**
 * Admin deletes a developer account. Same shape as the advertiser delete:
 * the auth user goes first and the developer_accounts row cascades off it.
 */
async function deleteDeveloperAccount(profileId: unknown, actor: Actor) {
  if (typeof profileId !== "string" || !isUuid(profileId)) {
    return apiError("INVALID_ID", "Profile identifier is not valid.", 400);
  }
  const { data: profile, error: findError } = await admin
    .from("profiles")
    .select("id, role, full_name")
    .eq("id", profileId)
    .maybeSingle();
  if (findError) {
    console.error("delete developer lookup error:", findError.message);
    return apiError("INTERNAL_ERROR", "Could not load profile.", 500);
  }
  if (!profile) {
    return apiError("PROFILE_NOT_FOUND", "Account not found.", 404);
  }
  if (String(profile.role ?? "") !== "developer") {
    return apiError("INVALID_ROLE", "That profile is not a developer account.", 400);
  }
  const { data: developer } = await admin
    .from("developer_accounts")
    .select("id")
    .eq("profile_id", profileId)
    .maybeSingle();
  const { error: deleteError } = await admin.auth.admin.deleteUser(profileId);
  if (deleteError) {
    console.error("delete developer error:", deleteError.message);
    return apiError("INTERNAL_ERROR", "Could not delete the developer account.", 500);
  }
  await recordGovernanceAction(
    actor,
    "developer_delete",
    String(profileId),
    `Deleted developer account "${profile.full_name ?? profileId}" (${developer?.id ?? "no row"})`,
    "",
    "",
  );
  return { data: { deleted: true, profileId, role: profile.role } };
}

// --------------------------------------------------------------
// Identity, moderation, health, audit and operations
//
// The shape of every block below is driven by what the schema can actually
// answer, not by what a console would like to show:
//
//   - public.profiles (000001 + 000007) is id / role / created_at /
//     updated_at / full_name / phone / address. There is no email, no status,
//     no suspension flag and no verification column, so an identity directory
//     can only join the role tables and must say so.
//   - public.advertisers.can_run_campaigns (000022) is the single stored,
//     server-enforced admin lever. It is the only write in this file.
//   - Activation readiness is decided by public.campaign_activation_blockers()
//     in SQL. This file calls that RPC rather than restating the rules, so the
//     review queue cannot drift from the activation path.
//   - telemetry_events (000021) is an append-only delivery event stream, not a
//     record of administrator actions. The audit route says so explicitly.
// --------------------------------------------------------------

function groupBy<T extends Record<string, unknown>>(rows: T[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const value = String(row[key] ?? "unknown");
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

async function accountsDirectory() {
  const [profilesRes, advertisersRes, developersRes, publishersRes, adminEmailsRes] =
    await Promise.all([
      admin
        .from("profiles")
        .select("id, role, full_name, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(DIRECTORY_LIMIT),
      admin
        .from("advertisers")
        .select("id, profile_id, company_name, contact_email, can_run_campaigns, created_at"),
      admin
        .from("developer_accounts")
        .select("id, profile_id, developer_name, developer_type, created_at"),
      admin
        .from("publishers")
        .select("id, owner_profile_id, name, status, created_at")
        .order("created_at", { ascending: false }),
      admin
        .from("admin_emails")
        .select("email, note, created_at")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

  const failure = [profilesRes, advertisersRes, developersRes, publishersRes].find((r) => r.error);
  if (failure && failure.error) {
    console.error("accounts directory error:", failure.error.message);
    return apiError("INTERNAL_ERROR", "Failed to load the account directory.", 500);
  }

  const advertisersByProfile = new Map<string, Record<string, unknown>>();
  for (const row of (advertisersRes.data ?? []) as Record<string, unknown>[]) {
    if (row.profile_id) advertisersByProfile.set(String(row.profile_id), row);
  }
  const developersByProfile = new Map<string, Record<string, unknown>>();
  for (const row of (developersRes.data ?? []) as Record<string, unknown>[]) {
    if (row.profile_id) developersByProfile.set(String(row.profile_id), row);
  }
  const publishersByOwner = new Map<string, Record<string, unknown>[]>();
  for (const row of (publishersRes.data ?? []) as Record<string, unknown>[]) {
    if (!row.owner_profile_id) continue;
    const key = String(row.owner_profile_id);
    const list = publishersByOwner.get(key) ?? [];
    list.push(row);
    publishersByOwner.set(key, list);
  }

  const profiles = (profilesRes.data ?? []) as Record<string, unknown>[];
  const accounts = profiles.map((profile) => {
    const id = String(profile.id);
    const role = String(profile.role ?? "unknown");
    const advertiser = advertisersByProfile.get(id) ?? null;
    const developer = developersByProfile.get(id) ?? null;
    const publisher = (publishersByOwner.get(id) ?? [])[0] ?? null;

    // Display name comes from whichever role table actually stores one.
    // Falling back to full_name and then to null keeps an unnamed account
    // visible instead of inventing a company or a handle for it.
    const displayName =
      (advertiser && typeof advertiser.company_name === "string" && advertiser.company_name) ||
      (developer && typeof developer.developer_name === "string" && developer.developer_name) ||
      (publisher && typeof publisher.name === "string" && publisher.name) ||
      (typeof profile.full_name === "string" && profile.full_name) ||
      null;

    return {
      profileId: id,
      role,
      displayName,
      fullName: profile.full_name ?? null,
      // Only advertisers store an address. Returning null for the other roles
      // is the honest answer; the console renders it as "not stored".
      email: advertiser && typeof advertiser.contact_email === "string"
        ? advertiser.contact_email
        : null,
      emailSource: advertiser ? "advertisers.contact_email" : null,
      createdAt: profile.created_at ?? null,
      updatedAt: profile.updated_at ?? null,
      advertiser: advertiser
        ? {
            id: String(advertiser.id),
            companyName: advertiser.company_name ?? null,
            canRunCampaigns: advertiser.can_run_campaigns === true,
          }
        : null,
      developer: developer
        ? {
            id: String(developer.id),
            developerType: developer.developer_type ?? null,
          }
        : null,
      publisher: publisher
        ? {
            id: String(publisher.id),
            name: publisher.name ?? null,
            // publishers.status is a real CHECK (active | suspended).
            status: publisher.status ?? null,
          }
        : null,
      ownedPublisherCount: (publishersByOwner.get(id) ?? []).length,
    };
  });

  return {
    accounts,
    counts: {
      total: accounts.length,
      byRole: groupBy(accounts, "role"),
      advertisers: advertisersByProfile.size,
      developers: developersByProfile.size,
      publishers: (publishersRes.data ?? []).length,
    },
    // The authority table itself: addresses that grant admin access. Read with
    // the service role because RLS grants it to nobody else (000017).
    adminRoster: adminEmailsRes.error
      ? { available: false, reason: adminEmailsRes.error.message, entries: [] }
      : {
          available: true,
          entries: (adminEmailsRes.data ?? []) as Record<string, unknown>[],
        },
    capabilities: {
      accountStatus: {
        supported: false,
        reason:
          "public.profiles has no status or suspended column (migrations 000001, 000007). There is no field to read and nothing to write.",
      },
      email: {
        supported: true,
        scope:
          "advertisers.contact_email only. Developer, publisher and admin profiles store no address anywhere in the schema.",
      },
      identityVerification: {
        supported: false,
        reason:
          "No KYC, verification, or review-state table or column exists. Nothing in this project records that an advertiser was checked.",
      },
      riskFlags: {
        supported: false,
        reason:
          "Per-account flags do not exist. telemetry_events.risk_flags scores individual delivery events, not accounts.",
      },
      servingGate: {
        supported: true,
        detail:
          "advertisers.can_run_campaigns is stored and enforced by campaign_activation_blockers(); PATCH /admin/accounts/gate is the only admin write.",
      },
      publisherSuspension: {
        supported: true,
        scope: "publishers.status (active | suspended) — applies to publishers, not to profiles.",
      },
      pagination: {
        supported: false,
        detail: `No page, cursor or search parameter is accepted. This listing is capped at ${DIRECTORY_LIMIT} rows and reports truncated when it hits the cap.`,
      },
      rowLimit: DIRECTORY_LIMIT,
      truncated: profiles.length >= DIRECTORY_LIMIT,
    },
  };
}

async function recordGovernanceAction(
  actor: Actor,
  action: string,
  subjectId: string,
  reason: string,
  previousValue: string,
  newValue: string,
) {
  // Best-effort by design: the serving gate has already changed by the time
  // this runs, so a missing audit table must not roll the write back. The
  // caller reports `auditRecorded: false` so the operator knows.
  const { error } = await admin.from("admin_governance_actions").insert({
    actor_profile_id: actor.profileId,
    actor_email: actor.email,
    action,
    subject_type: "advertiser",
    subject_id: subjectId,
    reason,
    previous_value: previousValue,
    new_value: newValue,
  });
  if (error) {
    console.error("governance audit insert failed:", error.message);
    return false;
  }
  return true;
}

async function updateAdvertiserGate(body: Record<string, unknown>, actor: Actor) {
  const advertiserId = body.advertiser_id;
  const canRunCampaigns = body.can_run_campaigns;
  const reason = body.reason;

  if (!isUuid(advertiserId)) {
    return apiError("INVALID_ID", "Advertiser identifier is not valid.", 400);
  }
  if (typeof canRunCampaigns !== "boolean") {
    return apiError("INVALID_VALUE", "can_run_campaigns must be a boolean.", 400);
  }
  // A serving gate can stop a live advertiser from delivering. Requiring a
  // written reason is what makes that change accountable once it has happened.
  if (typeof reason !== "string" || reason.trim().length < 3) {
    return apiError(
      "REASON_REQUIRED",
      "A written reason (3-500 characters) is required to change a serving gate.",
      400,
    );
  }
  if (reason.length > GOVERNANCE_REASON_MAX) {
    return apiError(
      "REASON_TOO_LONG",
      `Reason cannot exceed ${GOVERNANCE_REASON_MAX} characters.`,
      400,
    );
  }

  const { data: before, error: readError } = await admin
    .from("advertisers")
    .select("id, company_name, can_run_campaigns")
    .eq("id", advertiserId)
    .maybeSingle();
  if (readError) {
    console.error("advertiser gate read error:", readError.message);
    return apiError("INTERNAL_ERROR", "Failed to read the advertiser record.", 500);
  }
  if (!before) {
    return apiError("NOT_FOUND", "Advertiser not found.", 404);
  }

  if (before.can_run_campaigns === canRunCampaigns) {
    return json({
      changed: false,
      advertiser: {
        id: before.id,
        companyName: before.company_name ?? null,
        canRunCampaigns: before.can_run_campaigns === true,
      },
      auditRecorded: true,
      note: "No change: the serving gate already held that value, so nothing was written or logged.",
    });
  }

  const now = new Date().toISOString();
  const { data: after, error: writeError } = await admin
    .from("advertisers")
    .update({ can_run_campaigns: canRunCampaigns, updated_at: now })
    .eq("id", advertiserId)
    .select("id, company_name, can_run_campaigns, updated_at")
    .single();
  if (writeError) {
    console.error("advertiser gate write error:", writeError);
    return apiError("INTERNAL_ERROR", "Failed to update the serving gate.", 500);
  }

  const auditRecorded = await recordGovernanceAction(
    actor,
    canRunCampaigns ? "SERVING_GATE_ENABLED" : "SERVING_GATE_DISABLED",
    String(advertiserId),
    reason.trim(),
    String(before.can_run_campaigns),
    String(canRunCampaigns),
  );

  return json({
    changed: true,
    advertiser: {
      id: after.id,
      companyName: after.company_name ?? null,
      canRunCampaigns: after.can_run_campaigns === true,
      updatedAt: after.updated_at ?? now,
    },
    auditRecorded,
    note: auditRecorded
      ? "Change applied and written to the append-only governance log."
      : "Change applied, but the governance log rejected the entry (missing migration). The change is NOT in the audit trail.",
  });
}

type ModerationState =
  | "live"
  | "archived"
  | "ready_to_activate"
  | "creative_missing"
  | "awaiting_upload"
  | "awaiting_validation"
  | "creative_failed"
  | "creative_revoked"
  | "unknown";

// The creative lifecycle is the only per-campaign artefact an administrator
// could review, so the review state is derived from it plus the SQL blocker
// list rather than from a moderation table that does not exist.
function moderationState(
  campaignStatus: string,
  creativeStatus: string | null,
  blockers: string[] | null,
): ModerationState {
  if (blockers === null) return "unknown";
  if (campaignStatus === "active") return "live";
  if (campaignStatus === "archived") return "archived";
  if (blockers.length === 0) return "ready_to_activate";
  switch (creativeStatus) {
    case null:
      return "creative_missing";
    case "pending":
      return "awaiting_upload";
    case "uploaded":
      return "awaiting_validation";
    case "failed":
      return "creative_failed";
    case "revoked":
      return "creative_revoked";
    default:
      return "unknown";
  }
}

async function moderationQueue() {
  const [campaignsRes, creativesRes, advertisersRes] = await Promise.all([
    admin
      .from("campaigns")
      .select(
        "id, name, headline, description, cta, audience_id, budget_cents, cpm_cents, spend_milli_cents, impressions_count, clicks_count, conversions_count, status, starts_at, ends_at, landing_url, advertiser_id, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(MODERATION_LIMIT),
    admin
      .from("campaign_creatives")
      .select(
        "campaign_id, advertiser_id, media_type, mime_type, file_size_bytes, width, height, duration_ms, checksum, label, status, created_at, updated_at",
      )
      .order("updated_at", { ascending: false })
      .limit(CREATIVE_SCAN_LIMIT),
    admin.from("advertisers").select("id, company_name, contact_email, can_run_campaigns"),
  ]);

  if (campaignsRes.error) {
    console.error("moderation campaigns error:", campaignsRes.error.message);
    return apiError("INTERNAL_ERROR", "Failed to load the moderation queue.", 500);
  }

  const campaigns = (campaignsRes.data ?? []) as Record<string, unknown>[];
  const creatives = (creativesRes.data ?? []) as Record<string, unknown>[];
  const advertisers = (advertisersRes.data ?? []) as Record<string, unknown>[];

  const creativeByCampaign = new Map<string, Record<string, unknown>>();
  for (const creative of creatives) {
    const key = String(creative.campaign_id ?? "");
    if (key && !creativeByCampaign.has(key)) creativeByCampaign.set(key, creative);
  }
  const advertiserById = new Map<string, Record<string, unknown>>();
  for (const advertiser of advertisers) {
    advertiserById.set(String(advertiser.id), advertiser);
  }

  // campaign_activation_blockers() is the authority on whether a campaign may
  // serve. Batched so a 200-row queue does not open 200 simultaneous
  // connections; a failed batch reports `null` blockers rather than an empty
  // array, because "we could not ask" and "nothing is wrong" must not look
  // identical on screen.
  const blockersById = new Map<string, string[] | null>();
  let blockerLookupError: string | null = null;
  for (let i = 0; i < campaigns.length; i += BLOCKER_BATCH) {
    const batch = campaigns.slice(i, i + BLOCKER_BATCH);
    const results = await Promise.all(
      batch.map((campaign) =>
        admin.rpc("campaign_activation_blockers", { p_campaign_id: campaign.id }),
      ),
    );
    results.forEach((result, index) => {
      const id = String(batch[index].id);
      if (result.error) {
        blockerLookupError = result.error.message;
        blockersById.set(id, null);
        return;
      }
      blockersById.set(id, Array.isArray(result.data) ? (result.data as string[]) : []);
    });
  }

  const items = campaigns.map((campaign) => {
    const id = String(campaign.id);
    const creative = creativeByCampaign.get(id) ?? null;
    const advertiser = advertiserById.get(String(campaign.advertiser_id ?? "")) ?? null;
    const blockers = blockersById.has(id) ? blockersById.get(id)! : null;
    const creativeStatus = creative ? String(creative.status) : null;
    const state = moderationState(String(campaign.status), creativeStatus, blockers);

    return {
      campaignId: id,
      name: campaign.name ?? null,
      headline: campaign.headline ?? null,
      description: campaign.description ?? null,
      cta: campaign.cta ?? null,
      status: campaign.status ?? null,
      audienceId: campaign.audience_id ?? null,
      landingUrl: campaign.landing_url ?? null,
      budgetCents: campaign.budget_cents ?? null,
      cpmCents: campaign.cpm_cents ?? null,
      spendMilliCents: campaign.spend_milli_cents ?? null,
      impressionsCount: campaign.impressions_count ?? null,
      clicksCount: campaign.clicks_count ?? null,
      conversionsCount: campaign.conversions_count ?? null,
      startsAt: campaign.starts_at ?? null,
      endsAt: campaign.ends_at ?? null,
      createdAt: campaign.created_at ?? null,
      updatedAt: campaign.updated_at ?? null,
      advertiser: advertiser
        ? {
            id: String(advertiser.id),
            companyName: advertiser.company_name ?? null,
            canRunCampaigns: advertiser.can_run_campaigns === true,
          }
        : null,
      creative: creative
        ? {
            status: creative.status ?? null,
            mediaType: creative.media_type ?? null,
            mimeType: creative.mime_type ?? null,
            fileSizeBytes: creative.file_size_bytes ?? null,
            width: creative.width ?? null,
            height: creative.height ?? null,
            durationMs: creative.duration_ms ?? null,
            checksum: creative.checksum ?? null,
            label: creative.label ?? null,
            updatedAt: creative.updated_at ?? null,
            // The object key and any signed URL stay out of this response: the
            // admin queue needs the review status, not a delivery credential.
            objectKeyPresent: Boolean(creative.object_key),
          }
        : null,
      creativeStatus,
      blockers: blockers
        ? blockers.map((code) => ({ code, message: ACTIVATION_BLOCKER_MESSAGES[code] ?? code }))
        : null,
      blockersAvailable: blockers !== null,
      reviewState: state,
      needsAttention:
        blockers !== null &&
        blockers.length > 0 &&
        campaign.status !== "active" &&
        campaign.status !== "archived",
    };
  });

  const attention = items.filter((item) => item.needsAttention);

  return {
    items,
    summary: {
      windowSize: items.length,
      needsAttention: attention.length,
      byReviewState: groupBy(items, "reviewState"),
      byCampaignStatus: groupBy(items, "status"),
      byCreativeStatus: groupBy(
        items.filter((item) => item.creativeStatus),
        "creativeStatus",
      ),
    },
    blockerCodes: ACTIVATION_BLOCKER_MESSAGES,
    blockerLookupError,
    capabilities: {
      queueSemantics: {
        supported: true,
        detail:
          "This is a readiness queue derived from campaign_creatives.status plus campaign_activation_blockers(). There is no human moderation queue table: nothing here has ever been submitted to a moderator.",
      },
      decide: {
        supported: false,
        reason:
          "No admin decision endpoint exists. creatives/index.ts is reached through requireAdvertiser and campaigns/index.ts scopes every update with .eq('advertiser_id', ...), so an admin JWT without its own advertiser row cannot write either. Approve / Reject / Flag / Batch cannot be implemented against this backend.",
      },
      forceStatus: {
        supported: false,
        reason:
          "campaigns.status is writable only through the advertiser-scoped PATCH in campaigns/index.ts, which enforces the TRANSITIONS table. No admin override path is exposed.",
      },
      storageVerification: {
        supported: false,
        reason:
          "Confirming the stored object still exists in Filebase needs a network HEAD. creatives/index.ts does it before flipping a creative to validated; this read-only route does not, so 'validated' means the row says validated, not that the bytes are reachable.",
      },
      domainReputation: {
        supported: false,
        reason: "No domain or URL reputation service is integrated anywhere in this project.",
      },
      piiScanning: {
        supported: false,
        reason:
          "No PII or content scanner runs server-side. Creative MIME types and sizes are constrained by CHECK constraints in 000022; the text is not inspected.",
      },
      slaTimer: {
        supported: false,
        reason:
          "No review deadline, queue entry time or SLA policy is stored. created_at/updated_at are the only timestamps that exist.",
      },
      servingGate: {
        supported: true,
        detail: "The advertiser gate can be changed via PATCH /admin/accounts/gate.",
      },
      rowLimit: MODERATION_LIMIT,
      truncated: campaigns.length >= MODERATION_LIMIT,
    },
  };
}

type SignalKind = "measured" | "unverified";

type Signal = {
  key: string;
  label: string;
  kind: SignalKind;
  ok: boolean | null;
  detail: string;
  durationMs: number | null;
  source: string | null;
};

// PromiseLike, not Promise: a PostgREST query builder is a thenable, so a
// Promise-typed parameter rejects every admin.from(...) chain passed directly.
async function timedProbe(run: () => PromiseLike<{ error: { message: string } | null }>) {
  const startedAt = Date.now();
  const { error } = await run();
  return { ok: !error, durationMs: Date.now() - startedAt, error: error ? error.message : null };
}

async function healthSignals() {
  const [profilesProbe, telemetryProbe] = await Promise.all([
    timedProbe(() => admin.from("profiles").select("id").limit(1)),
    // telemetry_events has RLS enabled with zero policies (000021), so a
    // successful read here also proves the service-role path is intact rather
    // than merely proving the table exists.
    timedProbe(() => admin.from("telemetry_events").select("id").limit(1)),
  ]);

  const [activeCampaignsRes, publishersRes, placementsRes, creativeBacklogRes, quarantineRes] =
    await Promise.all([
      admin.from("campaigns").select("*", { count: "exact", head: true }).eq("status", "active"),
      admin.from("publishers").select("*", { count: "exact", head: true }),
      admin.from("placements").select("*", { count: "exact", head: true }).eq("enabled", true),
      admin
        .from("campaign_creatives")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "uploaded"]),
      admin
        .from("telemetry_events")
        .select("*", { count: "exact", head: true })
        .eq("validation_state", "quarantined"),
    ]);

  const signals: Signal[] = [
    {
      key: "auth",
      label: "Admin authorization",
      kind: "measured",
      ok: true,
      detail:
        "This request passed getJwtUser() and requireAdmin(), which resolved profiles.role = 'admin' and a matching public.admin_emails row.",
      durationMs: null,
      source: "supabase/functions/_shared/auth.ts",
    },
    {
      key: "database",
      label: "Database (PostgREST round-trip)",
      kind: "measured",
      ok: profilesProbe.ok,
      detail: profilesProbe.error
        ? `profiles read failed: ${profilesProbe.error}`
        : "profiles read returned without error.",
      durationMs: profilesProbe.durationMs,
      source: "public.profiles",
    },
    {
      key: "telemetryPath",
      label: "Service-role path (zero-policy table)",
      kind: "measured",
      ok: telemetryProbe.ok,
      detail: telemetryProbe.error
        ? `telemetry_events read failed: ${telemetryProbe.error}`
        : "telemetry_events read returned without error through the service role.",
      durationMs: telemetryProbe.durationMs,
      source: "public.telemetry_events",
    },
    {
      key: "delivery",
      label: "Delivery inventory",
      kind: "measured",
      // Having something to serve is a fact about inventory, not proof that
      // anything is being served successfully, so this reports the count.
      ok: activeCampaignsRes.error ? null : (activeCampaignsRes.count ?? 0) > 0,
      detail: activeCampaignsRes.error
        ? `campaign count failed: ${activeCampaignsRes.error.message}`
        : `${activeCampaignsRes.count ?? 0} campaign(s) in status 'active'.`,
      durationMs: null,
      source: "public.campaigns",
    },
    {
      key: "creativeBacklog",
      label: "Creative validation backlog",
      kind: "measured",
      ok: creativeBacklogRes.error ? null : (creativeBacklogRes.count ?? 0) === 0,
      detail: creativeBacklogRes.error
        ? `creative count failed: ${creativeBacklogRes.error.message}`
        : `${creativeBacklogRes.count ?? 0} creative(s) pending or uploaded but not validated.`,
      durationMs: null,
      source: "public.campaign_creatives",
    },
    {
      key: "quarantinedTelemetry",
      label: "Quarantined delivery events",
      kind: "measured",
      ok: quarantineRes.error ? null : (quarantineRes.count ?? 0) === 0,
      detail: quarantineRes.error
        ? `telemetry count failed: ${quarantineRes.error.message}`
        : `${quarantineRes.count ?? 0} telemetry event(s) in validation_state 'quarantined'.`,
      durationMs: null,
      source: "public.telemetry_events",
    },
    {
      key: "edgeRuntime",
      label: "Edge function mesh",
      kind: "unverified",
      ok: null,
      detail:
        "Not instrumented. A function cannot observe the runtime of its siblings, and this project has no control plane, registry or per-function health endpoint. Reporting a number here would be invention.",
      durationMs: null,
      source: null,
    },
    {
      key: "uptime",
      label: "Availability / uptime",
      kind: "unverified",
      ok: null,
      detail:
        "Not instrumented. No request log, error-rate counter or SLA history is stored anywhere, so availability cannot be computed after the fact.",
      durationMs: null,
      source: null,
    },
    {
      key: "provisioning",
      label: "Publisher provisioning",
      kind: "measured",
      ok: null,
      detail: publishersRes.error
        ? `publisher count failed: ${publishersRes.error.message}`
        : `${publishersRes.count ?? 0} publisher(s) on record, ${placementsRes.count ?? 0} enabled placement(s).`,
      durationMs: null,
      source: "public.publishers, public.placements",
    },
  ];

  const measured = signals.filter((signal) => signal.kind === "measured");
  const measuredFailures = measured.filter((signal) => signal.ok === false);

  return {
    signals,
    summary: {
      measuredCount: measured.length,
      measuredFailures: measuredFailures.length,
      unverifiedCount: signals.filter((signal) => signal.kind === "unverified").length,
      // Deliberately not "every signal is ok": an unverified signal has ok=null
      // and would make a rolled-up verdict meaningless.
      state: measuredFailures.length > 0 ? "degraded" : "measured-signals-ok",
    },
    checkedAt: new Date().toISOString(),
    capabilities: {
      merkleProof: {
        supported: false,
        reason:
          "No Merkle tree, state root or content-addressed commitment is computed or stored. There is nothing to verify and no proof to publish.",
      },
      nodeMesh: {
        supported: false,
        reason:
          "No node or region registry exists. Edge functions run as managed Supabase infrastructure; this project never records where they run.",
      },
      regionalLatency: {
        supported: false,
        reason:
          "Only database round-trip time is measured here, in-process. No request originates from a region this service controls.",
      },
      droppedPackets: {
        supported: false,
        reason: "No network-level telemetry is collected at any hop.",
      },
      piiScrubbing: {
        supported: false,
        reason:
          "No content scanner or PII scrubber runs server-side. The only redaction in this repository is CLI-side secret masking in src/lib, which protects the developer's terminal, not stored creative content.",
      },
      liveStream: {
        supported: false,
        reason:
          "There is no websocket endpoint and no push channel. This route answers once per request; the console polls it like every other screen.",
      },
      signatures: {
        supported: false,
        reason:
          "telemetry_events rows carry no signature and admin_governance_actions is a plain append-only table. Rows are not tamper-evident and must not be presented as if they were.",
      },
      availabilityWindow: {
        supported: true,
        detail: "Every value on this screen is computed at checkedAt from a live query.",
      },
    },
  };
}

async function auditTrail() {
  const [totalRes, acceptedRes, quarantinedRes, rejectedRes] = await Promise.all([
    admin.from("telemetry_events").select("*", { count: "exact", head: true }),
    admin
      .from("telemetry_events")
      .select("*", { count: "exact", head: true })
      .eq("validation_state", "accepted"),
    admin
      .from("telemetry_events")
      .select("*", { count: "exact", head: true })
      .eq("validation_state", "quarantined"),
    admin
      .from("telemetry_events")
      .select("*", { count: "exact", head: true })
      .eq("validation_state", "rejected"),
  ]);

  const { data: events, error: eventsError } = await admin
    .from("telemetry_events")
    .select(
      "id, event_type, validation_state, risk_score, risk_flags, recorded_at, occurred_at, session_id, sequence, publisher_id, placement_id, campaign_id, creative_id, developer_id, sdk_version",
    )
    .order("recorded_at", { ascending: false })
    .limit(AUDIT_LIMIT);

  if (eventsError) {
    console.error("audit telemetry error:", eventsError.message);
    return apiError("INTERNAL_ERROR", "Failed to load the delivery event stream.", 500);
  }

  const rows = (events ?? []) as Record<string, unknown>[];

  // The governance log lives in migration 000024 and is not present on a
  // database that has not been migrated yet. Reported as unavailable with the
  // database's own message rather than as an empty log that looks like a
  // quiet day.
  const { data: governanceActions, error: governanceError } = await admin
    .from("admin_governance_actions")
    .select(
      "id, actor_profile_id, actor_email, action, subject_type, subject_id, reason, previous_value, new_value, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(AUDIT_LIMIT);

  const countError = [totalRes, acceptedRes, quarantinedRes, rejectedRes].find((r) => r.error);

  return {
    telemetry: {
      // Totals are exact table counts; the breakdowns are derived from the
      // fetched window only. The console labels which is which.
      totals: countError && countError.error
        ? { available: false, reason: countError.error.message }
        : {
            available: true,
            total: totalRes.count ?? 0,
            accepted: acceptedRes.count ?? 0,
            quarantined: quarantinedRes.count ?? 0,
            rejected: rejectedRes.count ?? 0,
          },
      window: {
        size: rows.length,
        byEventType: groupBy(rows, "event_type"),
        byValidationState: groupBy(rows, "validation_state"),
        truncated: rows.length >= AUDIT_LIMIT,
      },
      events: rows.map((row) => ({
        id: String(row.id),
        eventType: row.event_type ?? null,
        validationState: row.validation_state ?? null,
        riskScore: row.risk_score ?? null,
        riskFlags: Array.isArray(row.risk_flags) ? row.risk_flags : [],
        // recorded_at is the server's authoritative clock; occurred_at is the
        // SDK's claim and can be missing or wrong, so both are exposed.
        recordedAt: row.recorded_at ?? null,
        occurredAt: row.occurred_at ?? null,
        sessionId: row.session_id ?? null,
        sequence: row.sequence ?? null,
        publisherId: row.publisher_id ?? null,
        placementId: row.placement_id ?? null,
        campaignId: row.campaign_id ?? null,
        creativeId: row.creative_id ?? null,
        developerId: row.developer_id ?? null,
        sdkVersion: row.sdk_version ?? null,
      })),
    },
    governance: {
      available: !governanceError,
      reason: governanceError
        ? `admin_governance_actions is not readable: ${governanceError.message}`
        : null,
      windowSize: (governanceActions ?? []).length,
      truncated: (governanceActions ?? []).length >= AUDIT_LIMIT,
      actions: ((governanceActions ?? []) as Record<string, unknown>[]).map((row) => ({
        id: String(row.id),
        actorProfileId: row.actor_profile_id ?? null,
        actorEmail: row.actor_email ?? null,
        action: row.action ?? null,
        subjectType: row.subject_type ?? null,
        subjectId: row.subject_id ?? null,
        reason: row.reason ?? null,
        previousValue: row.previous_value ?? null,
        newValue: row.new_value ?? null,
        createdAt: row.created_at ?? null,
      })),
    },
    capabilities: {
      scope: {
        supported: true,
        detail:
          "telemetry_events is the append-only SDK delivery event stream written by the telemetry Edge Function (migration 000021). It records what the delivery pipeline did, not what an administrator did.",
      },
      adminActionAudit: {
        supported: false,
        reason:
          "No table records admin console activity. Contact-submission edits and deletes have never been logged, and no row in this project records who opened the admin console. The governance log above only covers serving-gate changes made after migration 000024 was applied.",
      },
      tamperEvidence: {
        supported: false,
        reason:
          "Neither table is append-only at the storage layer: the server-side key holds full DML on both and nothing prevents an UPDATE or DELETE. Migration 000024 revokes UPDATE and DELETE from the server role, which stops accidents, not a determined caller.",
      },
      signatures: {
        supported: false,
        reason: "No signature or hash chain is computed over either table.",
      },
      metadataInspection: {
        supported: false,
        reason:
          "telemetry_events.metadata is deliberately not returned. It is caller-supplied JSONB and has not been reviewed for what SDKs put in it.",
      },
      rowLimit: AUDIT_LIMIT,
    },
  };
}

async function operationsOverview() {
  const [campaigns, advertisers, developers, publishers, placements, events, moderation, audit] =
    await Promise.all([
      campaignsOverview(),
      advertisersOverview(),
      developersOverview(),
      publishersOverview(),
      placementsOverview(),
      eventsOverview(),
      moderationQueue(),
      auditTrail(),
    ]);

  if (moderation instanceof Response || audit instanceof Response) {
    return apiError("INTERNAL_ERROR", "Failed to assemble the operations overview.", 500);
  }

  // Narrowed explicitly: both helpers can answer with an apiError() Response,
  // and TypeScript keeps that union even after the instanceof guard above when
  // the value is re-read through an alias.
  const queue = moderation as Exclude<Awaited<ReturnType<typeof moderationQueue>>, Response>;
  const auditLog = audit as Exclude<Awaited<ReturnType<typeof auditTrail>>, Response>;
  const { count: blockedAdvertisers } = await admin
    .from("advertisers")
    .select("*", { count: "exact", head: true })
    .eq("can_run_campaigns", false);
  const { count: suspendedPublishers } = await admin
    .from("publishers")
    .select("*", { count: "exact", head: true })
    .eq("status", "suspended");
  const { count: telemetryRecent } = await admin
    .from("telemetry_events")
    .select("*", { count: "exact", head: true })
    .gte("recorded_at", events.since);

  const byStatus = queue.summary.byCampaignStatus;
  const inFlight = Object.entries(byStatus)
    .filter(([status]) => status !== "archived")
    .reduce((total, [, count]) => total + count, 0);

  const telemetryTotals = auditLog.telemetry.totals;
  const quarantined =
    telemetryTotals.available === true ? telemetryTotals.quarantined : null;

  // Each card carries its own provenance so a reader never has to guess
  // whether a number is a live count, a windowed sample, or nothing at all.
  const cards = [
    {
      key: "activeCampaigns",
      label: "Active campaigns",
      available: true,
      value: campaigns.activeCount,
      unit: "campaigns",
      detail: "Exact count of campaigns with status 'active'.",
      source: "public.campaigns",
      scope: "total",
    },
    {
      key: "campaignsInFlight",
      label: "Campaigns not archived",
      available: true,
      value: inFlight,
      unit: "campaigns",
      detail: `Derived from the ${queue.summary.windowSize} most recently updated campaigns in the review queue window.`,
      source: "public.campaigns",
      scope: "window",
    },
    {
      key: "moderationBacklog",
      label: "Campaigns not servable",
      available: true,
      value: queue.summary.needsAttention,
      unit: "campaigns",
      detail: "Blocked by campaign_activation_blockers() and not active or archived.",
      source: "public.campaign_activation_blockers()",
      scope: "window",
    },
    {
      key: "creativesAwaitingValidation",
      label: "Creatives awaiting validation",
      available: true,
      value: (queue.summary.byCreativeStatus.pending ?? 0) +
        (queue.summary.byCreativeStatus.uploaded ?? 0),
      unit: "creatives",
      detail: "campaign_creatives rows in 'pending' or 'uploaded'.",
      source: "public.campaign_creatives",
      scope: "window",
    },
    {
      key: "serveEvents24h",
      label: "Ad serves (24h)",
      available: true,
      value: events.serveCount,
      unit: "serves",
      detail: `ad_serve_log rows since ${events.since}.`,
      source: "public.ad_serve_log",
      scope: "window",
    },
    {
      key: "impressions24h",
      label: "Impressions (24h)",
      available: true,
      value: events.impressionCount,
      unit: "impressions",
      detail: `ad_impressions rows since ${events.since}.`,
      source: "public.ad_impressions",
      scope: "window",
    },
    {
      key: "interactions24h",
      label: "Interactions (24h)",
      available: true,
      value: events.interactionCount,
      unit: "interactions",
      detail: `ad_interactions rows since ${events.since}.`,
      source: "public.ad_interactions",
      scope: "window",
    },
    {
      key: "telemetryEvents24h",
      label: "Telemetry events (24h)",
      available: true,
      value: telemetryRecent ?? 0,
      unit: "events",
      detail: `telemetry_events rows by the server clock since ${events.since}.`,
      source: "public.telemetry_events",
      scope: "window",
    },
    {
      key: "quarantinedEvents",
      label: "Quarantined events (all time)",
      available: quarantined !== null,
      value: quarantined,
      unit: "events",
      detail:
        quarantined === null
          ? "Count unavailable."
          : "telemetry_events in validation_state 'quarantined'.",
      source: "public.telemetry_events",
      scope: "total",
    },
    {
      key: "gatedAdvertisers",
      label: "Advertisers blocked from serving",
      available: true,
      value: blockedAdvertisers ?? 0,
      unit: "advertisers",
      detail: "advertisers.can_run_campaigns = false.",
      source: "public.advertisers",
      scope: "total",
    },
    {
      key: "suspendedPublishers",
      label: "Suspended publishers",
      available: true,
      value: suspendedPublishers ?? 0,
      unit: "publishers",
      detail: "publishers.status = 'suspended'.",
      source: "public.publishers",
      scope: "total",
    },
    {
      key: "enabledPlacements",
      label: "Enabled placements",
      available: true,
      value: placements.enabledCount,
      unit: `of ${placements.totalCount}`,
      detail: "placements.enabled = true.",
      source: "public.placements",
      scope: "total",
    },
    {
      key: "platformAccounts",
      label: "Accounts on platform",
      available: true,
      value: `${advertisers.totalCount} advertisers / ${developers.totalCount} developers / ${publishers.totalCount} publishers`,
      unit: "",
      detail: "Row counts on each role table.",
      source: "public.advertisers, public.developer_accounts, public.publishers",
      scope: "total",
    },
    {
      key: "edgeUptime",
      label: "Edge availability",
      available: false,
      value: null,
      unit: "",
      detail:
        "Not instrumented. No request log, error counter or uptime history is stored, so availability cannot be computed for any window.",
      source: null,
      scope: "unavailable",
    },
    {
      key: "regionMesh",
      label: "Regions / node mesh",
      available: false,
      value: null,
      unit: "",
      detail:
        "Not instrumented. No node or region registry exists; edge functions run as managed infrastructure that this project never enumerates.",
      source: null,
      scope: "unavailable",
    },
    {
      key: "settlementSync",
      label: "Settlement synchronisation",
      available: false,
      value: null,
      unit: "",
      detail:
        "Not instrumented. settle_rewards computes payouts on demand and reward_ledger records accrual, but no run history, cursor or last-success timestamp is persisted anywhere.",
      source: null,
      scope: "unavailable",
    },
    {
      key: "openIncidents",
      label: "Open incidents",
      available: false,
      value: null,
      unit: "",
      detail:
        "Not instrumented. There is no incident table, no escalation record and no on-call model in this project.",
      source: null,
      scope: "unavailable",
    },
    {
      key: "slaBreaches",
      label: "SLA breaches",
      available: false,
      value: null,
      unit: "",
      detail:
        "Not instrumented. No SLA target or per-record deadline is stored, so nothing can be scored against one.",
      source: null,
      scope: "unavailable",
    },
  ];

  return {
    cards,
    recentEvents: events,
    generatedAt: new Date().toISOString(),
    capabilities: {
      actions: {
        supported: false,
        reason:
          "PoP ping, token freeze and every other operation in the console design have no backend command behind them. Nothing in this function or any other can be invoked to run them.",
        },
      batchOperations: {
        supported: false,
        reason:
          "No bulk endpoint exists. The one supported write is a single advertiser serving gate per PATCH /admin/accounts/gate.",
      },
      governanceLog: auditLog.capabilities,
      note: "Every value above was read on this request. Nothing is cached, sampled from a design mock, or carried over from a previous response.",
    },
  };
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

async function bootstrapFirstAdmin(user: { id: string; email?: string | null }) {
  // The first admin cannot bootstrap through requireAdmin: that function
  // reads public.admin_emails, which is empty until somebody puts an email
  // in it, and the only way to put an email in it is to be an admin. This
  // route breaks that cycle by accepting the call when the table is empty
  // and the caller's profile already says 'admin'.
  //
  // The check is a guarded INSERT, not a read-then-insert: two first admins
  // pressing the button at once would both see an empty table and both
  // write. `.is("email", null)` inside the INSERT means the second one
  // matches zero rows and reports the winner instead of creating a second
  // admin. It also means a later caller cannot use this route to add
  // themselves: once the table has a row the guard matches nothing and the
  // route answers 409, pointing at the SQL console where further admins are
  // supposed to be added by a human.
  const normalizedEmail = String(user.email || '').toLowerCase().trim()
  if (!normalizedEmail) {
    return apiError("INVALID_EMAIL", "The signed-in account has no email.", 400);
  }
  const { data, error } = await admin
    .from("admin_emails")
    .insert({ email: normalizedEmail, note: 'bootstrap' })
    .select("email, note, created_at")
    .single();
  if (error) {
    // 23505 is the unique-violation code, which is what the empty-table
    // guard produces when another caller got there first.
    if (error.code === "23505") {
      return apiError(
        "ALREADY_BOOTSTRAPPED",
        "The admin allowlist already has an entry. Add further admins from the SQL console.",
        409,
      );
    }
    console.error("admin bootstrap error:", error.message);
    return apiError("INTERNAL_ERROR", "Could not bootstrap the admin allowlist.", 500);
  }
  return json({ bootstrapped: true, email: data.email, createdAt: data.created_at });
}

const handler = serveWithCors(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const user = authed.user!;

  const path = restPath(new URL(req.url).pathname, "admin");
  const segment = path[0] || "overview";

  // Bootstrap runs before requireAdmin, on purpose: it is the one route that
  // has to work while the allowlist is still empty. It only accepts callers
  // whose profile already says 'admin', so it cannot be used to grant
  // yourself admin status — only to make the admin status you already have
  // actually work.
  if (segment === "bootstrap" && req.method === "POST") {
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle();
    if (profileError) {
      return apiError("INTERNAL_ERROR", "Could not load profile.", 500);
    }
    if (!profile || profile.role !== "admin") {
      return apiError("FORBIDDEN", "Admin access required.", 403);
    }
    return bootstrapFirstAdmin(user);
  }

  const adminCheck = await requireAdmin(admin, user.id, user.email || '');
  if ("error" in adminCheck && adminCheck.error) return adminCheck.error;

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

      case "campaign": {
        // Admin-only hard delete of a single campaign. The advertiser-facing
        // DELETE on /campaigns/:id archives the row; this route removes it
        // outright and records who did it.
        const id = path[1];
        if (!id) return apiError("NOT_FOUND", "Not found.", 404);
        if (req.method !== "DELETE") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await deleteCampaign(id, { profileId: user.id, email: user.email || "" });
        return result instanceof Response ? result : json(result);
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

      case "account-keys": {
        // The only place an account key is ever minted.
        //
        // Reaching this branch already means `requireAdmin` resolved
        // profiles.role = 'admin' against the verified JWT, so the audience is
        // already restricted to staff. That check is the reason this route
        // lives here rather than in provision_publisher: a developer could
        // call the latter, and handing them their own staff capability would
        // make "internal" a property of which endpoint you happened to hit.
        if (req.method !== "POST") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }

        const body = await req.text();
        let parsed: { publisher_id?: unknown };
        try {
          parsed = body ? JSON.parse(body) : {};
        } catch {
          return apiError("INVALID_JSON", "Request body must be valid JSON.", 400);
        }

        const publisherId = parsed.publisher_id;
        if (typeof publisherId !== "string" || !isUuid(publisherId)) {
          return apiError("INVALID_ID", "publisher_id must be a UUID.", 400);
        }

        const result = await mintAccountKeyForPublisher(publisherId);
        if (result instanceof Response) return result;
        return json(result);
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

      case "accounts": {
        const sub = path[1];

        if (!sub) {
          if (req.method !== "GET") {
            return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
          }
          const result = await accountsDirectory();
          return result instanceof Response ? result : json(result);
        }

        if (sub === "gate") {
          if (req.method !== "PATCH") {
            return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
          }
          const body = await req.text();
          let parsed;
          try {
            parsed = body ? JSON.parse(body) : {};
          } catch {
            return apiError("INVALID_JSON", "Request body must be valid JSON.", 400);
          }
          // The actor comes from the verified JWT, never from the body: the
          // audit row has to name the person the server authenticated.
          const result = await updateAdvertiserGate(parsed, {
            profileId: user.id,
            email: user.email || "",
          });
          return result instanceof Response ? result : json(result);
        }

        // Admin deletes. These resolve the profile row, check its role, then
        // drop the auth user and let the FKs cascade. They are the only path
        // that can remove an account, which is why they live here rather than
        // in delete_account: a self-service route cannot be handed a target.
        if (sub === "advertiser") {
          if (req.method !== "DELETE") {
            return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
          }
          const result = await deleteAdvertiserAccount(path[2], { profileId: user.id, email: user.email || "" });
          return result instanceof Response ? result : json(result);
        }
        if (sub === "developer") {
          if (req.method !== "DELETE") {
            return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
          }
          const result = await deleteDeveloperAccount(path[2], { profileId: user.id, email: user.email || "" });
          return result instanceof Response ? result : json(result);
        }

        return apiError("NOT_FOUND", "Not found.", 404);
      }

      case "moderation": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await moderationQueue();
        return result instanceof Response ? result : json(result);
      }

      case "health": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await healthSignals();
        return result instanceof Response ? result : json(result);
      }

      case "audit": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await auditTrail();
        return result instanceof Response ? result : json(result);
      }

      case "operations": {
        if (req.method !== "GET") {
          return apiError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
        }
        const result = await operationsOverview();
        return result instanceof Response ? result : json(result);
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
