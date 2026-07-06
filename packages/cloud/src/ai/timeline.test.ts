import { describe, expect, test } from "bun:test";
import type { Message } from "@valentinkolb/nessi";
import { assistantDisplayBlocks, assistantVisibleBlocks, buildAiMessageTimeline, copyTextFromAssistantEntries } from "./timeline";
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
  test("groups one Nessi loop into one visible assistant response", () => {
    const firstAssistant: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "Here is the card." },
        { type: "tool_call", id: "call-card", name: "card", args: { title: "Status", value: "Online" } },
      ],
      stopReason: "tool_use",
    };
    const toolResult: Message = { role: "tool_result", callId: "call-card", name: "card", result: { displayed: true } };
    const finalAssistant: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Done." }],
      stopReason: "stop",
    };
    const aggregate: NonNullable<AiStoredMessage["loopAggregate"]> = {
      turns: [
        {
          message: firstAssistant as Extract<Message, { role: "assistant" }>,
          stopReason: "tool_use",
          toolCalls: [{ callId: "call-card", name: "card", args: { title: "Status" } }],
        },
        { message: finalAssistant as Extract<Message, { role: "assistant" }>, stopReason: "stop", toolCalls: [] },
      ],
      usage: { input: 10, output: 5, total: 15 },
      toolCallCount: 1,
      toolErrorCount: 0,
      toolIssueCount: 0,
      toolMalformedCount: 0,
      toolCancelledCount: 0,
      toolIssues: [],
      assistantMessageCount: 2,
    };

    const timeline = buildAiMessageTimeline([
      stored({ id: "user-1", seq: 1, message: { role: "user", content: [{ type: "text", text: "test" }] } }),
      stored({ id: "assistant-1", seq: 2, message: firstAssistant, loopId: "loop-1" }),
      stored({ id: "tool-1", seq: 3, message: toolResult, loopId: "loop-1" }),
      stored({ id: "assistant-2", seq: 4, message: finalAssistant, loopId: "loop-1", loopAggregate: aggregate }),
    ]);

    expect(timeline).toHaveLength(2);
    expect(timeline[1]?.type).toBe("assistant_response");
    if (timeline[1]?.type !== "assistant_response") throw new Error("Expected assistant response group");
    expect(timeline[1].loopId).toBe("loop-1");
    expect(timeline[1].entries.map((entry) => entry.id)).toEqual(["assistant-1", "tool-1", "assistant-2"]);
    expect(timeline[1].actionEntry?.id).toBe("assistant-2");
    expect(copyTextFromAssistantEntries(timeline[1].entries)).toBe("Here is the card.\n\nDone.");
  });

  test("preserves assistant block order from the stored message", () => {
    const message: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "first" },
        { type: "thinking", thinking: "reasoning" },
        { type: "tool_call", id: "call-1", name: "card", args: { title: "A" } },
        { type: "text", text: "second" },
      ],
    };

    expect(assistantVisibleBlocks(message).map((block) => block.type)).toEqual(["text", "thinking", "tool_call", "text"]);
  });

  test("displays reasoning before answer text for final assistant messages", () => {
    const message: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "answer" },
        { type: "thinking", thinking: "reasoning" },
      ],
    };

    expect(assistantDisplayBlocks(message).map((block) => block.type)).toEqual(["thinking", "text"]);
  });
});
