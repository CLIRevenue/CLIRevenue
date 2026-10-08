/**
 * Tests for the advertiser creative pipeline on the client.
 *
 * Two separate concerns are covered:
 *
 *  1. The pure rules in campaignRules.js. They run before anything is sent, so
 *     a bug here is a bug that reaches the network, and they must agree with
 *     the server's own rules in _shared/filebase.ts and _shared/campaignRules.ts.
 *
 *  2. The upload orchestration in advertiserApi.js. `uploadCreativeFile` is the
 *     one place where a browser holds a storage capability, so the assertions
 *     that matter most are about ordering (intent before PUT, confirm before
 *     validate) and about what must never appear in any request the browser
 *     makes -- a Filebase credential being the obvious one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/api.js", () => ({
  supabaseConfigured: true,
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "jwt-token" } }, error: null }),
    },
  },
}));

const {
  acceptForMediaType,
  activationBlockerMessage,
  advisoryBlockers,
  formatBytes,
  maxCreativeBytes,
  parseCpmCents,
  parseLandingUrl,
  validateCreativeFile,
} = await import("../src/lib/campaignRules.js");

const {
  deleteCreative,
  fetchCreatives,
  normalizeCampaign,
  normalizeCreative,
  revokeCreative,
  uploadCreativeFile,
  validateCreative,
  validateCampaignInput,
} = await import("../src/lib/advertiserApi.js");

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function fakeFile(name, type, size) {
  return { name, type, size };
}

// ---------------------------------------------------------------------------
// Pure rules
// ---------------------------------------------------------------------------

describe("creative file rules", () => {
  it("accepts a small PNG and reports the ceiling it was checked against", () => {
    const result = validateCreativeFile(fakeFile("logo.png", "image/png", 2048), "image");
    expect(result.ok).toBe(true);
    expect(result.mimeType).toBe("image/png");
    expect(result.maxBytes).toBe(5 * 1024 * 1024);
  });

  it("refuses SVG because it can carry script", () => {
    const result = validateCreativeFile(fakeFile("logo.svg", "image/svg+xml", 512), "image");
    expect(result.ok).toBe(false);
    expect(result.code).toBe("UNSUPPORTED_MIME_TYPE");
  });

  it("refuses an image over the image ceiling and a video over the video ceiling", () => {
    expect(validateCreativeFile(fakeFile("big.png", "image/png", 6 * 1024 * 1024), "image").code).toBe("FILE_TOO_LARGE");
    expect(validateCreativeFile(fakeFile("big.mp4", "video/mp4", 26 * 1024 * 1024), "video").code).toBe("FILE_TOO_LARGE");
    expect(maxCreativeBytes("image")).toBe(5 * 1024 * 1024);
    expect(maxCreativeBytes("video")).toBe(25 * 1024 * 1024);
  });

  it("refuses a zero-byte or missing file before any request is made", () => {
    expect(validateCreativeFile(fakeFile("empty.png", "image/png", 0), "image").code).toBe("INVALID_FILE_SIZE");
    expect(validateCreativeFile(null, "image").code).toBe("INVALID_FILE");
  });

  it("offers the file picker exactly the types it will accept", () => {
    expect(acceptForMediaType("image")).toContain("image/png");
    expect(acceptForMediaType("image")).not.toContain("image/svg+xml");
    expect(acceptForMediaType("video")).toContain("video/mp4");
  });

  it("formats bytes for the upload panel", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
  });
});

describe("campaign field rules", () => {
  it("clears the landing URL when it is empty and keeps a valid one", () => {
    expect(parseLandingUrl("")).toEqual({ ok: true, value: null });
    expect(parseLandingUrl(undefined)).toEqual({ ok: true, value: null });
    expect(parseLandingUrl("  https://example.test/x  ").ok).toBe(true);
  });

  it("refuses a landing URL that is not http(s) or is absurdly long", () => {
    expect(parseLandingUrl("javascript:alert(1)").code).toBe("INVALID_LANDING_URL");
    expect(parseLandingUrl("not a url").code).toBe("INVALID_LANDING_URL");
    expect(parseLandingUrl(`https://example.test/${"x".repeat(2100)}`).code).toBe("INVALID_LANDING_URL");
  });

  it("holds milli-cents, matching the column and the server's parser", () => {
    expect(parseCpmCents("")).toEqual({ ok: true, value: null });
    expect(parseCpmCents("10")).toEqual({ ok: true, value: 10 });
    expect(parseCpmCents("2500")).toEqual({ ok: true, value: 2500 });
    // A dollar amount is not a milli-cent amount and must not be silently coerced.
    expect(parseCpmCents("0.01").ok).toBe(false);
  });

  it("refuses a CPM that is zero, negative, fractional or unparseable", () => {
    for (const raw of ["0", "-1", "1.5", "abc"]) {
      const result = parseCpmCents(raw);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("INVALID_CPM");
    }
    expect(parseCpmCents("10001").ok).toBe(false);
  });

  it("tells the advertiser why a campaign cannot go live", () => {
    expect(activationBlockerMessage("CREATIVE_MISSING")).toMatch(/creative/i);
    expect(activationBlockerMessage("SOMETHING_NEW")).toBeTruthy();
  });

  it("hints at blockers before the server is asked", () => {
    expect(advisoryBlockers({ budgetCents: 1000, creative: null })).toContain("CREATIVE_MISSING");
    expect(
      advisoryBlockers({
        audienceId: "backend",
        budgetCents: 0,
        landingUrl: "https://example.test",
        startsAt: null,
        endsAt: null,
        creative: { status: "validated" },
      }),
    ).toContain("INVALID_BUDGET");
    expect(
      advisoryBlockers({
        audienceId: "backend",
        budgetCents: 1000,
        landingUrl: "https://example.test",
        startsAt: "2024-01-02T00:00:00.000Z",
        endsAt: "2024-01-01T00:00:00.000Z",
        creative: { status: "validated" },
      }),
    ).toContain("INVALID_SCHEDULE");
    expect(
      advisoryBlockers({
        audienceId: "backend",
        budgetCents: 1000,
        landingUrl: "https://example.test",
        startsAt: null,
        endsAt: "2000-01-01T00:00:00.000Z",
        creative: { status: "validated" },
      }),
    ).toContain("SCHEDULE_ENDED");
    expect(
      advisoryBlockers({
        audienceId: "backend",
        budgetCents: 1000,
        landingUrl: "https://example.test",
        startsAt: null,
        endsAt: null,
        creative: { status: "validated" },
      }),
    ).toEqual([]);
    expect(advisoryBlockers({})).toContain("INVALID_AUDIENCE");
  });

  it("reports an invalid landing URL and an unreversed schedule", () => {
    const bad = validateCampaignInput({
      name: "n",
      headline: "h",
      audienceId: "backend",
      budgetDollars: "100",
      landingUrl: "javascript:alert(1)",
    });
    expect(bad.landingUrl).toBeTruthy();
    expect(bad.endsAt).toBeUndefined();

    const reversed = validateCampaignInput({
      name: "n",
      headline: "h",
      audienceId: "backend",
      budgetDollars: "100",
      landingUrl: "https://example.test",
      startsAt: "2024-02-01T00:00:00.000Z",
      endsAt: "2024-01-01T00:00:00.000Z",
    });
    expect(reversed.endsAt).toBeTruthy();
    expect(reversed.landingUrl).toBeUndefined();
  });

  it("accepts a fully specified campaign", () => {
    expect(
      validateCampaignInput({
        name: "n",
        headline: "h",
        audienceId: "backend",
        budgetDollars: "100",
        landingUrl: "https://example.test",
        cpmCents: 10,
        startsAt: "2024-01-01T00:00:00.000Z",
        endsAt: "2024-03-01T00:00:00.000Z",
      }),
    ).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

describe("campaign normalisation", () => {
  it("carries the creative summary onto the campaign", () => {
    const campaign = normalizeCampaign(
      {
        id: UUID_A,
        name: "Launch",
        headline: "Ship it",
        cta: "Go",
        audience_id: "backend",
        budget_cents: 5000,
        spend_milli_cents: 400,
        impressions_count: 40,
        clicks_count: 2,
        conversions_count: 1,
        status: "active",
        landing_url: "https://example.test/x",
        cpm_cents: 10,
        creative: {
          id: UUID_B,
          status: "validated",
          media_type: "image",
          mime_type: "image/png",
          file_size_bytes: 2048,
          width: 1200,
          height: 628,
        },
      },
      { backend: "Backend" },
    );
    expect(campaign.landingUrl).toBe("https://example.test/x");
    expect(campaign.cpmCents).toBe(10);
    expect(campaign.creative.mediaType).toBe("image");
    expect(campaign.creative.mimeType).toBe("image/png");
    expect(campaign.creative.fileSizeBytes).toBe(2048);
  });

  it("reports no campaign creative rather than inventing one", () => {
    expect(normalizeCampaign({ id: UUID_A, name: "x", headline: "y", creative: null }).creative).toBeNull();
    expect(normalizeCreative(null)).toBeNull();
  });

  it("only ever exposes a URL the server minted", () => {
    expect(normalizeCreative({ id: UUID_B, status: "validated" }).url).toBeNull();
    expect(normalizeCreative({ id: UUID_B, status: "validated", url: "https://x.test/o?sig=1" }).url).toBe(
      "https://x.test/o?sig=1",
    );
  });
});

// ---------------------------------------------------------------------------
// Upload orchestration
// ---------------------------------------------------------------------------

describe("creative upload orchestration", () => {
  let calls;
  let progress;

  beforeEach(() => {
    calls = [];
    progress = [];
  });

  function install({ putStatus = 200 } = {}) {
    vi.stubGlobal("XMLHttpRequest", class {
      constructor() {
        this.upload = {};
        this.status = putStatus;
        this.abort = () => {};
      }

      open(method, url) {
        this._method = method;
        this._url = url;
      }

      setRequestHeader() {}

      send(body) {
        this._body = body;
        calls.push({ kind: "put", method: this._method, url: this._url, body });
        this.upload.onprogress?.({ loaded: 1, total: 1 });
        this.onload?.();
      }
    });

    vi.stubGlobal("fetch", async (url, options = {}) => {
      const path = String(url);
      calls.push({ kind: "fetch", url: path, method: options.method || "GET", body: options.body });
      if (path.includes("/upload-intent")) {
        return jsonResponse({
          creative: { id: UUID_B, status: "pending", media_type: "image" },
          upload: {
            url: "https://s3.filebase.com/bucket/o?X-Amz-Signature=deadbeef",
            method: "PUT",
            headers: { "Content-Type": "image/png" },
            expiresInSeconds: 60,
          },
          storageReady: true,
        });
      }
      if (path.includes("/confirm")) return jsonResponse({ creative: { id: UUID_B, status: "uploaded" } });
      if (path.includes("/validate")) return jsonResponse({ creative: { id: UUID_B, status: "validated" } });
      return jsonResponse({ creatives: [] });
    });
  }

  function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  it("runs intent, then the direct PUT, then confirm, then validate", async () => {
    install();
    const file = fakeFile("logo.png", "image/png", 2048);
    const result = await uploadCreativeFile(UUID_A, file, {
      mediaType: "image",
      onProgress: (pct) => progress.push(pct),
    });
    expect(result.status).toBe("validated");
    expect(progress[0]).toBe(1);
    expect(progress[progress.length - 1]).toBe(100);
    expect(calls.map((c) => (c.kind === "put" ? "PUT" : c.url.split("/").pop()))).toEqual([
      "upload-intent",
      "PUT",
      "confirm",
      "validate",
    ]);
  });

  it("never puts a storage credential in a request the browser makes", async () => {
    install();
    await uploadCreativeFile(UUID_A, fakeFile("logo.png", "image/png", 2048), { mediaType: "image" });
    for (const call of calls) {
      const serialised = JSON.stringify({ url: call.url, body: call.body ?? null });
      expect(serialised).not.toMatch(/FILEBASE_SECRET|X-Amz-Credential=|aws4_request/);
    }
    // The signed URL is a capability the server issued; the browser must not
    // echo it back to our own API.
    const apiCalls = calls.filter((c) => c.kind === "fetch");
    for (const call of apiCalls) expect(String(call.body ?? "")).not.toContain("X-Amz-Signature");
  });

  it("refuses an unsupported file before contacting the network", async () => {
    install();
    await expect(
      uploadCreativeFile(UUID_A, fakeFile("logo.svg", "image/svg+xml", 512), { mediaType: "image" }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MIME_TYPE" });
    expect(calls).toHaveLength(0);
  });

  it("surfaces the server error code when the storage layer refuses", async () => {
    install();
    vi.stubGlobal("fetch", async () =>
      jsonResponse({ error: { code: "STORAGE_NOT_CONFIGURED", message: "Storage is not configured." } }, 503),
    );
    // The error shape is the one campaignErrorCode() already understands.
    await expect(
      uploadCreativeFile(UUID_A, fakeFile("logo.png", "image/png", 2048), { mediaType: "image" }),
    ).rejects.toMatchObject({ status: 503, payload: { error: { code: "STORAGE_NOT_CONFIGURED" } } });
  });
});

describe("creative lifecycle calls", () => {
  let calls;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal("fetch", async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || "GET", body: options.body ?? null });
      const path = String(url);
      if (path.includes("/validate")) {
        return new Response(JSON.stringify({ creative: { id: UUID_B, status: "validated" } }), { status: 200 });
      }
      if (path.includes("/revoke")) {
        return new Response(JSON.stringify({ creative: { id: UUID_B, status: "revoked" } }), { status: 200 });
      }
      if (options.method === "DELETE") {
        return new Response(JSON.stringify({ deleted: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ creatives: [{ id: UUID_B, status: "validated" }] }), { status: 200 });
    });
  });

  it("reads the creative list for one campaign", async () => {
    const rows = await fetchCreatives({ campaignId: UUID_A, includeUrl: true });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("validated");
  });

  it("validates and revokes through the same campaign-scoped paths", async () => {
    expect((await validateCreative(UUID_A)).status).toBe("validated");
    expect((await revokeCreative(UUID_A)).status).toBe("revoked");
  });

  it("removes a creative only through the DELETE route", async () => {
    await deleteCreative(UUID_A);
    // tryCandidates probes a few URL shapes, so only the surviving call matters.
    // The campaign is named in the body, never chosen by the browser.
    expect(calls.at(-1).method).toBe("DELETE");
    expect(JSON.parse(calls.at(-1).body).campaignId).toBe(UUID_A);
  });
});