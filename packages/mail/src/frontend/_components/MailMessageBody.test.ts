import { describe, expect, test } from "bun:test";
import { buildMessageDocument, normalizeMessageBodyHeight } from "./MailMessageBody";

describe("MailMessageBody sizing", () => {
  test("measures the intrinsic message root instead of the iframe viewport", () => {
    const document = buildMessageDocument("<p>Short message</p>", "test-channel");

    expect(document).toContain('<div id="mail-message-root"><p>Short message</p></div>');
    expect(document).toContain("root?.getBoundingClientRect().height");
    expect(document).toContain("new ResizeObserver(reportHeight).observe(root)");
    expect(document).not.toContain("document.documentElement.scrollHeight");
  });

  test("keeps reported heights finite and bounded", () => {
    expect(normalizeMessageBodyHeight(1)).toBe(32);
    expect(normalizeMessageBodyHeight(48.2)).toBe(49);
    expect(normalizeMessageBodyHeight(200_000)).toBe(100_000);
  });
});
