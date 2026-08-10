import { describe, expect, test } from "bun:test";
import { buildAiTaskPrompt } from "./task-prompt";

describe("buildAiTaskPrompt", () => {
  test("keeps additional guidance between the fixed task and fixed contract", () => {
    const prompt = buildAiTaskPrompt({
      baseInstructions: "Index the chat.",
      additionalInstructions: "Use our canonical product names.",
      outputContract: "Return only the requested schema.",
    });

    expect(prompt).toBe(
      "# Task\nIndex the chat.\n\n# Additional organization guidance\nUse our canonical product names.\n\n# Fixed output contract\nReturn only the requested schema.",
    );
  });

  test("omits blank additional guidance without changing fixed sections", () => {
    expect(buildAiTaskPrompt({ baseInstructions: "Task", additionalInstructions: "  ", outputContract: "Contract" })).toBe(
      "# Task\nTask\n\n# Fixed output contract\nContract",
    );
  });
});
