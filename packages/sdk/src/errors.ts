/**
 * Typed errors.
 *
 * Every failure the SDK raises is one of these, so a host app can branch on
 * the type instead of matching message strings. A timeout is deliberately its
 * own class: it is retryable, and a caller needs to distinguish "the network
 * was slow" from "the server said no".
 */

export class CLIRevenueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request did not complete within the configured budget. Retryable. */
export class CLIRevenueTimeoutError extends CLIRevenueError {}

/** Transport-level failure: DNS, offline, connection reset. Retryable. */
export class CLIRevenueNetworkError extends CLIRevenueError {}

/** The server returned a non-2xx. Not retryable when 4xx. */
export class CLIRevenueHttpError extends CLIRevenueError {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, code: string | null, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * The SDK was set up incorrectly -- a bad publisher key, a missing
 * conversion token, an unknown placement.
 *
 * This is raised eagerly and locally rather than being sent to the server and
 * turned into a 4xx. A configuration mistake should not cost a network round
 * trip, and silently swallowing it is how publishers end up wondering why
 * they are not paid.
 */
export class CLIRevenueConfigError extends CLIRevenueError {}
