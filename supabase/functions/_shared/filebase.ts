/**
 * Filebase (S3-compatible) object storage for advertiser creatives.
 *
 * WHY THIS EXISTS INSTEAD OF AN SDK
 * -------------------------------
 * The Edge Functions run on Deno with no npm install step, and the whole point
 * of the exercise is that credentials never reach a browser. Pulling in
 * `aws-sdk-s3` would drag a dependency tree into a code path that only needs
 * four verbs (presigned PUT, presigned GET, HEAD, DELETE) over one bucket.
 * SigV4 is ~150 lines on Web Crypto, so that is what this is.
 *
 * THE SECURITY MODEL, STATED PLAINLY
 * ---------------------------------
 * * The access key id and the secret never leave this module's process. The
 *   only thing that escapes is a presigned URL, which is a capability scoped to
 *   exactly one object key, one HTTP method, optionally one Content-Type, and a
 *   bounded lifetime.
 * * Object keys are built here, from UUIDs, by `buildObjectKey`. No caller can
 *   pass an arbitrary path. Filenames are attacker-controlled input and are
 *   never part of a key.
 * * Presigned URLs are minted per-object, never per-prefix, so a leaked upload
 *   URL cannot be edited into a read or a wildcard.
 * * Reads at delivery time are signed too, so nothing in the bucket depends on
 *   the bucket being public, and no Filebase credential is ever proxied to a
 *   publisher.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ------------------------------------------
 * It does not retry, does not buffer file bodies, does not stream, and does not
 * know anything about campaigns. It signs URLs and describes objects. Every
 * campaign/ownership rule lives in the calling Edge Function.
 */

const HASH_ALGORITHM = "SHA-256";

/** SHA-256 of the empty string, the payload hash for HEAD and DELETE. */
const EMPTY_PAYLOAD_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

const SHA256_ALGORITHM_NAME = "AWS4-HMAC-SHA256";

// ---------------------------------------------------------------------------
// Media allowlists
// ---------------------------------------------------------------------------

/**
 * Image types the delivery path can render in an `<img>`. AVIF is included
 * because it is the modern default for stills; GIF because publishers expect
 * it. SVG is deliberately absent: it is an executable document, and serving one
 * from the storage origin would be stored XSS.
 */
export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

/**
 * Video types the delivery path can render in a `<video>` element.
 *
 * MP4 (H.264) and WebM (VP8/VP9) are the two containers every target surface
 * in the SDK's audience can play. HLS/DASH manifests are excluded on purpose:
 * they are multi-file, and the storage layout here is one object per creative.
 */
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm"] as const;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;

/** Presigned lifetime bounds. Short enough to be useless if it leaks. */
export const MIN_UPLOAD_URL_TTL_SECONDS = 60;
export const MAX_UPLOAD_URL_TTL_SECONDS = 900;
export const CREATIVE_DELIVERY_URL_TTL_SECONDS = 600;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

const MIME_MEDIA_TYPE: Record<string, "image" | "video"> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "image/gif": "image",
  "image/avif": "image",
  "video/mp4": "video",
  "video/webm": "video",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MediaType = "image" | "video";

export type FilebaseConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type HeadObjectResult = {
  contentLength: number;
  contentType: string;
  etag: string;
};

/**
 * Read Filebase settings out of the environment.
 *
 * Returns `null` rather than a half-populated config when anything is missing,
 * so a partially-configured deployment fails closed at the call site (503) and
 * never issues a request against the wrong bucket.
 */
export function filebaseConfig(
  env: { get(name: string): string | undefined } = Deno.env,
): FilebaseConfig | null {
  const endpoint = (env.get("FILEBASE_ENDPOINT") ?? "").trim().replace(/\/+$/, "");
  const bucket = (env.get("FILEBASE_BUCKET") ?? "").trim();
  const accessKeyId = (env.get("FILEBASE_ACCESS_KEY_ID") ?? "").trim();
  const secretAccessKey = (env.get("FILEBASE_SECRET_ACCESS_KEY") ?? "").trim();
  const region = (env.get("FILEBASE_REGION") ?? "").trim() || "us-east-1";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!/^https?:\/\//i.test(endpoint)) return null;

  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
}

