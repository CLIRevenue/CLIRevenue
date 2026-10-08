// Advertiser creative pipeline: upload authorisation, confirmation, validation,
// listing, replacement and revocation for Filebase-backed creatives.
//
// OWNERSHIP IS NEVER SUPPLIED BY THE CALLER. Every route derives it from the
// caller's JWT -> profile -> advertiser -> campaign, and the creative row is
// always reached through that campaign. A body carrying `advertiserId`,
// `objectKey`, or any other tenant field is rejected as an unknown field.
//
// The browser never receives a Filebase secret. `upload-intent` returns a
// short-lived presigned PUT URL; the Filebase secret stays in this function's
// environment. Delivery URLs are presigned GETs minted here, never public paths.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { adminClient, getJwtUser, requireAdvertiser } from "../_shared/auth.ts";
import {
  apiError,
  isUuid,
  json,
  optionsResponse,
  restPath,
  serveWithCors,
} from "../_shared/http.ts";
import {
  buildObjectKey,
  CREATIVE_DELIVERY_URL_TTL_SECONDS,
  filebaseConfig,
  headObject,
  deleteObject,
  MAX_UPLOAD_URL_TTL_SECONDS,
  MIN_UPLOAD_URL_TTL_SECONDS,
  presign,
  presignCreativeRead,
  validateCreativeUpload,
  type MediaType,
} from "../_shared/filebase.ts";

const CREATIVE_COLS =
  "id, campaign_id, advertiser_id, media_type, object_key, mime_type, file_size_bytes, " +
  "extension, width, height, duration_ms, poster_object_key, checksum, label, status, " +
  "created_at, updated_at";

/** Shape of a campaign_creatives row as this function reads and writes it. */
type CreativeRow = Record<string, unknown>;

const UPLOAD_INTENT_FIELDS = new Set([
  "campaignId",
  "mediaType",
  "mimeType",
  "fileSizeBytes",
  "filename",
  "label",
]);
const CONFIRM_FIELDS = new Set([
  "campaignId",
  "mimeType",
  "fileSizeBytes",
  "width",
  "height",
  "durationMs",
  "checksum",
]);
const VALIDATE_FIELDS = new Set(["campaignId"]);

function unknownFields(
  body: Record<string, unknown>,
  allowed: Set<string>,
): string[] {
  return Object.keys(body).filter((key) => !allowed.has(key));
}

