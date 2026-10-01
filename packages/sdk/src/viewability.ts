/**
 * Viewability gating.
 *
 * An impression must not fire merely because the ad element exists in the DOM.
 * The existing Workbench behaviour keyed off a bare onScreen boolean, which
 * fires on any intersection at all -- including a 1% sliver entering the
 * viewport, and including an element that was never actually read.
 *
 * The standard here is the one used for real viewability:
 *   - at least 50% of the element's area inside the viewport, AND
 *   - continuously, for at least 1 second.
 *
 * Both conditions must hold together. A brief 100% pass does not count, and a
 * long 40% pass does not count. Once satisfied the impression fires exactly
 * once; the observer disconnects itself so a re-scroll cannot re-fire.
 *
 * sendBeacon is used for the unload path because a normal fetch is frequently
 * cancelled when a page is torn down, which is precisely the case this exists
 * to cover.
 */

export const VIEWABILITY_THRESHOLD = 0.5;
export const VIEWABILITY_MIN_MS = 1_000;

type IntersectionEntryLike = {
  isIntersecting: boolean;
  intersectionRatio: number;
};

type ObserverCtor = new (
  callback: (entries: IntersectionEntryLike[]) => void,
  options: { threshold: number },
) => { observe(el: Element): void; disconnect(): void };

export function createViewabilityGate({
  ObserverImpl,
  minMs = VIEWABILITY_MIN_MS,
  threshold = VIEWABILITY_THRESHOLD,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (handle) => clearTimeout(handle as number | undefined),
}: {
  ObserverImpl: ObserverCtor;
  minMs?: number;
  threshold?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}) {
  /**
   * Watch `element` and invoke `onViewable` once it has been at least
   * `threshold` visible for `minMs`. Returns a disposer.
   */
  return function observe(element: Element, onViewable: () => void): () => void {
    let satisfied = false;
    let startedAt: number | null = null;
    let timer: unknown = null;
    let disposed = false;

    const observer = new ObserverImpl(
      (entries) => {
        if (disposed || satisfied) return;
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < threshold) {
            // Dropped below the bar: restart the clock. Time spent partially
            // visible must not count toward the dwell requirement.
            startedAt = null;
            if (timer !== null) {
              clearTimer(timer);
              timer = null;
            }
            continue;
          }
          if (startedAt === null) {
            startedAt = Date.now();
            timer = setTimer(() => {
              timer = null;
              if (disposed || satisfied) return;
              satisfied = true;
              observer.disconnect();
              onViewable();
            }, minMs);
          }
        }
      },
      { threshold },
    );

    observer.observe(element);
    return () => {
      disposed = true;
      if (timer !== null) clearTimer(timer);
      observer.disconnect();
    };
  };
}

/**
 * Beacon delivery, used on page-hide and visibilitychange.
 *
 * Returns false when the environment has no sendBeacon (non-browser, or a
 * browser that refuses cross-origin beacons), so the caller can fall back to a
 * normal request rather than assuming success.
 *
 * Note: the Beacon API cannot set custom request headers, so the beacon path
 * does NOT carry X-CLIRevenue-SDK-Version. Authentication is unaffected -- the
 * publisher key travels in the body, not a header -- but version telemetry is
 * lost on this path. The caller falls back to a normal request only when the
 * beacon is unavailable, not when the version header is.
 */
export function sendBeacon(
  url: string,
  body: Record<string, unknown>,
  beaconImpl?: (url: string, data: Blob) => boolean,
): boolean {
  const impl = beaconImpl ?? globalThis.navigator?.sendBeacon?.bind(globalThis.navigator);
  if (!impl) return false;
  try {
    return impl(
      url,
      new Blob([JSON.stringify(body)], { type: "application/json" }),
    );
  } catch {
    return false;
  }
}
