import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Regression tests for the failure that made `npx clirevenue setup` look
 * like it was crashing the user's terminal.
 *
 * The bin entry point shipped without a `#!` line, so the shell tried to
 * interpret the ESM bundle as a shell script. Through `npx` that produced
 * `import: not found` and `Syntax error: "(" unexpected`, and the process
 * died with exit code 2 and no explanation — the window closing with
 * nothing in it. `node dist/index.js` worked, which is exactly why this
 * survived local testing.
 *
 * `src/index.ts` is asserted directly. `dist/index.js` is asserted too when
 * it is present, because the shipped artefact is what npx executes.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const pkgRoot = join(here, '..');
const srcEntry = join(pkgRoot, 'src', 'index.ts');
const distEntry = join(pkgRoot, 'dist', 'index.js');

let binDir: string;
let binPath: string;

beforeAll(() => {
  binDir = mkdtempSync(join(tmpdir(), 'clirevenue-bin-'));
  binPath = join(binDir, 'clirevenue');

  if (existsSync(distEntry)) {
    symlinkSync(distEntry, binPath);
    chmodSync(distEntry, 0o755);
  }
});

afterAll(() => {
  if (binDir) rmSync(binDir, { recursive: true, force: true });
});

describe('the bin entry point is a real executable script', () => {
  it('starts with a node shebang in the source', () => {
    const source = readFileSync(srcEntry, 'utf8');
    expect(source.split('\n')[0]).toBe('#!/usr/bin/env node');
  });

  it.skipIf(!existsSync(distEntry))('keeps the shebang through the TypeScript build', () => {
    const built = readFileSync(distEntry, 'utf8');
    expect(built.split('\n')[0]).toBe('#!/usr/bin/env node');
  });

  it.skipIf(!existsSync(distEntry))(
    'runs when executed directly, the way npm and npx run a bin',
    () => {
      const result = spawnSync(binPath, ['--help'], { encoding: 'utf8' });

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain('not found');
      expect(result.stderr).not.toContain('Syntax error');
      expect(result.stdout).toContain('Usage: clirevenue');
    },
  );
});

describe('--help', () => {
  it('prints usage and exits 0 when invoked through node', () => {
    const result = spawnSync(process.execPath, [distEntry, '--help'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: clirevenue [options] [command]');
    expect(result.stdout).toContain('setup');
  });

  it.skipIf(!existsSync(distEntry))('prints usage and exits 0 when invoked as a bin', () => {
    const result = spawnSync(binPath, ['--help'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: clirevenue');
  });
});

describe('--version', () => {
  it('reports 1.0.0', () => {
    const result = spawnSync(process.execPath, [distEntry, '--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('1.0.0');
  });

  it.skipIf(!existsSync(distEntry))('reports 1.0.0 through the bin', () => {
    const result = spawnSync(binPath, ['--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('1.0.0');
  });
});

describe('failure reporting', () => {
  let unsupportedProject: string;

  beforeAll(() => {
    unsupportedProject = mkdtempSync(join(tmpdir(), 'clirevenue-unsupported-'));
    writeFileSync(
      join(unsupportedProject, 'package.json'),
      JSON.stringify({ name: 'not-a-vite-app', version: '1.0.0' }, null, 2),
      'utf8',
    );
  });

  afterAll(() => {
    if (unsupportedProject) rmSync(unsupportedProject, { recursive: true, force: true });
  });

  it('exits non-zero with a readable message when the project is unsupported', () => {
    const result = spawnSync(process.execPath, [distEntry, 'setup'], {
      cwd: unsupportedProject,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unsupported project.');
    /* The message has to survive: stdout/stderr are pipes here, which is
       how npx runs a bin, so anything written with a raw process.exit()
       was lost exactly when it mattered most. */
    expect(result.stderr).toContain('Vite + React');
  });

  it('never lets a rejected setup escape as an unhandled rejection', () => {
    const result = spawnSync(process.execPath, [distEntry, 'setup'], {
      cwd: unsupportedProject,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const combined = `${result.stdout}${result.stderr}`;

    expect(combined).not.toContain('UnhandledPromiseRejection');
    expect(combined).not.toContain('unhandled rejection');
    /* A stack trace is kept behind an explicit flag, not dumped by default. */
    expect(combined).not.toMatch(/\n\s+at\s/);
    expect(combined).toContain('CLIREVENUE_DEBUG=1');
  });

  it('resolves with the project directory it inspected, not the CLI package', () => {
    const result = spawnSync(process.execPath, [distEntry, 'setup'], {
      cwd: unsupportedProject,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    expect(result.stderr).toContain(unsupportedProject);
    expect(result.stderr).not.toContain(join(pkgRoot, 'src'));
  });

  it('rejects an unknown command with a non-zero exit code', () => {
    const result = spawnSync(process.execPath, [distEntry, 'nope'], { encoding: 'utf8' });

    expect(result.status).not.toBe(0);
    expect(result.stderr + result.stdout).toContain('nope');
  });

  it('prints help for a bare invocation and exits 0', () => {
    const result = spawnSync(process.execPath, [distEntry], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: clirevenue');
  });
});

describe('package metadata', () => {
  it('stays publishable as an unscoped public package on Node 18+', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      name: string;
      version: string;
      type: string;
      bin: Record<string, string>;
      engines: { node: string };
      files: string[];
      publishConfig?: { access?: string };
    };

    expect(pkg.name).toBe('clirevenue');
    expect(pkg.version).toBe('1.0.0');
    expect(pkg.type).toBe('module');
    expect(pkg.bin.clirevenue).toBe('./dist/index.js');
    expect(pkg.engines.node).toBe('>=18');
    expect(pkg.publishConfig?.access).toBe('public');
    expect(pkg.files).toContain('dist');
  });

  it('points its bin at the built entry point that carries the shebang', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    const resolved = join(pkgRoot, pkg.bin.clirevenue);

    expect(existsSync(resolved)).toBe(true);
    expect(readFileSync(resolved, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('publishes dist and docs only, never tests or sources', () => {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
      files: string[];
    };

    expect(pkg.files).not.toContain('src');
    expect(pkg.files).not.toContain('tests');
  });
});

/* Keeps the temp-directory helper honest if this file is ever trimmed. */
export function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(dir, { recursive: true });
  return dir;
}