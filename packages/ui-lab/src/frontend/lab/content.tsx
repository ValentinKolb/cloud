/**
 * Content tab — rich content components: charts, markdown rendering,
 * and the standalone MarkdownEditor for full-page editor surfaces.
 *
 * Chart is a thin Solid wrapper around `stdlib.charts`; SVG re-renders
 * reactively when props change. Axes / ticks inherit `currentColor`,
 * so light/dark mode works automatically.
 */

import {
  Chart,
  DataTable,
  type DataTableColumn,
  FilterChip,
  type FilterChipSection,
  MarkdownEditor,
  MarkdownView,
  StructuredDataPreview,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import DemoCard from "./DemoCard";

const FROM_UI = "@valentinkolb/cloud/ui";

const sampleMetadata = {
  expiredCandidates: 0,
  demotedToGuest: 0,
  skipped: 0,
  failed: 0,
  source: "accounts.cleanup",
  labels: { environment: "dev", runner: "scheduler" },
};

/* ── Chart variants ───────────────────────────────────────── */

export const ChartLine = () => {
  const lineSeries = [
    {
      label: "Revenue",
      data: [
        { x: 1, y: 42 },
        { x: 2, y: 51 },
        { x: 3, y: 47 },
        { x: 4, y: 63 },
        { x: 5, y: 71 },
        { x: 6, y: 68 },
        { x: 7, y: 82 },
        { x: 8, y: 91 },
      ],
    },
    {
      label: "Costs",
      data: [
        { x: 1, y: 30 },
        { x: 2, y: 33 },
        { x: 3, y: 36 },
        { x: 4, y: 41 },
        { x: 5, y: 44 },
        { x: 6, y: 48 },
        { x: 7, y: 52 },
        { x: 8, y: 58 },
      ],
    },
  ];
  return (
    <DemoCard
      id="chart-line"
      variant="line, multi-series, smoothed"
      chip={{ kind: "component", name: "Chart", from: FROM_UI }}
      code={`<Chart
  kind="line"
  class="h-56 text-dimmed"
  series={[
    { label: "Revenue", data: [{ x: 1, y: 42 }, …] },
    { label: "Costs", data: [{ x: 1, y: 30 }, …] },
  ]}
  yAxis={{ format: (v) => \`€\${v}k\` }}
  legend
  smooth
/>`}
    >
      <Chart kind="line" class="h-56 text-dimmed" series={lineSeries} yAxis={{ format: (v) => `€${v}k` }} legend smooth />
    </DemoCard>
  );
};

export const ChartBar = () => {
  const data = [
    { label: "Mon", value: 42 },
    { label: "Tue", value: 51 },
    { label: "Wed", value: 38 },
    { label: "Thu", value: 63 },
    { label: "Fri", value: 71 },
    { label: "Sat", value: 24 },
    { label: "Sun", value: 18 },
  ];
  return (
    <DemoCard
      id="chart-bar"
      variant="bar"
      chip={{ kind: "component", name: "Chart", from: FROM_UI }}
      code={`<Chart kind="bar" class="h-56 text-dimmed" data={data} showValues />`}
    >
      <Chart kind="bar" class="h-56 text-dimmed" data={data} showValues />
    </DemoCard>
  );
};

export const ChartDonut = () => {
  const data = [
    { label: "Direct", value: 412 },
    { label: "Search", value: 287 },
    { label: "Referral", value: 154 },
    { label: "Email", value: 89 },
    { label: "Other", value: 31 },
  ];
  return (
    <DemoCard
      id="chart-donut"
      variant="donut"
      chip={{ kind: "component", name: "Chart", from: FROM_UI }}
      code={`<Chart kind="donut" class="h-56 text-dimmed" data={data} showLabels />`}
    >
      <Chart kind="donut" class="h-56 text-dimmed" data={data} showLabels />
    </DemoCard>
  );
};

export const ChartSparkline = () => (
  <DemoCard
    id="chart-sparkline"
    variant="sparklines (inline trends)"
    chip={{ kind: "component", name: "Chart", from: FROM_UI }}
    description="Decorative inline trend visualisation. Colour inherits via text-* class. Optional showLast / showMinMax markers."
    code={`<Chart kind="sparkline" class="h-8 text-emerald-600" data={[12,14,13,16,18,17,21,22,24,28]} showLast showMinMax />`}
  >
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <span class="text-[10px] uppercase tracking-wider text-dimmed w-16 shrink-0">Up</span>
        <Chart
          kind="sparkline"
          class="flex-1 h-8 text-emerald-600 dark:text-emerald-400"
          data={[12, 14, 13, 16, 18, 17, 21, 22, 24, 28]}
          showLast
          showMinMax
        />
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[10px] uppercase tracking-wider text-dimmed w-16 shrink-0">Down</span>
        <Chart
          kind="sparkline"
          class="flex-1 h-8 text-red-500 dark:text-red-400"
          data={[42, 39, 41, 35, 33, 28, 24, 22, 19, 15]}
          showLast
          showMinMax
        />
      </div>
      <div class="flex items-center gap-3">
        <span class="text-[10px] uppercase tracking-wider text-dimmed w-16 shrink-0">Flat</span>
        <Chart kind="sparkline" class="flex-1 h-8 text-dimmed" data={[50, 51, 49, 50, 50, 51, 50, 49, 51, 50]} showLast />
      </div>
    </div>
  </DemoCard>
);

export const ChartLive = () => {
  const [data, setData] = createSignal<{ x: number; y: number }[]>(
    Array.from({ length: 20 }, (_, i) => ({ x: i, y: 50 + Math.sin(i / 2) * 15 })),
  );
  onMount(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const last = prev[prev.length - 1]!;
        const next = { x: last.x + 1, y: Math.max(10, Math.min(90, last.y + (Math.random() - 0.5) * 12)) };
        return [...prev.slice(1), next];
      });
    }, 1000);
    onCleanup(() => clearInterval(id));
  });
  return (
    <DemoCard
      id="chart-live"
      variant="live (reactive series)"
      chip={{ kind: "component", name: "Chart", from: FROM_UI }}
      description="setInterval pushes a new point into a signal every second; Chart re-renders automatically."
      code={`const [data, setData] = createSignal<{x:number; y:number}[]>(...);
setInterval(() => setData(prev => [...prev.slice(1), nextPoint]), 1000);

<Chart kind="line" class="h-56" series={[{ label: "metric", data: data() }]} smooth area />`}
    >
      <Chart kind="line" class="h-56 text-dimmed" series={[{ label: "metric", data: data() }]} smooth area />
    </DemoCard>
  );
};

