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
import type { KitContext, KitLocalStateAPI } from "./kit-types";

const KEY_NAMESPACE = "notebooks:script-state";

export const createKitLocalStateAPI = (ctx: KitContext): KitLocalStateAPI => {
  /** Namespace prefix for THIS notebook's local state. */
  const prefix = `${KEY_NAMESPACE}:${ctx.notebookId}:`;
  const fullKey = (key: string): string => `${prefix}${key}`;

  const get = async <T = unknown>(key: string): Promise<T | undefined> => {
    return kvStore.get<T>(fullKey(key));
  };

  const set = async <T>(key: string, value: T): Promise<void> => {
    await kvStore.set(fullKey(key), value);
  };

  const del = async (key: string): Promise<void> => {
    await kvStore.delete(fullKey(key));
  };

  const keys = async (): Promise<string[]> => {
    // `kvStore.keys(prefix)` returns the prefixed keys; strip the
    // namespace so callers see the keys they passed in.
    const all = await kvStore.keys(prefix);
    return all.map((k) => k.slice(prefix.length)).sort();
  };

  return { get, set, delete: del, keys };
};
