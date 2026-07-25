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

/** Matches what the ephemeral store returns; the heartbeat ignores the value. */
const upsertResult = () => ({
  key: `apps/${entry.id}`,
  value: entry,
  version: "1",
  createdAt: 0,
  updatedAt: 0,
  expiresAt: 0,
});

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
        return upsertResult();
      },
      remove: async () => {
        removals += 1;
        return true;
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
        return upsertResult();
      },
      remove: async () => true,
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
    const registration = Promise.withResolvers<void>();
    const operations: string[] = [];
    const registry = {
      upsert: async () => {
        operations.push("upsert:start");
        await registration.promise;
        operations.push("upsert:end");
        return upsertResult();
      },
      remove: async () => {
        operations.push("remove");
        return true;
      },
    };

    const heartbeat = createHeartbeat("test", entry, { intervalMs: 10, registry });
    const starting = heartbeat.start();
    await waitUntil(() => operations.includes("upsert:start"));
    const stopping = heartbeat.stop();
    registration.resolve();
    await Promise.all([starting, stopping]);

    expect(operations).toEqual(["upsert:start", "upsert:end", "remove"]);
  });

  test("rejects invalid intervals", () => {
    expect(() => createHeartbeat("test", entry, { intervalMs: 0 })).toThrow(RangeError);
  });
});
