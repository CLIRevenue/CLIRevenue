/**
 * Placement creation — the CLI half of `POST /cli/placements`.
 *
 * The backend decides which publisher a placement belongs to (it derives that
 * from the key hash), so what these tests pin is everything the CLI is
 * responsible for: that it sends the credential in the body and never in a
 * URL, that it distinguishes the four failure modes a user can actually fix,
 * that it creates a placement only when the publisher has none, and that the
 * geometry the user drags afterwards still lands in
 * `clirevenue.config.json` rather than anywhere server-side.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createPlacement,
  PlacementCreateError,
  DEFAULT_PLACEMENT_KEY,
  type CreatedPlacement,
} from '../src/verify/placement.js';
import { ensureIntegrations, editor, EditorError } from '../src/editor/index.js';
import { addIntegration, readConfig } from '../src/project/config.js';

const KEY = 'pk_test_0123456789abcdefghijABCDEFGHIJ012345';
const BASE = 'https://api.example.test';

const scratchDirs: string[] = [];
const afterEachCbs: Array<() => void> = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-placement-'));
  scratchDirs.push(dir);
  afterEachCbs.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A project the detector recognises as Vite + React. */
function viteProject(): string {
  const root = scratch();
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'app',
        version: '1.0.0',
        dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        devDependencies: { vite: '^8.0.0' },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, 'vite.config.js'), 'export default {}\n');
  writeFileSync(join(root, 'index.html'), '<!doctype html><div id="root"></div>\n');
  return root;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const CREATED_BODY = {
  publisherId: 'pub_123',
  created: true,
  placement: {
    id: 'plc_1',
    key: 'home',
    name: 'Home',
    enabled: true,
    allowedAudienceId: null,
  },
};

afterEach(() => {
  while (afterEachCbs.length) afterEachCbs.pop()?.();
  vi.unstubAllGlobals();
});

