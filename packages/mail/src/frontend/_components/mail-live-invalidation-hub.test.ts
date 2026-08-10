import { describe, expect, test } from "bun:test";
import { createMailLiveInvalidationHub, type MailLiveInvalidation } from "./mail-live-invalidation-hub";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, reject, resolve };
};

const waitFor = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await Bun.sleep(1);
  }
  throw new Error("Timed out waiting for Mail live invalidation test condition");
};

describe("Mail live invalidation hub", () => {
  test("fans out and acknowledges the latest cursor after every matching query applies", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const applied: Array<string | null> = [];
    const hub = createMailLiveInvalidationHub({
      delayMs: 1,
      isBlocked: () => false,
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });
    let calls = 0;
    hub.register({ matches: () => true, invalidate: () => (calls++, first.promise) });
    hub.register({ matches: () => true, invalidate: () => (calls++, second.promise) });

    hub.schedule({ cursor: "10-1", conversationId: "conversation-a" });
    hub.schedule({ cursor: "10-2", conversationId: "conversation-b" });
    await waitFor(() => calls === 2);
    expect(applied).toEqual([]);
    first.resolve();
    await Bun.sleep(2);
    expect(applied).toEqual([]);
    second.resolve();
    await waitFor(() => applied.length === 1);
    expect(applied).toEqual(["10-2"]);
    hub.dispose();
  });

  test("only invalidates matching detail queries", async () => {
    const seen: MailLiveInvalidation[] = [];
    const hub = createMailLiveInvalidationHub({
      delayMs: 1,
      isBlocked: () => false,
      onApplied: () => undefined,
      onFailed: () => undefined,
    });
    hub.register({
      matches: (invalidation) => invalidation.conversationIds?.has("conversation-a") ?? true,
      invalidate: async (invalidation) => void seen.push(invalidation),
    });

    hub.schedule({ cursor: "20-1", conversationId: "conversation-b" });
    await Bun.sleep(3);
    expect(seen).toEqual([]);
    hub.schedule({ cursor: "20-2", conversationId: "conversation-a" });
    await waitFor(() => seen.length === 1);
    expect(seen[0]?.cursor).toBe("20-2");
    hub.dispose();
  });

  test("applies a later event that arrives while invalidation is in flight", async () => {
    const first = deferred<void>();
    const second = deferred<void>();
    const applied: Array<string | null> = [];
    let calls = 0;
    const hub = createMailLiveInvalidationHub({
      delayMs: 1,
      isBlocked: () => false,
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });
    hub.register({
      matches: () => true,
      invalidate: () => (++calls === 1 ? first.promise : second.promise),
    });

    hub.schedule({ cursor: "25-1", conversationId: "conversation-a" });
    await waitFor(() => calls === 1);
    hub.schedule({ cursor: "25-2", conversationId: "conversation-b" });
    first.resolve();
    await waitFor(() => calls === 2);
    expect(applied).toEqual(["25-1"]);
    second.resolve();
    await waitFor(() => applied.length === 2);
    expect(applied).toEqual(["25-1", "25-2"]);
    hub.dispose();
  });

  test("retries failed coverage without acknowledging its cursor", async () => {
    const applied: Array<string | null> = [];
    const failures: number[] = [];
    let attempts = 0;
    const hub = createMailLiveInvalidationHub({
      delayMs: 1,
      retryBaseMs: 1,
      isBlocked: () => false,
      onApplied: (cursor) => applied.push(cursor),
      onFailed: (attempt) => failures.push(attempt),
    });
    hub.register({
      matches: () => true,
      invalidate: async () => {
        if (++attempts === 1) throw new Error("snapshot failed");
      },
    });

    hub.schedule({ cursor: "30-1", conversationId: null });
    await waitFor(() => failures.length === 1);
    expect(applied).toEqual([]);
    await waitFor(() => applied.length === 1);
    expect(attempts).toBe(2);
    expect(applied).toEqual(["30-1"]);
    hub.dispose();
  });

  test("waits while blocked and never acknowledges after disposal", async () => {
    let blocked = true;
    let calls = 0;
    const refresh = deferred<void>();
    const applied: Array<string | null> = [];
    const hub = createMailLiveInvalidationHub({
      delayMs: 1,
      isBlocked: () => blocked,
      onApplied: (cursor) => applied.push(cursor),
      onFailed: () => undefined,
    });
    hub.register({ matches: () => true, invalidate: () => (calls++, refresh.promise) });
    hub.schedule({ cursor: "40-1", conversationId: null });
    await Bun.sleep(3);
    expect(calls).toBe(0);
    blocked = false;
    hub.resume();
    await waitFor(() => calls === 1);
    hub.dispose();
    refresh.resolve();
    await Bun.sleep(3);
    expect(applied).toEqual([]);
  });
});
