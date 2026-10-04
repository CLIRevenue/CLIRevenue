import { CLIREVENUE_API_BASE_URL } from '../config.js';
const KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

/** A verification call that never returns leaves the terminal looking
 *  frozen, so every request is bounded. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 15_000;

function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function') {
    return undefined;
  }
  return AbortSignal.timeout(timeoutMs);
}

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

  const url = `${baseUrl.replace(/\/+$/, '')}/cli/placements?publisherKey=${encodeURIComponent(rawKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: timeoutSignal(options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS),
    });
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new KeyVerificationError(
        `The CLIRevenue API did not respond within ${
          options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS
        }ms. Check your network connection, then try again.`,
        'network_error',
      );
    }

    throw new KeyVerificationError(
      `Could not reach CLIRevenue backend: ${err instanceof Error ? err.message : 'unknown error'}`,
      'network_error',
    );
  }

  if (res.status === 401) {
    throw new KeyVerificationError('Invalid or revoked publisher key.', 'invalid_key');
  }

  if (res.status !== 200) {
    const text = await res.text().catch(() => '');
    throw new KeyVerificationError(
      `Backend returned ${res.status}: ${text.slice(0, 200)}`,
      'unexpected',
    );
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
