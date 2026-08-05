import { describe, expect, test } from "bun:test";
import { assistantHelp } from ".";

describe("assistantHelp", () => {
  test("serves the existing Assistant help topics as Markdown", async () => {
    expect(assistantHelp.documents.map((document) => document.id)).toEqual([
      "assistant-overview",
      "assistant-workflow",
      "assistant-guidance",
    ]);
    expect(assistantHelp.getMarkdown("assistant-overview")).toContain("Assistant is a personal AI workspace");
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("Assistant keeps recent chats in the sidebar");
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("Always approve");
    expect(assistantHelp.getMarkdown("assistant-guidance")).toContain("Assistant works best when the request states");
  });
});
