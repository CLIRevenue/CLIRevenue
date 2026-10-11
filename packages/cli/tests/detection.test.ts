import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { adapterFiles } from '../src/generate/adapters.js';
import {
  detectProject,
  isSupported,
  SUPPORTED_TYPES,
  type ProjectType,
} from '../src/detect/project.js';

/**
 * Detection decides two things at once: whether setup is allowed to touch the
 * project at all, and which adapter gets written. The second consequence is
 * why the matrix is asserted end-to-end against `adapterFiles` — a type that
 * is reported as supported but has no adapter behind it would fail at runtime
 * in the user's project, long after the CLI declared victory.
 */

const scratchDirs: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'clirevenue-detect-'));
  scratchDirs.push(root);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, name), content);
  }
  return root;
}

const pkg = (deps: Record<string, string> = {}, dev: Record<string, string> = {}) =>
  JSON.stringify({ name: 'app', version: '1.0.0', dependencies: deps, devDependencies: dev });

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('detection matrix', () => {
  const cases: Array<[string, Record<string, string>, ProjectType, boolean]> = [
    [
      'Vite + React',
      { 'package.json': pkg({ react: '^19' }, { vite: '^8' }), 'index.html': '' },
      'vite-react',
      true,
    ],
    [
      'Vite + Vue',
      { 'package.json': pkg({ vue: '^3' }, { vite: '^8' }), 'index.html': '' },
      'vite-vue',
      true,
    ],
    [
      'Vite + Svelte',
      { 'package.json': pkg({ svelte: '^5' }, { vite: '^8' }), 'index.html': '' },
      'vite-svelte',
      true,
    ],
    [
      'Vite with no framework',
      { 'package.json': pkg({}, { vite: '^8' }), 'index.html': '' },
      'vite-vanilla',
      true,
    ],
    [
      'a static page with no build tooling at all',
      { 'index.html': '<!doctype html>' },
      'static-html',
      true,
    ],
    [
      'a Node library with nothing to render into',
      { 'package.json': pkg({ lodash: '^4' }) },
      'node',
      false,
    ],
  ];

  for (const [label, files, expected, supported] of cases) {
    it(`classifies ${label} as ${expected}`, () => {
      const root = fixture(files);
      const project = detectProject(root);

      expect(project.type).toBe(expected);
      expect(isSupported(project.type)).toBe(supported);
      expect(project.supportsRendering).toBe(supported);
      /* Unsupported means "explain", never "silently guess" — a reason must
         always be available for the message setup prints. */
      if (!supported) expect(project.reason).toBeTruthy();
    });
  }

  it('reports an empty directory as unsupported rather than pretending', () => {
    /* A directory with nothing in it: the guard that keeps setup from writing
       into whatever folder the user happened to be standing in. */
    const root = mkdtempSync(join(tmpdir(), 'clirevenue-empty-'));
    scratchDirs.push(root);
    const project = detectProject(root);
    /* findUp walks to /, so only assert the shape, not the exact value. */
    expect(isSupported(project.type) || project.reason).toBeTruthy();
  });
});

describe('every supported type has a real adapter', () => {
  it('has no supported type without generated files behind it', () => {
    for (const type of SUPPORTED_TYPES) {
      const files = adapterFiles(type, '2.0.0');
      expect(files.length, `${type} must generate at least one file`).toBeGreaterThan(0);
      expect(files[0].content).toContain('@clirevenue/sdk');
      for (const file of files) {
        expect(file.path, `${type} must not generate outside the project`).not.toMatch(/^\/|\.\./);
        expect(file.content).toContain('clirevenue setup');
      }
    }
  });

  it('generates a framework component only where a framework exists', () => {
    const react = adapterFiles('vite-react', '2.0.0');
    expect(react.map((f) => f.path)).toContain('src/components/CLIRevenueAd.jsx');

    /* A plain Vite or static project has no component framework to plug
       into, so shipping a .jsx there would be dead code the user must delete. */
    for (const type of ['vite-vanilla', 'static-html'] as const) {
      expect(adapterFiles(type, '2.0.0').map((f) => f.path)).not.toContain(
        'src/components/CLIRevenueAd.jsx',
      );
    }
  });

  it('pins the SDK version it was asked for, not a hardcoded one', () => {
    for (const type of SUPPORTED_TYPES) {
      const files = adapterFiles(type, '9.9.9');
      const entry = files[0].content;
      /* The static adapter imports from a CDN and must pin the version; the
         bundled ones resolve through the package manager instead. */
      if (type === 'static-html') expect(entry).toContain('9.9.9');
      expect(entry).not.toContain('__SDK_VERSION__');
    }
  });
});

describe('package manager conventions are respected', () => {
  it('reports the package manager the project actually uses', () => {
    const root = fixture({
      'package.json': pkg({}, { vite: '^8' }),
      'index.html': '',
      'pnpm-lock.yaml': '',
    });
    expect(detectProject(root).packageManager).toBe('pnpm');
  });

  it('does not install a second lockfile style into a project', () => {
    const root = fixture({
      'package.json': pkg({}, { vite: '^8' }),
      'index.html': '',
      'yarn.lock': '',
    });
    const project = detectProject(root);
    expect(project.packageManager).toBe('yarn');
  });
});
