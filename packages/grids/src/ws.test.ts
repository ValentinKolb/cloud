import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { isDashboardWorkflowLauncherKind, isWorkspaceAccessRefreshCurrent, sendWorkspaceMessage } from "./ws";

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

describe("Grids dashboard workflow websocket access", () => {
  test("accepts dashboard and scanner launchers", () => {
    expect(isDashboardWorkflowLauncherKind("dashboard")).toBe(true);
    expect(isDashboardWorkflowLauncherKind("scanner")).toBe(true);
    expect(isDashboardWorkflowLauncherKind("bulk")).toBe(false);
  });
});
