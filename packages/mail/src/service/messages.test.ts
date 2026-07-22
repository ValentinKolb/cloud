import { describe, expect, test } from "bun:test";
import { messageForwardText } from "./messages";

describe("messageForwardText", () => {
  test("prefers the original plain-text alternative", () => {
    expect(messageForwardText("Plain body", "<p>HTML body</p>")).toBe("Plain body");
  });

  test("converts an HTML-only body to readable text", () => {
    const text = messageForwardText(null, '<p>Hello <strong>Ada</strong>.</p><p><a href="https://example.com">Details</a></p>');
    expect(text).toContain("Hello Ada.");
    expect(text).toContain("Details");
    expect(text).not.toContain("<strong>");
  });

  test("uses HTML when an empty plain-text alternative carries no content", () => {
    expect(messageForwardText("", "<p>HTML body</p>")).toBe("HTML body");
    expect(messageForwardText("  \n", "<p>HTML body</p>")).toBe("HTML body");
  });

  test("does not fail the message projection when HTML conversion rejects malformed input", () => {
    expect(typeof messageForwardText(null, "\u0000")).toBe("string");
  });
});
