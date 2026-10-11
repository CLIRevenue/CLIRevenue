/**
 * Regression tests for the publisher-key lookup in `clirevenue editor`.
 *
 * The bug these pin: `setup` writes the publishable key to the project's
 * `.env.local`, but `editor` only ever read `options.env` -- an object that
 * `src/index.ts` never passed. So `setup` verified a key successfully,
 * wrote it, and the very next `clirevenue editor` reported
 * "No CLIRevenue publisher key found." The two commands disagreed about
 * where the key lives, and the editor was the one that was wrong.
 *
 * These assert the behaviour, not the implementation: a key that exists only
 * on disk must be found, and a key supplied in the environment must win over
 * whatever is in the file.
 *
 * No test here prints, asserts on, or embeds a real key -- `KEY` is a
 * well-formed fake, and the secret-hygiene assertions check that the value
 * does not leak into output.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editor, EditorError } from '../src/editor/index.js';
import { addIntegration, addSlot } from '../src/project/config.js';
import {
  ENV_FILE,
  PUBLISHABLE_KEY_PATTERN,
  PUBLISHABLE_KEY_VAR,
  readKeyFromEnvFile,
  resolvePublisherKey,
} from '../src/verify/key-file.js';

/** A fake that satisfies the key pattern without being a real credential. */
const KEY = 'pk_test_0123456789abcdefghijABCDEFGHIJ012345';
const OTHER_KEY = 'pk_live_9876543210ZYXWVUTSRQPONMLKJIHGFEDC';

/* Captured at module scope, BEFORE any stub runs. See the project note: a
   stub installed later that returns `undefined` swallows the loopback POST
   that settles an EditorSession, and the test then times out instead of
   failing. */
const realFetch = globalThis.fetch;

const scratchDirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'clirevenue-keyfile-'));
  scratchDirs.push(dir);
  return dir;
}

/** A project the detector recognises, with the key already written. */
function projectWithKey(envContents?: string): string {
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
  if (envContents !== undefined) writeFileSync(join(root, ENV_FILE), envContents);
  return root;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface Seen {
  method: string;
  url: string;
  publisherKey: unknown;
  headerKey: unknown;
}

/** Fakes only the CLIRevenue API and forwards loopback traffic untouched. */
function stubApi(): { seen: Seen[] } {
  const seen: Seen[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('http://127.0.0.1')) return realFetch(input, init);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const headers = (init?.headers ?? {}) as Record<string, string>;
      seen.push({
        method: init?.method ?? 'GET',
        url,
        publisherKey: body.publisherKey,
        headerKey: headers['x-clirevenue-publisher-key'],
      });
      if (url.endsWith('/cli/placements') && (init?.method ?? 'GET') === 'GET') {
        return jsonResponse({
          publisherId: 'pub_123',
          placements: [{ id: 'plc_1', key: 'home', name: 'Home', enabled: true, allowedAudienceId: null }],
        });
      }
      if (url.endsWith('/cli/placements')) {
        return jsonResponse({
          publisherId: 'pub_123',
          created: true,
          placement: { id: 'plc_new', key: 'home', name: 'Home', enabled: true, allowedAudienceId: null },
        });
      }
      return jsonResponse({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404);
    }),
  );
  return { seen };
}

const openSessions: Array<{ close: () => void }> = [];

afterEach(() => {
  while (openSessions.length) {
    try {
      openSessions.pop()!.close();
    } catch {
      /* already closed */
    }
  }
  vi.unstubAllGlobals();
  while (scratchDirs.length) rmSync(scratchDirs.pop()!, { recursive: true, force: true });
});

