import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { PublicNotebookWorkspaceEvent } from "../../../../lib/workspace-events";
import { dispatchWorkspaceEvent, WORKSPACE_EVENT, type WorkspaceEventDetail } from "./workspace-events";

const event: PublicNotebookWorkspaceEvent = {
  v: 1,
  type: "workspace.invalidated",
  notebookId: "book01",
  reason: "bulk",
  scopes: ["tree"],
};

let originalWindow: Window | undefined;

beforeEach(() => {
  originalWindow = globalThis.window;
  Object.assign(globalThis, { window: new EventTarget() });
});

afterEach(() => {
  if (originalWindow) Object.assign(globalThis, { window: originalWindow });
  else Reflect.deleteProperty(globalThis, "window");
});

describe("workspace event coverage", () => {
  test("does not acknowledge an event before every mounted owner covers it", async () => {
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    window.addEventListener(WORKSPACE_EVENT, (raw) => (raw as CustomEvent<WorkspaceEventDetail>).detail.cover(first));
    window.addEventListener(WORKSPACE_EVENT, (raw) => (raw as CustomEvent<WorkspaceEventDetail>).detail.cover(second));

    let acknowledged = false;
    const dispatched = dispatchWorkspaceEvent(event, "1-0").then(() => {
      acknowledged = true;
    });
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    releaseFirst();
    await Promise.resolve();
    expect(acknowledged).toBe(false);
    releaseSecond();
    await dispatched;
    expect(acknowledged).toBe(true);
  });

  test("rejects coverage when no workspace query is mounted", async () => {
    await expect(dispatchWorkspaceEvent(event, "1-0")).rejects.toThrow("No mounted workspace query covered the event");
  });
});
