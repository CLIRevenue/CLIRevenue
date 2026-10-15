import {
  CLIREVENUE_API_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  apiUrl,
  errorMessage,
  isTimeoutError,
  timeoutMessage,
  timeoutSignal,
  unreachableMessage,
} from './http.js';
import {
  ADS_KEY_PREFIX,
  isWellFormedAccountKey,
  isWellFormedPublisherKey,
} from './keyFormat.js';

export const PUBLISHER_KEY_HEADER = 'x-clirevenue-publisher-key';

/** A verification call that never returns leaves the terminal looking
 *  frozen, so every request is bounded. */
export const DEFAULT_VERIFY_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

export interface VerifiedKey {
  publisherId: string;
  /**
   * Display names and lifetime counters, resolved from the publisher id that
   * authentication just proved. Nothing here is a secret and nothing here is
   * the developer's email, phone or address — the endpoint returns only what
   * the overlay needs to render. `displayName` is the one field callers
   * should show, because it prefers the account's own name and falls back to
   * the auto-generated publisher name for accounts that never set one.
   */
  fullName: string | null;
  publisherName: string;
  adsSeen: number;
  earningsMilliCents: number;
  slotCount: number;
  placements: Array<{
    id: string;
    key: string;
    name: string;
    enabled: boolean;
    allowedAudienceId: string | null;
  }>;
}

export class KeyVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: 'invalid_format' | 'invalid_key' | 'network_error' | 'unexpected',
  ) {
    super(message);
    this.name = 'KeyVerificationError';
  }
}

export async function verifyKey(
  rawKey: string,
  baseUrl: string = CLIREVENUE_API_BASE_URL,
  options: { timeoutMs?: number } = {},
): Promise<VerifiedKey> {
  if (!isWellFormedPublisherKey(rawKey)) {
    // Name the two real mistakes rather than restating the regex. A developer
    // and a member of staff sign up through the same form, so an account key
    // arriving here is plausible, and "Invalid or revoked" would send them
    // looking for a revoked key they never had. Asked through the account-key
    // predicate rather than `rawKey.startsWith(...)`: by this point the
    // publisher-key guard has narrowed `rawKey` to `never`, and a `never` has
    // no methods on it.
    throw new KeyVerificationError(
      isWellFormedAccountKey(rawKey)
        ? 'That is an internal CLIRevenue account key. It is not a publisher key and cannot be used here.'
        : `Key must start with ${ADS_KEY_PREFIX} followed by 30 characters. Keys issued before this format (pk_test_... / pk_live_...) are still accepted — check for a truncated or mistyped paste.`,
      'invalid_format',
    );
  }

  // The credential travels in a header, never in the query string: a URL is
  // written to proxy and gateway logs, and this one is a secret. The server
  // still accepts the legacy `?publisherKey=` form for already-released CLIs.
  const url = apiUrl(baseUrl, '/cli/placements');

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json', [PUBLISHER_KEY_HEADER]: rawKey },
      signal: timeoutSignal(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new KeyVerificationError(
        timeoutMessage(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS),
        'network_error',
      );
    }

    throw new KeyVerificationError(unreachableMessage(err), 'network_error');
  }

  if (res.status === 401) {
    throw new KeyVerificationError('Invalid or revoked publisher key.', 'invalid_key');
  }

  if (res.status !== 200) {
    throw new KeyVerificationError(await errorMessage(res), 'unexpected');
  }

  const body = await res.json().catch(() => null);
  if (!body || typeof body !== 'object' || !Array.isArray((body as any).placements)) {
    throw new KeyVerificationError('Unexpected backend response shape.', 'unexpected');
  }

  const data = body as {
    publisherId: string;
    publisherName?: unknown;
    fullName?: unknown;
    adsSeen?: unknown;
    earningsMilliCents?: unknown;
    slotCount?: unknown;
    placements: any[];
  };

  // The display fields are read tolerantly on purpose. This CLI is installed
  // from npm and talks to a backend that is deployed independently, so a
  // missing field is a version skew, not a malformed response — and a welcome
  // banner must still render against a backend that has never heard of it.
  // Only `placements` is load-bearing, and it was already required above.
  const text = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() ? v.trim() : null;
  const count = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

  const fullName = text(data.fullName);
  return {
    publisherId: data.publisherId,
    fullName,
    publisherName: text(data.publisherName) ?? fullName ?? 'CLIRevenue publisher',
    adsSeen: count(data.adsSeen),
    earningsMilliCents: count(data.earningsMilliCents),
    slotCount: count(data.slotCount),
    placements: data.placements.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      enabled: p.enabled,
      allowedAudienceId: p.allowedAudienceId ?? null,
    })),
  };
}
