import { describe, expect, test } from "bun:test";
import { sanitizeIncomingMailHtml, sanitizeIncomingMailHtmlWithRemoteImages } from "./message-hydration";

describe("incoming mail HTML", () => {
  test("removes executable content and remote tracking images", () => {
    const sanitized = sanitizeIncomingMailHtml(`
      <script>alert('xss')</script>
      <style>body { display: none }</style>
      <form action="https://attacker.example"><input name="secret"></form>
      <a href="javascript:alert(1)" onclick="alert(2)">unsafe</a>
      <a href="https://example.com/path">safe</a>
      <img src="https://tracker.example/pixel" onerror="alert(3)">
      <img src="cid:logo@example.com" style="position:fixed" alt="Logo">
    `);

    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("<style");
    expect(sanitized).not.toContain("<form");
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("tracker.example");
    expect(sanitized).toContain('src="cid:logo@example.com"');
    expect(sanitized).toContain('href="https://example.com/path"');
    expect(sanitized).toContain('target="_blank"');
    expect(sanitized).toContain('rel="noopener noreferrer nofollow"');
  });

  test("preserves only known quote markers for isolated reader presentation", () => {
    expect(
      sanitizeIncomingMailHtml(
        '<div class="gmail_quote unknown">history</div><blockquote type="cite" class="yahoo_quoted other">quoted</blockquote>',
      ),
    ).toBe('<div class="gmail_quote">history</div><blockquote type="cite" class="yahoo_quoted">quoted</blockquote>');
  });

  test("keeps remote image locations only in server-side metadata", () => {
    const result = sanitizeIncomingMailHtmlWithRemoteImages(`
      <img src="https://Tracker.Example/pixel?message=123#fragment" data-mail-remote-image="00000000-0000-4000-8000-000000000099" alt="Tracking pixel">
      <img src="cid:logo@example.com" data-mail-remote-image="00000000-0000-4000-8000-000000000098" alt="Inline logo">
    `);

    expect(result.html).not.toContain("tracker.example");
    expect(result.html).not.toContain("message=123");
    expect(result.html).toContain('src="cid:logo@example.com"');
    expect(result.remoteImages).toHaveLength(1);
    expect(result.remoteImages[0]).toMatchObject({
      position: 0,
      sourceUrl: "https://tracker.example/pixel?message=123",
      sourceHost: "tracker.example",
    });
    expect(result.html).toContain(`data-mail-remote-image="${result.remoteImages[0]?.id}"`);
    expect(result.html).not.toContain("00000000-0000-4000-8000-000000000099");
    expect(result.html).not.toContain("00000000-0000-4000-8000-000000000098");
  });

  test("bounds retained remote image metadata", () => {
    const result = sanitizeIncomingMailHtmlWithRemoteImages(
      Array.from({ length: 70 }, (_, index) => `<img src="https://images.example/${index}.png">`).join(""),
    );
    expect(result.remoteImages).toHaveLength(64);
    expect(result.html.match(/data-mail-remote-image=/gu)).toHaveLength(64);
    expect(result.html).not.toContain("https://images.example");
  });
});
