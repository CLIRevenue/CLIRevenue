import { readFileSync } from 'node:fs';

interface PackageManifest {
  name?: unknown;
  version?: unknown;
}

/**
 * The CLI's own version, read from the package manifest that ships with it.
 *
 * This used to be a hardcoded `.version('1.0.0')` in `index.ts`, which meant a
 * release had to remember to update a second place or `--version` would quietly
 * disagree with `npm view clirevenue version`. Reading the manifest removes the
 * class of bug instead of documenting it.
 *
 * The path is resolved relative to this module rather than `process.cwd()`, so
 * it works the same whether the CLI runs from `src/` during development, from
 * `dist/` inside a checkout, or from `node_modules/clirevenue/dist/` when
 * installed: in all three cases the manifest sits one directory up.
 */
function readManifest(): PackageManifest {
  try {
    const manifestUrl = new URL('../package.json', import.meta.url);
    return JSON.parse(readFileSync(manifestUrl, 'utf8')) as PackageManifest;
  } catch {
    /* A missing or unparseable manifest must not stop the CLI from running —
       `setup` and `editor` do not need a version to do their job. Reporting
       "unknown" is honest; refusing to start is not. */
    return {};
  }
}

const manifest = readManifest();

/** e.g. `1.1.0`. Falls back to `0.0.0-unknown` only if the manifest is unreadable. */
export const CLI_VERSION: string =
  typeof manifest.version === 'string' && manifest.version.length > 0 ? manifest.version : '0.0.0-unknown';

export const CLI_NAME: string = typeof manifest.name === 'string' && manifest.name.length > 0 ? manifest.name : 'clirevenue';