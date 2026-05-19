import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { createKitStateAPI } from "./kit-state";
import type { KitContext } from "./kit-types";

const ctxWithDoc = (): KitContext => ({
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
  ydoc: new Y.Doc(),
  outputEl: {} as HTMLElement,
});

describe("current.kv", () => {
  test("set accepts updater functions", () => {
    const kv = createKitStateAPI(ctxWithDoc());

    kv.set("clicks", 1);
    kv.set<number>("clicks", (current = 0) => current + 1);
    kv.set<number>("missing", (current = 0) => current + 5);

    expect(kv.get<number>("clicks")).toBe(2);
    expect(kv.get<number>("missing")).toBe(5);
  });
});
