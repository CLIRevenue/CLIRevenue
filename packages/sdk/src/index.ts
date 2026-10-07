/**
 * CLIRevenue SDK.
 *
 * PRIVACY (this is a design constraint, not a policy statement):
 *   - no cookies, and nothing that behaves like one
 *   - no cross-site identifier, and no fingerprinting
 *   - no PII: the only context sent is the current URL and the referrer
 *   - sessionStorage is used only to hold the offline retry queue, and only
 *     for the duration of the browsing session
 *   - the publisher key is a publishable capability and is safe in a browser.
 *     SUPABASE_SERVICE_ROLE_KEY and any other server secret must never appear
 *     in this bundle; there is no code path here that reads one.
 *
 * The only identity the SDK keeps is an in-memory session id, generated per
 * page load and never persisted or transmitted as an identifier across sites.
 * It exists so a click can be tied to the impression that preceded it in this
 * page, and it is discarded when the page goes away.
 */
import { CLIRevenueConfigError, CLIRevenueHttpError } from "./errors.ts";
import { requestJson, type FetchLike } from "./http.ts";
import { createPlacementCache, CACHE_TTL_MS } from "./cache.ts";
import { createEventQueue, type EventQueue, type StorageLike } from "./queue.ts";
import { createViewabilityGate, sendBeacon as defaultSendBeacon } from "./viewability.ts";
import {
  AD_ANCHORS,
  AD_SIZE_LIMITS,
  adBoxStyle,
  normalizeAdPosition,
  normalizeAdSize,
  resolveAdBox,
  type AdAnchor,
  type AdBox,
  type AdContainer,
  type AdLayoutInput,
  type AdPosition,
  type AdSize,
} from "./layout.ts";

/**
 * The presentation API. Re-exported from the package root so a publisher can
 * type-check their own configuration against the same bounds the SDK enforces,
 * and so a publisher with their own visual system can reuse the exact geometry
 * the SDK would have applied instead of reimplementing it.
 */
export {
  AD_ANCHORS,
  AD_SIZE_LIMITS,
  adBoxStyle,
  normalizeAdPosition,
  normalizeAdSize,
  resolveAdBox,
};
export type { AdAnchor, AdBox, AdContainer, AdLayoutInput, AdPosition, AdSize };

/** Read the host's content box. Zero or unavailable means "not measured yet". */
function measureHost(root: Element): AdContainer {
  const el = root as HTMLElement;
  const width = el.clientWidth || el.getBoundingClientRect().width || 0;
  const height = el.clientHeight || el.getBoundingClientRect().height || 0;
  return { width, height };
}

export const SDK_VERSION = "1.0.3";

/**
 * The only telemetry events this SDK is able to report.
 *
 * The server catalogues twelve. These three are the ones a browser is the sole
 * authority for, and they are an observation, never a claim about money or
 * accounting. The other nine are derived server-side from the delivery,
 * impression, interaction and reward transactions, which is why there is no
 * method here to assert any of them.
 */
export type TelemetryEventName = "session_started" | "page_viewed" | "ad_rendered";
export const SDK_VERSION_HEADER = "X-CLIRevenue-SDK-Version";
export const DEFAULT_BASE_URL = "https://api.clirevenue.in";

/** A key is a capability. Reject an obviously wrong one before any network. */
const KEY_RE = /^pk_(live|test)_[A-Za-z0-9_-]{32,}$/;

export type Ad = {
  id: string;
  name: string | null;
  headline: string;
  description: string | null;
  cta: string | null;
  audience: string;
  landingUrl: string | null;
};

export type ServedAd = {
  requestId: string;
  ad: Ad;
  /** Opaque, server-signed. Pass back verbatim; never construct one. */
  impressionToken: string;
  expiresAt: string;
};

export type CLIRevenueOptions = {
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: FetchLike;
  storage?: StorageLike | null;
  /** Injected for tests; defaults to the real IntersectionObserver. */
  ObserverImpl?: Parameters<typeof createViewabilityGate>[0]["ObserverImpl"];
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  cacheTtlMs?: number;
  sendBeaconImpl?: (url: string, data: Blob) => boolean;
  /**
   * Emit page lifecycle telemetry. Defaults to true.
   *
   * Telemetry is what turns a set of counters into a lifecycle an advertiser
   * can read: which session asked, which creative was chosen, when the ad
   * became viewable, when the server accepted it, when a reward came into
   * existence. Turning it off loses all of that and changes no money, which is
   * why it is a publisher's choice rather than an internal detail.
   *
   * The delivery, impression and click calls are unaffected either way: those
   * are the ad pipeline and are always sent.
   */
  telemetry?: boolean;
};

