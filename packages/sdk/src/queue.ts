/**
 * Offline event queue, backed by sessionStorage.
 *
 * Purpose: an impression fired as the page is unloading can fail, and losing
 * it silently means the publisher is under-reported. Queuing it for the rest
 * of the browsing session recovers it.
 *
 * Constraints, all deliberate:
 *
 *   - sessionStorage only. NOT localStorage (would outlive the session and
 *     create a durable visitor identifier), NOT IndexedDB (unnecessary
 *     weight), NOT cookies (would be sent to the server on every request and
 *     is exactly the cross-site identifier this SDK refuses to create).
 *   - Hard cap of 100 events. A publisher with a broken connection must not
 *     grow unbounded storage on a visitor's device. When full, the oldest
 *     event is dropped: recent events are the more likely relevant ones.
 *   - Idempotency keys are stored with the event and reused verbatim, so a
 *     queued-then-flushed event is still one logical event. The server
 *     dedupes on it and on the serve guard, so a flush that partly succeeded
 *     cannot double count.
 *   - Corrupt or unavailable storage degrades to a no-op. A privacy-mode
 *     browser that throws on sessionStorage must not break ad delivery,
 *     which is the publisher's revenue path.
 */

export const MAX_QUEUE_SIZE = 100;
const STORAGE_KEY = "clirevenue:pending-events";

export type QueuedEvent = {
  path: string;
  body: Record<string, unknown>;
  idempotencyKey: string;
  queuedAt: number;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** sessionStorage when usable, otherwise null. Never throws. */
export function defaultStorage(): StorageLike | null {
  try {
    if (typeof globalThis.sessionStorage === "undefined") return null;
    const probe = "__clirevenue_probe__";
    globalThis.sessionStorage.setItem(probe, "1");
    globalThis.sessionStorage.removeItem(probe);
    return globalThis.sessionStorage as unknown as StorageLike;
  } catch {
    // Blocked by privacy settings, or unavailable in a non-browser runtime.
    return null;
  }
}

function parse(raw: string | null): QueuedEvent[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Defensive: a hand-edited or truncated entry must not poison the queue.
    return parsed.filter(
      (e): e is QueuedEvent =>
        !!e &&
        typeof e === "object" &&
        typeof (e as QueuedEvent).path === "string" &&
        typeof (e as QueuedEvent).idempotencyKey === "string",
    );
  } catch {
    return [];
  }
}

export function createEventQueue({
  storage = defaultStorage(),
  maxSize = MAX_QUEUE_SIZE,
} = {}) {
  function read(): QueuedEvent[] {
    if (!storage) return [];
    try {
      return parse(storage.getItem(STORAGE_KEY));
    } catch {
      return [];
    }
  }

  function write(events: QueuedEvent[]): void {
    if (!storage) return;
    try {
      if (events.length === 0) storage.removeItem(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, JSON.stringify(events));
    } catch {
      /* quota or blocked: dropping the queue is preferable to throwing */
    }
  }

  return {
    enqueue(event: QueuedEvent): void {
      const events = read();
      events.push(event);
      // Drop oldest first when over the cap.
      write(events.slice(Math.max(0, events.length - maxSize)));
    },
    /** Remove and return every queued event. */
    drain(): QueuedEvent[] {
      const events = read();
      write([]);
      return events;
    },
    peek(): QueuedEvent[] {
      return read();
    },
    get length(): number {
      return read().length;
    },
    clear(): void {
      write([]);
    },
  };
}

export type EventQueue = ReturnType<typeof createEventQueue>;
