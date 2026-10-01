/**
 * Transport: timeout, retry policy, backoff.
 *
 * Retry rules, and the reasoning, because getting this wrong is expensive in
 * both directions:
 *
 *   - Retry network failures, timeouts and 5xx. These are transient.
 *   - NEVER retry 4xx. A rejected publisher key, an invalid token or a
 *     disabled placement will fail identically forever; retrying just burns
 *     the publisher's rate limit and delays the error the host needs to see.
 *   - The idempotency key is generated once per logical event by the caller
 *     and passed through every attempt unchanged. Generating a fresh key per
 *     attempt would turn a retry into a second logical event, which is
 *     precisely how double-counting happens.
 *
 * Backoff is exponential with full jitter. Full jitter rather than a fixed
 * delay so that a fleet of SDKs recovering from one server hiccup does not
 * resynchronise into a thundering herd.
 */
import {
  CLIRevenueError,
  CLIRevenueHttpError,
  CLIRevenueNetworkError,
  CLIRevenueTimeoutError,
} from "./errors.ts";

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    keepalive?: boolean;
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export type RequestOptions = {
  url: string;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  fetchImpl: FetchLike;
  timeoutMs: number;
  maxRetries: number;
  /** Stable across every retry of this logical event. */
  idempotencyKey: string;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** beacon-style delivery; not retried, no response body read. */
  beacon?: boolean;
};

export type JsonResult<T> = {
  status: number;
  /** null for 204 / empty bodies. */
  data: T | null;
};

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Full-jitter exponential backoff, capped. */
export function backoffDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const ceiling = Math.min(30_000, 250 * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export function isRetryableStatus(status: number): boolean {
  return status >= 500;
}

function errorCodeFrom(body: unknown): { code: string | null; message: string } {
  if (body && typeof body === "object") {
    const err = (body as { error?: { code?: unknown; message?: unknown } }).error;
    if (err && typeof err === "object") {
      return {
        code: typeof err.code === "string" ? err.code : null,
        message: typeof err.message === "string" ? err.message : "Request failed.",
      };
    }
  }
  return { code: null, message: "Request failed." };
}

async function readJson(response: {
  status: number;
  json(): Promise<unknown>;
}): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function requestJson<T>(options: RequestOptions): Promise<JsonResult<T>> {
  const {
    url, method, headers, body, fetchImpl, timeoutMs, maxRetries,
    idempotencyKey, beacon,
  } = options;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  const payload = body === undefined ? undefined : JSON.stringify(body);
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImpl(url, {
        method,
        headers: {
          "content-type": "application/json",
          // Stable across retries, and stable for the whole logical event.
          "x-idempotency-key": idempotencyKey,
          ...(headers ?? {}),
        },
        ...(payload === undefined ? {} : { body: payload }),
        ...(beacon ? { keepalive: true } : {}),
        // The signal is what actually aborts an in-flight request, so the
        // timeout is real rather than only observed after the fact.
        signal: controller.signal,
      } as never);
      clearTimeout(timer);

      // 204 is the documented no-fill signal and is a success, not an error.
      if (response.status === 204) return { status: 204, data: null };

      if (response.status >= 200 && response.status < 300) {
        const data = await readJson(response);
        return { status: response.status, data: (data ?? null) as T | null };
      }

      const parsed = await readJson(response);
      const { code, message } = errorCodeFrom(parsed);

      if (!isRetryableStatus(response.status)) {
        // 4xx: permanent for this request. Fail now so the host sees the real
        // reason instead of a timeout after several pointless attempts.
        throw new CLIRevenueHttpError(response.status, code, message);
      }

      lastError = new CLIRevenueHttpError(response.status, code, message);
    } catch (err) {
      clearTimeout(timer);
      if (err instanceof CLIRevenueHttpError && !isRetryableStatus(err.status)) throw err;

      if (timedOut) {
        lastError = new CLIRevenueTimeoutError(
          `Request to ${url} timed out after ${timeoutMs}ms.`,
        );
      } else if (err instanceof CLIRevenueError) {
        lastError = err;
      } else {
        lastError = new CLIRevenueNetworkError(
          `Request to ${url} failed: ${(err as Error)?.message ?? "network error"}`,
        );
      }
    }

    if (attempt < maxRetries) {
      await sleep(backoffDelay(attempt, random));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new CLIRevenueNetworkError(`Request to ${url} failed.`);
}
