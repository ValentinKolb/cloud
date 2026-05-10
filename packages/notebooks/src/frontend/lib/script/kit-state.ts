/**
 * `kit.state` — collaborative per-note key-value store backed by a
 * Y.Map on the same Y.Doc as the note body. Automatic conflict-free
 * sync via the existing yjs collab pipeline; persisted via the
 * existing snapshot worker.
 *
 * Edit-mode only — read-mode has no Y.Doc, so:
 *   - get() returns undefined
 *   - set() / delete() log a warning and no-op
 *   - keys() returns []
 *   - observe() returns a no-op unsubscribe
 *
 * Values are stored as JSON-serialised payloads under each key.
 * This keeps the API typeless for V1 (caller can put primitives,
 * objects, arrays — anything that survives a JSON round-trip) and
 * makes the wire format inspectable.
 *
 * If the script ever needs richer types (Y.Array, Y.Map nested),
 * Phase 3+ can expose a separate `kit.yjs` escape hatch — for
 * now keep it simple.
 */
import * as Y from "yjs";
import type { KitContext, KitStateAPI } from "./kit-types";

const STATE_MAP_NAME = "kit:state";
const READ_MODE_WARN = "kit.state.* is a no-op in read mode (no Y.Doc available)";

const noopUnsubscribe = (): void => {};

export const createKitStateAPI = (ctx: KitContext): KitStateAPI => {
  // Read-mode short-circuit: no Y.Doc → every operation is a
  // safe-but-empty no-op. Logging once keeps the console signal
  // clear without spamming when scripts call set in a loop.
  if (ctx.mode !== "edit" || !ctx.ydoc) {
    let warned = false;
    const warn = () => {
      if (warned) return;
      warned = true;
      console.warn(READ_MODE_WARN);
    };
    return {
      get: () => undefined,
      set: () => {
        warn();
      },
      delete: () => {
        warn();
      },
      keys: () => [],
      observe: () => noopUnsubscribe,
    };
  }

  const ymap = ctx.ydoc.getMap<string>(STATE_MAP_NAME);

  const get = <T = unknown>(key: string): T | undefined => {
    const raw = ymap.get(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Corrupt JSON in the map — return undefined rather than
      // throw so a single bad entry doesn't break the whole script.
      return undefined;
    }
  };

  const set = <T>(key: string, value: T): void => {
    ymap.set(key, JSON.stringify(value));
  };

  const del = (key: string): void => {
    ymap.delete(key);
  };

  const keys = (): string[] => Array.from(ymap.keys()).sort();

  const observe = <T = unknown>(
    key: string,
    cb: (newValue: T | undefined) => void,
  ): (() => void) => {
    const handler = (event: Y.YMapEvent<string>) => {
      // `event.keysChanged` is a Set of keys that changed in this
      // transaction — only fire the callback when the watched key
      // is in there, so subscribers only see relevant updates.
      if (!event.keysChanged.has(key)) return;
      cb(get<T>(key));
    };
    ymap.observe(handler);
    let disposed = false;
    const unsub = () => {
      if (disposed) return;
      disposed = true;
      ymap.unobserve(handler);
    };
    // Auto-cleanup on script re-run / widget destroy. Without this,
    // every debounced re-run leaks a Y.Map handler — codex review
    // on commit 7ee5fdc, finding 6. The returned `unsub` still
    // works for explicit cleanup; running it twice is a no-op.
    ctx.registerDisposer?.(unsub);
    return unsub;
  };

  return { get, set, delete: del, keys, observe };
};
