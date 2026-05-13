/**
 * `kit.localState` — per-user, per-notebook key-value store backed
 * by the platform OPFS `kvStore` from `@valentinkolb/stdlib/browser`.
 *
 * Differences from `kit.state` (which uses a Y.Map):
 *  - NOT collaborative — only the user who set it sees the value.
 *  - Persists in the browser's Origin Private File System; survives
 *    reload + cross-tab sync via BroadcastChannel.
 *  - Async — OPFS writes return Promises.
 *  - Works in BOTH edit and read modes (no Y.Doc dependency).
 *
 * Use cases: "has-seen-intro" flags, personal view toggles,
 * per-user preferences scoped to one notebook.
 *
 * Keys are namespaced as `notebooks:script-state:<notebookId>:<key>`
 * so collisions across notebooks / other apps using the same kvStore
 * are impossible.
 */
import { kvStore } from "@valentinkolb/stdlib/browser";
import { assertActive, type KitContext, type KitLocalStateAPI } from "./kit-types";

const KEY_NAMESPACE = "notebooks:script-state";
type LocalStateObserver = (newValue: unknown) => void;

export const createKitLocalStateAPI = (ctx: KitContext): KitLocalStateAPI => {
  /** Namespace prefix for THIS notebook's local state. */
  const prefix = `${KEY_NAMESPACE}:${ctx.notebookId}:`;
  const fullKey = (key: string): string => `${prefix}${key}`;
  const observers = new Map<string, Set<LocalStateObserver>>();
  const suppressedWatchKeys = new Set<string>();

  const notifyObservers = <T>(key: string, value: T | undefined): void => {
    const callbacks = observers.get(key);
    if (!callbacks) return;
    for (const cb of callbacks) cb(value);
  };

  const get = async <T = unknown>(key: string): Promise<T | undefined> => {
    return kvStore.get<T>(fullKey(key));
  };

  const set = async <T>(key: string, value: T): Promise<void> => {
    assertActive(ctx);
    const full = fullKey(key);
    suppressedWatchKeys.add(full);
    try {
      await kvStore.set(full, value);
      notifyObservers(key, value);
    } finally {
      suppressedWatchKeys.delete(full);
    }
  };

  const del = async (key: string): Promise<void> => {
    assertActive(ctx);
    const full = fullKey(key);
    suppressedWatchKeys.add(full);
    try {
      await kvStore.delete(full);
      notifyObservers(key, undefined);
    } finally {
      suppressedWatchKeys.delete(full);
    }
  };

  const keys = async (): Promise<string[]> => {
    // `kvStore.keys(prefix)` returns the prefixed keys; strip the
    // namespace so callers see the keys they passed in.
    const all = await kvStore.keys(prefix);
    return all.map((k) => k.slice(prefix.length)).sort();
  };

  const observe = <T = unknown>(
    key: string,
    cb: (newValue: T | undefined) => void,
  ): (() => void) => {
    // `kvStore.watch` accepts a prefix and fires on any matching
    // key change. We pass the FULLY-NAMESPACED key as the prefix
    // and then filter by exact match in the callback so we only
    // fire for THIS key, not siblings under the same notebook.
    const full = fullKey(key);
    const observer = cb as LocalStateObserver;
    const callbacks = observers.get(key) ?? new Set<LocalStateObserver>();
    callbacks.add(observer);
    observers.set(key, callbacks);

    const unwatch = kvStore.watch((event) => {
      if (event.key !== full) return;
      if (suppressedWatchKeys.has(full)) return;
      // Re-read async so the callback sees the current value (or
      // undefined on delete). `kvStore.watch` is cross-tab via
      // BroadcastChannel, so updates from OTHER browser tabs / other
      // scripts that touched the same key also fire here.
      void (async () => {
        const value = await kvStore.get<T>(full);
        cb(value);
      })();
    }, full);

    // Auto-cleanup on script re-run / widget destroy. Identical
    // pattern to `kit.state.observe`'s `registerDisposer` usage.
    let disposed = false;
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unwatch();
      callbacks.delete(observer);
      if (callbacks.size === 0) observers.delete(key);
    };
    ctx.registerDisposer?.(dispose);
    return dispose;
  };

  return { get, set, delete: del, keys, observe };
};
