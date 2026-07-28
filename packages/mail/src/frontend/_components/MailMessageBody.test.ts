import { describe, expect, test } from "bun:test";
import { buildMessageDocument, normalizeMessageBodyHeight } from "./mail-message-document";

describe("MailMessageBody sizing", () => {
  test("measures the intrinsic message root instead of the iframe viewport", () => {
    const document = buildMessageDocument("<p>Short message</p>", "test-channel");

    expect(document).toContain('<div id="mail-message-root"><p>Short message</p></div>');
    expect(document).toContain("root?.getBoundingClientRect().height");
    expect(document).toContain("new ResizeObserver(reportHeight).observe(root)");
    expect(document).not.toContain("document.documentElement.scrollHeight");
  });

  test("keeps reported heights finite without truncating long messages", () => {
    expect(normalizeMessageBodyHeight(1)).toBe(32);
    expect(normalizeMessageBodyHeight(48.2)).toBe(49);
    expect(normalizeMessageBodyHeight(200_000)).toBe(200_000);
    expect(normalizeMessageBodyHeight(Number.POSITIVE_INFINITY)).toBe(32);
    expect(normalizeMessageBodyHeight(Number.NaN)).toBe(32);
  });

  test("collapses only explicit HTML quote containers", () => {
    const document = buildMessageDocument('<p>New content</p><blockquote type="cite">Old content</blockquote>', "test-channel");

    expect(document).toContain("Show quoted text");
    expect(document).toContain('blockquote[type="cite"], .gmail_quote, .yahoo_quoted');
  });

  test("allows only the app-owned iframe bridge script", () => {
    const document = buildMessageDocument("<p>Safe content</p>", "channel-123");

    expect(document).toContain("script-src 'nonce-channel123'");
    expect(document).toContain('<script nonce="channel123">');
    expect(document).not.toContain("script-src 'unsafe-inline'");
  });

  test("keeps HTML mail on an opaque light canvas in every app theme", () => {
    const document = buildMessageDocument("<p>Readable content</p>", "test-channel");

    expect(document).toContain(":root { color-scheme: only light; }");
    expect(document).toContain("background: #fff; color: #18181b;");
  });
});
