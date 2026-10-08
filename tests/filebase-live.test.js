/**
 * LIVE Filebase integration test -- opt-in, never runs by default.
 *
 * This performs a real round-trip against a real S3-compatible bucket:
 *
 *   presign PUT -> PUT bytes -> HEAD confirms size and type ->
 *   presign GET -> GET returns those exact bytes -> DELETE -> HEAD is gone
 *
 * It is gated on FILEBASE_LIVE_TEST=1 plus the four credential settings, so CI
 * and every `npm test` run skip it. Nothing about it is simulated: if it is
 * skipped, live Filebase is UNVERIFIED and must be reported as such.
 *
 * Nothing in here logs a credential. Failures print the endpoint host, the
 * bucket and the object key -- never the access key or the secret.
 *
 * Run with:
 *   FILEBASE_LIVE_TEST=1 FILEBASE_ENDPOINT=... FILEBASE_BUCKET=... \
 *   FILEBASE_ACCESS_KEY_ID=... FILEBASE_SECRET_ACCESS_KEY=... \
 *   npx vitest run tests/filebase-live.test.js
 */
import { afterAll, describe, expect, it } from "vitest";

const { filebaseConfig, buildObjectKey, presign, presignCreativeRead, headObject, deleteObject, validateCreativeUpload } =
  await import("../supabase/functions/_shared/filebase.ts");

const ENABLED = globalThis.process.env.FILEBASE_LIVE_TEST === "1";
const CONFIG = ENABLED ? filebaseConfig() : null;

// A 1x1 transparent PNG -- the smallest thing that is genuinely a PNG, so a
// success cannot be an artefact of a text body.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

const safeDescribe = ENABLED && CONFIG ? describe : describe.skip;

if (!ENABLED) {
  console.info("[filebase-live] SKIPPED: set FILEBASE_LIVE_TEST=1 with credentials to run the live round-trip.");
} else if (!CONFIG) {
  console.info(
    "[filebase-live] SKIPPED: FILEBASE_LIVE_TEST=1 but the endpoint/bucket/credentials are incomplete. Storage is UNCONFIGURED.",
  );
}

safeDescribe("Filebase live round-trip", () => {
  // A fresh UUID per run so a concurrent or aborted run cannot collide with,
  // or clobber, a previous run's object.
  const key = buildObjectKey({
    advertiserId: "00000000-0000-4000-8000-0000000000aa",
    campaignId: "00000000-0000-4000-8000-0000000000bb",
    creativeId: crypto.randomUUID(),
  });

  afterAll(async () => {
    if (CONFIG) await deleteObject(CONFIG, key);
  });

  it("reads back exactly what a presigned PUT stored", async () => {
    const declared = validateCreativeUpload({
      mediaType: "image",
      mimeType: "image/png",
      fileSizeBytes: PNG.length,
      filename: "creative.png",
    });
    expect(declared.ok).toBe(true);

    const uploadUrl = await presign(CONFIG, {
      method: "PUT",
      objectKey: key,
      expiresInSeconds: 120,
      contentType: "image/png",
    });
    expect(uploadUrl).not.toContain(CONFIG.secretAccessKey);

    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "image/png" },
      body: PNG,
    });
    expect([200, 201, 204], `PUT failed with ${put.status} ${await safeBody(put)}`).toContain(put.status);

    const head = await headObject(CONFIG, key);
    expect(head, "HEAD could not confirm the object").not.toBeNull();
    expect(head.contentLength).toBe(PNG.length);
    expect(head.contentType).toBe("image/png");

    const readUrl = await presignCreativeRead(CONFIG, key);
    expect(readUrl).not.toContain(CONFIG.secretAccessKey);
    const got = await fetch(readUrl);
    expect(got.status).toBe(200);
    const bytes = new Uint8Array(await got.arrayBuffer());
    expect(bytes.length).toBe(PNG.length);
    expect(Array.from(bytes)).toEqual(Array.from(PNG));

    expect(await deleteObject(CONFIG, key)).toBe(true);
    expect(await headObject(CONFIG, key)).toBeNull();
  });

  it("refuses a presigned PUT whose declared content type does not match the body", async () => {
    const uploadUrl = await presign(CONFIG, {
      method: "PUT",
      objectKey: key,
      expiresInSeconds: 120,
      contentType: "image/png",
    });
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "text/html" },
      body: Uint8Array.from([0x3c, 0x73, 0x63, 0x72, 0x69, 0x70, 0x74, 0x3e]),
    });
    // The signature binds content-type, so the storage layer must not accept it.
    expect(put.status).toBeGreaterThanOrEqual(400);
  });

  it("cannot read an object through an unsigned URL", async () => {
    const unsigned = `${CONFIG.endpoint}/${CONFIG.bucket}/${key}`;
    const anon = await fetch(unsigned);
    expect(anon.status).toBeGreaterThanOrEqual(400);
  });
});

async function safeBody(response) {
  try {
    return (await response.text()).slice(0, 200);
  } catch {
    return "<unreadable>";
  }
}
