/**
 * Shared plumbing for the CLI's calls to the CLIRevenue API.
 *
 * Both the key check (`verifyKey`) and the placement create
 * (`createPlacement`) are network calls made from a terminal a user is
 * watching, so they share the two rules that keep a hang from looking like a
 * freeze: every request is bounded by a timeout, and a timeout is reported as
 * a timeout rather than as a generic network failure.
 */

import { CLIREVENUE_API_BASE_URL } from '../config.js';

/** A request that never returns leaves the terminal looking frozen. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function isTimeoutError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || err.name === 'AbortError')
  );
}

/**
 * A timeout signal, when the runtime has one.
 *
 * `AbortSignal.timeout` is available on every Node the package supports, but
 * the guard keeps the CLI working on an older runtime instead of throwing a
 * `TypeError` from inside the error path — the one place a crash is least
 * recoverable and least useful.
 */
export function timeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (
    typeof AbortSignal === 'undefined' ||
    typeof AbortSignal.timeout !== 'function'
  ) {
    return undefined;
  }
  return AbortSignal.timeout(timeoutMs);
}

/** Strip trailing slashes so a base URL can be joined with a path safely. */
export function apiUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** The message used whenever the API cannot be reached at all. */
export function unreachableMessage(err: unknown): string {
  return `Could not reach CLIRevenue backend: ${
    err instanceof Error ? err.message : 'unknown error'
  }`;
}

/** The message used whenever the API did not answer in time. */
export function timeoutMessage(timeoutMs: number): string {
  return `The CLIRevenue API did not respond within ${timeoutMs}ms. Check your network connection, then try again.`;
}

/**
 * Pull a human-readable message out of an error response.
 *
 * The API's error shape is `{ error: { code, message }, code, ... }`, but a
 * proxy or a crash can return anything, so this degrades to the raw text
 * rather than pretending it understood.
 */
export async function errorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  if (!text) return `Backend returned ${res.status}`;
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } };
    const message = parsed?.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    /* Not JSON — fall through to the raw text. */
  }
  return `Backend returned ${res.status}: ${text.slice(0, 200)}`;
}

export { CLIREVENUE_API_BASE_URL };