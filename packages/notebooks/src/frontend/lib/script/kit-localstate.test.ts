import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { KitContext } from "./kit-types";

const store = new Map<string, unknown>();
const watchers = new Set<(event: { key: string }) => void>();

mock.module("@valentinkolb/stdlib/browser", () => ({
  kvStore: {
    get: async <T>(key: string): Promise<T | undefined> => store.get(key) as T | undefined,
    set: async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
      for (const cb of watchers) cb({ key });
    },
    delete: async (key: string): Promise<void> => {
      store.delete(key);
      for (const cb of watchers) cb({ key });
    },
    keys: async (prefix: string): Promise<string[]> => Array.from(store.keys()).filter((key) => key.startsWith(prefix)),
    watch: (cb: (event: { key: string }) => void): (() => void) => {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
  },
}));

const { createKitLocalStateAPI } = await import("./kit-localstate");

const ctx = (): KitContext => ({
  mode: "edit",
  notebookId: "nb1234",
  note: {
    shortId: "nt1234",
    title: "Test",
    content: "",
    notebookName: "Notebook",
    parentId: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    lockedAt: null,
  },
  outputEl: {} as HTMLElement,
});

describe("nb.localKV", () => {
  beforeEach(() => {
    store.clear();
    watchers.clear();
  });

  test("set accepts updater functions", async () => {
    const kv = createKitLocalStateAPI(ctx());

    await kv.set("clicks", 1);
    await kv.set<number>("clicks", (current = 0) => current + 1);
    await kv.set<number>("missing", (current = 0) => current + 5);

    expect(await kv.get<number>("clicks")).toBe(2);
    expect(await kv.get<number>("missing")).toBe(5);
  });
});