// ---------------------------------------------------------------------------
// Object keys (Phase 4: deterministic, non-user-controlled)
// ---------------------------------------------------------------------------

/**
 * `advertisers/{advertiserId}/campaigns/{campaignId}/creatives/{creativeId}/{variant}`
 *
 * Every path segment is a validated UUID or a fixed literal. A filename is never
 * part of the key: filenames are attacker-controlled, and they are the usual
 * source of traversal, key collisions, and extension/content-type confusion.
 * `variant` is `original` for the upload and `poster` for a video poster frame.
 */
export function buildObjectKey(input: {
  advertiserId: string;
  campaignId: string;
  creativeId: string;
  variant?: "original" | "poster";
}): string {
  for (const [label, value] of [
    ["advertiserId", input.advertiserId],
    ["campaignId", input.campaignId],
    ["creativeId", input.creativeId],
  ] as const) {
    if (!UUID_RE.test(value)) {
      throw new Error(`buildObjectKey: ${label} must be a uuid`);
    }
  }
  const variant = input.variant === "poster" ? "poster" : "original";
  return `advertisers/${input.advertiserId}/campaigns/${input.campaignId}/creatives/${input.creativeId}/${variant}`;
}

// ---------------------------------------------------------------------------
// Upload validation (Phase 2)
// ---------------------------------------------------------------------------

export type CreativeValidation =
  | { ok: true; mediaType: MediaType; mimeType: string; extension: string; maxBytes: number }
  | { ok: false; code: string; message: string };

/**
 * Decide whether a declared upload may be authorized.
 *
 * The declared MIME type is authoritative and the filename extension must agree
 * with it. Neither is a proof of content — S3 stores bytes and echoes headers —
 * but disagreeing on the two is a client bug or a probe, and rejecting it here
 * means no object with a lying Content-Type ever reaches a bucket.
 */
