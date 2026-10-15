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

  const isExpired = (entry: Entry<T>): boolean => now() - entry.storedAt >= ttlMs;

  return {
    get(key: string): T | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (isExpired(entry)) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key: string, value: T): void {
      entries.set(key, { value, storedAt: now() });
    },
    /**
     * Reverse lookup by value, e.g. requestId -> served ad for trackConversion.
     *
     * Expired entries are swept here for the same reason `get()` skips them:
     * this is the lookup that hands out an `impressionToken` to the conversion
     * endpoint, so honouring the TTL is not cosmetic -- without it an entry
     * that nobody has `get()`-ed since it aged out stays reachable forever, and
     * `size` reports it as live. Sweeping while iterating is safe here because
     * `Map` iterators tolerate deletion of the entry being visited.
     */
    find(predicate: (value: T) => boolean): T | undefined {
      for (const [key, entry] of entries) {
        if (isExpired(entry)) {
          entries.delete(key);
          continue;
        }
        if (predicate(entry.value)) return entry.value;
      }
      return undefined;
    },
    delete(key: string): void {
      entries.delete(key);
    },
    /** Drop every entry already past its TTL. Returns how many were removed. */
    prune(): number {
      let removed = 0;
      for (const [key, entry] of entries) {
        if (isExpired(entry)) {
          entries.delete(key);
          removed++;
        }
      }
      return removed;
    },
    clear(): void {
      entries.clear();
    },
    get size(): number {
      // Live entries only, so `size` cannot report an expired entry as cached.
      this.prune();
      return entries.size;
    },
  };
}
