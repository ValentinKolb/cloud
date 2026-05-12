/**
 * Per-notebook fetch cache with TTL + in-flight coalescing.
 *
 * Used by the autocomplete sources (tags, note-links, attachments)
 * that all share the same caching shape:
 *
 *  - Module-scoped Map keyed by `notebookId` so multiple editor
 *    instances mounted in the same tab (different notebooks) don't
 *    pollute each other's data.
 *  - Short TTL (default 45s) — fresh enough that collaborator-added
 *    entries surface promptly, long enough that rapid typing doesn't
 *    pound the API on every keystroke.
 *  - In-flight coalescing — concurrent callers during a cold-cache
 *    fetch share the same Promise instead of issuing N parallel
 *    network requests.
 *  - Empty-fallback on error — network failures degrade gracefully
 *    to "no suggestions" rather than throwing into the editor.
 *
 * Callers use it like:
 *
 *     const cache = createNotebookFetchCache<MyShape>(
 *       async (notebookId) => { const r = await fetch(...); return shaped; },
 *       { ttlMs: 45_000, fallback: emptyShape },
 *     );
 *
 *     const fresh = cache.getFresh(notebookId);  // sync hot-path
 *     if (fresh) return useIt(fresh);
 *     return cache.fetch(notebookId).then(useIt); // cold path
 *
 * The split between `getFresh` (sync) and `fetch` (async) is what
 * lets the CM autocomplete sources stay synchronous on cache hits —
 * an unconditionally-async source delays the OTHER sources' popups
 * by a microtask per keystroke, which is visible lag in practice.
 */

type CacheEntry<T> = {
  fetchedAt: number;
  data: T;
};

export type NotebookFetchCache<T> = {
  /** Synchronous: return cached data if still within TTL, else
   *  `undefined`. Callers use this for the hot path so they can
   *  return a fully-sync result when the cache is warm. */
  getFresh(notebookId: string): T | undefined;
  /** Cold path: returns cached data if fresh, otherwise issues a
   *  fetch (coalesced across concurrent callers) and caches the
   *  result. On fetch error the configured `fallback` is returned
   *  and NOT cached, so the next call retries. */
  fetch(notebookId: string): Promise<T>;
};

export const createNotebookFetchCache = <T>(
  fetcher: (notebookId: string) => Promise<T>,
  options: { ttlMs?: number; fallback: T },
): NotebookFetchCache<T> => {
  const ttl = options.ttlMs ?? 45_000;
  const cache = new Map<string, CacheEntry<T>>();
  const pending = new Map<string, Promise<T>>();

  const getFresh = (notebookId: string): T | undefined => {
    const entry = cache.get(notebookId);
    if (entry && Date.now() - entry.fetchedAt < ttl) return entry.data;
    return undefined;
  };

  const fetch = async (notebookId: string): Promise<T> => {
    const fresh = getFresh(notebookId);
    if (fresh !== undefined) return fresh;
    const inflight = pending.get(notebookId);
    if (inflight) return inflight;

    const promise = (async () => {
      try {
        const data = await fetcher(notebookId);
        cache.set(notebookId, { fetchedAt: Date.now(), data });
        return data;
      } catch {
        // Don't cache the failure — keep the slot empty so the
        // next trigger retries instead of returning stale empties
        // for the full TTL window.
        return options.fallback;
      } finally {
        pending.delete(notebookId);
      }
    })();
    pending.set(notebookId, promise);
    return promise;
  };

  return { getFresh, fetch };
};
