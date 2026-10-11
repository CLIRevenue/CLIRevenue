import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { detectProject, isSupported, type ProjectType } from '../src/detect/project.js';

function createFixture(baseDir: string, files: Record<string, string>): string {
  const root = join(baseDir, Math.random().toString(36).slice(2));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

function cleanup(root: string) {
  try {
    rmSync(root, { recursive: true });
  } catch {
    // ignore
  }
}

describe('detectProject', () => {
  const scratch = join(tmpdir(), 'cli-revenue-test');

  it('detects Vite + React', () => {
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^5.0.0' },
      }),
      'vite.config.js': 'export default {}',
    });
    try {
      const result = detectProject(root);
      expect(result.type).toBe('vite-react');
      expect(result.hasReact).toBe(true);
      expect(result.hasVite).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it('detects a package.json project with no page to render into', () => {
    /* React alone, no Vite and no HTML entry. This is not a supported ad
       target, and it now gets its own diagnosis ('node') instead of the
       catch-all 'unsupported' so setup can explain *why* it cannot wire an
       ad in. The load-bearing assertion is isSupported() === false. */
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({
        dependencies: { react: '^19.0.0' },
      }),
    });
    try {
      const result = detectProject(root);
      expect(result.type).toBe('node');
      expect(isSupported(result.type)).toBe(false);
      expect(result.supportsRendering).toBe(false);
      expect(result.reason).toBeTruthy();
      expect(result.hasReact).toBe(true);
      expect(result.hasVite).toBe(false);
    } finally {
      cleanup(root);
    }
  });

  it('detects a static HTML page with no build tooling', () => {
    const root = createFixture(scratch, {
      'index.html': '<!doctype html><html><body></body></html>',
    });
    try {
      const result = detectProject(root);
      expect(result.type).toBe('static-html');
      expect(isSupported(result.type)).toBe(true);
      expect(result.supportsRendering).toBe(true);
    } finally {
      cleanup(root);
    }
  });

  it('detects npm as default package manager', () => {
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({ dependencies: { react: '^1', 'react-dom': '^1' }, devDependencies: { vite: '^1' } }),
      'package-lock.json': '{}',
    });
    try {
      const result = detectProject(root);
      expect(result.packageManager).toBe('npm');
    } finally {
      cleanup(root);
    }
  });

  it('detects pnpm', () => {
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({ dependencies: { react: '^1', 'react-dom': '^1' }, devDependencies: { vite: '^1' } }),
      'pnpm-lock.yaml': '',
    });
    try {
      const result = detectProject(root);
      expect(result.packageManager).toBe('pnpm');
    } finally {
      cleanup(root);
    }
  });

  it('detects yarn', () => {
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({ dependencies: { react: '^1', 'react-dom': '^1' }, devDependencies: { vite: '^1' } }),
      'yarn.lock': '',
    });
    try {
      const result = detectProject(root);
      expect(result.packageManager).toBe('yarn');
    } finally {
      cleanup(root);
    }
  });

  it('detects bun', () => {
    const root = createFixture(scratch, {
      'package.json': JSON.stringify({ dependencies: { react: '^1', 'react-dom': '^1' }, devDependencies: { vite: '^1' } }),
      'bun.lockb': Buffer.from('fake'),
    });
    try {
      const result = detectProject(root);
      expect(result.packageManager).toBe('bun');
    } finally {
      cleanup(root);
    }
  });
});

function dirname(path: string): string {
  return path.split(/[/\\]/).slice(0, -1).join('/') || '.';
}
