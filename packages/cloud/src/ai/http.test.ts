import { describe, expect, test } from "bun:test";
import { AiCreateConversationInputSchema, AiSteerInputSchema, AiTurnInputSchema, aiTurnInputToContent } from "./http";

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

  test("accepts a project only when creating a conversation", () => {
    expect(AiCreateConversationInputSchema.parse({ projectId: "pRk234" }).projectId).toBe("pRk234");
    expect(() => AiCreateConversationInputSchema.parse({ projectId: "11111111-1111-4111-8111-111111111111" })).toThrow();
    expect(() => AiCreateConversationInputSchema.parse({ projectId: "meeting-summary" })).toThrow();
  });

  test("accepts only the predefined optional local client tool", () => {
    expect(AiTurnInputSchema.parse({ message: "Inspect this checkout", clientToolIds: ["local_bash"] }).clientToolIds).toEqual([
      "local_bash",
    ]);
    expect(() => AiTurnInputSchema.parse({ message: "Inspect this checkout", clientToolIds: ["arbitrary_tool"] })).toThrow();
    expect(() => AiTurnInputSchema.parse({ message: "Inspect this checkout", clientToolIds: ["local_bash", "local_bash"] })).toThrow();
  });

  test("steering is text-only and requires an idempotency key", () => {
    expect(AiSteerInputSchema.parse({ message: "  Change course  ", clientRequestId: "request-1" })).toEqual({
      message: "Change course",
      clientRequestId: "request-1",
    });
    expect(() => AiSteerInputSchema.parse({ message: "", clientRequestId: "request-1" })).toThrow();
    expect(() => AiSteerInputSchema.parse({ message: "Change course" })).toThrow();
  });
});