export const ChartEmpty = () => (
  <DemoCard
    id="chart-empty"
    variant="empty-state fallback"
    chip={{ kind: "component", name: "Chart", from: FROM_UI }}
    description="Wrapper short-circuits empty data → tonal 'No data' placeholder instead of an empty SVG."
    code={`<Chart kind="line" class="h-32" series={[]} />
<Chart kind="bar" class="h-32" data={[]} />`}
  >
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Chart kind="line" class="h-32" series={[]} />
      <Chart kind="bar" class="h-32" data={[]} />
      <Chart kind="donut" class="h-32" data={[]} />
    </div>
  </DemoCard>
);

/* ── Data tables ─────────────────────────────────────────── */

type TableDemoRow = {
  id: string;
  customer: string;
  status: "new" | "shipped" | "delivered";
  items: number;
  total: number;
  createdAt: Date;
};

const tableDemoRows: TableDemoRow[] = [
  { id: "ord_1001", customer: "Alice Becker", status: "delivered", items: 3, total: 129.9, createdAt: new Date("2026-05-01T10:15:00") },
  { id: "ord_1002", customer: "Bob Schmidt", status: "shipped", items: 1, total: 42.5, createdAt: new Date("2026-05-03T15:40:00") },
  { id: "ord_1003", customer: "Cara Müller", status: "new", items: 5, total: 219.99, createdAt: new Date("2026-05-04T08:05:00") },
];

const statusClass = (status: TableDemoRow["status"]) =>
  ({
    new: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    shipped: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
    delivered: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  })[status];

