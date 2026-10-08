/**
 * Tests for the Filebase (S3-compatible) storage adapter.
 *
 * Two things are being protected here:
 *
 *  1. Correctness of the hand-rolled SigV4 presigner. There is no AWS SDK in
 *     this repo, so a subtle encoding mistake would not fail any build -- it
 *     would fail in production with a 403 and an upload that silently never
 *     lands. The canonical-request test pins the wire format against the
 *     published AWS "get-vanilla" vector.
 *
 *  2. The invariants that keep browser-supplied data out of object keys. A
 *     filename in a storage key is the usual source of traversal, collisions,
 *     and extension/content-type confusion, so `buildObjectKey` accepts UUIDs
 *     and nothing else.
 *
 * The live round-trip (PUT/HEAD/DELETE against a real bucket) is NOT here:
 * it needs credentials. See the env-gated integration test instead.
 *
 * Run with: npm run test:deno
 */
import { assert, assertEquals, assertNotEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  CREATIVE_DELIVERY_URL_TTL_SECONDS,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  MAX_UPLOAD_URL_TTL_SECONDS,
  buildCanonicalRequest,
  buildObjectKey,
  deleteObject,
  filebaseConfig,
  headObject,
  maxBytesForMediaType,
  mediaTypeForMime,
  objectUrl,
  presign,
  presignCreativeRead,
  validateCreativeUpload,
  type FilebaseConfig,
} from "./filebase.ts";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const UUID_C = "33333333-3333-4333-8333-333333333333";

