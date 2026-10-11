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
const KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

export const PUBLISHER_KEY_HEADER = 'x-clirevenue-publisher-key';

/** A verification call that never returns leaves the terminal looking
 *  frozen, so every request is bounded. */
export const DEFAULT_VERIFY_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MS;

export interface VerifiedKey {
  publisherId: string;
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
  if (!KEY_RE.test(rawKey)) {
    throw new KeyVerificationError(
      'Key must match pk_test_... or pk_live_...',
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

  const data = body as { publisherId: string; placements: any[] };
  return {
    publisherId: data.publisherId,
    placements: data.placements.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      enabled: p.enabled,
      allowedAudienceId: p.allowedAudienceId ?? null,
    })),
  };
}
