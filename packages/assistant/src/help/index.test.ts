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
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("Assistant separates Project chats from general chats");
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("the compact context stays at the upper right");
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("A Project chat includes its inherited Project context");
    expect(assistantHelp.getMarkdown("assistant-workflow")).toContain("Always approve");
    expect(assistantHelp.getMarkdown("assistant-guidance")).toContain("Assistant works best when the request states");
  });
});