export function validateCreativeUpload(input: {
  mediaType: unknown;
  mimeType: unknown;
  fileSizeBytes: unknown;
  filename?: unknown;
}): CreativeValidation {
  const mediaType = typeof input.mediaType === "string" ? input.mediaType.trim().toLowerCase() : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.trim().toLowerCase() : "";
  const size = input.fileSizeBytes;

  if (mediaType !== "image" && mediaType !== "video") {
    return { ok: false, code: "INVALID_MEDIA_TYPE", message: "Creative type must be image or video." };
  }

  const expected = mediaType === "image" ? ALLOWED_IMAGE_MIME_TYPES : ALLOWED_VIDEO_MIME_TYPES;
  if (!(expected as readonly string[]).includes(mimeType)) {
    return {
      ok: false,
      code: "UNSUPPORTED_MIME_TYPE",
      message: `Unsupported ${mediaType} type. Allowed: ${expected.join(", ")}.`,
    };
  }

  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) {
    return { ok: false, code: "INVALID_FILE_SIZE", message: "File size must be a positive integer number of bytes." };
  }

  const maxBytes = mediaType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  if (size > maxBytes) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Creative exceeds the ${mediaType} limit of ${Math.floor(maxBytes / (1024 * 1024))} MB.`,
    };
  }

  if (typeof input.filename === "string" && input.filename.trim() !== "") {
    const name = input.filename.trim().toLowerCase();
    const dot = name.lastIndexOf(".");
    const extension = dot === -1 ? "" : name.slice(dot + 1);
    const canonical = MIME_EXTENSIONS[mimeType];
    if (extension !== canonical && !(canonical === "jpg" && extension === "jpeg")) {
      return {
        ok: false,
        code: "EXTENSION_MISMATCH",
        message: `Filename extension ".${extension}" does not match ${mimeType}.`,
      };
    }
  }

  return { ok: true, mediaType, mimeType, extension: MIME_EXTENSIONS[mimeType], maxBytes };
}

/** Server-side media type for a MIME string, or `null` when unsupported. */
export function mediaTypeForMime(mimeType: string): MediaType | null {
  return MIME_MEDIA_TYPE[mimeType.trim().toLowerCase()] ?? null;
}

export function maxBytesForMediaType(mediaType: MediaType): number {
  return mediaType === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
}

// ---------------------------------------------------------------------------
// SigV4
// ---------------------------------------------------------------------------

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Percent-encode each path segment, preserving the `/` separators. */
function encodePath(path: string): string {
  return path.split("/").map((segment) => encodeRfc3986(segment)).join("/");
}

function canonicalQueryString(params: Array<[string, string]>): string {
  return params
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)] as const)
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function canonicalHeaders(headers: Record<string, string>): { canonical: string; signed: string } {
  const normalized = Object.entries(headers)
    .map(([key, value]) => [key.trim().toLowerCase(), String(value).trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const canonical = normalized.map(([key, value]) => `${key}:${value}\n`).join("");
  const signed = normalized.map(([key]) => key).join(";");
  return { canonical, signed };
}

export type CanonicalRequestInput = {
  method: string;
  path: string;
  query: Array<[string, string]>;
  headers: Record<string, string>;
  payloadHash: string;
};

export function buildCanonicalRequest(input: CanonicalRequestInput): string {
  const { canonical, signed } = canonicalHeaders(input.headers);
  return [
    input.method.toUpperCase(),
    encodePath(input.path),
    canonicalQueryString(input.query),
    canonical,
    signed,
    input.payloadHash,
  ].join("\n");
}

function sha256Hex(data: Uint8Array): Promise<string> {
  return crypto.subtle
    .digest(HASH_ALGORITHM, data as unknown as ArrayBuffer)
    .then((digest) => bytesToHex(new Uint8Array(digest)));
}

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as ArrayBuffer,
    { name: "HMAC", hash: HASH_ALGORITHM },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data) as unknown as ArrayBuffer);
  return new Uint8Array(signature);
}

async function hmacHex(key: Uint8Array, data: string): Promise<string> {
  return bytesToHex(await hmac(key, data));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

function amzDates(nowMs: number): { amzDate: string; dateStamp: string } {
  const amzDate = new Date(nowMs).toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

async function signingKey(config: FilebaseConfig, dateStamp: string): Promise<Uint8Array> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${config.secretAccessKey}`), dateStamp);
  const kRegion = await hmac(kDate, config.region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

function scope(config: FilebaseConfig, dateStamp: string): string {
  return `${dateStamp}/${config.region}/s3/aws4_request`;
}

/** Absolute URL of one object in the configured bucket. Path-style, as S3 requires. */
export function objectUrl(config: FilebaseConfig, objectKey: string): string {
  return `${config.endpoint}/${encodeRfc3986(config.bucket)}/${encodePath(objectKey)}`;
}

export type PresignInput = {
  method: "GET" | "PUT" | "HEAD" | "DELETE";
  objectKey: string;
  expiresInSeconds: number;
  /** When set, the signature binds this exact Content-Type and the URL fails otherwise. */
  contentType?: string;
  nowMs?: number;
};

/**
 * Presign one request. Returns a URL whose query string carries the signature;
 * the secret is never present.
 */
export async function presign(config: FilebaseConfig, input: PresignInput): Promise<string> {
  const nowMs = input.nowMs ?? Date.now();
  const { amzDate, dateStamp } = amzDates(nowMs);

  // A presigned URL signs the headers it names, and the client must send them.
  // Only `host` is always safe to require; `content-type` is bound so an upload
  // URL cannot be reused to store a different declared type.
  const headers: Record<string, string> = { host: hostOf(config) };
  if (input.contentType) headers["content-type"] = input.contentType;

  const expiresInSeconds = Math.min(
    Math.max(Math.trunc(input.expiresInSeconds), 1),
    7 * 24 * 60 * 60,
  );

  const query: Array<[string, string]> = [
    ["X-Amz-Algorithm", SHA256_ALGORITHM_NAME],
    ["X-Amz-Credential", `${config.accessKeyId}/${scope(config, dateStamp)}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresInSeconds)],
    ["X-Amz-SignedHeaders", Object.keys(headers).map((k) => k.toLowerCase()).sort().join(";")],
  ];

  const canonicalRequest = buildCanonicalRequest({
    method: input.method,
    path: `/${config.bucket}/${input.objectKey}`,
    query,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
  });

  const stringToSign = [
    SHA256_ALGORITHM_NAME,
    amzDate,
    scope(config, dateStamp),
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");

  const signature = await hmacHex(await signingKey(config, dateStamp), stringToSign);

  const signedQuery = canonicalQueryString([...query, ["X-Amz-Signature", signature]]);
  const url = new URL(objectUrl(config, input.objectKey));
  return `${url.origin}${url.pathname}?${signedQuery}`;
}

function hostOf(config: FilebaseConfig): string {
  return new URL(config.endpoint).host;
}

/**
 * Short-lived signed URL handed to a publisher at delivery time.
 *
 * Deliberately short: the SDK fetches the asset as soon as the ad is served, so
 * a ten-minute capability is plenty and a leaked URL stops working quickly.
 */
export async function presignCreativeRead(
  config: FilebaseConfig,
  objectKey: string,
  ttlSeconds: number = CREATIVE_DELIVERY_URL_TTL_SECONDS,
  nowMs?: number,
): Promise<string> {
  return presign(config, { method: "GET", objectKey, expiresInSeconds: ttlSeconds, nowMs });
}

async function signedRequest(
  config: FilebaseConfig,
  method: "HEAD" | "DELETE",
  objectKey: string,
  nowMs: number,
): Promise<Response> {
  const { amzDate, dateStamp } = amzDates(nowMs);
  const headers: Record<string, string> = {
    host: hostOf(config),
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  const { signed } = canonicalHeaders(headers);
  const canonicalRequest = buildCanonicalRequest({
    method,
    path: `/${config.bucket}/${objectKey}`,
    query: [],
    headers,
    payloadHash: EMPTY_PAYLOAD_SHA256,
  });
  const stringToSign = [
    SHA256_ALGORITHM_NAME,
    amzDate,
    scope(config, dateStamp),
    await sha256Hex(new TextEncoder().encode(canonicalRequest)),
  ].join("\n");
  const signature = await hmacHex(await signingKey(config, dateStamp), stringToSign);

  // `host` is signed but not set: fetch owns it, and it will match the URL.
  const sendHeaders: Record<string, string> = {
    "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
    "x-amz-date": amzDate,
  };
  sendHeaders.authorization = `${SHA256_ALGORITHM_NAME} Credential=${config.accessKeyId}/${scope(config, dateStamp)}, SignedHeaders=${signed}, Signature=${signature}`;

  return fetch(objectUrl(config, objectKey), { method, headers: sendHeaders });
}

/**
 * Confirm an object really exists and really is the size and type we authorized.
 * A `null` return means "could not confirm" — HEAD failure, network error, or a
 * missing object are deliberately indistinguishable to the caller so this
 * cannot be used as an existence oracle for arbitrary keys.
 */
export async function headObject(
  config: FilebaseConfig,
  objectKey: string,
  nowMs?: number,
): Promise<HeadObjectResult | null> {
  try {
    const response = await signedRequest(config, "HEAD", objectKey, nowMs ?? Date.now());
    if (!response.ok) return null;
    const rawLength = response.headers.get("content-length");
    const length = rawLength === null ? Number.NaN : Number.parseInt(rawLength, 10);
    return {
      contentLength: Number.isFinite(length) ? length : 0,
      contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase(),
      etag: (response.headers.get("etag") ?? "").replace(/^"|"$/g, ""),
    };
  } catch {
    return null;
  }
}

/**
 * Remove an object. Returns whether the storage layer accepted the request; a
 * missing object counts as removed, which is what the caller wants.
 */
export async function deleteObject(config: FilebaseConfig, objectKey: string, nowMs?: number): Promise<boolean> {
  try {
    const response = await signedRequest(config, "DELETE", objectKey, nowMs ?? Date.now());
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}