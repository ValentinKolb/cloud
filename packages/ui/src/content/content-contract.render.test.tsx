import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createConfig } from "@k2b/ssr";
import { dates } from "@k2b/stdlib";
import { createComponent } from "solid-js";
import { renderToString } from "solid-js/web";
import type { CalendarEvent } from "./Calendar";
import type { DataTableProps } from "./DataTable";
import { getFileViewPreviewKind } from "./file-view-preview";

const root = mkdtempSync(resolve(tmpdir(), "k2b-ui-content-contract-"));
const { plugin } = createConfig({ dev: true, rootDir: root });
Bun.plugin(plugin());
process.once("exit", () => rmSync(root, { recursive: true, force: true }));

const { default: Calendar } = await import("./Calendar");
const { default: CodeDisplay } = await import("./CodeDisplay");
const { default: DataTable } = await import("./DataTable");
const { DocCode, DocConceptGrid, DocRows } = await import("./Docs");
const { default: FileTree } = await import("./FileTree");
const { default: LogEntriesTable } = await import("./LogEntriesTable");
const { default: MarkdownView } = await import("./MarkdownView");
const { Pagination } = await import("./Pagination");
const { default: PdfPreview } = await import("./PdfPreview");
const { default: RangePicker } = await import("./RangePicker");
const { default: StructuredDataPreview } = await import("./StructuredDataPreview");
const contentCss = await Bun.file(resolve(import.meta.dir, "../styles/content-parity.css")).text();

