import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ProjectType } from '../detect/project.js';
import { CLIREVENUE_SDK_VERSION } from '../config.js';
import { adapterFiles, GENERATED_HEADER } from './adapters.js';
import { ensureConfigFile } from '../project/config.js';

export interface GenerateOptions {
  projectRoot: string;
  publisherKey: string;
  baseUrl: string;
  /** Which stack's adapter files to emit. */
  projectType?: ProjectType;
  /** Interpolated into the CDN URL for bundler-free projects. */
  sdkVersion?: string;
  /**
   * @deprecated Setup no longer picks a placement or a size — the editor
   * owns both. Retained so callers and older tests keep compiling.
   */
  placementKey?: string;
  /** @deprecated See `placementKey`. */
  placementName?: string;
  /** @deprecated See `placementKey`. */
  size?: 'responsive' | [number, number];
}

export interface GenerateResult {
  envFile: string;
  envAdded: boolean;
  /** The adapter entry module (`src/lib/clirevenue.js`, `clirevenue-ad.js`, …). */
  libFile: string;
  libAdded: boolean;
  /** The framework component, when the stack has one. */
  componentFile: string;
  componentAdded: boolean;
  /** The placement config the editor writes and the entry module imports. */
  configFile: string;
  configAdded: boolean;
  gitignoreUpdated: boolean;
  /** Paths this CLI owns and therefore refreshed in place. */
  updated: string[];
  /** Paths that already existed without our marker and were left byte-for-byte alone. */
  preserved: string[];
}

const ENV_FILE = '.env.local';

/* The only two variables this CLI owns inside `.env.local`. Every other
   line in that file belongs to the user and is never touched. */
const ENV_OWNED_KEYS = ['VITE_CLIREVENUE_PUBLISHABLE_KEY', 'VITE_API_BASE_URL'];

export { GENERATED_HEADER };

/**
 * Merges CLIRevenue's variables into an existing `.env.local`.
 *
 * This replaces the previous `writeFileSync(envPath, ENV_CONTENT(...))`,
 * which truncated the file and silently deleted every other variable the
 * project had. Now: absent file → created; existing file → only the two
 * owned keys are set (replaced in place, or appended if not already
 * present), every other line, comment and line ending survives.
 */
export function mergeEnvFile(
  existing: string | null,
  publisherKey: string,
  baseUrl: string,
): string {
  const values: Record<string, string> = {
    VITE_CLIREVENUE_PUBLISHABLE_KEY: publisherKey,
    VITE_API_BASE_URL: baseUrl,
  };

  if (existing === null) {
    return `${ENV_OWNED_KEYS.map((key) => `${key}=${values[key]}`).join('\n')}\n`;
  }

  /* Keep whatever line ending the user's file already uses rather than
     normalising it to LF behind their back. */
  const eol = existing.includes('\r\n') ? '\r\n' : '\n';

  const lines = existing.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const seen = new Set<string>();
  const merged = lines.map((line) => {
    const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/)?.[1];
    if (!key || !ENV_OWNED_KEYS.includes(key)) return line;
    seen.add(key);
    return `${key}=${values[key]}`;
  });

  for (const key of ENV_OWNED_KEYS) {
    if (!seen.has(key)) merged.push(`${key}=${values[key]}`);
  }

  return `${merged.join(eol)}${eol}`;
}

function ensureGitignore(projectRoot: string): boolean {
  const gitignorePath = join(projectRoot, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, '# Local env variables\n.env.local\n');
    return true;
  }

  const content = readFileSync(gitignorePath, 'utf8');
  if (content.includes('.env.local')) return false;

  const suffix = content.endsWith('\n') ? '' : '\n';
  writeFileSync(gitignorePath, content + suffix + '# Local env variables\n.env.local\n');
  return true;
}

/**
 * Writes one generated file, or refuses to touch a file it does not own.
 * Returns `'created'`, `'updated'` or `'preserved'`.
 */
function writeGeneratedFile(path: string, content: string): 'created' | 'updated' | 'preserved' {
  if (existsSync(path)) {
    let owned = false;
    try {
      owned = readFileSync(path, 'utf8').startsWith(GENERATED_HEADER);
    } catch {
      owned = false;
    }

    /* Not ours: leave it alone. Overwriting someone's own
       `src/lib/clirevenue.js` is exactly the kind of silent data loss
       this CLI must not do. */
    if (!owned) return 'preserved';

    writeFileSync(path, content);
    return 'updated';
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return 'created';
}

export function generateIntegration(opts: GenerateOptions): GenerateResult {
  const projectRoot = opts.projectRoot;
  const type = opts.projectType ?? 'vite-react';
  const sdkVersion = opts.sdkVersion ?? CLIREVENUE_SDK_VERSION;

  const envPath = join(projectRoot, ENV_FILE);
  const updated: string[] = [];
  const preserved: string[] = [];

  const envAdded = !existsSync(envPath);
  mkdirSync(dirname(envPath), { recursive: true });
  writeFileSync(
    envPath,
    mergeEnvFile(envAdded ? null : readFileSync(envPath, 'utf8'), opts.publisherKey, opts.baseUrl),
  );

  /*
   * The config file is written before the adapter that imports it. The
   * bundled entry does a static `import … from '../../clirevenue.config.json'`,
   * and a bundler resolving a missing JSON module fails the entire build —
   * so a fresh project must have the file before it has an ad in it.
   */
  const config = ensureConfigFile(projectRoot);

  const adapters = adapterFiles(type, sdkVersion);
  const entry = adapters[0];
  const render = adapters[1];

  const libPath = join(projectRoot, entry?.path ?? '');
  let libOutcome: 'created' | 'updated' | 'preserved' = 'created';
  if (entry) {
    libOutcome = writeGeneratedFile(libPath, entry.content);
    if (libOutcome === 'updated') updated.push(libPath);
    else if (libOutcome === 'preserved') preserved.push(libPath);
  }

  const componentPath = join(projectRoot, render?.path ?? '');
  let componentOutcome: 'created' | 'updated' | 'preserved' = 'created';
  if (render) {
    componentOutcome = writeGeneratedFile(componentPath, render.content);
    if (componentOutcome === 'updated') updated.push(componentPath);
    else if (componentOutcome === 'preserved') preserved.push(componentPath);
  }

  const gitignoreUpdated = ensureGitignore(projectRoot);

  return {
    envFile: envPath,
    envAdded,
    libFile: libPath,
    libAdded: libOutcome === 'created',
    componentFile: componentPath,
    componentAdded: componentOutcome === 'created',
    configFile: config.path,
    configAdded: config.created,
    gitignoreUpdated,
    updated,
    preserved,
  };
}