/**
 * Server-signed impression token.
 *
 * A token is handed to the browser at delivery and returned to the server at
 * impression time. Its job is to make it impossible to invent an impression
 * for a campaign the client chose: the campaign id inside the token is covered
 * by an HMAC, and the server separately resolves the same request id against
 * ad_serve_log. Both must agree, so a forged campaign id has to forge a valid
 * signature over a request id that also exists in the serve log.
 *
 * Format is `base64url(payload_json).base64url(hmac_sha256(payload))`.
 * Deliberately not a JWT: there is no library dependency, no algorithm
 * negotiation to get wrong, and the payload is fixed-shape. A JWT's
 * "alg" header is a well-known injection surface and there is nothing here
 * that needs the generality.
 *
 * The secret comes from AD_TOKEN_SECRET. If it is unset, signing fails closed
 * rather than falling back to anything predictable.
 */
import { constantTimeEqual } from "./secrets.ts";

export type ServeTokenPayload = {
  /** Token format version, so a future change can be detected rather than misread. */
  v: 1;
  /** ad_serve_log.request_id */
  rid: string;
  /** campaign the server actually selected */
  cid: string;
  /** publisher the key authenticated as */
  pid: string;
  /** placement the ad was served into */
  plid: string;
  /** expiry, epoch milliseconds */
  exp: number;
  /** SDK version that requested the ad, for attribution only */
  sv?: string;
};

export type TokenFailure =
  | "MALFORMED"
  | "BAD_SIGNATURE"
  | "EXPIRED"
  | "BAD_PAYLOAD";

export type VerifyResult =
  | { ok: true; payload: ServeTokenPayload }
  | { ok: false; reason: TokenFailure };

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Raw HMAC-SHA256 of `data`, base64url encoded. */
export async function hmacSha256B64Url(secret: string, data: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return toBase64Url(new Uint8Array(sig));
}

export async function signServeToken(
  secret: string,
  payload: ServeTokenPayload,
): Promise<string> {
  const body = toBase64Url(enc.encode(JSON.stringify(payload)));
  const sig = await hmacSha256B64Url(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verify signature and expiry.
 *
 * Order matters: the signature is checked before the payload is decoded, so
 * an attacker cannot learn anything from a malformed-but-unsigned payload.
 * A token that is validly signed but expired is reported as EXPIRED
 * separately from BAD_SIGNATURE so the caller can log the two differently.
 */
export async function verifyServeToken(
  secret: string,
  token: unknown,
  now: number = Date.now(),
): Promise<VerifyResult> {
  if (typeof token !== "string" || token.length === 0) return { ok: false, reason: "MALFORMED" };
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: "MALFORMED" };

  const expected = await hmacSha256B64Url(secret, parts[0]);
  if (!constantTimeEqual(expected, parts[1])) return { ok: false, reason: "BAD_SIGNATURE" };

  let payload: unknown;
  try {
    payload = JSON.parse(dec.decode(fromBase64Url(parts[0])));
  } catch {
    return { ok: false, reason: "BAD_PAYLOAD" };
  }
  if (
    !payload ||
    typeof payload !== "object" ||
    (payload as ServeTokenPayload).v !== 1 ||
    typeof (payload as ServeTokenPayload).rid !== "string" ||
    typeof (payload as ServeTokenPayload).cid !== "string" ||
    typeof (payload as ServeTokenPayload).pid !== "string" ||
    typeof (payload as ServeTokenPayload).exp !== "number"
  ) {
    return { ok: false, reason: "BAD_PAYLOAD" };
  }

  if (now > (payload as ServeTokenPayload).exp) return { ok: false, reason: "EXPIRED" };
  return { ok: true, payload: payload as ServeTokenPayload };
}

/**
 * Read the signing secret, or null.
 *
 * Null means delivery must not proceed: without a secret no token can be
 * issued, and the alternative -- serving an ad whose impression cannot be
 * verified -- would reintroduce exactly the fraud this token exists to stop.
 */
export function adTokenSecret(): string | null {
  const value = Deno.env.get("AD_TOKEN_SECRET");
  return value && value.length >= 16 ? value : null;
}
