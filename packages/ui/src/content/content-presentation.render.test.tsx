import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-content-presentation-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const {
  Calendar,
  Chart,
  DataTable,
  DocCode,
  DocNote,
  Docs,
  FileBrowser,
  FileView,
  Lightbox,
  LogEntriesTable,
  PdfPreview,
} = await import("../index");

describe("@k2b/ui content presentation", () => {
  test("renders sortable accessible data tables, footer, selection and empty state", () => {
    const html = renderToString(() =>
      DataTable({
        rows: [{ id: "one", name: "Ada", count: 3 }],
        columns: [
          { id: "name", header: "Name", value: "name", sortable: true },
          { id: "count", header: "Count", value: "count" },
        ],
        getRowId: (row: { id: string }) => row.id,
        selectedRowId: "one",
        sort: { key: "name", direction: "asc" },
        sortHref: (sort: { key: string; direction: string }) => `?sort=${sort.key}&direction=${sort.direction}`,
        footer: { values: { name: "Total", count: 3 } },
      }),
    );
    expect(html).toContain('aria-sort="ascending"');
    expect(html).toContain("direction=desc");
    expect(html).toContain('data-selected="true"');
    expect(html).toContain("<tfoot");
  });

  test("renders semantic log entries with localized timestamps", () => {
    const html = renderToString(() =>
      createComponent(LogEntriesTable, {
        entries: [{ id: 1, timestamp: "2026-01-01T12:00:00Z", level: "error", source: "worker", message: "Failed" }],
      }),
    );
    expect(html).toContain('aria-label="Log entries"');
    expect(html).toContain('data-level="error"');
    expect(html).toContain("worker");
    expect(html).toContain("Failed");
  });

  test("renders standard and interactive timeline charts", () => {
    const line = renderToString(() =>
      createComponent(Chart, { kind: "line", series: [{ label: "Requests", data: [{ x: 1, y: 2 }] }], label: "Requests" }),
    );
    const timeline = renderToString(() =>
      createComponent(Chart, {
        kind: "stateTimeline",
        interactive: true,
        rows: [{ label: "Worker", intervals: [{ from: 0, to: 5, state: "ok", tooltip: "Succeeded" }] }],
        states: [{ state: "ok", label: "Healthy" }],
      }),
    );
    expect(line).toContain("stdlib-chart");
    expect(timeline).toContain('role="application"');
    expect(timeline).toContain('data-chart-tooltip="Succeeded"');
    expect(timeline).toContain("Zoom in");
  });

  test("renders controlled calendar navigation and events", () => {
    const html = renderToString(() =>
      createComponent(Calendar, {
        date: new Date("2026-07-15T12:00:00Z"),
        dateContext: { timeZone: "UTC", locale: "en" },
        items: [{ id: "a", title: "Review", startsAt: "2026-07-15T09:00:00Z", endsAt: null, deadline: null }],
      }),
    );
    expect(html).toContain("July 2026");
    expect(html).toContain("Previous month");
    expect(html).toContain("Review");
    expect(html).toContain('aria-pressed="true"');
  });

  test("renders file tree, media views, PDF fallback and gallery lightbox", () => {
    const browser = renderToString(() =>
      createComponent(FileBrowser, {
        title: "Project",
        items: [{ id: "src", name: "src", type: "directory", children: [{ id: "app", name: "app.ts", type: "file" }] }],
        defaultExpandedIds: ["src"],
      }),
    );
    const audio = renderToString(() => createComponent(FileView, { name: "clip.mp3", mimeType: "audio/mpeg", src: "/clip.mp3" }));
    const pdf = renderToString(() => createComponent(PdfPreview, { src: "/report.pdf", title: "Report" }));
    const lightbox = renderToString(() =>
      createComponent(Lightbox, {
        open: true,
        images: [{ src: "/one.jpg", alt: "One" }, { src: "/two.jpg", alt: "Two" }],
      }),
    );
    expect(browser).toContain('role="tree"');
    expect(browser).toContain("app.ts");
    expect(audio).toContain("<audio");
    expect(pdf).toContain('type="application/pdf"');
    expect(lightbox).toContain("Previous image");
    expect(lightbox).toContain('aria-modal="true"');
  });

  test("renders portable documentation layout and content primitives", () => {
    const html = renderToString(() =>
      createComponent(Docs, {
        navigation: "Guide",
        aside: "Contents",
        children: [
          createComponent(DocCode, { code: "bun add @k2b/ui", language: "shell" }),
          createComponent(DocNote, { title: "Portable", variant: "tip", children: "No Cloud runtime required." }),
        ],
      }),
    );
    expect(html).toContain('aria-label="Documentation navigation"');
    expect(html).toContain("Copy code");
    expect(html).toContain('data-variant="tip"');
  });
});