function requireString(
  body: Record<string, unknown>,
  key: string,
  max = 200,
): string | null {
  const value = body[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalPositiveInt(value: unknown): number | null | "INVALID" {
  if (value === undefined || value === null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n <= 0 || n > 100_000) return "INVALID";
  return n;
}

/**
 * Loads the campaign and its single creative slot, proving ownership on both.
 * Returns 404 rather than 403 for a campaign owned by somebody else so an
 * advertiser cannot probe for the existence of another tenant's campaign ids.
 */
async function loadOwnedCreative(
  admin: SupabaseClient,
  campaignId: string,
  advertiserId: string,
): Promise<
  | { error: Response }
  | { campaign: CreativeRow; creative: CreativeRow }
> {
  if (!isUuid(campaignId)) {
    return { error: apiError("INVALID_CAMPAIGN", "campaignId must be a UUID.", 400) };
  }
  const { data: campaign, error: campaignError } = await admin
    .from("campaigns")
    .select("id, advertiser_id, name, status, budget_cents, cpm_cents, spend_milli_cents")
    .eq("id", campaignId)
    .eq("advertiser_id", advertiserId)
    .maybeSingle();
  if (campaignError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load campaign.", 500) };
  }
  if (!campaign) {
    return { error: apiError("CAMPAIGN_NOT_FOUND", "Campaign not found.", 404) };
  }
  const { data: creative, error: creativeError } = await admin
    .from("campaign_creatives")
    .select(CREATIVE_COLS)
    .eq("campaign_id", campaignId)
    .maybeSingle();
  if (creativeError) {
    return { error: apiError("INTERNAL_ERROR", "Could not load creative.", 500) };
  }
  // The mint trigger creates the slot, but a campaign created before migration
  // 000022 may not have one yet. Create it lazily, scoped to this owner.
  if (!creative) {
    const { data: created, error: createError } = await admin
      .from("campaign_creatives")
      .insert({ campaign_id: campaignId, advertiser_id: advertiserId })
      .select(CREATIVE_COLS)
      .single();
    if (createError) {
      return { error: apiError("INTERNAL_ERROR", "Could not open a creative slot.", 500) };
    }
    return { campaign: campaign as unknown as CreativeRow, creative: created as unknown as CreativeRow };
  }
  return { campaign: campaign as unknown as CreativeRow, creative: creative as unknown as CreativeRow };
}

function creativeView(
  creative: Record<string, unknown>,
  options: { includeUrl?: boolean; config?: ReturnType<typeof filebaseConfig> } = {},
): Record<string, unknown> {
  const status = String(creative.status ?? "pending");
  const view: Record<string, unknown> = {
    id: creative.id,
    campaignId: creative.campaign_id,
    mediaType: creative.media_type ?? null,
    mimeType: creative.mime_type ?? null,
    fileSizeBytes: creative.file_size_bytes ?? null,
    width: creative.width ?? null,
    height: creative.height ?? null,
    durationMs: creative.duration_ms ?? null,
    checksum: creative.checksum ?? null,
    label: creative.label ?? null,
    status,
    objectKey: creative.object_key ?? null,
    createdAt: creative.created_at,
    updatedAt: creative.updated_at,
  };
  const config = options.config;
  if (options.includeUrl && config && creative.object_key && status !== "revoked") {
    view.url = presignCreativeRead(
      config,
      String(creative.object_key),
      CREATIVE_DELIVERY_URL_TTL_SECONDS,
    );
  }
  return view;
}

async function handleUploadIntent(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const extra = unknownFields(body, UPLOAD_INTENT_FIELDS);
  if (extra.length) {
    return apiError("UNKNOWN_FIELDS", `Unexpected fields: ${extra.join(", ")}.`, 400);
  }
  const campaignId = requireString(body, "campaignId", 64);
  if (!campaignId) {
    return apiError("MISSING_FIELDS", "campaignId is required.", 400);
  }
  const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
  if ("error" in owned) return owned.error;
  const { creative } = owned;

  const mediaType = typeof body.mediaType === "string" ? body.mediaType : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.toLowerCase() : "";
  const fileSizeBytes = Number(body.fileSizeBytes);
  const filename = typeof body.filename === "string" ? body.filename : undefined;
  const validation = validateCreativeUpload({ mediaType, mimeType, fileSizeBytes, filename });
  if (!validation.ok) {
    return apiError(validation.code, validation.message, 400);
  }

  const config = filebaseConfig();
  if (!config) {
    return apiError(
      "STORAGE_NOT_CONFIGURED",
      "Creative storage is not configured on this deployment.",
      503,
    );
  }

  const objectKey = buildObjectKey({
    advertiserId,
    campaignId: String(owned.campaign.id),
    creativeId: String(creative.id),
    variant: "original",
  });

  // Releasing a previous upload keeps the bucket free of orphans and makes the
  // key re-usable; the unique partial index on object_key would otherwise
  // reject a replacement outright.
  if (creative.object_key && creative.object_key !== objectKey) {
    await deleteObject(config, String(creative.object_key));
  }

  const { data: reserved, error: reserveError } = await admin
    .from("campaign_creatives")
    .update({
      advertiser_id: advertiserId,
      media_type: validation.mediaType,
      mime_type: validation.mimeType,
      extension: validation.extension,
      status: "pending",
      object_key: null,
      width: null,
      height: null,
      duration_ms: null,
      checksum: null,
      poster_object_key: null,
      label: typeof body.label === "string" && body.label.trim()
        ? body.label.trim().slice(0, 120)
        : null,
    })
    .eq("id", creative.id)
    .eq("campaign_id", String(owned.campaign.id))
    .eq("advertiser_id", advertiserId)
    .select(CREATIVE_COLS)
    .single();
  if (reserveError) {
    return apiError("INTERNAL_ERROR", "Could not reserve the creative slot.", 500);
  }

  const uploadUrl = presign(config, {
    method: "PUT",
    objectKey,
    expiresInSeconds: MIN_UPLOAD_URL_TTL_SECONDS,
    contentType: validation.mimeType,
  });

  return json(
    {
      creative: creativeView(reserved as unknown as CreativeRow, { config }),
      upload: {
        url: uploadUrl,
        method: "PUT",
        headers: { "Content-Type": validation.mimeType },
        expiresInSeconds: MIN_UPLOAD_URL_TTL_SECONDS,
        maxBytes: validation.maxBytes,
      },
      storageReady: true,
      ttlRange: {
        min: MIN_UPLOAD_URL_TTL_SECONDS,
        max: MAX_UPLOAD_URL_TTL_SECONDS,
      },
    },
    200,
    req,
  );
}

async function handleConfirm(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const extra = unknownFields(body, CONFIRM_FIELDS);
  if (extra.length) {
    return apiError("UNKNOWN_FIELDS", `Unexpected fields: ${extra.join(", ")}.`, 400);
  }
  const campaignId = requireString(body, "campaignId", 64);
  if (!campaignId) {
    return apiError("MISSING_FIELDS", "campaignId is required.", 400);
  }
  const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
  if ("error" in owned) return owned.error;
  const { creative } = owned;
  if (!creative.object_key) {
    return apiError(
      "UPLOAD_NOT_STARTED",
      "Request an upload before confirming it.",
      409,
    );
  }

  const width = optionalPositiveInt(body.width);
  const height = optionalPositiveInt(body.height);
  const durationMs = optionalPositiveInt(body.durationMs);
  if (width === "INVALID" || height === "INVALID" || durationMs === "INVALID") {
    return apiError("INVALID_DIMENSIONS", "width, height and durationMs must be positive integers.", 400);
  }

  const config = filebaseConfig();
  if (!config) {
    return apiError("STORAGE_NOT_CONFIGURED", "Creative storage is not configured.", 503);
  }

  // The client never gets to declare its own file size or type: HEAD is the
  // authority for what actually landed in the bucket.
  const head = await headObject(config, String(creative.object_key));
  if (!head) {
    return apiError(
      "UPLOAD_NOT_FOUND",
      "No stored object was found for this creative.",
      409,
    );
  }
  if (head.contentType && head.contentType.split(";")[0].trim() !== creative.mime_type) {
    return apiError(
      "MIME_MISMATCH",
      "Stored object type does not match the reserved creative.",
      400,
    );
  }
  const declaredSize = Number(body.fileSizeBytes);
  if (Number.isFinite(declaredSize) && declaredSize > 0 && declaredSize !== head.contentLength) {
    return apiError("SIZE_MISMATCH", "Stored object size does not match the declared size.", 400);
  }

  const mediaType = String(creative.media_type ?? "image") as MediaType;
  const declaredMime = typeof body.mimeType === "string"
    ? body.mimeType.toLowerCase()
    : String(creative.mime_type);
  if (declaredMime !== creative.mime_type) {
    return apiError("MIME_MISMATCH", "Declared type does not match the reserved creative.", 400);
  }
  const validation = validateCreativeUpload({
    mediaType,
    mimeType: declaredMime,
    fileSizeBytes: head.contentLength,
  });
  if (!validation.ok) {
    return apiError(validation.code, validation.message, 400);
  }

  const checksum = typeof body.checksum === "string" && body.checksum.trim()
    ? body.checksum.trim().slice(0, 128)
    : null;

  const { data: updated, error: updateError } = await admin
    .from("campaign_creatives")
    .update({
      status: "uploaded",
      file_size_bytes: head.contentLength,
      mime_type: validation.mimeType,
      width,
      height,
      duration_ms: durationMs,
      checksum,
    })
    .eq("id", creative.id)
    .eq("campaign_id", campaignId)
    .eq("advertiser_id", advertiserId)
    .select(CREATIVE_COLS)
    .single();
  if (updateError) {
    return apiError("INTERNAL_ERROR", "Could not record the uploaded creative.", 500);
  }

  return json({ creative: creativeView(updated as unknown as CreativeRow, { config }) }, 200, req);
}

async function handleValidate(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const extra = unknownFields(body, VALIDATE_FIELDS);
  if (extra.length) {
    return apiError("UNKNOWN_FIELDS", `Unexpected fields: ${extra.join(", ")}.`, 400);
  }
  const campaignId = requireString(body, "campaignId", 64);
  if (!campaignId) {
    return apiError("MISSING_FIELDS", "campaignId is required.", 400);
  }
  const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
  if ("error" in owned) return owned.error;
  const { creative } = owned;

  if (creative.status !== "uploaded") {
    return apiError(
      "CREATIVE_NOT_UPLOADED",
      "Confirm the upload before validating the creative.",
      409,
    );
  }
  if (!creative.object_key || !creative.mime_type || !creative.file_size_bytes) {
    return apiError("CREATIVE_INCOMPLETE", "Creative metadata is incomplete.", 409);
  }

  const config = filebaseConfig();
  if (!config) {
    return apiError("STORAGE_NOT_CONFIGURED", "Creative storage is not configured.", 503);
  }
  const head = await headObject(config, String(creative.object_key));
  if (!head) {
    // The object disappeared between confirm and validate. Retire the slot so
    // the campaign can never activate against a dangling key.
    await admin
      .from("campaign_creatives")
      .update({ status: "failed", object_key: null, file_size_bytes: null })
      .eq("id", creative.id)
      .eq("advertiser_id", advertiserId);
    return apiError("CREATIVE_OBJECT_MISSING", "Stored creative object is missing.", 409);
  }

  const validation = validateCreativeUpload({
    mediaType: String(creative.media_type),
    mimeType: String(creative.mime_type),
    fileSizeBytes: head.contentLength,
  });
  if (!validation.ok) {
    return apiError(validation.code, validation.message, 400);
  }

  const { data: updated, error } = await admin
    .from("campaign_creatives")
    .update({ status: "validated" })
    .eq("id", creative.id)
    .eq("campaign_id", campaignId)
    .eq("advertiser_id", advertiserId)
    .eq("status", "uploaded")
    .select(CREATIVE_COLS)
    .single();
  if (error || !updated) {
    return apiError("CREATIVE_NOT_UPLOADED", "Creative is no longer awaiting validation.", 409);
  }

  return json({ creative: creativeView(updated as unknown as CreativeRow, { config }), validated: true }, 200, req);
}

async function handleList(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  campaignId: string | null,
): Promise<Response> {
  const config = filebaseConfig();
  if (campaignId) {
    const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
    if ("error" in owned) return owned.error;
    return json(
      { creatives: [creativeView(owned.creative, { includeUrl: true, config })] },
      200,
      req,
    );
  }
  const { data, error } = await admin
    .from("campaign_creatives")
    .select(CREATIVE_COLS)
    .eq("advertiser_id", advertiserId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) {
    return apiError("INTERNAL_ERROR", "Could not load creatives.", 500);
  }
  return json(
    {
      creatives: (data ?? []).map((row) =>
        creativeView(row as unknown as CreativeRow, { includeUrl: true, config }),
      ),
    },
    200,
    req,
  );
}

async function handleDelete(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  campaignId: string,
): Promise<Response> {
  const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
  if ("error" in owned) return owned.error;
  const { creative } = owned;
  const config = filebaseConfig();
  if (creative.object_key && config) {
    await deleteObject(config, String(creative.object_key));
  }
  const { error } = await admin
    .from("campaign_creatives")
    .update({
      status: "pending",
      object_key: null,
      mime_type: null,
      media_type: null,
      extension: null,
      file_size_bytes: null,
      width: null,
      height: null,
      duration_ms: null,
      checksum: null,
      poster_object_key: null,
      label: null,
    })
    .eq("id", creative.id)
    .eq("campaign_id", campaignId)
    .eq("advertiser_id", advertiserId);
  if (error) {
    return apiError("INTERNAL_ERROR", "Could not clear the creative.", 500);
  }
  return json({ deleted: true, campaignId }, 200, req);
}

async function handleRevoke(
  req: Request,
  admin: SupabaseClient,
  advertiserId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const extra = unknownFields(body, VALIDATE_FIELDS);
  if (extra.length) {
    return apiError("UNKNOWN_FIELDS", `Unexpected fields: ${extra.join(", ")}.`, 400);
  }
  const campaignId = requireString(body, "campaignId", 64);
  if (!campaignId) {
    return apiError("MISSING_FIELDS", "campaignId is required.", 400);
  }
  const owned = await loadOwnedCreative(admin, campaignId, advertiserId);
  if ("error" in owned) return owned.error;
  const config = filebaseConfig();
  if (owned.creative.object_key && config) {
    await deleteObject(config, String(owned.creative.object_key));
  }
  const { data, error } = await admin
    .from("campaign_creatives")
    .update({ status: "revoked", object_key: null })
    .eq("id", owned.creative.id)
    .eq("campaign_id", campaignId)
    .eq("advertiser_id", advertiserId)
    .select(CREATIVE_COLS)
    .single();
  if (error) {
    return apiError("INTERNAL_ERROR", "Could not revoke the creative.", 500);
  }
  return json({ creative: creativeView(data as unknown as CreativeRow, { config }), revoked: true }, 200, req);
}

const handler = serveWithCors(async (req): Promise<Response> => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
    return apiError("METHOD_NOT_ALLOWED", "Unsupported method.", 405, {}, req);
  }

  const parts = restPath(new URL(req.url).pathname, "creatives");
  const route = parts[0] ?? "";

  const authed = await getJwtUser(req);
  if ("error" in authed && authed.error) return authed.error;
  const admin = adminClient();
  const adv = await requireAdvertiser(admin, authed.user!.id);
  if ("error" in adv && adv.error) return adv.error;
  const advertiserId = adv.advertiser!.id;

  if (req.method === "GET" && (route === "" || route === "index")) {
    const campaignId = new URL(req.url).searchParams.get("campaignId");
    return handleList(req, admin, advertiserId, campaignId);
  }

  const campaignId = parts[1] ?? null;
  if (!campaignId) {
    return apiError("NOT_FOUND", "Unknown creatives route.", 404, {}, req);
  }

  if (route === "upload-intent" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return handleUploadIntent(req, admin, advertiserId, body as Record<string, unknown>);
  }
  if (route === "confirm" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return handleConfirm(req, admin, advertiserId, body as Record<string, unknown>);
  }
  if (route === "validate" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return handleValidate(req, admin, advertiserId, body as Record<string, unknown>);
  }
  if (route === "revoke" && req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    return handleRevoke(req, admin, advertiserId, body as Record<string, unknown>);
  }
  if (route === "delete" && req.method === "DELETE") {
    return handleDelete(req, admin, advertiserId, campaignId);
  }

  return apiError("NOT_FOUND", "Unknown creatives route.", 404, {}, req);
});

serve(handler);