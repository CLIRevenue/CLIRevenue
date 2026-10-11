import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { normalizeLayout, validateLayout, type AdLayout } from '../project/geometry.js';
import { saveSlot, loadLayout, ConfigError } from '../project/config.js';
import { renderEditorPage, type EditorIntegration, type EditorSlot } from './page.js';

/**
 * The local server behind `clirevenue editor`.
 *
 * A terminal cannot render a draggable rectangle, so the editor is a real
 * browser page served from loopback and opened with the user's default
 * browser. Three properties are load-bearing and each is enforced here rather
 * than assumed:
 *
 *   - **Loopback only.** The server binds to 127.0.0.1, never 0.0.0.0. The
 *     page has access to the project's ad configuration; it must not be
 *     reachable from the network.
 *   - **Unguessable per-session token.** Every `/api/*` request must carry
 *     the token printed in the URL. Without it, any web page the user visits
 *     in the same session could POST to localhost and rewrite the project's
 *     ad geometry. The token is compared in constant time.
 *   - **No credentials in the page.** The browser receives placement keys,
 *     labels and geometry. It never receives the publisher key, and it never
 *     writes files — saving posts to this process, which owns the disk.
 */

export interface EditorOptions {
  projectRoot: string;
  /** Integrations configured in this project, each with its slots. */
  integrations: EditorIntegration[];
  /** Which integration opens first. */
  selectedId?: string | null;
  hostWidth?: number;
  hostHeight?: number;
  /** Injected in tests. */
  randomBytes?: () => Buffer;
}

export interface EditorSession {
  url: string;
  port: number;
  token: string;
  /** The project root this session writes into, so callers can report it. */
  projectRoot: string;
  /** Resolves 'saved' or 'cancelled'. */
  result: Promise<'saved' | 'cancelled'>;
  close: () => Promise<void>;
  server: Server;
}

