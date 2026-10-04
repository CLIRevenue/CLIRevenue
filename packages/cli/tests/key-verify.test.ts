import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyKey, type VerifiedKey, KeyVerificationError } from '../src/verify/key.js';

const DEFAULT_BASE_URL = 'https://api.clirevenue.in';

describe('verifyKey', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed keys', async () => {
    await expect(verifyKey('not-a-key')).rejects.toThrow('Key must match pk_test_... or pk_live_...');
    await expect(verifyKey('')).rejects.toThrow();
    await expect(verifyKey('pk_test_short')).rejects.toThrow();
  });

  it('accepts pk_test_... keys', async () => {
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
    expect(result.placements).toHaveLength(1);
  });

  it('accepts pk_live_... keys', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        publisherId: 'pub-456',
        placements: [],
      }),
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    const result = await verifyKey('pk_live_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.publisherId).toBe('pub-456');
  });

  it('throws on 401 invalid key', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    await expect(verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789')).rejects.toThrow(
      'Invalid or revoked publisher key',
    );
  });

  it('throws on network error', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });

    await expect(verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789')).rejects.toThrow(
      'Could not reach CLIRevenue backend',
    );
  });

  it('throws on unexpected backend response', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      text: async () => 'Server error',
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    await expect(verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789')).rejects.toThrow(
      'Backend returned 500',
    );
  });

  it('throws on malformed JSON response', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('Invalid JSON');
      },
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    await expect(verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789')).rejects.toThrow(
      'Unexpected backend response shape',
    );
  });

  it('throws on timeout/AbortError and maps to network_error', async () => {
    vi.stubGlobal('fetch', async () => {
      const err = new Error('The operation was aborted.');
      err.name = 'AbortError';
      throw err;
    });

    await expect(verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789')).rejects.toThrow(
      'The CLIRevenue API did not respond within',
    );

    try {
      await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
    } catch (e) {
      const err = e as KeyVerificationError;
      expect(err.code).toBe('network_error');
    }
  });

  it('throws on TimeoutError and maps to network_error', async () => {
    vi.stubGlobal('fetch', async () => {
      const err = new Error('Timeout');
      err.name = 'TimeoutError';
      throw err;
    });

    try {
      await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
    } catch (e) {
      const err = e as KeyVerificationError;
      expect(err.code).toBe('network_error');
      expect(err.message).toContain('The CLIRevenue API did not respond within');
    }
  });
});