/** The ambient IntersectionObserver, typed the way the viewability gate wants it. */
type ObserverImpl = NonNullable<Parameters<typeof createViewabilityGate>[0]["ObserverImpl"]>;

function ambientObserver(): ObserverImpl | undefined {
  const ctor = globalThis.IntersectionObserver;
  return typeof ctor === "function" ? (ctor as unknown as ObserverImpl) : undefined;
}

/**
 * Identifier for a logical event.
 *
 * Always canonical UUID text, because the gateway stores `requestId` in a uuid
 * column and rejects anything that is not 8-4-4-4-12 hex. `crypto.randomUUID`
 * only exists in a secure context, so the LAN-accessible plain-HTTP dev origin
 * (`vite --host 0.0.0.0` over `http://<lan-ip>:5173`) would otherwise mint a
 * 32-character hex string with no dashes and every deliver would 400.
 */
function randomId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class CLIRevenue {
  readonly version = SDK_VERSION;
  private readonly publisherKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: FetchLike;
  private readonly cache: ReturnType<typeof createPlacementCache<ServedAd | null>>;
  private readonly queue: EventQueue;
  private readonly gate: ReturnType<typeof createViewabilityGate> | null;
  private readonly sendBeaconImpl?: (url: string, data: Blob) => boolean;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly random: () => number;

  /** In-memory only. Ties a click to this page's impression. */
  private readonly sessionId = randomId();
  private onlineHandlerAttached = false;

  /**
   * Whether this instance has already opened a telemetry session.
   *
   * Set on first use rather than in the constructor. A publisher page that
   * loads the SDK but never fills a slot should produce no telemetry at all,
   * and `init()` should stay free of side effects -- a constructor that fires
   * a network request makes the SDK impossible to import for its types alone.
   */
  private telemetryStarted = false;

  /** Whether page lifecycle telemetry is on. See the `telemetry` option. */
  private readonly telemetryEnabled: boolean;
  private onlineHandler?: () => void;
  private disposers = new Set<() => void>();

  /**
   * In-flight deliveries, keyed by placement key, so that concurrent callers
   * share one HTTP request instead of racing to start their own. Entries
   * remove themselves as soon as the request settles.
   */
  private readonly inFlight = new Map<string, Promise<ServedAd | null>>();

  constructor(publisherKey: string, options: CLIRevenueOptions = {}) {
    if (typeof publisherKey !== "string" || !KEY_RE.test(publisherKey)) {
      throw new CLIRevenueConfigError(
        "init(publisherKey) requires a publishable key of the form pk_live_... or pk_test_...",
      );
    }
    this.publisherKey = publisherKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetchImpl ?? ((globalThis.fetch as unknown as FetchLike) ?? (() => {
      throw new CLIRevenueConfigError("No fetch implementation is available.");
    }));
    this.random = options.random ?? Math.random;
    this.sleep = options.sleep;
    this.cache = createPlacementCache<ServedAd | null>({
      ttlMs: options.cacheTtlMs ?? CACHE_TTL_MS,
      now: options.now,
    });
    this.queue = createEventQueue({ storage: options.storage });
    // The gate is created from the ambient IntersectionObserver unless a test
    // injects one. Defaulting to null here would silently disable every
    // impression in a real browser: render() would take the "no observer"
    // branch and record nothing, while the injected-observer test suite stayed
    // green. A browser always has IntersectionObserver; anything that does not
    // must say so rather than pretend the impression happened.
    const observerImpl = options.ObserverImpl ?? ambientObserver();
    this.gate = observerImpl ? createViewabilityGate({ ObserverImpl: observerImpl }) : null;
    this.sendBeaconImpl = options.sendBeaconImpl;
    this.telemetryEnabled = options.telemetry !== false;
    this.attachOnlineFlush();
    this.telemetryStarted = false;
  }

  /* ---------------- delivery ---------------- */

  /**
   * Request an ad for a placement.
   *
   * Returns null when the server answers 204, which is the normal no-fill
   * case: nothing eligible, budget exhausted, or the campaign is not live. A
   * no-fill is never an exception, and never a retry.
   */
  async getAd(placementKey: string): Promise<ServedAd | null> {
    if (typeof placementKey !== "string" || !placementKey.trim()) {
      throw new CLIRevenueConfigError("getAd(placement) requires a non-empty placement key.");
    }
    this.startTelemetrySession();
    const cached = this.cache.get(placementKey);
    if (cached !== undefined) return cached;

    /* Single-flight.
     *
     * A second caller that arrives while this placement is still being
     * delivered joins the request already in flight rather than starting a
     * parallel one. The 60 second cache cannot cover this window on its own:
     * it is only written once the response lands, so a burst of calls in the
     * same tick would each observe an empty cache and each issue its own POST.
     *
     * This is invisible to the delivery pipeline. One call, one idempotency
     * key, one retry lifecycle -- shared by every caller -- so a React
     * StrictMode double-mount, a re-render, or two widgets reading the same
     * placement costs one delivery rather than several. In a production build
     * nothing changes: a single caller still performs exactly one request.
     *
     * Keyed per placement, so two placements never share a request. The entry
     * is removed as soon as the request settles either way, so a failure never
     * poisons later calls -- they start a fresh request with a fresh
     * idempotency key, exactly as they did before. */
    const existing = this.inFlight.get(placementKey);
    if (existing) return existing;

    const pending = this.deliver(placementKey).finally(() => {
      this.inFlight.delete(placementKey);
    });
    this.inFlight.set(placementKey, pending);
    return pending;
  }

  /**
   * Perform the delivery request for a placement and cache the outcome.
   *
   * Split out from getAd so the single-flight bookkeeping stays readable, and
   * so there is exactly one place that mints the request id and the
   * idempotency key for a delivery.
   */
  private async deliver(placementKey: string): Promise<ServedAd | null> {
    // One idempotency key per logical delivery request, reused across retries.
    const result = await requestJson<ServedAd>({
      url: `${this.baseUrl}/ads/deliver`,
      method: "POST",
      headers: this.headers(),
      body: {
        publisherKey: this.publisherKey,
        placementKey,
        // The only context permitted. No PII, no identifiers.
        url: safeLocationUrl(),
        referrer: safeReferrer(),
        requestId: randomId(),
        // Lets the server put this delivery's lifecycle events in the same
        // session as the rest of this page load. It is the in-memory session
        // id below: generated per page load, never persisted, never an
        // identifier that follows the reader anywhere.
        sessionId: this.sessionId,
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      idempotencyKey: randomId(),
      sleep: this.sleep,
      random: this.random,
    });

    const served = result.data ?? null;
    this.cache.set(placementKey, served);
    return served;
  }

  /* ---------------- rendering ---------------- */

  /**
   * Render an ad into `selector` and record an impression only once it has
   * been genuinely viewable.
   *
   * A missing selector is a configuration error and throws immediately rather
   * than silently doing nothing.
   */
  async render(
    placementKey: string,
    selector: string,
    layout?: AdLayoutInput | null,
  ): Promise<{
    served: ServedAd | null;
    dispose(): void;
  }> {
    if (typeof selector !== "string" || !selector.trim()) {
      throw new CLIRevenueConfigError("render() requires a non-empty CSS selector.");
    }
    this.startTelemetrySession();
    const root = globalThis.document?.querySelector(selector);
    if (!root) {
      throw new CLIRevenueConfigError(
        `render() could not find an element matching "${selector}".`,
      );
    }

    const served = await this.getAd(placementKey);
    if (!served) {
      // No fill: render nothing, record nothing. Not an error.
      return { served: null, dispose: () => {} };
    }

    const node = globalThis.document!.createElement("a");
    node.href = served.ad.landingUrl ?? "#";
    node.textContent = served.ad.headline;
    node.setAttribute("data-clirevenue-request-id", served.requestId);
    node.addEventListener("click", () => {
      void this.recordClick(served).catch(() => {
        /* a lost click report must not break navigation */
      });
    });

    /* An absolutely positioned ad is contained by its host, so the host has to
       establish a containing block. We only do that when the host is `static`
       (i.e. unpositioned), and we remember what it was so dispose() can put it
       back. Nothing here can position the ad outside the host it was given. */
    const style = (node as HTMLElement).style;
    const hostStyle = (root as HTMLElement).style;
    const hostPositionWasSet = hostStyle.position !== "";
    const hostPositionBefore = hostStyle.position;
    if (!hostPositionWasSet && globalThis.getComputedStyle?.(root).position === "static") {
      hostStyle.position = "relative";
    }

    /* One place that reads the host and writes the ad, so the resize path and
       the first paint cannot disagree. */
    const applyBox = () => {
      const box = resolveAdBox(layout, measureHost(root));
      const next = adBoxStyle(box) as {
        position: string;
        width: string;
        height: string;
        left: string;
        top: string;
      };
      style.position = next.position;
      style.width = next.width;
      style.height = next.height;
      style.left = next.left;
      style.top = next.top;
    };
    applyBox();

    /* Re-contain when the host changes size. rAF-gated so a resize drag costs
       one layout per frame at most, and disposed with the ad. */
    let frame = 0;
    const ResizeObserverImpl = globalThis.ResizeObserver;
    const resizeObserver =
      typeof ResizeObserverImpl === "function"
        ? new ResizeObserverImpl(() => {
            if (frame) return;
            frame = globalThis.requestAnimationFrame(() => {
              frame = 0;
              applyBox();
            });
          })
        : null;
    resizeObserver?.observe(root);

    root.appendChild(node);

    /* The ad is now in the document, which is exactly what "rendered" means.
       It precedes the impression in the lifecycle: the impression is only
       earned if the viewability gate later fires. Reported after the append,
       not before, so the event cannot claim a render that never happened.
       Best-effort: a lost render report must not stop the ad from working. */
    void this.recordRendered(served, placementKey);

    const stopViewability = this.watchViewability(served, root);
    let disposed = false;
    return {
      served,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        stopViewability();
        resizeObserver?.disconnect();
        if (frame) {
          globalThis.cancelAnimationFrame(frame);
          frame = 0;
        }
        if (!hostPositionWasSet) hostStyle.position = hostPositionBefore;
      },
    };
  }

  /**
   * Record the impression for `served` once `element` has been genuinely
   * viewable: at least 50% of its area on screen, continuously, for one
   * second. Returns a disposer that cancels a still-pending impression.
   *
   * This is the entry point for custom rendering. `render()` builds its own
   * anchor; a publisher with an existing visual system keeps its own markup
   * and calls this instead, so the viewability rule stays in one place and a
   * hand-rolled "it was on screen" boolean cannot leak back in.
   *
   * Records nothing when no IntersectionObserver exists, and says so.
   */
  watchViewability(served: ServedAd, element: Element): () => void {
    if (!this.gate) {
      console.warn(
        "[clirevenue] IntersectionObserver unavailable; no impression will be recorded.",
      );
      return () => {};
    }
    const dispose = this.gate(element, () => {
      void this.recordImpression(served);
    });
    this.disposers.add(dispose);
    return () => {
      dispose();
      this.disposers.delete(dispose);
    };
  }

  /* ---------------- tracking ---------------- */

  /** Record the impression for a served ad. Idempotent across retries. */
  async recordImpression(served: ServedAd, opts: { beacon?: boolean } = {}): Promise<void> {
    const body = {
      publisherKey: this.publisherKey,
      requestId: served.requestId,
      impressionToken: served.impressionToken,
      sessionId: this.sessionId,
      idempotencyKey: randomId(),
      cliIntegration: `clirevenue-sdk@${SDK_VERSION}`,
    };
    const headers = this.headers();

    if (opts.beacon) {
      const ok = defaultSendBeacon(
        `${this.baseUrl}/ads/impression`,
        body,
        this.sendBeaconImpl,
      );
      if (ok) return;
      // Beacon refused: fall through to a normal request rather than assume
      // the impression was recorded.
    }

    try {
      await requestJson({
        url: `${this.baseUrl}/ads/impression`,
        method: "POST",
        headers,
        body,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        // Stable for this logical impression across every retry.
        idempotencyKey: body.idempotencyKey,
        sleep: this.sleep,
        random: this.random,
      });
    } catch (err) {
      // Queue for a later flush rather than dropping the event. A 4xx is a
      // permanent rejection and is not worth retrying later.
      if (err instanceof CLIRevenueHttpError && err.status < 500) throw err;
      this.queue.enqueue({
        path: "/ads/impression",
        body,
        idempotencyKey: body.idempotencyKey,
        queuedAt: Date.now(),
      });
    }
  }

  /**
   * Record the click for a served ad.
   *
   * Public because a publisher with a custom visual system does not use
   * `render()` and still has to report clicks through the SDK: the frontend
   * must never construct the click payload itself, and the campaign behind a
   * click is resolved server-side from the serve record, never from anything
   * the page supplies. Fire-and-forget is the intended use; a lost click
   * report must not interrupt navigation to the landing URL.
   *
   * The request is sent with `keepalive`. A click is by definition followed
   * immediately by navigation, and a normal fetch is cancelled when the
   * document unloads, so without it every real click-through would be lost
   * exactly when it matters. The body is a few hundred bytes, far below the
   * 64 KB keepalive ceiling.
   */
  async recordClick(served: ServedAd): Promise<void> {
    const idempotencyKey = randomId();
    await requestJson({
      url: `${this.baseUrl}/ads/click`,
      method: "POST",
      headers: this.headers(),
      body: {
        publisherKey: this.publisherKey,
        requestId: served.requestId,
        impressionToken: served.impressionToken,
        idempotencyKey,
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      idempotencyKey,
      beacon: true,
      sleep: this.sleep,
      random: this.random,
    });
  }

  /**
   * Record a conversion attributed to a served ad.
   *
   * Requires the requestId returned by getAd. A missing or non-string
   * requestId is a configuration error and throws: silently ignoring it would
   * mean a publisher believes they are recording conversions that are not
   * being recorded at all.
   */
  async trackConversion(requestId: string): Promise<void> {
    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new CLIRevenueConfigError(
        "trackConversion(requestId) requires the requestId returned by getAd().",
      );
    }
    const cached = this.findServed(requestId);
    if (!cached) {
      throw new CLIRevenueConfigError(
        `trackConversion: no served ad is known for requestId "${requestId}". ` +
        "Call getAd() and keep the returned requestId.",
      );
    }
    const idempotencyKey = randomId();
    await requestJson({
      url: `${this.baseUrl}/ads/conversion`,
      method: "POST",
      headers: this.headers(),
      body: {
        publisherKey: this.publisherKey,
        requestId,
        impressionToken: cached.impressionToken,
        idempotencyKey,
      },
      fetchImpl: this.fetchImpl,
      timeoutMs: this.timeoutMs,
      maxRetries: this.maxRetries,
      idempotencyKey,
      sleep: this.sleep,
      random: this.random,
    });
  }

  private findServed(requestId: string): ServedAd | null {
    return this.cache.find((v) => v !== null && v.requestId === requestId) ?? null;
  }

  /* ---------------- telemetry ---------------- */

  /**
   * Report an observed page event to the server.
   *
   * Only the three observations the browser is the sole authority for are
   * reported from here: `session_started`, `page_viewed` and `ad_rendered`.
   * Everything else in the catalogue -- the delivery chain, viewability, the
   * impression, validation, and above all the reward -- is recorded by the
   * server from its own accounting transactions. The SDK has no way to assert
   * any of them, by construction rather than by convention.
   *
   * Uses the same idempotency key across every retry of one logical event and
   * the same offline queue as the impression path, so a telemetry event is no
   * more likely to be lost or double-counted than an impression.
   *
   * Nothing here is worth failing a page render over: 4xx responses are
   * swallowed and everything else is queued for the next flush.
   */
  private async emitTelemetry(
    eventType: TelemetryEventName,
    extra: Record<string, unknown> = {},
    opts: { beacon?: boolean } = {},
  ): Promise<void> {
    const idempotencyKey = randomId();
    const body = {
      publisherKey: this.publisherKey,
      eventType,
      sessionId: this.sessionId,
      idempotencyKey,
      ...extra,
    };

    if (opts.beacon) {
      const ok = defaultSendBeacon(`${this.baseUrl}/telemetry`, body, this.sendBeaconImpl);
      if (ok) return;
    }

    try {
      await requestJson({
        url: `${this.baseUrl}/telemetry`,
        method: "POST",
        headers: this.headers(),
        body,
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
        maxRetries: this.maxRetries,
        idempotencyKey,
        sleep: this.sleep,
        random: this.random,
      });
    } catch (err) {
      if (err instanceof CLIRevenueHttpError && err.status < 500) return;
      this.queue.enqueue({
        path: "/telemetry",
        body,
        idempotencyKey,
        queuedAt: Date.now(),
      });
    }
  }

  /** Report that this ad is now in the document. Called by render(). */
  private async recordRendered(served: ServedAd, placementKey: string): Promise<void> {
    if (!this.telemetryEnabled) return;
    await this.emitTelemetry("ad_rendered", {
      requestId: served.requestId,
      impressionToken: served.impressionToken,
      placementKey,
      occurredAt: new Date().toISOString(),
    });
  }

  /**
   * Open the page-load session and record the page view.
   *
   * `session_started` has to precede any other session event, so it is sent
   * first and the page view follows it. Both are fire-and-forget: the SDK does
   * not block a render on telemetry, and the server rejects a `page_viewed`
   * that arrives before its session root rather than guessing.
   */
  private startTelemetrySession(): void {
    if (!this.telemetryEnabled || this.telemetryStarted) return;
    this.telemetryStarted = true;
    void this.emitTelemetry("session_started", { occurredAt: new Date().toISOString() })
      .then(() => this.emitTelemetry("page_viewed", { occurredAt: new Date().toISOString() }))
      .catch(() => {
        /* telemetry must never surface to the publisher */
      });
  }

  /* ---------------- offline queue ---------------- */

  private attachOnlineFlush(): void {
    if (this.onlineHandlerAttached) return;
    const target = globalThis.addEventListener;
    if (typeof target !== "function") return;
    this.onlineHandlerAttached = true;
    this.onlineHandler = () => {
      void this.flush();
    };
    target.call(globalThis, "online", this.onlineHandler);
  }

  /** Attempt to deliver every queued event. Safe to call at any time. */
  async flush(): Promise<{ sent: number; failed: number }> {
    const events = this.queue.drain();
    let sent = 0;
    let failed = 0;
    for (const event of events) {
      try {
        await requestJson({
          url: `${this.baseUrl}${event.path}`,
          method: "POST",
          headers: this.headers(),
          body: event.body,
          fetchImpl: this.fetchImpl,
          timeoutMs: this.timeoutMs,
          maxRetries: 0,
          idempotencyKey: event.idempotencyKey,
          sleep: this.sleep,
          random: this.random,
        });
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed };
  }

  get pendingEvents(): number {
    return this.queue.length;
  }

  /** Release observers and listeners. Safe to call more than once. */
  destroy(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.clear();
    // The `online` listener is global, not element-scoped: without this a
    // mount/unmount cycle per SPA route would leave a trail of live clients,
    // each still flushing a queue on every reconnect.
    const remove = globalThis.removeEventListener;
    if (this.onlineHandler && typeof remove === "function") {
      remove.call(globalThis, "online", this.onlineHandler);
    }
    this.onlineHandler = undefined;
    this.onlineHandlerAttached = false;
  }

  private headers(): Record<string, string> {
    return { [SDK_VERSION_HEADER]: SDK_VERSION };
  }
}

function safeLocationUrl(): string | null {
  try {
    return globalThis.location?.href ?? null;
  } catch {
    return null;
  }
}

function safeReferrer(): string | null {
  try {
    return globalThis.document?.referrer ?? null;
  } catch {
    return null;
  }
}

/** Create a client. Throws CLIRevenueConfigError on a malformed key. */
export function init(publisherKey: string, options?: CLIRevenueOptions): CLIRevenue {
  return new CLIRevenue(publisherKey, options);
}

export {
  CLIRevenueError,
  CLIRevenueConfigError,
  CLIRevenueHttpError,
  CLIRevenueNetworkError,
  CLIRevenueTimeoutError,
} from "./errors.ts";
/**
 * Public surface is deliberately narrow.
 *
 * The transport, cache, queue and viewability helpers are NOT re-exported.
 * They are implementation details with no stable contract; exposing them
 * would let a consumer depend on internals that will change without a major
 * version bump. They remain importable from their own modules for the
 * package's own tests.
 *
 * Exported here: the factory, the class (so consumers can annotate a
 * variable without `ReturnType<typeof init>`), the public types, and the
 * error classes -- the last because a caller must be able to branch on
 * `CLIRevenueTimeoutError` vs `CLIRevenueConfigError` without matching
 * message strings.
 */
