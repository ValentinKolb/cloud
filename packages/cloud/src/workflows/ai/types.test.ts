import { describe, expect, test } from "bun:test";
import { workflowAiRequestSchema } from "./types";

describe("workflow AI requests", () => {
  test("accepts bounded generation and classification requests", () => {
    const generated = workflowAiRequestSchema.parse({ kind: "generate_text", prompt: "Draft a reply" });
    expect(generated.kind === "generate_text" ? generated.maxOutputChars : null).toBe(4_000);
    expect(
      workflowAiRequestSchema.safeParse({
        kind: "classify",
        prompt: "Route it",
        input: { subject: "Invoice" },
        choices: ["sales", "finance"],
      }).success,
    ).toBe(true);
  });

  test("rejects duplicate choices and invalid multi-choice bounds", () => {
    expect(workflowAiRequestSchema.safeParse({ kind: "classify", prompt: "Route it", input: "x", choices: ["same", "same"] }).success).toBe(
      false,
    );
    expect(
      workflowAiRequestSchema.safeParse({
        kind: "classify_many",
        prompt: "Tag it",
        input: "x",
        choices: ["a", "b"],
        minChoices: 2,
        maxChoices: 1,
      }).success,
    ).toBe(false);
  });
});
