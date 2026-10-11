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

/**
 * Create a placement for the publisher that owns the given key.
 *
 * `POST /cli/placements` is the write counterpart to the read that
 * `verifyKey` already performs, and it exists so the CLI can create the very
 * first placement instead of sending a brand-new publisher to a dashboard to
 * do it by hand. Everything about *which* publisher the placement belongs to
 * is decided by the backend from the key hash; this client sends only the
 * credential and the fields the publisher chose.
 */

/**
 * The key used when the CLI has to mint the first placement.
 *
 * It is deliberately a constant rather than something derived from the
 * directory name or the project title. A stable key means a second run — or a
 * retried request after a timeout — lands on the same key, so the backend's
 * uniqueness constraint turns the retry into a no-op instead of a second
 * placement the user never asked for.
 */
export const DEFAULT_PLACEMENT_KEY = 'home';

export const DEFAULT_PLACEMENT_NAME = 'Home';

export interface CreatedPlacement {
  id: string;
  key: string;
  name: string | null;
  enabled: boolean;
  allowedAudienceId: string | null;
  /** False when the placement already existed (an idempotent retry). */
  created: boolean;
  publisherId: string;
}

export type PlacementCreateErrorCode =
  | 'invalid_request'
  | 'invalid_key'
  | 'forbidden'
  | 'rate_limited'
  | 'network_error'
  | 'unexpected';

export class PlacementCreateError extends Error {
  constructor(
    message: string,
    public readonly code: PlacementCreateErrorCode,
    /** Present on 429 so a caller can tell the user how long to wait. */
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PlacementCreateError';
  }
}

export interface CreatePlacementOptions {
  placementKey?: string;
  name?: string | null;
  enabled?: boolean;
  baseUrl?: string;
  timeoutMs?: number;
}

export async function createPlacement(
  rawKey: string,
  options: CreatePlacementOptions = {},
): Promise<CreatedPlacement> {
  const baseUrl = options.baseUrl ?? CLIREVENUE_API_BASE_URL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const placementKey = options.placementKey ?? DEFAULT_PLACEMENT_KEY;
  const name = options.name === undefined ? DEFAULT_PLACEMENT_NAME : options.name;

  if (!rawKey) {
    throw new PlacementCreateError(
      'A publisher key is required to create a placement.',
      'invalid_key',
    );
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(baseUrl, '/cli/placements'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      /* The credential travels in the body, never in the query string: a URL
         is written to proxy and gateway logs, and this one is a secret. */
      body: JSON.stringify({
        publisherKey: rawKey,
        placementKey,
        name,
        enabled: options.enabled ?? true,
      }),
      signal: timeoutSignal(timeoutMs),
    });
  } catch (err) {
    throw new PlacementCreateError(
      isTimeoutError(err) ? timeoutMessage(timeoutMs) : unreachableMessage(err),
      'network_error',
    );
  }

  if (res.status === 429) {
    const retryAfterMs = await readRetryAfter(res);
    throw new PlacementCreateError(
      'The CLIRevenue API is rate limiting placement creation. Try again shortly.',
      'rate_limited',
      retryAfterMs,
    );
  }

  if (res.status !== 200) {
    const message = await errorMessage(res);
    throw new PlacementCreateError(message, codeForStatus(res.status));
  }

  const body = await res.json().catch(() => null);
  const placement = (body as { placement?: Record<string, unknown> } | null)?.placement;
  if (!body || typeof placement !== 'object' || placement === null || typeof placement.key !== 'string') {
    throw new PlacementCreateError(
      'Unexpected backend response shape.',
      'unexpected',
    );
  }

  return {
    id: String(placement.id ?? ''),
    key: placement.key,
    name: typeof placement.name === 'string' ? placement.name : null,
    enabled: placement.enabled !== false,
    allowedAudienceId:
      typeof placement.allowedAudienceId === 'string' ? placement.allowedAudienceId : null,
    created: (body as { created?: unknown }).created === true,
    publisherId: String((body as { publisherId?: unknown }).publisherId ?? ''),
  };
}

/**
 * Map an HTTP status onto the error code the CLI reports.
 *
 * 403 is separate from 401 on purpose: 403 means the key is valid but the
 * request tried to act on another publisher, which is a different problem for
 * the user to fix than a key that is wrong or revoked.
 */
function codeForStatus(status: number): PlacementCreateErrorCode {
  if (status === 400) return 'invalid_request';
  if (status === 401) return 'invalid_key';
  if (status === 403) return 'forbidden';
  return 'unexpected';
}

/**
 * Read `retry_after_ms` from a 429.
 *
 * Best effort: a rate-limit response without the field is still a rate limit,
 * so an unreadable body falls back to the key's own default rate rather than
 * turning a throttle into an "unexpected backend" failure.
 */
async function readRetryAfter(res: Response): Promise<number | undefined> {
  const body = await res.json().catch(() => null);
  const value = (body as { retry_after_ms?: unknown } | null)?.retry_after_ms;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}