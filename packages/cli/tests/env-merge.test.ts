import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { mergeEnvFile, generateIntegration } from '../src/generate/integration.js';

let testRoot: string;

beforeEach(() => {
  testRoot = join(tmpdir(), `clirevenue-env-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(testRoot, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  if (testRoot && existsSync(testRoot)) {
    rmSync(testRoot, { recursive: true, force: true });
  }
});

describe('mergeEnvFile', () => {
  const envPath = join('/tmp', 'test-env-local'); // Not actually used, function is pure

  it('creates both keys when file does not exist', () => {
    const result = mergeEnvFile(null, 'pk_test_abc', 'https://api.example.com');
    expect(result).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_abc');
    expect(result).toContain('VITE_API_BASE_URL=https://api.example.com');
  });

  it('preserves unrelated vars and comments', () => {
    const existing = '# Comment\nVITE_OTHER=keep\nVITE_ANOTHER=value\n';
    const result = mergeEnvFile(existing, 'pk_test_new', 'https://api.example.com');
    expect(result).toContain('# Comment');
    expect(result).toContain('VITE_OTHER=keep');
    expect(result).toContain('VITE_ANOTHER=value');
    expect(result).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_new');
    expect(result).toContain('VITE_API_BASE_URL=https://api.example.com');
  });

  it('replaces existing owned keys in place (no duplicates)', () => {
    const existing = 'VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_old\nVITE_API_BASE_URL=https://old.com\n';
    const result = mergeEnvFile(existing, 'pk_test_new', 'https://new.com');
    const keyLines = result.split('\n').filter(l => l.startsWith('VITE_CLIREVENUE_PUBLISHABLE_KEY='));
    const urlLines = result.split('\n').filter(l => l.startsWith('VITE_API_BASE_URL='));
    expect(keyLines).toHaveLength(1);
    expect(urlLines).toHaveLength(1);
    expect(keyLines[0]).toBe('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_new');
    expect(urlLines[0]).toBe('VITE_API_BASE_URL=https://new.com');
  });

  it('preserves CRLF line endings', () => {
    const existing = 'VITE_OTHER=keep\r\n';
    const result = mergeEnvFile(existing, 'pk_test_new', 'https://api.example.com');
    expect(result).toContain('\r\n');
  });

  it('appends missing owned keys when only one exists', () => {
    const existing = 'VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_old\n';
    const result = mergeEnvFile(existing, 'pk_test_new', 'https://api.example.com');
    expect(result).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_new');
    expect(result).toContain('VITE_API_BASE_URL=https://api.example.com');
  });

  it('handles empty string input', () => {
    const result = mergeEnvFile('', 'pk_test_abc', 'https://api.example.com');
    expect(result).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_abc');
    expect(result).toContain('VITE_API_BASE_URL=https://api.example.com');
  });

  it('preserves exact whitespace around equals for unrelated lines', () => {
    const existing = 'VITE_SPACED = value\n';
    const result = mergeEnvFile(existing, 'pk_test_new', 'https://api.example.com');
    expect(result).toContain('VITE_SPACED = value');
  });
});

describe('generateIntegration env merge', () => {
  it('never truncates .env.local - preserves all existing vars', () => {
    const existingEnv = 
      '# Project config\n' +
      'VITE_APP_TITLE=My App\n' +
      'VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_oldkey123456789012345678901234\n' +
      'VITE_API_BASE_URL=https://old.api.com\n' +
      'VITE_FEATURE_FLAG=true\n' +
      '\n';

    writeFileSync(join(testRoot, '.env.local'), existingEnv);
    writeFileSync(join(testRoot, 'package.json'), JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^18', 'react-dom': '^18' },
      devDependencies: { vite: '^5' }
    }, null, 2));
    mkdirSync(join(testRoot, 'src'), { recursive: true });
    writeFileSync(join(testRoot, 'vite.config.ts'), "import { defineConfig } from 'vite'; export default defineConfig({});");

    const result = generateIntegration({
      projectRoot: testRoot,
      publisherKey: 'pk_test_newkey123456789012345678901234',
      baseUrl: 'https://api.clirevenue.in',
      placementKey: 'hero-banner',
      placementName: 'Hero Banner',
      size: 'responsive',
    });

    const envContent = readFileSync(result.envFile, 'utf8');
    
    // Original vars preserved
    expect(envContent).toContain('VITE_APP_TITLE=My App');
    expect(envContent).toContain('VITE_FEATURE_FLAG=true');
    expect(envContent).toContain('# Project config');
    
    // Owned keys updated
    expect(envContent).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_newkey123456789012345678901234');
    expect(envContent).toContain('VITE_API_BASE_URL=https://api.clirevenue.in');
    
    // No duplicates
    const keyCount = (envContent.match(/VITE_CLIREVENUE_PUBLISHABLE_KEY=/g) || []).length;
    const urlCount = (envContent.match(/VITE_API_BASE_URL=/g) || []).length;
    expect(keyCount).toBe(1);
    expect(urlCount).toBe(1);
  });

  it('preserves CRLF in existing .env.local', () => {
    const existingEnv = 'VITE_OTHER=keep\r\nVITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_old\r\n';
    writeFileSync(join(testRoot, '.env.local'), existingEnv);
    writeFileSync(join(testRoot, 'package.json'), JSON.stringify({
      name: 'test-app',
      dependencies: { react: '^18', 'react-dom': '^18' },
      devDependencies: { vite: '^5' }
    }, null, 2));
    mkdirSync(join(testRoot, 'src'), { recursive: true });
    writeFileSync(join(testRoot, 'vite.config.ts'), "import { defineConfig } from 'vite'; export default defineConfig({});");

    const result = generateIntegration({
      projectRoot: testRoot,
      publisherKey: 'pk_test_newkey123456789012345678901234',
      baseUrl: 'https://api.clirevenue.in',
      placementKey: 'hero-banner',
      placementName: 'Hero Banner',
      size: 'responsive',
    });

    const envContent = readFileSync(result.envFile, 'utf8');
    expect(envContent).toContain('\r\n');
    expect(envContent).toContain('VITE_OTHER=keep');
    expect(envContent).toContain('VITE_CLIREVENUE_PUBLISHABLE_KEY=pk_test_newkey123456789012345678901234');
  });
});