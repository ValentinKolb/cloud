import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";

const root = mkdtempSync(resolve(tmpdir(), "assistant-live-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
const { createAssistantLiveInvalidationHub, matchesAssistantInvalidation } = await import("./assistant-live");
afterAll(() => rmSync(root, { recursive: true, force: true }));

const eventually = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Assistant live invalidation");
    await Bun.sleep(5);
  }
};

describe("Assistant live invalidation hub", () => {
  test("marks a cursor only after every matching query applied it", async () => {
    const calls: string[] = [];
    const applied: Array<string | null> = [];
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const hub = createAssistantLiveInvalidationHub({ delayMs: 1, onApplied: (cursor) => applied.push(cursor) });
    hub.register({
      matches: matchesAssistantInvalidation(["conversation-list"]),
      invalidate: async () => {
        calls.push("sidebar");
      },
    });
    hub.register({
      matches: matchesAssistantInvalidation(["conversation-list"]),
      invalidate: async () => {
        await blocked;
        calls.push("history");
      },
    });

    hub.scheduleEvent("10-0", {
      type: "ai.invalidated",
      changeId: crypto.randomUUID(),
      appId: "assistant",
      conversationId: "Chat01",
      projectId: null,
      domains: ["conversation-list"],
      at: new Date().toISOString(),
    });
    await eventually(() => calls.includes("sidebar"));
    expect(applied).toEqual([]);
    release();
    await eventually(() => applied.length === 1);
    expect(calls.sort()).toEqual(["history", "sidebar"]);
    expect(applied).toEqual(["10-0"]);
    hub.dispose();
  });

  test("retries failed coverage and keeps conversation scopes isolated", async () => {
    let attempts = 0;
    const applied: Array<string | null> = [];
    const hub = createAssistantLiveInvalidationHub({
      delayMs: 1,
      retryBaseMs: 1,
      retryMaxMs: 2,
      onApplied: (cursor) => applied.push(cursor),
    });
    hub.register({
      matches: matchesAssistantInvalidation(["conversation-files"], { conversationId: "Chat01" }),
      invalidate: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary");
      },
    });

    hub.scheduleEvent("11-0", {
      type: "ai.invalidated",
      changeId: crypto.randomUUID(),
      appId: "assistant",
      conversationId: "Other1",
      projectId: null,
      domains: ["conversation-files"],
      at: new Date().toISOString(),
    });
    await eventually(() => applied.length === 1);
    expect(attempts).toBe(0);

    hub.scheduleEvent("12-0", {
      type: "ai.invalidated",
      changeId: crypto.randomUUID(),
      appId: "assistant",
      conversationId: "Chat01",
      projectId: null,
      domains: ["conversation-files"],
      at: new Date().toISOString(),
    });
    await eventually(() => applied.length === 2);
    expect(attempts).toBe(2);
    expect(applied).toEqual(["11-0", "12-0"]);
    hub.dispose();
  });
});