describe('createPlacement', () => {
  it('posts the credential in the body, never in the URL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CREATED_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await createPlacement(KEY, { baseUrl: BASE });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${BASE}/cli/placements`);
    /* A URL is written to proxy and gateway logs; a publisher key in one is a
       leaked credential, so the read path's query string is deliberately not
       copied here. */
    expect(url).not.toContain(KEY);
    expect(url).not.toContain('publisherKey=');
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.publisherKey).toBe(KEY);
    expect(body.placementKey).toBe(DEFAULT_PLACEMENT_KEY);
    expect(body.enabled).toBe(true);
  });

  it('returns the created placement and whether it was newly made', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse(CREATED_BODY));
    await expect(createPlacement(KEY, { baseUrl: BASE })).resolves.toEqual<CreatedPlacement>({
      id: 'plc_1',
      key: 'home',
      name: 'Home',
      enabled: true,
      allowedAudienceId: null,
      created: true,
      publisherId: 'pub_123',
    });

    vi.stubGlobal('fetch', async () => jsonResponse({ ...CREATED_BODY, created: false }));
    await expect(createPlacement(KEY, { baseUrl: BASE })).resolves.toMatchObject({
      created: false,
    });
  });

  it('sends an explicit key and name when the caller asks for them', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CREATED_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await createPlacement(KEY, { baseUrl: BASE, placementKey: 'sidebar', name: 'Sidebar' });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    expect(body.placementKey).toBe('sidebar');
    expect(body.name).toBe('Sidebar');
  });

  it('never sends a publisher id — the backend must derive ownership', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CREATED_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await createPlacement(KEY, { baseUrl: BASE });

    const body = JSON.parse(
      String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body),
    ) as Record<string, unknown>;
    expect(Object.keys(body)).not.toContain('publisherId');
  });

  it('refuses an empty credential without touching the network', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(CREATED_BODY));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createPlacement('', { baseUrl: BASE })).rejects.toBeInstanceOf(
      PlacementCreateError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps each status onto the failure the user can actually fix', async () => {
    const cases: Array<[number, string]> = [
      [400, 'invalid_request'],
      [401, 'invalid_key'],
      [403, 'forbidden'],
      [500, 'unexpected'],
    ];

    for (const [status, code] of cases) {
      vi.stubGlobal('fetch', async () =>
        jsonResponse({ error: { code, message: 'nope' } }, status),
      );
      await expect(createPlacement(KEY, { baseUrl: BASE })).rejects.toMatchObject({ code });
    }
  });

  it('surfaces the backend message for a rejected request', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({ error: { code: 'INVALID_REQUEST', message: 'placement_key is required' } }, 400),
    );
    await expect(createPlacement(KEY, { baseUrl: BASE })).rejects.toThrow(
      'placement_key is required',
    );
  });

  it('reads retry_after_ms on a rate limit and keeps it as a rate limit', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({ error: { code: 'RATE_LIMITED', message: 'slow down' }, retry_after_ms: 1500 }, 429),
    );
    const err = await createPlacement(KEY, { baseUrl: BASE }).catch((e) => e);
    expect(err).toBeInstanceOf(PlacementCreateError);
    expect((err as PlacementCreateError).code).toBe('rate_limited');
    expect((err as PlacementCreateError).retryAfterMs).toBe(1500);
  });

  it('still reports a rate limit when the body carries no retry hint', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 429 }));
    const err = await createPlacement(KEY, { baseUrl: BASE }).catch((e) => e);
    expect((err as PlacementCreateError).code).toBe('rate_limited');
    expect((err as PlacementCreateError).retryAfterMs).toBeUndefined();
  });

  it('reports an unreachable backend as a network error, not a bad request', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(createPlacement(KEY, { baseUrl: BASE })).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('reports a timeout as a timeout', async () => {
    vi.stubGlobal('fetch', async () => {
      const err = new Error('aborted');
      err.name = 'TimeoutError';
      throw err;
    });
    const err = await createPlacement(KEY, { baseUrl: BASE }).catch((e) => e);
    expect((err as PlacementCreateError).code).toBe('network_error');
    expect((err as PlacementCreateError).message).toMatch(/did not respond within/);
  });

  it('rejects a 200 that is not a placement', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ ok: true }));
    await expect(createPlacement(KEY, { baseUrl: BASE })).rejects.toMatchObject({
      code: 'unexpected',
    });
  });

  it('tolerates a null name and preserves a disabled placement', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        ...CREATED_BODY,
        placement: { ...CREATED_BODY.placement, name: null, enabled: false },
      }),
    );
    await expect(createPlacement(KEY, { baseUrl: BASE })).resolves.toMatchObject({
      name: null,
      enabled: false,
    });
  });
});

