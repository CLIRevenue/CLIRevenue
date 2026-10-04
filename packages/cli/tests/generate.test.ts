import { describe, it, expect, beforeEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateIntegration } from '../src/generate/integration.js';

describe('generateIntegration', () => {
  const scratch = join(tmpdir(), 'cli-revenue-gen-test');

  function createRoot(): string {
    const root = join(scratch, Math.random().toString(36).slice(2));
    mkdirSync(join(root, 'src', 'components'), { recursive: true });
    return root;
  }

  function cleanup(root: string) {
    try {
      rmSync(root, { recursive: true });
    } catch {
      // ignore
    }
  }

  beforeEach(() => {
    try {
      rmSync(scratch, { recursive: true });
    } catch {
      // ignore
    }
  });

  it('creates .env.local with key and baseUrl', () => {
    const root = createRoot();
    try {
      const result = generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_abcdefghijklmnopqrstuvwxyz0123456789',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });

      expect(result.envAdded).toBe(true);
      expect(result.libAdded).toBe(true);
      expect(result.componentAdded).toBe(true);

      const envContent = readFileSync(result.envFile, 'utf8');
      expect(envContent).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
      expect(envContent).toContain('VITE_API_BASE_URL=https://api.clirevenue.in');
    } finally {
      cleanup(root);
    }
  });

  it('creates lib/clirevenue.js', () => {
    const root = createRoot();
    try {
      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });

      const libContent = readFileSync(join(root, 'src/lib/clirevenue.js'), 'utf8');
      expect(libContent).toContain("import { init } from '@clirevenue/sdk'");
      expect(libContent).toContain('import.meta.env.VITE_CLIREVENUE_PUBLISHABLE_KEY');
      expect(libContent).toContain('import.meta.env.VITE_API_BASE_URL');
    } finally {
      cleanup(root);
    }
  });

  it('creates component with correct placement key', () => {
    const root = createRoot();
    try {
      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'my-placement',
        placementName: 'My Placement',
        size: 'responsive',
      });

      const compContent = readFileSync(join(root, 'src/components/CLIRevenueAd.jsx'), 'utf8');
      expect(compContent).toContain("placementKey = 'my-placement'");
      expect(compContent).toContain('clirevenue.render');
    } finally {
      cleanup(root);
    }
  });

  it('generates custom size layout', () => {
    const root = createRoot();
    try {
      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: [640, 180],
      });

      const compContent = readFileSync(join(root, 'src/components/CLIRevenueAd.jsx'), 'utf8');
      expect(compContent).toContain('width: 640');
      expect(compContent).toContain('height: 180');
    } finally {
      cleanup(root);
    }
  });

  it('does not overwrite existing files', () => {
    const root = createRoot();
    try {
      const existingEnv = 'EXISTING=1\n';
      writeFileSync(join(root, '.env.local'), existingEnv);

      const result = generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });

      expect(result.envAdded).toBe(false);

      const envContent = readFileSync(join(root, '.env.local'), 'utf8');
      expect(envContent).not.toBe(existingEnv);
      expect(envContent).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY');
    } finally {
      cleanup(root);
    }
  });

  it('creates .gitignore entry for .env.local', () => {
    const root = createRoot();
    try {
      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });

      const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
      expect(gitignore).toContain('.env.local');
    } finally {
      cleanup(root);
    }
  });

  it('does not duplicate .gitignore entry on rerun', () => {
    const root = createRoot();
    try {
      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });
      const gitignore1 = readFileSync(join(root, '.gitignore'), 'utf8');
      const count1 = (gitignore1.match(/\.env\.local/g) || []).length;

      generateIntegration({
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive',
      });
      const gitignore2 = readFileSync(join(root, '.gitignore'), 'utf8');
      const count2 = (gitignore2.match(/\.env\.local/g) || []).length;

      expect(count1).toBe(1);
      expect(count2).toBe(1);
    } finally {
      cleanup(root);
    }
  });
});
