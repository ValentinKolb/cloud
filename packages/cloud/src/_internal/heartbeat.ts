/** Keep an app discoverable even when the ephemeral registry is recreated. */

import type { AppRegistryEntry } from "../contracts/registry";
import { appRegistry } from "./registry";

const HEARTBEAT_INTERVAL_MS = 60_000;

type HeartbeatRegistry = Pick<typeof appRegistry, "remove" | "upsert">;

type HeartbeatOptions = {
  intervalMs?: number;
  registry?: HeartbeatRegistry;
  onError?: (error: unknown) => void;
};

export const createHeartbeat = (appId: string, entry: AppRegistryEntry, options: HeartbeatOptions = {}) => {
  const intervalMs = options.intervalMs ?? HEARTBEAT_INTERVAL_MS;
  const registry = options.registry ?? appRegistry;
  const onError = options.onError ?? ((error: unknown) => console.error(`[app:${appId}] Registry heartbeat failed`, error));

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Heartbeat interval must be a positive finite number");
  }

  let timer: Timer | null = null;
  let inFlight: Promise<void> | null = null;
  let running = false;
  const key = `apps/${appId}`;

  const refresh = async (): Promise<void> => {
    // Upsert is intentionally unconditional. Unlike touch, it repairs a
    // registry that was cleared or recreated while this app kept running.
    await registry.upsert({ key, value: entry });
  };

  const schedule = () => {
    if (!running || timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!running) return;

      const operation = refresh();
      inFlight = operation;
      void operation
        .catch((error) => {
          try {
            onError(error);
          } catch {
            // Error reporting must never stop future registration attempts.
          }
        })
        .finally(() => {
          if (inFlight === operation) inFlight = null;
          schedule();
        });
    }, intervalMs);
  };

  return {
    start: async () => {
      if (running) {
        await inFlight;
        return;
      }
      running = true;
      const operation = refresh();
      inFlight = operation;
      try {
        await operation;
      } catch (error) {
        running = false;
        throw error;
      } finally {
        if (inFlight === operation) inFlight = null;
      }
      schedule();
    },
    stop: async () => {
      if (!running) return;
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;

      try {
        await inFlight;
      } catch {
        // Recurring heartbeat failures are already reported above. Removal is
        // still required so a stopped app cannot remain discoverable.
      }
      inFlight = null;
      await registry.remove({ key });
    },
  };
};
