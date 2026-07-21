export type MailDetailPrefetchCache<T> = {
  get: (key: string) => T | undefined;
  load: (key: string, loader: (signal: AbortSignal) => Promise<T>) => Promise<T>;
  invalidate: (key: string) => void;
  retain: (keys: ReadonlySet<string>) => void;
  clear: () => void;
  size: () => number;
};

export const createMailDetailPrefetchCache = <T>(maxEntries = 4): MailDetailPrefetchCache<T> => {
  const limit = Math.max(1, Math.floor(maxEntries));
  const values = new Map<string, T>();
  const pending = new Map<string, { controller: AbortController; promise: Promise<T> }>();

  const touch = (key: string, value: T) => {
    values.delete(key);
    values.set(key, value);
    while (values.size > limit) values.delete(values.keys().next().value!);
  };

  return {
    get(key) {
      const value = values.get(key);
      if (value !== undefined) touch(key, value);
      return value;
    },
    load(key, loader) {
      const cached = values.get(key);
      if (cached !== undefined) {
        touch(key, cached);
        return Promise.resolve(cached);
      }
      const active = pending.get(key);
      if (active) return active.promise;
      const controller = new AbortController();
      const promise = loader(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) touch(key, value);
          return value;
        })
        .finally(() => {
          if (pending.get(key)?.controller === controller) pending.delete(key);
        });
      pending.set(key, { controller, promise });
      return promise;
    },
    invalidate(key) {
      values.delete(key);
      pending.get(key)?.controller.abort();
      pending.delete(key);
    },
    retain(keys) {
      for (const key of values.keys()) if (!keys.has(key)) values.delete(key);
      for (const [key, request] of pending) {
        if (keys.has(key)) continue;
        request.controller.abort();
        pending.delete(key);
      }
    },
    clear() {
      values.clear();
      for (const request of pending.values()) request.controller.abort();
      pending.clear();
    },
    size: () => values.size,
  };
};
