import { describe, expect, test } from "bun:test";
import { assistantChatPrompt } from "./prompt";

describe("assistantChatPrompt", () => {
  test("teaches chat discovery, reviewed messaging, and scheduled work", () => {
    const prompt = assistantChatPrompt("cHt234");
    expect(prompt).toContain("Current chat ID: cHt234.");
    expect(prompt).toContain("chat.search");
    expect(prompt).toContain("chats.search");
    expect(prompt).toContain("chat.read");
    expect(prompt).toContain("chat.resources");
    expect(prompt).toContain("chats.resources");
    expect(prompt).toContain("chat.message");
    expect(prompt).toContain("Action review asks for approval");
    expect(prompt).toContain("only after the Action returned success");
    expect(prompt).toContain("task.create");
    expect(prompt).toContain("tasks.list");
    expect(prompt).toContain("runtime timezone");
    expect(prompt).toContain("current Project context at run time");
  });
});
