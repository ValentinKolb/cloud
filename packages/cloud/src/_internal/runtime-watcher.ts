/**
 * Module-level singleton for the live cluster registry snapshot.
 *
 * `defineApp().start()` and the `middleware.runtime()` factory both call
 * `ensureRuntimeWatcher()` — the first call subscribes to the Redis
 * registry and starts refreshing on every event; subsequent calls
 * await the same in-flight init promise. Reads happen via `getCurrentRuntime()`.
 *
 * One process = one app = one watcher; lives until `stopRuntimeWatcher()`
 * (called from defineApp's shutdown handler) or process exit.
 */

import type { CloudRuntime } from "../contracts/app";
import { logger } from "../services/logging";
import { superviseRuntimeTask } from "../services/runtime-lifecycle";
import { appRegistry, listApps } from "./registry";
import { buildRuntimeFromRegistry } from "./runtime-context";

const log = logger("runtime-watcher");

let current: CloudRuntime | undefined;
let initPromise: Promise<void> | undefined;
let watcherTask: Promise<void> | undefined;
let abort: AbortController | undefined;

const refresh = async () => {
  current = buildRuntimeFromRegistry(await listApps());
};

export const ensureRuntimeWatcher = (): Promise<void> => {
  // Concurrent callers (start() + first request) wait on the same init —
  // returning before `current` is populated would race getCurrentRuntime().
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await refresh();
    abort = new AbortController();
    const controller = abort;
    watcherTask = superviseRuntimeTask({
      name: "Runtime registry watcher",
      signal: controller.signal,
      run: async (signal) => {
        const snap = await appRegistry.snapshot({ prefix: "apps/" });
        await refresh();
        for await (const _ev of appRegistry.reader({ prefix: "apps/", after: snap.cursor }).stream({ signal })) {
          await refresh();
        }
      },
      onError: ({ error, failureCount, retryInMs }) =>
        log.error("Registry watcher failed; restarting", {
          error: error instanceof Error ? error.message : String(error),
          failureCount,
          retryInMs,
        }),
    });
  })();
  return initPromise;
};

export const stopRuntimeWatcher = async (): Promise<void> => {
  // Await the watcher loop's exit before clearing state — otherwise an
  // in-flight refresh() can write `current` after we cleared it, or a
  // restart can overlap two readers.
  abort?.abort();
  if (watcherTask) {
    try {
      await watcherTask;
    } catch {
      // already logged inside the loop
    }
  }
  abort = undefined;
  watcherTask = undefined;
  initPromise = undefined;
  current = undefined;
};

export const getCurrentRuntime = (): CloudRuntime => {
  if (!current) {
    throw new Error("Runtime not initialized — register middleware.runtime() in your router or call ensureRuntimeWatcher() during setup");
  }
  return current;
};
