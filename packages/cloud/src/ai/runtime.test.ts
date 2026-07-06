import { describe, expect, test } from "bun:test";
import type { OutboundEvent, StoreEntry } from "@valentinkolb/nessi";
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

describe("AI runtime compaction split", () => {
  const messageEntry = (seq: number, role: "user" | "assistant"): StoreEntry => ({
    seq,
    kind: "message",
    message:
      role === "user"
        ? { role, content: [{ type: "text", text: `User ${seq}` }] }
        : { role, content: [{ type: "text", text: `Assistant ${seq}` }] },
  });

  test("splits at user-message loop boundaries", () => {
    const entries: StoreEntry[] = [
      messageEntry(1, "user"),
      messageEntry(2, "assistant"),
      { seq: 3, kind: "message", message: { role: "tool_result", callId: "call-1", name: "tool", result: { ok: true } } },
      messageEntry(4, "user"),
      messageEntry(5, "assistant"),
      messageEntry(6, "user"),
      messageEntry(7, "assistant"),
      messageEntry(8, "user"),
    ];

    expect(__aiRuntimeTest.countConversationLoops(entries)).toBe(4);
    expect(__aiRuntimeTest.findLoopSplitIndex(entries, 2)).toBe(5);
    expect(entries.slice(0, __aiRuntimeTest.findLoopSplitIndex(entries, 2)).map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  test("keeps more recent loops when context pressure is lower", () => {
    expect(__aiRuntimeTest.keepLoopsForFillRatio(undefined, 10)).toBe(2);
    expect(__aiRuntimeTest.keepLoopsForFillRatio(0.75, 10)).toBe(3);
    expect(__aiRuntimeTest.keepLoopsForFillRatio(0.95, 10)).toBe(2);
  });
});