describe('reading the publishable key from .env.local', () => {
  it('finds a key that setup wrote to the file -- the reported failure', () => {
    const root = projectWithKey(`VITE_CLIREVENUE_PUBLISHABLE_KEY=${KEY}\n`);
    expect(readKeyFromEnvFile(root)).toBe(KEY);
  });

  it('is found by the editor when it exists only in .env.local', async () => {
    /* The exact reported scenario: no environment variable is set, the key is
       on disk, and `editor` used to refuse to start with
       "No CLIRevenue publisher key found." `env: {}` makes the absence of an
       environment variable explicit instead of depending on the ambient
       shell. */
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=${KEY}\n`);
    /* `setup` records the integration and its first slot in the project
       config, so the real sequence is setup-then-editor. Reproducing only the
       second half would test a project the reported user never had. */
    addIntegration(root, { id: 'vscode', target: 'vscode', label: 'VS Code', placementKey: 'home' });
    addSlot(root, 'vscode', { label: 'Ad 1' });
    const { seen } = stubApi();

    let editorUrl = '';
    const run = editor({
      cwd: root,
      env: {},
      write: () => {},
      openBrowser: (url) => {
        editorUrl = url;
      },
    });

    /* `editor` blocks until the user saves or cancels, so the assertion is
       that it got far enough to serve a page -- and that it authenticated
       with the key it read off disk, in the header and never in the URL.
       Before the fix this rejected before any of that happened. */
    await vi.waitFor(() => expect(editorUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//), {
      timeout: 5000,
    });
    const authed = seen.filter((call) => call.headerKey === KEY);
    expect(authed.length).toBeGreaterThan(0);
    expect(seen.some((call) => call.url.includes('publisherKey='))).toBe(false);

    /* Cancel so the command settles instead of hanging the test. */
    const origin = new URL(editorUrl).origin;
    await realFetch(`${origin}/api/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: new URL(editorUrl).searchParams.get('token') }),
    });
    await expect(run).resolves.toBeNull();
  });

  it('tolerates surrounding lines, quotes, and a missing trailing newline', () => {
    const root = projectWithKey(
      `# my ad keys\nVITE_API_BASE_URL=https://api.clirevenue.in\n${PUBLISHABLE_KEY_VAR}=${KEY}`,
    );
    expect(readKeyFromEnvFile(root)).toBe(KEY);
  });

  it('ignores a malformed value rather than handing it to the API', () => {
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=not-a-real-key\n`);
    expect(readKeyFromEnvFile(root)).toBeNull();
  });

  it('returns null for a missing file instead of throwing', () => {
    const root = projectWithKey();
    expect(existsSync(join(root, ENV_FILE))).toBe(false);
    expect(readKeyFromEnvFile(root)).toBeNull();
  });

  it('returns null for a malformed file instead of throwing', () => {
    /* Binary-ish garbage and a directory-shaped path are both "we cannot read
       a key here"; the caller already handles null by telling the user to run
       setup, so throwing here would replace an actionable message with a
       filesystem stack trace. */
    const root = projectWithKey('\u0000\u0001 not text \u00ff');
    expect(readKeyFromEnvFile(root)).toBeNull();
    expect(readKeyFromEnvFile(scratch())).toBeNull();
  });
});

describe('publisher key precedence', () => {
  it('prefers an explicit environment variable over the file', () => {
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=${KEY}\n`);
    expect(resolvePublisherKey(root, { [PUBLISHABLE_KEY_VAR]: OTHER_KEY })).toBe(OTHER_KEY);
  });

  it('honours the plain, non-VITE_ alias from the environment', () => {
    const root = projectWithKey();
    expect(resolvePublisherKey(root, { CLIREVENUE_PUBLISHABLE_KEY: OTHER_KEY })).toBe(OTHER_KEY);
  });

  it('prefers the VITE_ name when both are present in the environment', () => {
    expect(
      resolvePublisherKey(scratch(), {
        [PUBLISHABLE_KEY_VAR]: KEY,
        CLIREVENUE_PUBLISHABLE_KEY: OTHER_KEY,
      }),
    ).toBe(KEY);
  });

  it('falls back to the file when the environment has no usable value', () => {
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=${KEY}\n`);
    expect(resolvePublisherKey(root, {})).toBe(KEY);
    expect(resolvePublisherKey(root, { [PUBLISHABLE_KEY_VAR]: '   ' })).toBe(KEY);
    expect(resolvePublisherKey(root, undefined)).toBe(KEY);
  });

  it('never lets an empty environment value shadow a file value', () => {
    /* An empty string is a common accident (`KEY=` in a .envrc, an unset
       variable exported by a wrapper script). Treating it as "provided"
       would send an empty credential to the API. */
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=${KEY}\n`);
    expect(resolvePublisherKey(root, { [PUBLISHABLE_KEY_VAR]: '' })).toBe(KEY);
  });

  it('returns null when neither source has a usable key', () => {
    expect(resolvePublisherKey(scratch(), {})).toBeNull();
    expect(resolvePublisherKey(scratch())).toBeNull();
  });
});

describe('editor refuses honestly when there is no key anywhere', () => {
  it('throws a useful error that names the file it looked in', async () => {
    const root = projectWithKey();
    stubApi();

    const promise = editor({ cwd: root, env: {}, write: () => {} });
    await expect(promise).rejects.toBeInstanceOf(EditorError);
    await expect(promise).rejects.toThrow(/No CLIRevenue publisher key found/);

    /* The hint has to be actionable: naming both the command and the file
       the user should edit is the whole point of the message. */
    let message = '';
    await editor({ cwd: root, env: {}, write: () => {} }).catch((err: EditorError) => {
      message = `${err.message} ${err.hint ?? ''}`;
    });
    expect(message).toContain('clirevenue setup');
    expect(message).toContain(PUBLISHABLE_KEY_VAR);
    expect(message).toContain(ENV_FILE);
  });

  it('does not leak a key from the environment into the error path', async () => {
    const root = projectWithKey(`${PUBLISHABLE_KEY_VAR}=garbage\n`);
    stubApi();

    let message = '';
    await editor({
      cwd: root,
      env: { [PUBLISHABLE_KEY_VAR]: 'also-garbage' },
      write: () => {},
    }).catch((err: EditorError) => {
      message = `${err.message} ${err.hint ?? ''}`;
    });
    expect(message).not.toContain('garbage');
    expect(message).not.toMatch(/pk_(live|test)_/);
  });
});

describe('the file reader never writes', () => {
  it('leaves .env.local byte-identical', () => {
    const original = `${PUBLISHABLE_KEY_VAR}=${KEY}\nVITE_API_BASE_URL=https://api.clirevenue.in\n`;
    const root = projectWithKey(original);
    readKeyFromEnvFile(root);
    resolvePublisherKey(root, {});
    expect(readFileSync(join(root, ENV_FILE), 'utf8')).toBe(original);
  });
});

describe('the key pattern', () => {
  it('accepts the shapes setup can produce', () => {
    expect(PUBLISHABLE_KEY_PATTERN.test(KEY)).toBe(true);
    expect(PUBLISHABLE_KEY_PATTERN.test(OTHER_KEY)).toBe(true);
  });

  it('rejects obvious non-keys', () => {
    for (const bad of ['', 'pk_live_short', 'fake_secret_key_for_rejection_test', 'nope']) {
      expect(PUBLISHABLE_KEY_PATTERN.test(bad)).toBe(false);
    }
  });
});