const CONFIG: FilebaseConfig = {
  endpoint: "https://s3.filebase.com",
  region: "us-east-1",
  bucket: "clirevenue-creatives",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

function stubEnv(values: Record<string, string | undefined>) {
  return { get: (name: string) => values[name] };
}

/** Narrow a validation result and return its error code, asserting the failure. */
function failureCode(result: ReturnType<typeof validateCreativeUpload>): string {
  assert(!result.ok, "expected the upload to be refused");
  return result.code;
}

const FULL_ENV = {
  FILEBASE_ENDPOINT: "https://s3.filebase.com/",
  FILEBASE_BUCKET: "clirevenue-creatives",
  FILEBASE_ACCESS_KEY_ID: "AKIDEXAMPLE",
  FILEBASE_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};

// 2024-05-01T00:00:00Z -- a fixed clock keeps signatures reproducible.
const NOW_MS = Date.parse("2024-05-01T00:00:00.000Z");

// ---------------------------------------------------------------------------

Deno.test("filebaseConfig reads all four settings and trims the endpoint", () => {
  const config = filebaseConfig(stubEnv(FULL_ENV));
  assert(config);
  assertEquals(config.endpoint, "https://s3.filebase.com");
  assertEquals(config.bucket, "clirevenue-creatives");
  assertEquals(config.accessKeyId, "AKIDEXAMPLE");
  assertEquals(config.region, "us-east-1");
});

Deno.test("filebaseConfig defaults the region instead of demanding it", () => {
  const config = filebaseConfig(stubEnv({ ...FULL_ENV, FILEBASE_REGION: undefined }));
  assert(config);
  assertEquals(config.region, "us-east-1");
});

Deno.test("filebaseConfig fails closed when any required setting is missing", () => {
  const required = [
    "FILEBASE_ENDPOINT",
    "FILEBASE_BUCKET",
    "FILEBASE_ACCESS_KEY_ID",
    "FILEBASE_SECRET_ACCESS_KEY",
  ];
  for (const key of required) {
    assertEquals(
      filebaseConfig(stubEnv({ ...FULL_ENV, [key]: undefined })),
      null,
      `${key} missing must not produce a half-configured client`,
    );
  }
  assertEquals(filebaseConfig(stubEnv({})), null);
});

Deno.test("filebaseConfig rejects a non-http endpoint", () => {
  assertEquals(filebaseConfig(stubEnv({ ...FULL_ENV, FILEBASE_ENDPOINT: "filebase://creatives" })), null);
});

Deno.test("buildObjectKey is fully server-derived and never contains a filename", () => {
  assertEquals(
    buildObjectKey({ advertiserId: UUID_A, campaignId: UUID_B, creativeId: UUID_C }),
    `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`,
  );
  assertEquals(
    buildObjectKey({ advertiserId: UUID_A, campaignId: UUID_B, creativeId: UUID_C, variant: "poster" }),
    `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/poster`,
  );
});

Deno.test("buildObjectKey refuses anything that is not a uuid in every segment", () => {
  const bad = [
    { advertiserId: "../../etc", campaignId: UUID_B, creativeId: UUID_C },
    { advertiserId: UUID_A, campaignId: "my logo.png", creativeId: UUID_C },
    { advertiserId: UUID_A, campaignId: UUID_B, creativeId: "advertisers/x" },
    { advertiserId: "", campaignId: UUID_B, creativeId: UUID_C },
  ];
  for (const input of bad) {
    let threw = false;
    try {
      buildObjectKey(input);
    } catch {
      threw = true;
    }
    assert(threw, `expected a throw for ${JSON.stringify(input)}`);
  }
});

Deno.test("buildObjectKey defaults an unknown variant to original", () => {
  const key = buildObjectKey({
    advertiserId: UUID_A,
    campaignId: UUID_B,
    creativeId: UUID_C,
    variant: "evil" as "poster",
  });
  assertStringIncludes(key, "/original");
});

// ---------------------------------------------------------------------------

Deno.test("validateCreativeUpload accepts a declared image that matches its extension", () => {
  const result = validateCreativeUpload({
    mediaType: "image",
    mimeType: "image/png",
    fileSizeBytes: 1024,
    filename: "logo.png",
  });
  assert(result.ok);
  assertEquals(result.mediaType, "image");
  assertEquals(result.mimeType, "image/png");
  assertEquals(result.extension, "png");
  assertEquals(result.maxBytes, MAX_IMAGE_BYTES);
});

Deno.test("validateCreativeUpload tolerates .jpg for image/jpeg and an absent filename", () => {
  const jpg = validateCreativeUpload({ mediaType: "image", mimeType: "image/jpeg", fileSizeBytes: 10, filename: "a.JPG" });
  assert(jpg.ok);
  assertEquals(jpg.extension, "jpg");
  const anon = validateCreativeUpload({ mediaType: "image", mimeType: "image/png", fileSizeBytes: 10 });
  assert(anon.ok);
});

Deno.test("validateCreativeUpload rejects SVG, HTML and shell payloads", () => {
  for (const mimeType of ["image/svg+xml", "text/html", "application/x-shockwave-flash", "application/javascript"]) {
    assertEquals(
      failureCode(validateCreativeUpload({ mediaType: "image", mimeType, fileSizeBytes: 10 })),
      "UNSUPPORTED_MIME_TYPE",
      `${mimeType} must be refused`,
    );
  }
});

Deno.test("validateCreativeUpload rejects a filename extension that contradicts the MIME", () => {
  assertEquals(
    failureCode(validateCreativeUpload({
      mediaType: "image",
      mimeType: "image/png",
      fileSizeBytes: 10,
      filename: "payload.html",
    })),
    "EXTENSION_MISMATCH",
  );
});

Deno.test("validateCreativeUpload enforces the per-media-type size ceiling", () => {
  assertEquals(
    failureCode(validateCreativeUpload({ mediaType: "image", mimeType: "image/png", fileSizeBytes: MAX_IMAGE_BYTES + 1 })),
    "FILE_TOO_LARGE",
  );
  assertEquals(
    failureCode(validateCreativeUpload({ mediaType: "video", mimeType: "video/mp4", fileSizeBytes: MAX_VIDEO_BYTES + 1 })),
    "FILE_TOO_LARGE",
  );
  assert(validateCreativeUpload({ mediaType: "image", mimeType: "image/png", fileSizeBytes: MAX_IMAGE_BYTES }).ok);
});

Deno.test("validateCreativeUpload rejects sizes that are not positive integers", () => {
  for (const fileSizeBytes of [0, -1, 1.5, Number.NaN, "1024" as unknown, null as unknown]) {
    assertEquals(
      failureCode(validateCreativeUpload({ mediaType: "image", mimeType: "image/png", fileSizeBytes })),
      "INVALID_FILE_SIZE",
      `size ${String(fileSizeBytes)} must be refused`,
    );
  }
});

Deno.test("validateCreativeUpload rejects a media type outside image and video", () => {
  for (const mediaType of ["html", "audio", ""]) {
    assertEquals(failureCode(validateCreativeUpload({ mediaType, mimeType: "image/png", fileSizeBytes: 10 })), "INVALID_MEDIA_TYPE");
  }
  // Case and padding are normalised before the comparison, so "IMAGE " is the
  // same media type and is accepted rather than being a second spelling to police.
  const padded = validateCreativeUpload({ mediaType: "IMAGE ", mimeType: "image/png", fileSizeBytes: 10 });
  assert(padded.ok);
  assertEquals(padded.mediaType, "image");
});

Deno.test("validateCreativeUpload will not accept a video MIME declared as an image", () => {
  assertEquals(
    failureCode(validateCreativeUpload({ mediaType: "image", mimeType: "video/mp4", fileSizeBytes: 10 })),
    "UNSUPPORTED_MIME_TYPE",
  );
});

Deno.test("mediaTypeForMime and maxBytesForMediaType agree with the allowlists", () => {
  for (const mime of ALLOWED_IMAGE_MIME_TYPES) assertEquals(mediaTypeForMime(mime), "image");
  for (const mime of ALLOWED_VIDEO_MIME_TYPES) assertEquals(mediaTypeForMime(mime), "video");
  assertEquals(mediaTypeForMime("image/svg+xml"), null);
  assertEquals(mediaTypeForMime("nope"), null);
  assertEquals(maxBytesForMediaType("image"), MAX_IMAGE_BYTES);
  assertEquals(maxBytesForMediaType("video"), MAX_VIDEO_BYTES);
});

Deno.test("the allowlists exclude SVG on purpose", () => {
  assertEquals(ALLOWED_IMAGE_MIME_TYPES.includes("image/svg+xml" as never), false);
});

// ---------------------------------------------------------------------------

Deno.test("buildCanonicalRequest matches the published AWS get-vanilla vector", () => {
  // From the AWS SigV4 test suite: GET / on example.amazonaws.com at
  // 20150830T123600Z with an empty body. If this drifts, every real signature
  // is wrong and nothing else in the suite would notice.
  const canonical = buildCanonicalRequest({
    method: "GET",
    path: "/",
    query: [],
    headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
    payloadHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  });
  assertEquals(
    canonical,
    [
      "GET",
      "/",
      "",
      "host:example.amazonaws.com",
      "x-amz-date:20150830T123600Z",
      "",
      "host;x-amz-date",
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    ].join("\n"),
  );
});

Deno.test("buildCanonicalRequest sorts the query string and lowercases header names", () => {
  const unsorted = buildCanonicalRequest({
    method: "GET",
    path: "/b",
    query: [["Zeta", "2"], ["alpha", "1"]],
    headers: { Host: "h", "X-Amz-Date": "d" },
    payloadHash: "hash",
  });
  const sorted = buildCanonicalRequest({
    method: "GET",
    path: "/b",
    query: [["alpha", "1"], ["Zeta", "2"]],
    headers: { "x-amz-date": "d", host: "h" },
    payloadHash: "hash",
  });
  assertEquals(unsorted, sorted);
  // Sorted on the ENCODED key in byte order, so an uppercase name sorts before
  // a lowercase one -- that is what AWS specifies, not case-insensitive order.
  assertStringIncludes(unsorted, "Zeta=2&alpha=1");
  assertStringIncludes(unsorted, "host:h\nx-amz-date:d\n");
});

Deno.test("buildCanonicalRequest percent-encodes each path segment but keeps separators", () => {
  const canonical = buildCanonicalRequest({
    method: "GET",
    path: "/bucket/advertisers/a b/c%2Fd",
    query: [],
    headers: { host: "h" },
    payloadHash: "x",
  });
  assertStringIncludes(canonical, "/bucket/advertisers/a%20b/c%252Fd");
});

Deno.test("objectUrl is path-style under the configured bucket", () => {
  assertEquals(
    objectUrl(CONFIG, `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`),
    `https://s3.filebase.com/clirevenue-creatives/advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`,
  );
});

// ---------------------------------------------------------------------------

Deno.test("presign produces a signed GET URL with no secret anywhere in it", async () => {
  const url = new URL(
    await presign(CONFIG, {
      method: "GET",
      objectKey: `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`,
      expiresInSeconds: 600,
      nowMs: NOW_MS,
    }),
  );
  assertEquals(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assertEquals(url.searchParams.get("X-Amz-Date"), "20240501T000000Z");
  assertEquals(url.searchParams.get("X-Amz-Expires"), "600");
  assertStringIncludes(url.searchParams.get("X-Amz-Credential") ?? "", "AKIDEXAMPLE/20240501/us-east-1/s3/aws4_request");
  assertEquals(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert((url.searchParams.get("X-Amz-Signature") ?? "").length === 64);
  assert(!url.href.includes(CONFIG.secretAccessKey), "the secret key must never reach a client");
  assertEquals(url.pathname, `/clirevenue-creatives/advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`);
});

Deno.test("presign binds content-type when one is supplied", async () => {
  const key = `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`;
  const plain = await presign(CONFIG, { method: "PUT", objectKey: key, expiresInSeconds: 300, nowMs: NOW_MS });
  const bound = await presign(CONFIG, {
    method: "PUT",
    objectKey: key,
    expiresInSeconds: 300,
    contentType: "image/png",
    nowMs: NOW_MS,
  });
  assertEquals(new URL(bound).searchParams.get("X-Amz-SignedHeaders"), "content-type;host");
  assertNotEquals(plain, bound, "binding the content type must change the signature");
});

Deno.test("presign is deterministic for the same inputs and changes with the key", async () => {
  const base = { method: "PUT" as const, expiresInSeconds: 120, nowMs: NOW_MS };
  const a = await presign(CONFIG, { ...base, objectKey: `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original` });
  const b = await presign(CONFIG, { ...base, objectKey: `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original` });
  const c = await presign(CONFIG, { ...base, objectKey: `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/poster` });
  assertEquals(a, b);
  assertNotEquals(a, c);
});

Deno.test("presign clamps a hostile TTL into the 1s..7d range", async () => {
  const key = `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`;
  const zero = await presign(CONFIG, { method: "GET", objectKey: key, expiresInSeconds: 0, nowMs: NOW_MS });
  const huge = await presign(CONFIG, { method: "GET", objectKey: key, expiresInSeconds: 10 ** 9, nowMs: NOW_MS });
  assertEquals(new URL(zero).searchParams.get("X-Amz-Expires"), "1");
  assertEquals(new URL(huge).searchParams.get("X-Amz-Expires"), String(7 * 24 * 60 * 60));
});

Deno.test("presignCreativeRead defaults to the short delivery capability lifetime", async () => {
  const url = new URL(
    await presignCreativeRead(CONFIG, `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`, undefined, NOW_MS),
  );
  assertEquals(url.searchParams.get("X-Amz-Expires"), String(CREATIVE_DELIVERY_URL_TTL_SECONDS));
  assert(CREATIVE_DELIVERY_URL_TTL_SECONDS <= MAX_UPLOAD_URL_TTL_SECONDS);
});

Deno.test("presign with a different region or key changes the signature", async () => {
  const key = `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`;
  const input = { method: "GET" as const, objectKey: key, expiresInSeconds: 60, nowMs: NOW_MS };
  const base = await presign(CONFIG, input);
  const otherRegion = await presign({ ...CONFIG, region: "eu-west-1" }, input);
  const otherKey = await presign({ ...CONFIG, accessKeyId: "AKIDOTHER" }, input);
  assertNotEquals(base, otherRegion);
  assertNotEquals(base, otherKey);
});
// ---------------------------------------------------------------------------
// Storage round-trips against a stubbed S3 endpoint.
//
// `headObject` and `deleteObject` are the only two functions that talk to the
// network, and both must degrade to a safe answer rather than throwing: a
// HEAD is how the confirm step decides whether an object really landed, and a
// DELETE has to be safe to retry.
// ---------------------------------------------------------------------------

type StubCall = { method: string; url: string; headers: Record<string, string> };

function stubFetch(
  handler: (call: StubCall) => Response,
): { calls: StubCall[]; restore: () => void } {
  const calls: StubCall[] = [];
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  (globalThis as any).fetch = async (_input: string | URL, init?: RequestInit) => {
    const call = {
      method: String(init?.method ?? "GET").toUpperCase(),
      url: String(_input),
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    return handler(call);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

Deno.test("headObject confirms the stored length, type and etag", async () => {
  const stub = stubFetch(() =>
    new Response(null, {
      status: 200,
      headers: {
        "content-length": "2048",
        "content-type": "image/png; charset=binary",
        etag: '"abc123"',
      },
    }),
  );
  try {
    const head = await headObject(CONFIG, `advertisers/${UUID_A}/campaigns/${UUID_B}/creatives/${UUID_C}/original`, NOW_MS);
    assert(head);
    assertEquals(head.contentLength, 2048);
    assertEquals(head.contentType, "image/png");
    assertEquals(head.etag, "abc123");
  } finally {
    stub.restore();
  }
  assertEquals(stub.calls[0].method, "HEAD");
  assert(stub.calls[0].headers.authorization?.startsWith("AWS4-HMAC-SHA256 Credential="));
  assert(stub.calls[0].headers["x-amz-content-sha256"]);
});

Deno.test("headObject returns null rather than throwing, so it cannot be an existence oracle", async () => {
  const missing = stubFetch(() => new Response(null, { status: 404 }));
  try {
    assertEquals(await headObject(CONFIG, "advertisers/x/campaigns/y/creatives/z/original"), null);
  } finally {
    missing.restore();
  }

  const exploding = stubFetch(() => {
    throw new Error("ECONNRESET");
  });
  try {
    assertEquals(await headObject(CONFIG, "advertisers/x/campaigns/y/creatives/z/original"), null);
  } finally {
    exploding.restore();
  }
});

Deno.test("deleteObject accepts a 204, treats 404 as already removed, and refuses a 403", async () => {
  const cases: Array<[number, boolean]> = [[204, true], [200, true], [404, true], [403, false], [500, false]];
  for (const [status, expected] of cases) {
    const stub = stubFetch(() => new Response(null, { status }));
    try {
      assertEquals(await deleteObject(CONFIG, "advertisers/x/campaigns/y/creatives/z/original"), expected, `status ${status}`);
    } finally {
      stub.restore();
    }
  }
});

Deno.test("deleteObject reports failure instead of throwing when the network is down", async () => {
  const stub = stubFetch(() => {
    throw new Error("ECONNREFUSED");
  });
  try {
    assertEquals(await deleteObject(CONFIG, "advertisers/x/campaigns/y/creatives/z/original"), false);
  } finally {
    stub.restore();
  }
});

Deno.test("a HEAD authorization header never contains the secret access key", async () => {
  const stub = stubFetch(() => new Response(null, { status: 404 }));
  try {
    await headObject(CONFIG, "advertisers/x/campaigns/y/creatives/z/original", NOW_MS);
  } finally {
    stub.restore();
  }
  for (const call of stub.calls) {
    for (const value of Object.values(call.headers)) {
      assert(!value.includes(CONFIG.secretAccessKey), "the secret key must never be sent on the wire");
    }
  }
});