export const DataTableFullDemo = () => {
  const columns: DataTableColumn<TableDemoRow>[] = [
    { id: "customer", header: "Customer", subtitle: "text", value: "customer" },
    { id: "status", header: "Status", subtitle: "select", value: "status" },
    { id: "items", header: "Items", subtitle: "number", value: "items", cellClass: "tabular-nums" },
    { id: "total", header: "Total", subtitle: "decimal", value: "total", cellClass: "tabular-nums" },
    { id: "created", header: "Created", subtitle: "date", value: "createdAt", cellClass: "whitespace-nowrap" },
    {
      id: "actions",
      header: <span class="sr-only">Actions</span>,
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap max-w-none",
    },
  ];
  const footerValues = {
    customer: `${tableDemoRows.length} rows`,
    items: tableDemoRows.reduce((sum, row) => sum + row.items, 0),
    total: tableDemoRows.reduce((sum, row) => sum + row.total, 0),
  };

  return (
    <DemoCard
      id="datatable-full"
      variant="full-feature table"
      chip={{ kind: "component", name: "DataTable", from: FROM_UI }}
      description="Generic rows + columns, header subtitles, custom cell rendering, selected row, footer aggregations and crosshair hover."
      code={`<DataTable
  rows={rows}
  columns={columns}
  getRowId={(row) => row.id}
  selectedRowId="ord_1002"
  hoverRows
  footer={{ values: { customer: "3 rows", items: 9, total: 392.39 } }}
  renderCell={({ row, col, render }) =>
    col.id === "status" ? <StatusBadge value={row.status} /> : render(row[col.id])
  }
/>`}
    >
      <DataTable
        rows={tableDemoRows}
        columns={columns}
        getRowId={(row) => row.id}
        selectedRowId="ord_1002"
        hoverRows
        class="paper overflow-auto max-h-72"
        footer={{
          values: footerValues,
          renderCell: ({ col, value, render }) => {
            if (col.id === "items" || col.id === "total") return <span>{Number(value ?? 0).toLocaleString()} Σ</span>;
            return render(value);
          },
        }}
        renderCell={({ row, col, render }) => {
          if (col.id === "customer") return <span class="font-medium text-primary">{row.customer}</span>;
          if (col.id === "status") {
            return <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(row.status)}`}>{row.status}</span>;
          }
          if (col.id === "total") return `€${row.total.toFixed(2)}`;
          if (col.id === "created") return row.createdAt.toLocaleDateString("de-DE");
          if (col.id === "actions") return <button class="btn-secondary btn-sm">Open</button>;
          return render(row[col.id as keyof TableDemoRow]);
        }}
      />
    </DemoCard>
  );
};

export const DataTableMinimalDemo = () => {
  const rows = [
    { name: "Alpha", value: 12, active: true },
    { name: "Beta", value: 8, active: false },
  ];
  const columns: DataTableColumn<(typeof rows)[number]>[] = [
    { id: "name", header: "Name", value: "name" },
    { id: "value", header: "Value", value: "value" },
    { id: "active", header: "Active", value: "active" },
  ];

  return (
    <DemoCard
      id="datatable-minimal"
      variant="minimal table"
      chip={{ kind: "component", name: "DataTable", from: FROM_UI }}
      code={`<DataTable rows={rows} columns={[
  { id: "name", header: "Name", value: "name" },
  { id: "value", header: "Value", value: "value" },
]} />`}
    >
      <DataTable rows={rows} columns={columns} class="paper overflow-auto" />
    </DemoCard>
  );
};

export const DataTableAdminPatternDemo = () => {
  const [search, setSearch] = createSignal("");
  const [status, setStatus] = createSignal("");
  const columns: DataTableColumn<TableDemoRow>[] = [
    { id: "customer", header: "Customer", value: "customer" },
    { id: "status", header: "Status", value: "status" },
    { id: "items", header: "Items", value: "items", cellClass: "tabular-nums" },
    { id: "total", header: "Total", value: "total", cellClass: "tabular-nums" },
    {
      id: "actions",
      header: "Settings",
      headerClass: "w-px text-right",
      cellClass: "text-right whitespace-nowrap max-w-none",
    },
  ];
  const statusOptions: FilterChipSection[] = [
    {
      options: [
        { value: "", label: "All", icon: "ti ti-list" },
        { value: "new", label: "New", icon: "ti ti-sparkles" },
        { value: "shipped", label: "Shipped", icon: "ti ti-truck" },
        { value: "delivered", label: "Delivered", icon: "ti ti-check" },
      ],
    },
  ];
  const rows = createMemo(() => {
    const needle = search().trim().toLowerCase();
    return tableDemoRows.filter((row) => {
      if (status() && row.status !== status()) return false;
      if (!needle) return true;
      return [row.customer, row.status, row.id].some((value) => value.toLowerCase().includes(needle));
    });
  });

  return (
    <DemoCard
      id="datatable-admin-pattern"
      variant="admin table pattern"
      chip={{ kind: "component", name: "DataTable + Search", from: `${FROM_UI} + @valentinkolb/cloud/ssr/islands` }}
      description="Admin lists keep search, filters, and table actions inside the same paper header: title/count, search row, filter/action row, then the DataTable."
      code={`<section class="paper overflow-hidden">
  <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
    <div>
      <h2 class="text-xs font-semibold text-primary">Resources</h2>
      <p class="text-[10px] text-dimmed">{rows.length} of {total} resources</p>
    </div>
    <SearchBar action="/admin/resources" value={search} placeholder="Search resources..." />
    <div class="flex flex-wrap items-center gap-2">
      <FilterChip label="Status" options={statusOptions} value={status} />
      <button class="btn-input btn-sm ml-auto">Create</button>
    </div>
  </div>
  <DataTable rows={rows} columns={columns} class="overflow-x-auto" />
</section>`}
    >
      <section class="paper overflow-hidden">
        <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
          <div>
            <h2 class="text-xs font-semibold text-primary">Orders</h2>
            <p class="text-[10px] text-dimmed">
              {rows().length} of {tableDemoRows.length} rows
            </p>
          </div>
          <TextInput
            name="datatable-admin-search"
            type="search"
            placeholder="Search orders..."
            ariaLabel="Search orders"
            icon="ti ti-search"
            activeIcon="ti ti-search"
            value={search}
            onInput={setSearch}
            clearable
          />
          <div class="flex flex-wrap items-center gap-2">
            <FilterChip
              label="Status"
              icon="ti ti-filter"
              options={statusOptions}
              value={status() ? [status()] : []}
              onChange={(value) => setStatus(value[0] ?? "")}
              isActive={status().length > 0}
              defaultValue={[]}
            />
            <button class="btn-input btn-sm ml-auto">
              <i class="ti ti-settings" />
              Settings
            </button>
          </div>
        </div>
        <DataTable
          rows={rows()}
          columns={columns}
          getRowId={(row) => row.id}
          hoverRows
          class="overflow-x-auto"
          empty="No orders match the current filters."
          renderCell={({ row, col, render }) => {
            if (col.id === "customer") return <span class="font-medium text-primary">{row.customer}</span>;
            if (col.id === "status") {
              return <span class={`rounded px-1.5 py-0.5 text-[10px] font-medium ${statusClass(row.status)}`}>{row.status}</span>;
            }
            if (col.id === "total") return `€${row.total.toFixed(2)}`;
            if (col.id === "actions") return <button class="btn-secondary btn-sm">Open</button>;
            return render(row[col.id as keyof TableDemoRow]);
          }}
        />
      </section>
    </DemoCard>
  );
};

export const StructuredDataPreviewDemo = () => (
  <DemoCard
    id="structured-data-preview"
    variant="formatted + raw JSON"
    chip={{ kind: "component", name: "StructuredDataPreview", from: FROM_UI }}
    description="Compact preview for metadata, payloads, labels, and dimensions. Shows key-value rows by default, with raw JSON and copy available on demand."
    code={`<StructuredDataPreview
  title="Metadata"
  data={metadata}
  maxRows={6}
/>`}
  >
    <StructuredDataPreview title="Metadata" data={sampleMetadata} maxRows={6} />
  </DemoCard>
);

/* ── Markdown rendering ───────────────────────────────────── */

export const MarkdownViewDemo = (props: { html: string }) => (
  <DemoCard
    id="markdownview"
    chip={{ kind: "component", name: "MarkdownView", from: FROM_UI }}
    description="Renders pre-built markdown HTML (use shared/markdown.render on the server to produce the HTML)."
    code={`// server side
const html = markdown.render("# Hello\\n\\nA paragraph.");

// island
<MarkdownView html={html} />`}
  >
    <MarkdownView html={props.html} />
  </DemoCard>
);

export const MarkdownEditorFullDemo = () => {
  const [v, setV] = createSignal(
    [
      "# Email composer",
      "",
      "MarkdownEditor used standalone (without InputWrapper chrome).",
      "",
      "- Toolbar + keyboard shortcuts",
      "- Smart Enter in lists",
      "- URL-on-selection paste → link",
      "- Live stats footer",
    ].join("\n"),
  );
  return (
    <DemoCard
      id="markdowneditor-content"
      variant="standalone full-page editor"
      chip={{ kind: "component", name: "MarkdownEditor", from: FROM_UI }}
      description="The same editor that powers <TextInput markdown />, exposed for non-form use-cases (email body, doc body)."
      code={`<MarkdownEditor value={v} onInput={setV} lines={12} placeholder="Write your message…" />`}
    >
      <MarkdownEditor value={v} onInput={setV} lines={12} placeholder="Write your message…" />
    </DemoCard>
  );
};

/* ── Tab assembly ────────────────────────────────────────── */

export const ContentTab = (props: { markdownHtml: string }) => (
  <div class="grid grid-cols-1 gap-3">
    <DataTableFullDemo />
    <DataTableMinimalDemo />
    <StructuredDataPreviewDemo />
    <ChartLive />
    <ChartLine />
    <ChartBar />
    <ChartDonut />
    <ChartSparkline />
    <ChartEmpty />
    <MarkdownViewDemo html={props.markdownHtml} />
    <MarkdownEditorFullDemo />
  </div>
);
