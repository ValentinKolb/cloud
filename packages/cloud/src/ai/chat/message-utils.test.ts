import { describe, expect, test } from "bun:test";
import type { LoopAggregate, Message, Usage } from "@valentinkolb/nessi";
import type { AiStoredMessage } from "../types";
import { latestLoopUsage, latestUsage, latestUsageSnapshot, memoryToolPresentation } from "./message-utils";

const storedAssistant = (input: { usage: Usage; aggregate?: LoopAggregate }): AiStoredMessage => {
  const message: Message = {
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    usage: input.usage,
    stopReason: "stop",
  };
  return {
    id: "message-1",
    conversationId: "conversation-1",
    seq: 1,
    kind: "message",
    message,
    loopId: "loop-1",
    modelProfileId: "model-1",
    providerModel: "provider/model",
    usage: input.usage,
    stopReason: "stop",
    loopAggregate: input.aggregate ?? null,
    loopDoneReason: input.aggregate ? "stop" : null,
    compactedAt: null,
    meta: null,
    createdAt: new Date(0).toISOString(),
  };
};

const aggregate = (lastRequest: Usage, loopUsage: Usage): LoopAggregate => ({
  turns: [
    {
      message: { role: "assistant", content: [{ type: "text", text: "Working" }], stopReason: "tool_use" },
      usage: { input: 8_598, output: 118, total: 8_716 },
      stopReason: "tool_use",
      toolCalls: [],
    },
    {
      message: { role: "assistant", content: [{ type: "text", text: "Done" }], stopReason: "stop" },
      usage: lastRequest,
      stopReason: "stop",
      toolCalls: [],
    },
  ],
  usage: loopUsage,
  issueCount: 0,
  issues: [],
  toolCallCount: 0,
  toolErrorCount: 0,
  toolIssueCount: 0,
  toolMalformedCount: 0,
  toolCancelledCount: 0,
  toolIssues: [],
  assistantMessageCount: 2,
});

describe("AI usage selectors", () => {
  test("separates the final provider request from cumulative loop usage", () => {
    const finalRequest = { input: 15_876, output: 32, total: 15_908 };
    const loopUsage = { input: 69_944, output: 819, total: 70_763 };
    const messages = [storedAssistant({ usage: loopUsage, aggregate: aggregate(finalRequest, loopUsage) })];

    expect(latestUsage(messages)).toEqual(finalRequest);
    expect(latestLoopUsage(messages)).toEqual(loopUsage);
    expect(latestUsageSnapshot(messages)).toEqual({ request: finalRequest, loop: loopUsage, modelProfileId: "model-1" });
  });

  test("falls back to stored turn usage for legacy single-turn messages", () => {
    const requestUsage = { input: 400, output: 20, total: 420 };
    const messages = [storedAssistant({ usage: requestUsage })];

    expect(latestUsage(messages)).toEqual(requestUsage);
    expect(latestLoopUsage(messages)).toEqual(requestUsage);
  });
});

describe("memory tool presentation", () => {
  test("shows an added memory once without technical result fields", () => {
    expect(
      memoryToolPresentation(
        { action: "add", content: "Valentin is in Reichardtsroth until Wednesday." },
        { ok: true, message: "Remembered: [2026-07-11] Valentin is in Reichardtsroth until Wednesday." },
      ),
    ).toEqual({ label: "Remembered", description: "Valentin is in Reichardtsroth until Wednesday.", failed: false });
  });

  test("uses the affected entries for removal copy", () => {
    expect(
      memoryToolPresentation(
        { action: "remove", content: "Reichardtsroth" },
        { ok: true, message: "Forgot 2 memories: [2026-07-10] First visit. | [2026-07-11] Second visit." },
      ),
    ).toEqual({ label: "Forgot 2 memories", description: "First visit. · Second visit.", failed: false });
  });

  test("keeps failed updates visible", () => {
    expect(memoryToolPresentation({ action: "add", content: "A fact" }, { ok: false, message: "Memory is full." })).toEqual({
      label: "Memory not updated",
      description: "Memory is full.",
      failed: true,
    });
  });
});
