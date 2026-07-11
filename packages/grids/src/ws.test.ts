import { describe, expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { sendWorkspaceMessage } from "./ws";

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