describe('ensureIntegrations', () => {
  it('creates nothing when the publisher already has placements', async () => {
    const root = scratch();
    const create = vi.fn();

    /* `ensureIntegrations` reports the integrations this project has already
       configured, filtered to the placements the key actually owns. Nothing
       comes from the `placements` argument alone -- a config file is not
       proof of ownership, so an integration the key does not own would not
       appear even if it were configured. */
    addIntegration(root, { id: 'home', target: 'vscode', label: 'Home', placementKey: 'home' });

    const result = await ensureIntegrations({
      projectRoot: root,
      publisherKey: KEY,
      placements: [{ id: 'a', key: 'home', name: 'Home', enabled: true, allowedAudienceId: null }],
      create: create as unknown as typeof createPlacement,
    });

    expect(create).not.toHaveBeenCalled();
    expect(result.created).toBeNull();
    expect(result.integrations.map((p) => p.placementKey)).toEqual(['home']);
  });

  it('creates the first placement and hands it straight to the editor', async () => {
    const root = scratch();
    const lines: string[] = [];

    const result = await ensureIntegrations({
      projectRoot: root,
      publisherKey: KEY,
      placements: [],
      write: (line) => lines.push(line),
      create: (async () => ({
        id: 'plc_1',
        key: 'home',
        name: 'Home',
        enabled: true,
        allowedAudienceId: null,
        created: true,
        publisherId: 'pub_123',
      })) as unknown as typeof createPlacement,
    });

    expect(result.created?.key).toBe('home');
    expect(result.integrations).toHaveLength(1);
    expect(result.integrations[0].placementKey).toBe('home');
    expect(result.integrations[0].slots[0].layout.size).toEqual({ width: 320, height: 100 });
    expect(lines.join('')).toMatch(/Created placement "home"/);
  });

  it('passes an explicitly requested placement through as the key to create', async () => {
    const create = vi.fn(async () => ({
      id: 'plc_2',
      key: 'sidebar',
      name: 'Sidebar',
      enabled: true,
      allowedAudienceId: null,
      created: true,
      publisherId: 'pub_123',
    }));

    await ensureIntegrations({
      projectRoot: scratch(),
      publisherKey: KEY,
      placements: [],
      write: () => {},
      placementKey: 'sidebar',
      create: create as unknown as typeof createPlacement,
    });

    expect(create).toHaveBeenCalledWith(KEY, { placementKey: 'sidebar' });
  });

  it('says "already exists" when the backend reports an idempotent retry', async () => {
    const lines: string[] = [];
    await ensureIntegrations({
      projectRoot: scratch(),
      publisherKey: KEY,
      placements: [],
      write: (line) => lines.push(line),
      create: (async () => ({
        id: 'plc_1',
        key: 'home',
        name: 'Home',
        enabled: true,
        allowedAudienceId: null,
        created: false,
        publisherId: 'pub_123',
      })) as unknown as typeof createPlacement,
    });
    expect(lines.join('')).toMatch(/already exists/);
  });

  it('gives each backend failure a distinct, actionable hint', async () => {
    const cases: Array<[string, RegExp]> = [
      ['invalid_key', /rejected.*clirevenue setup/i],
      ['forbidden', /did not belong to the publisher/i],
      ['invalid_request', /rejected the placement details/i],
      ['network_error', /could not be reached/i],
      ['unexpected', /could not be reached/i],
    ];

    for (const [code, hint] of cases) {
      const err = await ensureIntegrations({
        projectRoot: scratch(),
        publisherKey: KEY,
        placements: [],
        write: () => {},
        create: (async () => {
          throw new PlacementCreateError('failed', code as 'invalid_key');
        }) as unknown as typeof createPlacement,
      }).catch((e) => e as EditorError);

      expect(err).toBeInstanceOf(EditorError);
      expect(err.message).toBe('failed');
      expect(err.hint).toMatch(hint);
    }
  });

  it('tells the user how long a rate limit lasts', async () => {
    const err = await ensureIntegrations({
      projectRoot: scratch(),
      publisherKey: KEY,
      placements: [],
      write: () => {},
      create: (async () => {
        throw new PlacementCreateError('slow down', 'rate_limited', 3200);
      }) as unknown as typeof createPlacement,
    }).catch((e) => e as EditorError);

    expect(err.hint).toMatch(/Wait 4s/);
  });
});

