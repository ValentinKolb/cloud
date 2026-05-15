import { describe, expect, test } from "bun:test";
import { renderPrettyTableHtml } from "./pretty-table";

describe("pretty table rendering", () => {
  test("renders inline markdown formatting in body cells", () => {
    const html = renderPrettyTableHtml({
      headers: ["Item", "Meta"],
      rows: [["**Summary**", "`code` and *italic* and ~~done~~"]],
    });

    expect(html).toContain("<strong>Summary</strong>");
    expect(html).not.toContain("**Summary**");
    expect(html).toContain("<code>code</code>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<s>done</s>");
  });

  test("keeps note links and tags pretty while rendering inline markdown", () => {
    const html = renderPrettyTableHtml(
      {
        headers: ["Idea"],
        rows: [["**Build** [Treehouse](note://5ARr8F) #garden"]],
      },
      { notebookId: "nb1234" },
    );

    expect(html).toContain("<strong>Build</strong>");
    expect(html).toContain('href="/app/notebooks/nb1234/notes/5ARr8F"');
    expect(html).toContain('href="/app/notebooks/nb1234/tags/garden"');
  });

  test("formats standalone ISO date-time strings", () => {
    const html = renderPrettyTableHtml({
      headers: ["created", "title"],
      rows: [["2026-05-14T18:01:15.575Z", "2026-05-13"]],
    });

    expect(html).toContain('<time datetime="2026-05-14T18:01:15.575Z"');
    expect(html).toContain("14 May 2026, 18:01");
    expect(html).toContain(">2026-05-13<");
  });
});
