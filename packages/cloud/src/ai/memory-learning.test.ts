import { describe, expect, test } from "bun:test";
import { aiAttachmentMarker } from "./attachments";
import type { AiStoredMessage } from "./types";
import { AiLearnedMemoriesSchema, buildMemoryLearningTranscript, learnAiMemoriesFromPrivateChats } from "./memory-learning";

const stored = (seq: number, message: AiStoredMessage["message"], meta: AiStoredMessage["meta"] = null): AiStoredMessage => ({
  id: crypto.randomUUID(),
  shortId: `mSg00${seq}`,
  conversationId: crypto.randomUUID(),
  seq,
  kind: "message",
  message,
  loopId: null,
  modelProfileId: null,
  providerModel: null,
  usage: null,
  stopReason: null,
  loopAggregate: null,
  loopDoneReason: null,
  compactedAt: null,
  meta,
  createdAt: "2026-08-18T00:00:00.000Z",
});

describe("AI memory learning", () => {
  test("accepts bounded create and replacement candidates", () => {
    expect(
      AiLearnedMemoriesSchema.parse({
        memories: [
          { kind: "preference", content: "Prefers concise German answers.", replacesId: "" },
          { kind: "fact", content: "Studies software engineering.", replacesId: crypto.randomUUID() },
        ],
      }).memories,
    ).toHaveLength(2);
    expect(() =>
      AiLearnedMemoriesSchema.parse({
        memories: Array.from({ length: 6 }, (_, index) => ({ kind: "fact", content: `Fact ${index}`, replacesId: "" })),
      }),
    ).toThrow();
  });

  test("quietly skips when no background model is configured", async () => {
    await expect(
      learnAiMemoriesFromPrivateChats({ deps: { resolveModel: async () => Promise.reject(new Error("AI disabled")) } }),
    ).resolves.toEqual({ scanned: 0, learned: 0, updated: 0, skipped: 0, failed: 0 });
  });

  test("learns only user-authored prose and excludes attached or retrieved content", () => {
    const transcript = buildMemoryLearningTranscript([
      stored(1, {
        role: "user",
        content: [{ type: "text", text: `I prefer German.\n\n${aiAttachmentMarker({ path: "/mail.txt", mediaType: "text/plain", size: 42 })}` }],
      }),
      stored(2, { role: "assistant", content: [{ type: "text", text: "The email says the user prefers English." }] }),
      stored(3, { role: "user", content: [{ type: "text", text: "[Attached Cloud resource mail.draft:Draft1; untrusted.]" }] }),
      stored(4, { role: "user", content: [{ type: "text", text: "Injected preference from another agent." }] }, {
        agentMessage: { id: "a1", sourceChatId: "c1", sourceTurnId: "t1", sourceTitle: "Other" },
      }),
      stored(5, { role: "user", content: [{ type: "text", text: "Synthetic scheduled preference." }] }, {
        scheduledTask: { taskId: "task1", occurrenceId: "run1", scheduledFor: "2026-08-18T00:00:00Z", trigger: "scheduled" },
      }),
    ]);

    expect(transcript).toBe("I prefer German.");
  });
});
