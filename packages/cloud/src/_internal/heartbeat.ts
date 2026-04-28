/**
 * Simple heartbeat for app registry entries.
 * Uses setInterval — KISS over scheduler+job+cron.
 *
 * The entry's TTL is set on the ephemeral-store factory (see ./registry.ts);
 * `touch` extends that TTL without re-sending the value. A failed touch means
 * the entry has expired and we fall back to `upsert` to re-seed it.
 */
import { appRegistry } from "./registry";
import type { AppRegistryEntry } from "../contracts/registry";

const HEARTBEAT_INTERVAL_MS = 60_000;

export const createHeartbeat = (appId: string, entry: AppRegistryEntry) => {
  let timer: Timer | null = null;
  const key = `apps/${appId}`;

  return {
    start: async () => {
      await appRegistry.upsert({ key, value: entry });
      timer = setInterval(async () => {
        const result = await appRegistry.touch({ key });
        if (!result.ok) {
          await appRegistry.upsert({ key, value: entry });
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    stop: async () => {
      if (timer) clearInterval(timer);
      await appRegistry.remove({ key });
    },
  };
};
