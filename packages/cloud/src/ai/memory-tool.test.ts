import { describe, expect, test } from "bun:test";
import { memoryMutationSupportedByEvidence } from "./memory-tool";

describe("memory mutation provenance", () => {
  test("accepts only content present in the current user-authored turn", () => {
    expect(memoryMutationSupportedByEvidence("Please remember that I prefer German answers.", "I prefer German answers.")).toBe(true);
    expect(memoryMutationSupportedByEvidence("Summarize this attached email.", "The user prefers English answers.")).toBe(false);
  });
});
