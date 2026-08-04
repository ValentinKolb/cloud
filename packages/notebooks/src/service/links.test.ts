import { describe, expect, test } from "bun:test";
import { transformNoteLinks } from "./links";

describe("transformNoteLinks", () => {
  test("rewrites note links rendered as one complete anchor", () => {
    const html =
      '<a href="note://abc123" target="_blank" rel="noopener noreferrer" class="md-link-widget">' +
      '<span class="md-link-label">[Linked note]</span>' +
      '<i class="md-link-icon ti ti-arrow-up-right text-xs" aria-hidden="true"></i>' +
      "</a>";

    const transformed = transformNoteLinks(html, {
      noteShortIdToHref: new Map([["abc123", "/app/notebooks/book/notes/abc123"]]),
    });

    expect(transformed).toContain('href="/app/notebooks/book/notes/abc123"');
    expect(transformed).toContain("<span>Linked note</span>");
    expect(transformed).not.toContain("note://abc123");
    expect(transformed).not.toContain("ti-arrow-up-right");
  });
});