export class EditorError extends Error {
  constructor(message: string, public readonly hint?: string) {
    super(message);
    this.name = 'EditorError';
  }
}

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      /* A hard cap. The legitimate body is a few hundred bytes; anything
         approaching this is not a placement save. */
      if (size > MAX_BODY_BYTES) {
        reject(new EditorError('Request body too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res: ServerResponse, status: number, payload: unknown): void => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

function tokenMatches(expected: string, provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

export async function startEditor(options: EditorOptions): Promise<EditorSession> {
  if (options.integrations.length === 0) {
    throw new EditorError(
      'This project has no CLIRevenue integrations yet, so there is nothing to position.',
      'Run `npx clirevenue setup`, or `npx clirevenue integrations add` to add one.',
    );
  }
  if (!options.integrations.some((entry) => entry.slots.length > 0)) {
    throw new EditorError(
      'This project has integrations but no ad slots to position.',
      'Add one with `npx clirevenue add-slot`, then run the editor again.',
    );
  }

  const token = randomBytesHex(options.randomBytes);
  let settle: (value: 'saved' | 'cancelled') => void = () => {};
  const result = new Promise<'saved' | 'cancelled'>((resolve) => {
    settle = resolve;
  });

  let settled = false;
  const finish = (value: 'saved' | 'cancelled'): void => {
    if (settled) return;
    settled = true;
    settle(value);
    setTimeout(() => server.close(), 50).unref?.();
  };

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      json(res, 500, { error: 'Internal editor error.' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const queryToken = url.searchParams.get('token');

    if (url.pathname === '/favicon.ico') {
      res.writeHead(204).end();
      return;
    }

    if (url.pathname === '/' || url.pathname === '/editor') {
      /* The page itself requires the token too: an unauthenticated GET must
         not hand out the placement list. */
      if (!tokenMatches(token, queryToken)) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end('Invalid token.');
        return;
      }
      const html = renderEditorPage({
        token,
        integrations: options.integrations,
        selectedId: options.selectedId ?? options.integrations[0]?.id ?? null,
        hostWidth: options.hostWidth ?? 1280,
        hostHeight: options.hostHeight ?? 720,
      });
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': Buffer.byteLength(html),
        'cache-control': 'no-store',
      });
      res.end(html);
      return;
    }

    if (url.pathname === '/api/save') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        return json(res, 400, { error: 'Invalid request body.' });
      }
      if (!tokenMatches(token, body.token)) {
        return json(res, 403, { error: 'Invalid token.' });
      }

      const integrationId =
        typeof body.integrationId === 'string' ? body.integrationId.trim() : '';
      const slotId = typeof body.slotId === 'string' ? body.slotId.trim() : '';
      if (!integrationId || !slotId) {
        return json(res, 400, { error: 'An integration and a slot are required.' });
      }

      /* The browser may only save slots this session was actually opened
         with. Otherwise a crafted page that somehow got the token could invent
         an integration or a slot id and write geometry into the user's file —
         so the pair is matched against the session's own list, not against
         whatever is on disk right now. */
      const known = options.integrations.some(
        (entry) => entry.id === integrationId && entry.slots.some((s) => s.slotId === slotId),
      );
      if (!known) {
        return json(res, 400, { error: 'That slot is not available in this editor session.' });
      }

      /* Validate the raw request before normalising it. Normalising first
         would silently clamp an out-of-range size, so a user who asked for a
         5000px-wide ad would have 1280 stored under their name and never be
         told. Rejecting is the honest answer: the editor is meant to control
         the real configuration, and a value the user did not choose is not
         the value they chose. */
      const requested = body.layout as Partial<AdLayout> | null | undefined;
      const problems = validateLayout(requested);
      if (problems.length > 0) {
        return json(res, 400, { error: problems.join(' ') });
      }

      const layout = normalizeLayout(requested);
      const container = typeof body.container === 'string' ? body.container.trim() : undefined;

      try {
        const saved = saveSlot(options.projectRoot, { integrationId, slotId, layout, container });
        json(res, 200, { ok: true, path: saved.path, changed: saved.changed });
        finish('saved');
        return;
      } catch (err) {
        const message =
          err instanceof ConfigError ? err.message : 'Could not write clirevenue.config.json.';
        return json(res, 400, { error: message });
      }
    }

    if (url.pathname === '/api/cancel') {
      if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' });
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse((await readBody(req)) || '{}');
      } catch {
        body = {};
      }
      if (!tokenMatches(token, body.token)) {
        return json(res, 403, { error: 'Invalid token.' });
      }
      json(res, 200, { ok: true });
      finish('cancelled');
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found.');
  }

  const port = await listenLoopback(server);
  const address = `http://127.0.0.1:${port}/editor?token=${token}`;

  return {
    url: address,
    port,
    token,
    projectRoot: options.projectRoot,
    result,
    server,
    close: () =>
      new Promise<void>((resolve) => {
        if (!server.listening) return resolve();
        server.close(() => resolve());
      }),
  };
}

function randomBytesHex(rng?: () => Buffer): string {
  const buffer = rng ? rng() : randomBytes(24);
  return buffer.toString('hex');
}

/**
 * Bind to loopback on an arbitrary free port.
 *
 * Port 0 lets the OS choose, which avoids the "address already in use" race
 * when two editors run at once. Binding to `127.0.0.1` explicitly is the
 * security-relevant half of this and is never configurable.
 */
export function listenLoopback(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening);
      reject(
        new EditorError(
          `Could not start the local placement editor: ${err.message}`,
          'A free TCP port on 127.0.0.1 is required. Close other local servers and try again.',
        ),
      );
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new EditorError('Local editor did not bind to a TCP port.'));
        return;
      }
      resolve(address.port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(0, '127.0.0.1');
  });
}

/** The layout the editor would open with for a given placement. */
export function initialLayoutFor(
  projectRoot: string,
  integrationId: string,
  slotId?: string,
): AdLayout {
  return loadLayout(projectRoot, integrationId, slotId);
}
