import { describe, expect, test } from "bun:test";
import type { AppRegistryEntry } from "../contracts/registry";
import { createHeartbeat } from "./heartbeat";

const entry = {
  id: "test",
  name: "Test",
  icon: "ti-test",
  description: "Test application",
  baseUrl: "http://test:3000",
  routes: ["/app/test"],
} satisfies AppRegistryEntry;

const waitUntil = async (predicate: () => boolean, timeoutMs = 250): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for heartbeat");
    await Bun.sleep(2);
  }
};

describe("createHeartbeat", () => {
  test("registers immediately and refreshes without overlapping writes", async () => {
    let writes = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    let removals = 0;
    const registry = {
      upsert: async () => {
        writes += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await Bun.sleep(5);
        concurrent -= 1;
        return { ok: true as const };
      },
      remove: async () => {
        removals += 1;
        return { ok: true as const };
      },
    };

    const heartbeat = createHeartbeat("test", entry, { intervalMs: 1, registry });
    await heartbeat.start();
    await waitUntil(() => writes >= 3);
    await heartbeat.stop();

    expect(maxConcurrent).toBe(1);
    expect(removals).toBe(1);
    const writesAfterStop = writes;
    await Bun.sleep(10);
    expect(writes).toBe(writesAfterStop);
  });

  test("keeps retrying after a transient registry failure", async () => {
    let attempts = 0;
    const errors: unknown[] = [];
    const registry = {
      upsert: async () => {
        attempts += 1;
        if (attempts === 2) throw new Error("registry unavailable");
        return { ok: true as const };
      },
      remove: async () => ({ ok: true as const }),
    };

    const heartbeat = createHeartbeat("test", entry, {
      intervalMs: 1,
      registry,
      onError: (error) => errors.push(error),
    });
    await heartbeat.start();
    await waitUntil(() => attempts >= 3);
    await heartbeat.stop();

    expect(errors).toHaveLength(1);
    expect(attempts).toBeGreaterThanOrEqual(3);
  });

  test("waits for initial registration before removing a stopped app", async () => {
    let finishRegistration: (() => void) | null = null;
    const operations: string[] = [];
    const registry = {
      upsert: async () => {
        operations.push("upsert:start");
        await new Promise<void>((resolve) => {
          finishRegistration = resolve;
        });
        operations.push("upsert:end");
        return { ok: true as const };
      },
      remove: async () => {
        operations.push("remove");
        return { ok: true as const };
      },
    };

    const heartbeat = createHeartbeat("test", entry, { intervalMs: 10, registry });
    const starting = heartbeat.start();
    await waitUntil(() => finishRegistration !== null);
    const stopping = heartbeat.stop();
    finishRegistration?.();
    await Promise.all([starting, stopping]);

    expect(operations).toEqual(["upsert:start", "upsert:end", "remove"]);
  });

  test("rejects invalid intervals", () => {
    expect(() => createHeartbeat("test", entry, { intervalMs: 0 })).toThrow(RangeError);
  });
});
