import { describe, expect, test } from "bun:test";
import { createMailLiveRefreshCoordinator, type MailLiveRefreshResult } from "./mail-live-refresh";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
};

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for Mail live refresh test condition");
};

describe("Mail live refresh coordinator", () => {
  test("coalesces cursors and acknowledges only after the snapshot applies", async () => {
    const refresh = deferred<MailLiveRefreshResult>();
    const applied: Array<string | null> = [];
    let refreshCalls = 0;
    const coordinator = createMailLiveRefreshCoordinator({
      delayMs: 1,
      isBlocked: () => false,
      refresh: () => {
        refreshCalls++;
        return refresh.promise;
      },
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });

    coordinator.schedule("10-1");
    coordinator.schedule("10-2");
    await waitFor(() => refreshCalls === 1);
    expect(applied).toEqual([]);

    refresh.resolve("applied");
    await waitFor(() => applied.length === 1);
    expect(applied).toEqual(["10-2"]);
    coordinator.dispose();
  });

  test("serializes refreshes while preserving events received in flight", async () => {
    const refreshes = [deferred<MailLiveRefreshResult>(), deferred<MailLiveRefreshResult>()];
    const applied: Array<string | null> = [];
    let refreshCalls = 0;
    const coordinator = createMailLiveRefreshCoordinator({
      delayMs: 1,
      isBlocked: () => false,
      refresh: () => refreshes[refreshCalls++]!.promise,
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });

    coordinator.schedule("20-1");
    await waitFor(() => refreshCalls === 1);
    coordinator.schedule("20-2");
    await Bun.sleep(3);
    expect(refreshCalls).toBe(1);

    refreshes[0]!.resolve("applied");
    await waitFor(() => refreshCalls === 2);
    refreshes[1]!.resolve("applied");
    await waitFor(() => applied.length === 2);
    expect(applied).toEqual(["20-1", "20-2"]);
    coordinator.dispose();
  });

  test("waits for composer release and retries stale route snapshots", async () => {
    let blocked = true;
    let refreshCalls = 0;
    const applied: Array<string | null> = [];
    const coordinator = createMailLiveRefreshCoordinator({
      delayMs: 1,
      isBlocked: () => blocked,
      refresh: async () => (++refreshCalls === 1 ? "stale" : "applied"),
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });

    coordinator.schedule("30-1");
    await Bun.sleep(3);
    expect(refreshCalls).toBe(0);
    blocked = false;
    coordinator.resume();

    await waitFor(() => applied.length === 1);
    expect(refreshCalls).toBe(2);
    expect(applied).toEqual(["30-1"]);
    coordinator.dispose();
  });

  test("falls back without acknowledging a failed refresh", async () => {
    const applied: Array<string | null> = [];
    let fallbacks = 0;
    const coordinator = createMailLiveRefreshCoordinator({
      delayMs: 1,
      isBlocked: () => false,
      refresh: async () => "failed",
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => fallbacks++,
    });

    coordinator.schedule("40-1");
    await waitFor(() => fallbacks === 1);
    expect(applied).toEqual([]);
    coordinator.schedule("40-2");
    await Bun.sleep(3);
    expect(fallbacks).toBe(1);
  });

  test("does not acknowledge an in-flight refresh after disposal", async () => {
    const refresh = deferred<MailLiveRefreshResult>();
    const applied: Array<string | null> = [];
    let refreshCalls = 0;
    const coordinator = createMailLiveRefreshCoordinator({
      delayMs: 1,
      isBlocked: () => false,
      refresh: () => {
        refreshCalls++;
        return refresh.promise;
      },
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });

    coordinator.schedule("50-1");
    await waitFor(() => refreshCalls === 1);
    coordinator.dispose();
    refresh.resolve("applied");
    await Bun.sleep(3);
    expect(applied).toEqual([]);
  });
});
