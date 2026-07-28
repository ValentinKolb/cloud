import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-content-tests-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { CodeDisplay, MarkdownView, Pagination, RangePicker, StructuredDataPreview } = await import("../index");

describe("@k2b/ui complete content primitives", () => {
  test("renders highlighted code as accessible numbered lines with copy", () => {
    const html = renderToString(() =>
      createComponent(CodeDisplay, { code: "select 1;\nselect 2;", language: "sql", title: "Query" }),
    );

    expect(html.match(/k2b-code-display__line/g)).toHaveLength(2);
    expect(html).toContain("k2b-code-display__number");
    expect(html).toContain("Copy code");
    expect(html).toContain("Query");
  });

  test("renders trusted markdown with compact-heading mode", () => {
    const html = renderToString(() =>
      createComponent(MarkdownView, { html: "<h2>Result</h2>", label: "Rendered result", smallHeadings: true }),
    );

    expect(html).toContain('aria-label="Rendered result"');
    expect(html).toContain('data-small-headings="true"');
    expect(html).toContain("<h2>Result</h2>");
  });

  test("renders formatted, truncated, empty, and raw structured data", () => {
    const formatted = renderToString(() =>
      createComponent(StructuredDataPreview, {
        title: "Payload",
        data: { one: 1, nested: { ok: true }, hidden: 3 },
        maxRows: 2,
      }),
    );
    const raw = renderToString(() =>
      createComponent(StructuredDataPreview, { data: { ok: true }, defaultMode: "raw", copy: true }),
    );
    const empty = renderToString(() => createComponent(StructuredDataPreview, { data: null, empty: "Nothing received" }));

    expect(formatted).toContain("<dt");
    expect(formatted).toContain("1 more rows hidden.");
    expect(formatted).toContain("View raw");
    expect(raw).toContain("Copy data");
    expect(raw).toContain("View formatted");
    expect(empty).toContain("Nothing received");
  });

  test("renders compact pagination with gaps and directional relations", () => {
    const html = renderToString(() =>
      createComponent(Pagination, {
        currentPage: 5,
        totalPages: 10,
        href: (page) => `/items?page=${page}`,
      }),
    );
    const hidden = renderToString(() =>
      createComponent(Pagination, { currentPage: 1, totalPages: 1, href: (page) => `/items?page=${page}` }),
    );

    expect(html).toContain("Page 5 of 10");
    expect(html).toContain('rel="prev"');
    expect(html).toContain('rel="next"');
    expect(html).toContain("…");
    expect(hidden).toBe("");
  });

  test("renders URL-backed range selection with caller-owned values", () => {
    const html = renderToString(() =>
      createComponent(RangePicker, {
        value: "24h",
        ariaLabel: "Telemetry window",
        options: [
          { value: "1h", href: "?window=1h" },
          { value: "24h", label: "One day", href: "?window=24h" },
        ],
      }),
    );

    expect(html).toContain('aria-label="Telemetry window"');
    expect(html).toContain(">Window<");
    expect(html).toContain('aria-current="page"');
    expect(html).toContain("One day");
  });
});
