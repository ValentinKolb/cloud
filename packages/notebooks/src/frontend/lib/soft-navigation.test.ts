import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleSoftNoteNavigationRequests, requestSoftNoteNavigation, type SoftNavigationResult } from "./soft-navigation";

let originalWindow: Window | undefined;

beforeEach(() => {
  originalWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
});

afterEach(() => {
  if (originalWindow) Object.assign(globalThis, { window: originalWindow });
  else Reflect.deleteProperty(globalThis, "window");
});

describe("soft note navigation request results", () => {
  test.each<SoftNavigationResult>([
    { kind: "applied", href: "/app/notebooks/book/notes/note-b" },
    { kind: "superseded" },
    { kind: "fallback" },
  ])("preserves the $kind result from the mounted route owner", async (result) => {
    const stop = handleSoftNoteNavigationRequests(async () => result);
    expect(await requestSoftNoteNavigation("/app/notebooks/book/notes/note-b")).toEqual(result);
    stop();
  });

  test("falls back when no route owner is mounted", async () => {
    expect(await requestSoftNoteNavigation("/app/notebooks/book/notes/note-b")).toEqual({ kind: "fallback" });
  });
});
