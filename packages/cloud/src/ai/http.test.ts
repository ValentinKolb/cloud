import { describe, expect, test } from "bun:test";
import { AiTurnInputSchema, aiTurnInputToContent } from "./http";

describe("AI HTTP input helpers", () => {
  test("keeps the message when content contains only files", () => {
    const input = AiTurnInputSchema.parse({
      message: "Describe this image",
      content: [{ type: "file", mediaType: "image/png", data: "abc123" }],
    });

    expect(aiTurnInputToContent(input)).toEqual([
      { type: "text", text: "Describe this image" },
      { type: "file", mediaType: "image/png", data: "abc123" },
    ]);
  });

  test("does not duplicate message text when content already has text", () => {
    const input = AiTurnInputSchema.parse({
      message: "Ignored fallback",
      content: [
        { type: "text", text: "Explicit prompt" },
        { type: "file", mediaType: "image/jpeg", data: "abc123" },
      ],
    });

    expect(aiTurnInputToContent(input)).toEqual([
      { type: "text", text: "Explicit prompt" },
      { type: "file", mediaType: "image/jpeg", data: "abc123" },
    ]);
  });

  test("rejects unsupported image media types", () => {
    expect(() =>
      AiTurnInputSchema.parse({
        content: [{ type: "file", mediaType: "image/svg+xml", data: "abc123" }],
      }),
    ).toThrow();
  });
});
