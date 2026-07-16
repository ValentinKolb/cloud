import { describe, expect, test } from "bun:test";
import { createDeferredWorkspaceReload } from "./deferred-workspace-reload";

describe("createDeferredWorkspaceReload", () => {
  test("cancels a close-frame reload when its workspace is disposed", () => {
    let dialogOpen = true;
    let reloads = 0;
    let dismissed = 0;
    const callbacks: { close?: EventListener; frame?: FrameRequestCallback; canceledFrame?: number } = {};

    const refresh = createDeferredWorkspaceReload(() => reloads++, 0, {
      isDialogOpen: () => dialogOpen,
      notifyPending: () => ({ dismiss: () => dismissed++ }),
      requestFrame: (callback) => {
        callbacks.frame = callback;
        return 42;
      },
      cancelFrame: (id) => {
        callbacks.canceledFrame = id;
      },
      addCloseListener: (listener) => {
        callbacks.close = listener;
      },
      removeCloseListener: (listener) => {
        if (callbacks.close === listener) delete callbacks.close;
      },
    });

    refresh.schedule();
    dialogOpen = false;
    callbacks.close?.(new Event("close"));
    refresh.dispose();
    callbacks.frame?.(0);

    expect(reloads).toBe(0);
    expect(dismissed).toBe(1);
    expect(callbacks.canceledFrame).toBe(42);
    expect(callbacks.close).toBeUndefined();
  });
});
