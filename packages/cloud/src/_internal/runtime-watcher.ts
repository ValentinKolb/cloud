/**
 * Module-level singleton for the live cluster registry snapshot.
 *
 * `defineApp().start()` and the `middleware.runtime()` factory both call
 * `ensureRuntimeWatcher()` — the first call subscribes to the Redis
 * registry and starts refreshing on every event; subsequent calls are
 * no-ops. Reads happen via `getCurrentRuntime()`.
 *
 * One process = one app = one watcher; lives until `stopRuntimeWatcher()`
 * (called from defineApp's shutdown handler) or process exit.
 */
import { logger } from "../services/logging";
import type { CloudRuntime } from "../contracts/app";
import { appRegistry, listApps } from "./registry";
import { buildRuntimeFromRegistry } from "./runtime-context";

const log = logger("runtime-watcher");

let current: CloudRuntime | undefined;
let started = false;
let abort: AbortController | undefined;

const refresh = async () => {
  current = buildRuntimeFromRegistry(await listApps());
};

export const ensureRuntimeWatcher = async (): Promise<void> => {
  if (started) return;
  started = true;
  await refresh();
  abort = new AbortController();
  void (async () => {
    try {
      const snap = await appRegistry.snapshot({ prefix: "apps/" });
      for await (const _ev of appRegistry
        .reader({ prefix: "apps/", after: snap.cursor })
        .stream({ signal: abort.signal })) {
        await refresh();
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      log.error("Registry watcher failed", { error: err instanceof Error ? err.message : String(err) });
    }
  })();
};

export const stopRuntimeWatcher = (): void => {
  abort?.abort();
  abort = undefined;
  started = false;
  current = undefined;
};

export const getCurrentRuntime = (): CloudRuntime => {
  if (!current) {
    throw new Error(
      "Runtime not initialized — register middleware.runtime() in your router or call ensureRuntimeWatcher() during setup",
    );
  }
  return current;
};
