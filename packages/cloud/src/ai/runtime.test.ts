import { describe, expect, test } from "bun:test";
import type { OutboundEvent } from "@valentinkolb/nessi";
import { __aiRuntimeTest } from "./runtime";

const eventBase = { agentId: "cloud", loopId: "loop-1" };

describe("AI runtime tool stream guard", () => {
  test("adds the turn loop id to legacy Nessi events without loop ids", () => {
    const event = { type: "text", agentId: "cloud", delta: "hello" } as OutboundEvent;

    expect(__aiRuntimeTest.withTurnLoopId(event, "turn-1")).toEqual({
      ...event,
      loopId: "turn-1",
    });
  });

  test("keeps explicit Nessi loop ids unchanged", () => {
    const event: OutboundEvent = { ...eventBase, type: "text", delta: "hello" };

    expect(__aiRuntimeTest.withTurnLoopId(event, "turn-2")).toBe(event);
  });

  test("accepts the matching tool_call immediately after a durable tool_start", () => {
    const event: OutboundEvent = {
      ...eventBase,
      type: "tool_call",
      callId: "call-1",
      name: "card",
      args: { title: "Status", value: "OK" },
    };

    expect(__aiRuntimeTest.getStaleToolStartCancelEvent({ callId: "call-1", name: "card" }, event, "loop-1")).toBeNull();
  });

  test("cancels a durable tool_start that is followed by unrelated output", () => {
    const event: OutboundEvent = { ...eventBase, type: "text", delta: "still thinking" };
    const cancel = __aiRuntimeTest.getStaleToolStartCancelEvent({ callId: "call-1", name: "card" }, event, "loop-1");

    expect(cancel).toMatchObject({
      type: "tool_cancel",
      callId: "call-1",
      name: "card",
      reason: "stream_ended_before_tool_call",
    });
  });
});
