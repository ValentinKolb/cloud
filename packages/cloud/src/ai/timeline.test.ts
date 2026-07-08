import { describe, expect, test } from "bun:test";
import type { Message } from "@valentinkolb/nessi";
import { buildAiMessageTimeline, copyTextFromAssistantEntries } from "./timeline";
import type { AiStoredMessage } from "./types";

const stored = (input: {
  id: string;
  seq: number;
  message: Message;
  loopId?: string | null;
  loopAggregate?: AiStoredMessage["loopAggregate"];
}): AiStoredMessage => ({
  id: input.id,
  conversationId: "conversation-1",
  seq: input.seq,
  kind: "message",
  message: input.message,
  loopId: input.loopId ?? null,
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: input.message.role === "assistant" ? (input.message.stopReason ?? null) : null,
  loopAggregate: input.loopAggregate ?? null,
  loopDoneReason: input.loopAggregate ? "stop" : null,
  createdAt: new Date(0).toISOString(),
});

describe("AI message timeline", () => {
  test("groups one loop into one assistant response with unified blocks", () => {
    const firstAssistant: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "Here is the card." },
        { type: "tool_call", id: "call-card", name: "card", args: { title: "Status", value: "Online" } },
      ],
      stopReason: "tool_use",
    };
    const toolResult: Message = { role: "tool_result", callId: "call-card", name: "card", result: { displayed: true } };
    const finalAssistant: Message = { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop" };

    const timeline = buildAiMessageTimeline([
      stored({ id: "user-1", seq: 1, message: { role: "user", content: [{ type: "text", text: "test" }] } }),
      stored({ id: "assistant-1", seq: 2, message: firstAssistant, loopId: "loop-1" }),
      stored({ id: "tool-1", seq: 3, message: toolResult, loopId: "loop-1" }),
      stored({ id: "assistant-2", seq: 4, message: finalAssistant, loopId: "loop-1" }),
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ type: "user" });

    const group = timeline[1];
    if (group?.type !== "assistant") throw new Error("expected assistant group");
    expect(group.loopId).toBe("loop-1");
    expect(group.entries).toHaveLength(3);
    // Blocks: text, tool (completed via tool_result), text.
    expect(group.blocks.map((block) => block.kind)).toEqual(["text", "tool", "text"]);
    const toolBlock = group.blocks.find((block) => block.kind === "tool");
    expect(toolBlock).toMatchObject({ kind: "tool", callId: "call-card", status: "completed" });
    expect(group.actionEntry?.id).toBe("assistant-2");
  });

  test("splits distinct loops into separate assistant groups", () => {
    const timeline = buildAiMessageTimeline([
      stored({ id: "u1", seq: 1, message: { role: "user", content: [{ type: "text", text: "one" }] } }),
      stored({ id: "a1", seq: 2, message: { role: "assistant", content: [{ type: "text", text: "first" }], stopReason: "stop" }, loopId: "loop-1" }),
      stored({ id: "u2", seq: 3, message: { role: "user", content: [{ type: "text", text: "two" }] } }),
      stored({ id: "a2", seq: 4, message: { role: "assistant", content: [{ type: "text", text: "second" }], stopReason: "stop" }, loopId: "loop-2" }),
    ]);

    expect(timeline.map((item) => item.type)).toEqual(["user", "assistant", "user", "assistant"]);
    const [, first, , second] = timeline;
    if (first?.type !== "assistant" || second?.type !== "assistant") throw new Error("expected assistant groups");
    expect(first.loopId).toBe("loop-1");
    expect(second.loopId).toBe("loop-2");
  });

  test("renders summary rows as their own items", () => {
    const timeline = buildAiMessageTimeline([
      { ...stored({ id: "s1", seq: 1, message: { role: "assistant", content: [{ type: "text", text: "summary" }], stopReason: "stop" } }), kind: "summary" },
      stored({ id: "u1", seq: 2, message: { role: "user", content: [{ type: "text", text: "next" }] } }),
    ]);
    expect(timeline[0]).toMatchObject({ type: "summary" });
    expect(timeline[1]).toMatchObject({ type: "user" });
  });

  test("copyTextFromAssistantEntries joins visible assistant text", () => {
    const entries = [
      stored({ id: "a1", seq: 1, message: { role: "assistant", content: [{ type: "text", text: "one" }], stopReason: "stop" }, loopId: "loop-1" }),
      stored({ id: "a2", seq: 2, message: { role: "assistant", content: [{ type: "text", text: "two" }], stopReason: "stop" }, loopId: "loop-1" }),
    ];
    expect(copyTextFromAssistantEntries(entries)).toBe("one\n\ntwo");
  });
});
