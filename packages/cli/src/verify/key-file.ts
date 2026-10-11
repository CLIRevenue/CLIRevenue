import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where the publishable key lives on disk, and how to read it back.
 *
 * This lives in its own module rather than inside a command because two very
 * different code paths need it: `setup` writes the key and reuses it on a
 * re-run, and `editor` has to find the key a previous `setup` left behind.
 * When those two used separate readers they drifted, and the editor ended up
 * reading only `process.env` while `setup` read the file -- so `setup`
 * succeeded, wrote a key, and `editor` then claimed it could not find it.
 */
export const ENV_FILE = '.env.local';

/** The only key name setup writes, and the only one we read back. */
export const PUBLISHABLE_KEY_VAR = 'VITE_CLIREVENUE_PUBLISHABLE_KEY';

/** A non-`VITE_` alias, honoured if a user set it by hand. */
export const PUBLISHABLE_KEY_VAR_PLAIN = 'CLIREVENUE_PUBLISHABLE_KEY';

/**
 * The shape of a CLIRevenue publishable key.
 *
 * Deliberately the same pattern `verify/key.ts` uses, so a value we happily
 * read out of a file is a value the API will actually accept. Reading a
 * malformed value would only move the failure later, to a confusing
 * "Invalid or revoked publisher key" from the API.
 */
export const PUBLISHABLE_KEY_PATTERN = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

/**
 * Reads the publishable key a previous `setup` wrote into `<root>/.env.local`.
 *
 * Returns `null` -- never throws -- when the file is absent, unreadable, or
 * holds no well-formed key. `setup` treats a missing key as "prompt me", and
 * `editor` treats it as "tell the user to run setup"; in both cases an
 * unreadable file is a routine state, not an exceptional one, so this stays
 * quiet rather than surfacing a filesystem error the user cannot act on.
 *
 * The file is read, never written, and the value is returned to the caller --
 * it is deliberately not logged here.
 */
export function readKeyFromEnvFile(root: string): string | null {
  try {
    const envPath = join(root, ENV_FILE);
    if (!existsSync(envPath)) return null;
    const match = readFileSync(envPath, 'utf8').match(
      new RegExp(`^${PUBLISHABLE_KEY_VAR}=(.+)$`, 'm'),
    );
    const value = match?.[1]?.trim();
    return value && PUBLISHABLE_KEY_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the publisher key for a command that needs it.
 *
 * Precedence, highest first:
 *
 *   1. `env` -- an explicitly supplied environment. This is deliberately not
 *      merged with anything read from a file: a caller that hands us a value
 *      means it, and a file must never quietly override a deliberate choice.
 *   2. `<root>/.env.local` -- what `setup` writes, so a project that has been
 *      set up just works.
 *
 * A `VITE_`-prefixed variable wins over the plain alias at the same tier,
 * because that is the name setup writes and the one the generated app reads.
 */
export function resolvePublisherKey(
  root: string,
  env?: NodeJS.ProcessEnv,
): string | null {
  const fromEnv = firstKey(env);
  if (fromEnv) return fromEnv;
  return readKeyFromEnvFile(root);
}

function firstKey(env?: NodeJS.ProcessEnv): string | null {
  if (!env) return null;
  const candidates = [env[PUBLISHABLE_KEY_VAR], env[PUBLISHABLE_KEY_VAR_PLAIN]];
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && PUBLISHABLE_KEY_PATTERN.test(value)) return value;
  }
  return null;
}