describe('the editor creates the placement and still saves the geometry locally', () => {
  /**
 * The real `fetch`, captured before any stub is installed.
 *
 * The editor talks to the CLI process over loopback; stubbing that would mean
 * the save the test is trying to make never arrives, and the session waits
 * forever instead of failing.
 */
const realFetch = globalThis.fetch;

const stubApi = () => {
    const seen: Array<{ method: string; url: string; headerKey: unknown }> = [];
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith('http://127.0.0.1')) {
        return realFetch(input as never, init as never);
      }
      const headers = init?.headers as Record<string, string> | undefined;
      seen.push({ method: String(init?.method ?? 'GET'), url, headerKey: headers?.['x-clirevenue-publisher-key'] });
      if (url.endsWith('/cli/placements') && String(init?.method ?? 'GET') === 'GET') {
        // The publisher genuinely has no placements yet. The credential now
        // travels in the header, never in the URL.
        return jsonResponse({ publisherId: 'pub_123', placements: [] });
      }
      if (url.endsWith('/cli/placements')) {
        return jsonResponse(CREATED_BODY);
      }
      return new Response('', { status: 404 });
    });
    return seen;
  };

  beforeEach(() => {
    /* Intentionally empty: `stubApi` installs its own fetch stub and captures
       the real one from module scope. Stubbing here first would mean
       `stubApi` captured the stub and the loopback save would never be sent. */
  });

  it('creates, opens the browser editor, and writes the dragged size to the project config', async () => {
    const root = viteProject();
    const seen = stubApi();

    const outcome = await editor({
      cwd: root,
      write: () => {},
      env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
      openBrowser: (url) => {
        /* The editor URL already carries its token, so the page can drive its
           own session exactly as a real browser would. */
        const parsed = new URL(url);
        expect(parsed.hostname).toBe('127.0.0.1');
        void fetch(`${parsed.origin}/api/save`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: parsed.searchParams.get('token'),
            integrationId: 'home',
            slotId: 'slot-1',
            layout: {
              size: { width: 728, height: 90 },
              position: { anchor: 'bottom-center', offsetX: 0, offsetY: 24 },
            },
            container: '#ad-slot',
          }),
        });
      },
    });

    expect(outcome?.placementKey).toBe('home');

    /* One read, one create — and the credential never travelled in a URL. */
    const posts = seen.filter((call) => call.method === 'POST');
    expect(seen).toHaveLength(2);
    expect(posts).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.clirevenue.in/cli/placements');
    expect(seen[0].url).not.toContain('publisherKey=');
    expect(seen[0].headerKey).toBe(KEY);
    expect(seen[1].url).toBe('https://api.clirevenue.in/cli/placements');

    /* Geometry is the project's, not the backend's. */
    const config = readConfig(root);
    const saved = config.integrations.home?.slots['slot-1']?.layout;
    expect(saved?.size).toEqual({ width: 728, height: 90 });
    expect(saved?.position.anchor).toBe('bottom-center');
    expect(saved?.position.offsetY).toBe(24);
    expect(readFileSync(join(root, 'clirevenue.config.json'), 'utf8')).not.toContain(KEY);
  });

  it('stays bound to loopback, refuses the page without its token, and writes nothing on cancel', async () => {
    const root = viteProject();
    stubApi();

    const origin = await new Promise<string>((resolve) => {
      void editor({
        cwd: root,
        write: () => {},
        env: { VITE_CLIREVENUE_PUBLISHABLE_KEY: KEY },
        openBrowser: (url) => {
          const parsed = new URL(url);
          expect(parsed.protocol).toBe('http:');
          expect(parsed.hostname).toBe('127.0.0.1');
          const token = parsed.searchParams.get('token') ?? '';
          /* Reaching for the page without the token must fail: the editor is
             local, but "local" is not the same as unauthenticated. */
          void realFetch(`${parsed.origin}/editor`)
            .then((res) => expect(res.status).toBe(403))
            .then(() =>
              realFetch(`${parsed.origin}/api/cancel`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ token }),
              }),
            )
            .finally(() => resolve(parsed.origin));
        },
      });
    });

    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    /* Setup records the integration and its first slot at the SDK defaults
       before the editor opens, so the config legitimately exists here.
       What cancelling must guarantee is that the editor itself wrote
       nothing -- the slot is still exactly the default it was created with,
       not a half-dragged position. */
    const config = readConfig(root);
    const slot = config.integrations.home?.slots['slot-1'];
    expect(slot).toBeDefined();
    expect(slot?.layout).toEqual({ size: { width: 320, height: 100 }, position: { anchor: 'center', offsetX: 0, offsetY: 0 } });
  });
});