describe("@k2b/ui Cloud content contract", () => {
  test("keeps the complete calendar event and view contract on the server", () => {
    const events: CalendarEvent[] = [
      {
        id: "review",
        title: "Review",
        start: "2026-07-15T09:00:00Z",
        end: "2026-07-15T10:00:00Z",
        color: "emerald",
        location: "Studio",
      },
    ];
    const html = renderToString(() =>
      createComponent(Calendar, {
        date: "2026-07-15T12:00:00Z",
        events,
        view: "month",
        views: ["day", "week", "month", "year"],
        timeZone: "UTC",
        withWeekNumbers: true,
        navigationPending: true,
        getDateHref: (date, view) => `/calendar?view=${view}&date=${date.toISOString()}`,
        getViewHref: (view) => `/calendar?view=${view}`,
      }),
    );

    expect(html).toContain('aria-label="Calendar view"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Review");
    expect(html).toContain("Review, 09:00 to 10:00");
    expect(html).toContain("view=day");
    expect(contentCss).toContain("--k2b-calendar-event-text: #047857");
    expect(contentCss).toContain("--k2b-calendar-event-surface: #ecfdf5");
    expect(contentCss).toContain("color: var(--k2b-calendar-event-text, var(--k2b-text))");
    expect(contentCss).toContain("background: var(--k2b-calendar-event-surface, var(--k2b-surface-muted))");
  });

  test("indexes year-view events once instead of rescanning them for every day", () => {
    const formatDateKey = dates.formatDateKey;
    const mutableDates = dates as { -readonly [Key in keyof typeof dates]: (typeof dates)[Key] };
    let calls = 0;
    mutableDates.formatDateKey = (...args: Parameters<typeof formatDateKey>) => {
      calls += 1;
      return formatDateKey(...args);
    };

    try {
      renderToString(() =>
        createComponent(Calendar, {
          date: "2026-07-15T12:00:00Z",
          view: "year",
          timeZone: "Europe/Berlin",
          events: Array.from({ length: 64 }, (_, index) => ({
            id: String(index),
            title: `Event ${index}`,
            start: "2026-07-15T09:00:00Z",
            end: "2026-07-15T10:00:00Z",
          })),
        }),
      );
    } finally {
      mutableDates.formatDateKey = formatDateKey;
    }

    expect(calls).toBeLessThan(2_000);
  });

  test("keeps code language defaults and custom documentation hooks", () => {
    const code = renderToString(() => createComponent(CodeDisplay, { code: "const answer = 42;", language: "ts" }));
    const docs = renderToString(() => [
      createComponent(DocCode, {
        code: "select 1",
        format: (value) => value.toUpperCase(),
        highlight: (value) => `<mark>${value}</mark>`,
        copy: true,
        copyText: "select 1",
        lineNumbers: true,
      }),
      createComponent(DocConceptGrid, { items: [{ title: "Source", icon: "ti ti-code", text: "Exact contract" }] }),
      createComponent(DocRows, { items: [{ title: "Mode", icon: "ti ti-check", text: "Portable" }] }),
    ]);

    expect(code).toContain("code-display");
    expect(code).toContain("k2b-content-code-display__body");
    expect(code).toContain('role="region"');
    expect(code).toContain('aria-label="ts code"');
    expect(code).toContain('tabindex="0"');
    expect(code).toContain("cd-k");
    expect(code).toContain("Copy");
    expect(docs).toContain("<mark>SELECT 1</mark>");
    expect(docs).toContain("Exact contract");
    expect(docs).toContain("Portable");
  });

  test("keeps DataTable callback names, URL sorting, defaults and scroll hooks", () => {
    type PersonRow = { id: string; name: string; count: number };
    const html = renderToString(() =>
      DataTable<PersonRow>({
        rows: [{ id: "one", name: "Ada", count: 3 }],
        columns: [
          { id: "name", header: ({ col }) => `Name (${col.id})`, value: "name", sortable: true },
          { id: "count", header: "Count", value: "count" },
        ],
        sort: { key: "count", direction: "asc" },
        sortHref: (sort) => `?sort=${sort.key}&direction=${sort.direction}`,
        getRowId: (row) => row.id,
        selectedRowId: "one",
        renderCell: ({ col, value, render }) => (col.id === "name" ? String(value).toUpperCase() : render(value)),
        footer: { values: { name: "Total", count: 3 } },
        scrollPreserveKey: "people",
      }),
    );

    expect(html).toContain("Name (name)");
    expect(html).toContain("ADA");
    expect(html).toContain("direction=desc");
    expect(html).toContain('data-scroll-preserve="people"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-selected="true"');
    expect(html).toContain('data-has-footer="true"');
    expect(html).toContain("Total");
  });

  test("composes a labelled professional DataTable panel without component-valued props", () => {
    type Row = { id: string; name: string };
    const html = renderToString(() =>
      createComponent(DataTable.Panel, {
        get children() {
          return [
            createComponent(DataTable.Header, { title: "Orders", subtitle: "1 of 1 rows", children: "Settings" }),
            createComponent(DataTable.Controls, { children: "Search orders" }),
            DataTable<Row>({
              rows: [{ id: "one", name: "Ada" }],
              columns: [{ id: "name", header: "Name", value: "name" }],
              getRowId: (row) => row.id,
            }),
            createComponent(DataTable.Footer, { children: "Page 1 of 1" }),
          ];
        },
      }),
    );

    const headingId = html.match(/id="(k2b-data-table-[^"]+-heading)"/)?.[1];
    expect(headingId).toBeTruthy();
    expect(html).toContain(`aria-labelledby="${headingId}"`);
    expect(html).not.toContain('aria-label="Data table"');
    expect(html).toContain("k2b-data-panel__controls");
    expect(html).toContain("Settings");
    expect(html).toContain("Page 1 of 1");
  });

  test("lets standalone DataTable regions override their accessible name", () => {
    const html = renderToString(() =>
      DataTable({
        ariaLabel: "Project orders",
        rows: [{ id: "one" }],
        columns: [{ id: "id", header: "ID", value: "id" }],
      }),
    );

    expect(html).toContain('aria-label="Project orders"');
  });

  test("lets callers choose table surface independently from geometry classes", () => {
    const paper = renderToString(() =>
      DataTable({
        surface: "paper",
        class: "overflow-x-auto",
        rows: [{ id: "one" }],
        columns: [{ id: "id", header: "ID", value: "id" }],
      }),
    );
    const plain = renderToString(() =>
      DataTable({
        surface: "plain",
        rows: [{ id: "one" }],
        columns: [{ id: "id", header: "ID", value: "id" }],
      }),
    );

    expect(paper).toContain('data-surface="paper"');
    expect(paper).toContain("overflow-x-auto");
    expect(plain).toContain('data-surface="plain"');
  });

  test("keeps SSR navigation and observability content defaults", () => {
    const pagination = renderToString(() =>
      createComponent(Pagination, { currentPage: 5, totalPages: 10, baseUrl: "/items?page=" }),
    );
    const range = renderToString(() =>
      createComponent(RangePicker, {
        value: "24h",
        options: [
          { value: "1h", href: "?window=1h" },
          { value: "24h", href: "?window=24h" },
        ],
      }),
    );
    const logs = renderToString(() =>
      createComponent(LogEntriesTable, {
        entries: [
          {
            id: 1,
            level: "error",
            source: "worker",
            message: "Failed",
            metadata: null,
            createdAt: "2026-01-01T12:00:00Z",
          },
        ],
      }),
    );

    expect(pagination).toContain('href="/items?page=4"');
    expect(pagination).toContain('rel="next"');
    expect(range).toContain('aria-current="true"');
    expect(logs).toContain("ti-alert-circle");
    expect(logs).toContain("worker");
  });

  test("renders unknown log levels without mislabelling them as debug", () => {
    const html = renderToString(() =>
      createComponent(LogEntriesTable, {
        entries: [
          { id: 1, level: "notice", source: "worker", message: "Observed", metadata: null, createdAt: "2026-01-01T12:00:00Z" },
        ],
      }),
    );

    expect(html).toContain('data-level="neutral"');
    expect(html).toContain("notice");
    expect(html).not.toContain("ti-bug");
    expect(html).toContain('aria-hidden="true"');
  });

  test("keeps pagination work bounded for very large result sets", () => {
    const html = renderToString(() =>
      createComponent(Pagination, {
        currentPage: 500_000_000,
        totalPages: 1_000_000_000,
        baseUrl: "/items?page=",
      }),
    );

    expect(html.match(/<a /g)?.length).toBeLessThanOrEqual(6);
    expect(html).toContain("500000000");
    expect(html).toContain("1000000000");
  });

  test("normalizes invalid pagination bounds", () => {
    const html = renderToString(() =>
      createComponent(Pagination, { currentPage: -4, totalPages: 3, baseUrl: "/items?page=" }),
    );

    expect(html).toContain("Page 1 of 3");
    expect(html).not.toContain("page=0");
  });

  test("keeps date-only calendar values in the configured local day and noninteractive events neutral", () => {
    const html = renderToString(() =>
      createComponent(Calendar, {
        date: "2026-07-15",
        selectedDate: "2026-07-15",
        view: "day",
        timeZone: "America/Los_Angeles",
        events: [
          { id: "planning", title: "All-day planning", start: "2026-07-15", end: "2026-07-16", allDay: true },
        ],
      }),
    );

    expect(html).toContain("All-day planning");
    const event = html.match(/<div class="k2b-calendar-event"[^>]*>/)?.[0] ?? "";
    expect(event).not.toContain('role="button"');
    expect(event).not.toContain("tabindex");
  });

  test("keeps trusted Markdown, structured data and PDF interaction shells", () => {
    const markdown = renderToString(() =>
      createComponent(MarkdownView, { trustedHtml: "<h2>Result</h2>", smallHeadings: true }),
    );
    const data = renderToString(() =>
      createComponent(StructuredDataPreview, { data: { ok: true }, defaultMode: "raw", copy: true }),
    );
    const pdf = renderToString(() =>
      createComponent(PdfPreview, { request: async () => new Blob([], { type: "application/pdf" }), title: "Report" }),
    );

    expect(markdown).toContain("k2b-content-markdown");
    expect(markdown).toContain('data-small-headings="true"');
    expect(markdown).toContain("<h2>Result</h2>");
    expect(data).toContain("View formatted");
    expect(data).toContain("k2b-content-structured-data__action");
    expect(pdf).toContain("Open preview");
    expect(pdf).toContain("Preview PDF");
  });

  test("keeps DataTable density, alignment, sticky and footer geometry hooks", () => {
    type Row = { id: string; label: string; total: number };
    const html = renderToString(() =>
      DataTable<Row>({
        rows: [{ id: "one", label: "Ada", total: 3 }],
        columns: [
          { id: "label", header: "Label", subtitle: "who", value: "label" },
          { id: "total", header: "Total", value: "total" },
          { id: "mid", header: "Mid", value: "label", align: "center" },
        ],
        density: "compact",
        verticalAlign: "top",
        fillHeight: true,
        footer: { values: { total: 3 } },
        onLoadMore: () => {},
      }),
    );

    expect(html).toContain('data-density="compact"');
    expect(html).toContain('class="k2b-data-table" data-fill="true"');
    expect(html).toContain('data-sticky="true"');
    expect(html).toContain("k2b-data-table__head-row");
    expect(html).toContain("k2b-data-table__foot-row");
    expect(html).toContain("k2b-data-table__footer-cell");
    expect(html).toContain("k2b-data-table__header-subtitle");
    expect(html).toContain('data-align="right"');
    expect(html).toContain('data-align="center"');
    expect(html).toContain('data-valign="top"');
    expect(html).toContain("k2b-data-table__fill");
    expect(html).toContain("k2b-data-table__sentinel");
    expect(html).toContain("k2b-data-table__cell-text");
    expect(html).toContain('scope="col"');
    expect(html.indexOf("<tbody")).toBeLessThan(html.indexOf("<tfoot"));
  });

  test("infers each DataTable column alignment once per row set", () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({ value: index + 1 }));
    let reads = 0;
    const tableProps: DataTableProps<(typeof rows)[number]> = {
      rows,
      get columns() {
        return [
          {
            id: "value",
            header: "Value",
            value: (row: (typeof rows)[number]) => {
              reads += 1;
              return row.value;
            },
          },
        ];
      },
    };
    const html = renderToString(() => DataTable(tableProps));

    // One read determines the alignment; one read per row renders the cells.
    expect(reads).toBe(rows.length + 1);
    expect(html).toContain('data-align="right"');
  });

  test("keeps the DataTable base geometry when callers add table classes", () => {
    const html = renderToString(() =>
      DataTable({
        rows: [{ id: "one" }],
        columns: [{ id: "id", header: "ID", value: "id" }],
        tableClass: "min-w-[72rem] text-sm",
      }),
    );

    expect(html).toContain('class="k2b-data-table min-w-[72rem] text-sm"');
  });

  test("keeps observability presentation hooks off Cloud-era utility names", () => {
    const pagination = renderToString(() =>
      createComponent(Pagination, { currentPage: 5, totalPages: 20, baseUrl: "/items?page=" }),
    );
    const range = renderToString(() =>
      createComponent(RangePicker, {
        value: "24h",
        label: "Window",
        options: [
          { value: "1h", href: "?window=1h" },
          { value: "24h", href: "?window=24h" },
        ],
      }),
    );
    const logs = renderToString(() =>
      createComponent(LogEntriesTable, {
        entries: [
          { id: 1, level: "warn", source: "worker", message: "Slow", metadata: null, createdAt: "2026-01-01T12:00:00Z" },
        ],
      }),
    );

    // Screen-reader summary must stay visually hidden, and the far pages must
    // stay collapsible below the `sm` breakpoint like Cloud.
    expect(pagination).toContain("k2b-sr-only");
    expect(pagination).toContain("k2b-pagination__pages");
    expect(pagination).toContain("k2b-pagination__ellipsis");
    expect(pagination).toContain("k2b-pagination__page--wide-only");
    expect(pagination).toContain("k2b-pagination__page is-current");
    expect(pagination).not.toContain('class="sr-only"');
    expect(pagination).not.toContain("pagination-item");

    expect(range).toContain("k2b-range-picker__caption");
    expect(range).toContain('data-selected="true"');
    expect(range).not.toContain("btn-input");

    expect(logs).toContain('data-level="warn"');
    expect(logs).toContain("k2b-log-table__source");
    expect(logs).toContain("k2b-log-table__time");
    expect(logs).not.toContain("text-amber-500");
  });

  test("styles every class the content group renders", async () => {
    const owned = [
      "Calendar.tsx",
      "Chart.tsx",
      "DataTable.tsx",
      "LogEntriesTable.tsx",
      "Pagination.tsx",
      "RangePicker.tsx",
    ];
    const packageRoot = resolve(import.meta.dir, "../..");
    const css = await Bun.file(resolve(packageRoot, "dist/styles.css")).text();
    const defined = new Set<string>();
    for (const match of css.matchAll(/\.((?:[A-Za-z0-9_-]|\\.)+)/g)) defined.add(match[1]!.replace(/\\/g, ""));

    const unstyled: string[] = [];
    for (const file of owned) {
      // Comments carry documentation examples, not rendered markup.
      const source = (await Bun.file(resolve(import.meta.dir, file)).text())
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const match of source.matchAll(/class(?:Name)?\s*[:=]\s*\{?\s*[`"']([^`"']*)[`"']/g)) {
        // Interpolated segments are caller-owned classes, not package classes.
        const literal = match[1]!.replace(/\$\{[^}]*\}?/g, " ");
        for (const token of literal.split(/\s+/)) {
          // `ti*` icon classes ship in the optional Tabler preset, not here.
          if (!token || token.startsWith("ti-") || token === "ti") continue;
          if (!/^[A-Za-z][\w-]*$/.test(token)) continue;
          if (!defined.has(token)) unstyled.push(`${file}: ${token}`);
        }
      }
    }

    expect(unstyled).toEqual([]);
  });

  test("keeps path-first files and preview helpers", () => {
    const tree = renderToString(() =>
      createComponent(FileTree, {
        entries: [
          { path: "/src/app.ts", size: 4 },
          { path: "/README.md", size: 10 },
        ],
        selectedPath: "/README.md",
        actions: { download: () => {} },
      }),
    );
    expect(tree).toContain('role="tree"');
    expect(tree).toContain("README.md");
    expect(tree).toContain("k2b-content-file-tree__row");
    expect(tree).toContain("k2b-content-file-tree__select");
    expect(tree).toContain("<button");
    expect(tree).toContain("Actions for README.md");
    expect(getFileViewPreviewKind({ path: "report.json" })).toBe("json");
  });
});
