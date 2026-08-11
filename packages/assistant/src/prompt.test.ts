import { describe, expect, test } from "bun:test";
import { assistantChatPrompt } from "./prompt";

describe("assistantChatPrompt", () => {
  test("teaches explicit current and cross-chat discovery plus reviewed messaging", () => {
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
  });
});
