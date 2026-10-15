import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyKey, type VerifiedKey, KeyVerificationError } from '../src/verify/key.js';

const DEFAULT_BASE_URL = 'https://api.clirevenue.in';

describe('verifyKey', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects malformed keys', async () => {
    await expect(verifyKey('not-a-key')).rejects.toThrow('clirevenue_ads_');
    await expect(verifyKey('')).rejects.toThrow();
    await expect(verifyKey('pk_test_short')).rejects.toThrow();
  });

  it('names the account-key mistake instead of calling the key revoked', async () => {
    /* The reason this message exists: setup and staff provisioning share one
       signup form, so an account key reaching the setup prompt is a real
       mistake. Reporting it as an invalid key sends the user to the dashboard
       looking for a key they were never issued. */
    const accountKey = `clirevenue_account_${'a'.repeat(25)}`;
    const promise = verifyKey(accountKey);
    await expect(promise).rejects.toThrow(/account key/i);
    await expect(promise).rejects.not.toThrow(/revoked/i);
    await expect(promise).rejects.not.toThrow(/clirevenue_ads_ followed by/);
  });

  it('accepts a current clirevenue_ads_ key', async () => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        publisherId: 'pub-new',
        publisherName: 'Untitled publisher',
        fullName: 'Ada Lovelace',
        adsSeen: 12,
        earningsMilliCents: 450,
        slotCount: 2,
        placements: [],
      }),
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    const result = await verifyKey(`clirevenue_ads_${'A1b2C3d4E5f6G7h8I9j0KlMnOpQrSt'}`);
    expect(result.publisherId).toBe('pub-new');
    expect(result.fullName).toBe('Ada Lovelace');
    expect(result.adsSeen).toBe(12);
    expect(result.earningsMilliCents).toBe(450);
    expect(result.slotCount).toBe(2);
  });

  it('falls back when the backend predates the display fields', async () => {
    /* The CLI is installed from npm and the API is deployed independently, so
       an older backend answering the current CLI is expected, not exceptional.
       Setup must still reach the welcome banner against it. */
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({ publisherId: 'pub-old', placements: [] }),
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    const result = await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.fullName).toBeNull();
    expect(result.publisherName).toBe('CLIRevenue publisher');
    expect(result.adsSeen).toBe(0);
    expect(result.earningsMilliCents).toBe(0);
    expect(result.slotCount).toBe(0);
  });

  it.each([
    ['a negative count', { adsSeen: -3 }],
    ['a NaN count', { adsSeen: Number.NaN }],
    ['a string count', { adsSeen: 'many' }],
  ])('never reports %s as a real number', async (_label, overrides) => {
    const mockResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        publisherId: 'pub-x',
        publisherName: 'Acme',
        fullName: 'Grace',
        ...overrides,
        placements: [],
      }),
    };
    vi.stubGlobal('fetch', async () => mockResponse as any);

    const result = await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(result.adsSeen).toBe(0);
    /* A broken counter must not cost the user their name. */
    expect(result.fullName).toBe('Grace');
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

  it('sends the key in a header and never in the URL', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ publisherId: 'pub-123', placements: [] }),
      } as any;
    });

    await verifyKey('pk_test_abcdefghijklmnopqrstuvwxyz0123456789');

    expect(calls).toHaveLength(1);
    const [{ url, init }] = calls;
    expect(url).not.toContain('publisherKey=');
    expect(url).not.toContain('pk_test_');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-clirevenue-publisher-key']).toBe(
      'pk_test_abcdefghijklmnopqrstuvwxyz0123456789',
    );
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
