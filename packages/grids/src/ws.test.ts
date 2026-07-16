import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import {
  isDashboardWorkflowLauncherKind,
  isWorkspaceAccessRefreshCurrent,
  resolveWorkspaceEventCursor,
  sendWorkspaceMessage,
  workspaceCloseCodeForError,
} from "./ws";

const socket = (status: number) =>
  ({
    send: () => status,
  }) as unknown as ServerWebSocket<unknown>;

describe("Grids websocket delivery", () => {
  test("accepts only messages written without backpressure or drops", () => {
    expect(sendWorkspaceMessage(socket(12), "event", { ok: true })).toBe(true);
    expect(sendWorkspaceMessage(socket(-1), "event", { ok: true })).toBe(false);
    expect(sendWorkspaceMessage(socket(0), "event", { ok: true })).toBe(false);
  });

  test("treats closed-socket send failures as undelivered", () => {
    const closed = {
      send: () => {
        throw new Error("closed");
      },
    } as unknown as ServerWebSocket<unknown>;
    expect(sendWorkspaceMessage(closed, "event")).toBe(false);
  });

  test("reconnects cursor-backed streams after transient delivery failures", () => {
    expect(workspaceCloseCodeForError("backpressure")).toBe(1012);
    expect(workspaceCloseCodeForError("stream_failed")).toBe(1012);
    expect(workspaceCloseCodeForError("internal_error")).toBe(1011);
    expect(workspaceCloseCodeForError("access_denied")).toBe(1008);
  });
});

describe("Grids websocket access refresh", () => {
  test("discards results after the subscription changes", () => {
    const subscription = { kind: "metadata" as const, baseId: "11111111-1111-4111-8111-111111111111" };
    const ctx = { phase: "subscribed" as const, sessionToken: "first-session", subscription };

    expect(isWorkspaceAccessRefreshCurrent(ctx, subscription, "first-session")).toBe(true);
    expect(isWorkspaceAccessRefreshCurrent({ ...ctx, subscription: { ...subscription } }, subscription, "first-session")).toBe(false);
  });

  test("discards results after the session or phase changes", () => {
    const subscription = { kind: "metadata" as const, baseId: "11111111-1111-4111-8111-111111111111" };

    expect(
      isWorkspaceAccessRefreshCurrent({ phase: "subscribed", sessionToken: "new-session", subscription }, subscription, "old-session"),
    ).toBe(false);
    expect(
      isWorkspaceAccessRefreshCurrent({ phase: "closing", sessionToken: "old-session", subscription }, subscription, "old-session"),
    ).toBe(false);
  });
});

describe("Grids websocket cursor baseline", () => {
  test("preserves a client cursor without loading a new baseline", async () => {
    let latestCalls = 0;
    const cursor = await resolveWorkspaceEventCursor("7-4", async () => {
      latestCalls++;
      return "9-1";
    });

    expect(cursor).toBe("7-4");
    expect(latestCalls).toBe(0);
  });

  test("uses the latest cursor or the empty-stream baseline", async () => {
    expect(await resolveWorkspaceEventCursor(null, async () => "9-1")).toBe("9-1");
    expect(await resolveWorkspaceEventCursor(undefined, async () => null)).toBe("0-0");
  });
});

describe("Grids dashboard workflow websocket access", () => {
  test("accepts dashboard and scanner launchers", () => {
    expect(isDashboardWorkflowLauncherKind("dashboard")).toBe(true);
    expect(isDashboardWorkflowLauncherKind("scanner")).toBe(true);
    expect(isDashboardWorkflowLauncherKind("bulk")).toBe(false);
  });
});
