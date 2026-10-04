import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rmSync } from 'node:fs';
import { detectProject } from '../src/detect/project.js';
import { verifyKey } from '../src/verify/key.js';
import { generateIntegration } from '../src/generate/integration.js';

describe('setup integration', () => {
  it('rejects unsupported projects', () => {
    const result = detectProject('/tmp');
    expect(result.type).toBe('unsupported');
  });

  it('verifies key against backend', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        publisherId: 'pub-123',
        placements: [
          { id: 'p1', key: 'homepage', name: 'Homepage', enabled: true, allowedAudienceId: null },
        ],
      }),
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    const result = await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.publisherId).toBe('pub-123');
    expect(result.placements[0].key).toBe('homepage');
  });

  it('generates idempotent files', () => {
    const root = '/tmp/cli-revenue-idempotent-test';
    const cleanup = () => {
      try {
        rmSync(root, { recursive: true });
      } catch {
        // ignore
      }
    };

    cleanup();
    try {
      const opts = {
        projectRoot: root,
        publisherKey: 'pk_test_key',
        baseUrl: 'https://api.clirevenue.in',
        placementKey: 'homepage',
        placementName: 'Homepage',
        size: 'responsive' as const,
      };

      const first = generateIntegration(opts);
      expect(first.envAdded).toBe(true);
      expect(first.libAdded).toBe(true);
      expect(first.componentAdded).toBe(true);

      const second = generateIntegration(opts);
      expect(second.envAdded).toBe(false);
      expect(second.libAdded).toBe(false);
      expect(second.componentAdded).toBe(false);
    } finally {
      cleanup();
    }
  });
});
