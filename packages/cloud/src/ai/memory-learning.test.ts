import { describe, expect, test } from "bun:test";
import { AiLearnedMemoriesSchema, learnAiMemoriesFromPrivateChats } from "./memory-learning";

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
});
