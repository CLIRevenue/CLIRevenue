/**
 * Per-placement in-memory cache with a 60 second lifetime.
 *
 * Why: a placement that scrolls in and out of view would otherwise request
 * delivery again on every intersection, multiplying impressions per pageview
 * and burning the publisher's rate limit for no additional fill.
 *
 * In-memory only, and deliberately so. This is a request-deduplication cache
 * with a horizon shorter than any user session; persisting it would create a
 * cross-page-view identifier for the visitor, which the privacy design of this
 * SDK exists to avoid.
 */

export const CACHE_TTL_MS = 60_000;

type Entry<T> = { value: T; storedAt: number };

export function createPlacementCache<T>({
  ttlMs = CACHE_TTL_MS,
  now = () => Date.now(),
} = {}) {
  const entries = new Map<string, Entry<T>>();

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (now() - entry.storedAt >= ttlMs) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.set(key, { value, storedAt: now() });
    },
    /** Reverse lookup by value, e.g. requestId -> served ad for trackConversion. */
    find(predicate: (value: T) => boolean): T | undefined {
      for (const entry of entries.values()) {
        if (predicate(entry.value)) return entry.value;
      }
      return undefined;
    },
    delete(key: string): void {
      entries.delete(key);
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      return entries.size;
    },
  };
}
