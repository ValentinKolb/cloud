import {
  Button,
  Chart,
  CodeDisplay,
  DataTable,
  type DataTableColumn,
  DocCode,
  DocConceptGrid,
  DocLead,
  DocNote,
  DocPage,
  DocRows,
  DocSection,
  FileBrowserPanel,
  type FileSource,
  Lightbox,
  LogEntriesTable,
  MarkdownEditor,
  MarkdownView,
  Pagination,
  PdfPreview,
  RangePicker,
  StructuredDataPreview,
  TemplateEditor,
  TemplatePreview,
  TemplateSampleData,
} from "@k2b/ui";
import { createMemo, createSignal, Show } from "solid-js";
import { DemoCard } from "../DemoCard";
import { DemoGrid, type DemoSection } from "./types";

const ChartDemo = () => (
  <DemoCard
    id="charts"
    chip={{ kind: "component", name: "Chart", from: "@k2b/ui" }}
    description="Typed SSR charts with bounded line inspection, map pan and zoom, and state-timeline navigation. The wrapper is a plain block, so the caller owns the height — except for stateTimeline, which derives its own from the row count."
    code={`<Chart kind="line" style={{ height: "14rem" }} series={series} interactive />
<Chart kind="map" style={{ height: "14rem" }} series={locations} interactive />
<Chart kind="stateTimeline" rows={rows} states={states} interactive />`}
  >
    <RangePicker
      value="24h"
      options={[
        { value: "1h", href: "?window=1h" },
        { value: "24h", href: "?window=24h" },
      ]}
    />
    <div class="ui-chart-demo">
      <Chart
        kind="line"
        style={{ height: "14rem" }}
        series={[
          {
            label: "Requests",
            data: [
              { x: 1, y: 12 },
              { x: 2, y: 28 },
              { x: 3, y: 24 },
              { x: 4, y: 42 },
            ],
          },
        ]}
        legend
        smooth
        interactive
      />
      <Chart
        kind="map"
        style={{ height: "14rem" }}
        series={[
          {
            label: "Requests",
            data: [
              { latitude: 52.52, longitude: 13.405, label: "Berlin" },
              { latitude: 48.137, longitude: 11.575, label: "Munich" },
            ],
          },
        ]}
        interactive
      />
      <Chart
        kind="stateTimeline"
        rows={[
          {
            label: "Worker",
            intervals: [
              { from: 0, to: 4, state: "ok", tooltip: "Succeeded" },
              { from: 5, to: 8, state: "running", tooltip: "Running" },
            ],
          },
        ]}
        states={[
          { state: "ok", label: "Healthy", color: "#10b981" },
          { state: "running", label: "Running", color: "#3b82f6" },
        ]}
        domain={[0, 10]}
        interactive
      />
    </div>
  </DemoCard>
);

type Row = { id: string; name: string; owner: string; requests: number };
const rows: Row[] = [
  { id: "api", name: "Public API", owner: "Platform", requests: 18492 },
  { id: "docs", name: "Documentation", owner: "Design systems", requests: 3274 },
];
const columns: DataTableColumn<Row>[] = [
  { id: "name", header: ({ col }) => `Name (${col.id})`, value: "name", sortable: true },
  { id: "owner", header: "Owner", value: "owner" },
  { id: "requests", header: "Requests", value: "requests", align: "right" },
];
const TableDemo = () => (
  <DemoCard
    id="tables"
    chip={[
      { kind: "component", name: "DataTable", from: "@k2b/ui" },
      { kind: "component", name: "Pagination", from: "@k2b/ui" },
    ]}
    description="Exact typed records with server-owned sorting, callback composition, selection, totals, and URL pagination."
    code={`<DataTable
  rows={rows}
  columns={columns}
  renderCell={({ col, value, render }) => col.id === "name" ? <strong>{value}</strong> : render(value)}
  sortHref={(sort) => \`?sort=\${sort.key}&direction=\${sort.direction}\`}
/>
<Pagination currentPage={2} totalPages={6} baseUrl="?page=" />`}
  >
    <DataTable
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      selectedRowId="api"
      sort={{ key: "name", direction: "asc" }}
      sortHref={(sort) => `?sort=${sort.key}&direction=${sort.direction}`}
      renderHeader={({ render }) => render()}
      renderCell={({ col, value, render }) => (col.id === "name" ? <strong>{String(value)}</strong> : render(value))}
      footer={{ values: { name: "Total", requests: 21766 } }}
      scrollPreserveKey="content-demo-table"
    />
    <Pagination currentPage={2} totalPages={6} baseUrl="?page=" />
  </DemoCard>
);

const CodeDemo = () => (
  <DemoCard
    id="code"
    chip={{ kind: "component", name: "CodeDisplay", from: "@k2b/ui" }}
    description="Selectable source with quiet chrome, optional titles, copy, and exact language modes."
    code={`<CodeDisplay title="Install" language="script" code="bun add @k2b/ui" />`}
  >
    <CodeDisplay title="Install" language="script" code={"bun add @k2b/ui\nbun run build"} />
    <CodeDisplay title="component.tsx" language="tsx" code={'export const Status = () => <span data-ready="true">Ready</span>;'} />
  </DemoCard>
);

const LogsDemo = () => (
  <DemoCard
    id="logs"
    chip={{ kind: "component", name: "LogEntriesTable", from: "@k2b/ui" }}
    description="Timestamped log entries with semantic levels, sources, messages, and optional structured metadata."
    code={`<LogEntriesTable entries={entries} />`}
  >
    <LogEntriesTable
      entries={[
        {
          id: 1,
          level: "info",
          source: "build",
          message: "Package compiled",
          metadata: null,
          createdAt: "2026-07-28T09:42:00Z",
        },
        {
          id: 2,
          level: "warn",
          source: "preview",
          message: "One optional font was not loaded",
          metadata: { font: "IBM Plex Mono" },
          createdAt: "2026-07-28T09:43:00Z",
        },
      ]}
    />
  </DemoCard>
);

const StructuredDemo = () => (
  <DemoCard
    id="structured-data"
    chip={{ kind: "component", name: "StructuredDataPreview", from: "@k2b/ui" }}
    description="Formatted and raw disclosure for unknown JSON-like values with bounded rows and copy."
    code={`<StructuredDataPreview title="Response" data={payload} maxRows={8} />`}
  >
    <StructuredDataPreview
      title="Response"
      data={{ status: "ready", counts: { pages: 52, sections: 9 }, portable: true }}
      maxRows={8}
    />
  </DemoCard>
);

const gallery = [
  {
    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540'%3E%3Crect width='960' height='540' fill='%2306b6d4'/%3E%3C/svg%3E",
    alt: "Cyan field",
  },
  {
    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='960' height='540'%3E%3Crect width='960' height='540' fill='%238b5cf6'/%3E%3C/svg%3E",
    alt: "Purple field",
  },
];
const MediaDemo = () => {
  const [open, setOpen] = createSignal(false);
  return (
    <DemoCard
      id="media"
      chip={[
        { kind: "component", name: "Lightbox", from: "@k2b/ui" },
        { kind: "component", name: "PdfPreview", from: "@k2b/ui" },
      ]}
      description="Application-owned media in a native image dialog and an explicitly requested local PDF preview."
      code={`<Show when={open()}><Lightbox images={images} onClose={() => setOpen(false)} /></Show>
<PdfPreview request={() => Promise.resolve(pdfBlob)} title="Report" />`}
    >
      <div class="ui-demo-row">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Open gallery
        </Button>
      </div>
      <Show when={open()}>
        <Lightbox images={gallery} initialIndex={0} onClose={() => setOpen(false)} />
      </Show>
      <div class="ui-pdf-demo">
        <PdfPreview
          request={async () => new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" })}
          title="Sample report"
          emptyText="Generate the local sample to inspect it."
        />
      </div>
    </DemoCard>
  );
};

type DemoFile = {
  encoding: "utf8" | "base64";
  content: string;
  mediaType: string;
};

const initialFileContent: Record<string, DemoFile> = {
  "/src/app.tsx": {
    encoding: "utf8",
    content: 'export const App = () => <main class="k2b-ui">Portable</main>;',
    mediaType: "text/typescript",
  },
  "/README.md": {
    encoding: "utf8",
    content: "# Portable files\n\nThe application owns this in-memory source.",
    mediaType: "text/markdown",
  },
};

const demoMediaType = (path: string): string => {
  if (path.endsWith(".md") || path.endsWith(".markdown")) return "text/markdown";
  if (path.endsWith(".tsx") || path.endsWith(".ts")) return "text/typescript";
  if (path.endsWith(".json")) return "application/json";
  return "text/plain";
};

const FilesDemo = () => {
  const [files, setFiles] = createSignal<Record<string, DemoFile>>({ ...initialFileContent });
  const fileSource: FileSource = {
    list: async () =>
      Object.entries(files()).map(([path, file]) => ({
        path,
        mediaType: file.mediaType,
        size: file.encoding === "utf8" ? new TextEncoder().encode(file.content).byteLength : file.content.length,
      })),
    read: async (path) => {
      const file = files()[path];
      if (!file) throw new Error(`File not found: ${path}`);
      return file;
    },
    write: async (path, content, encoding = "utf8") => {
      setFiles((current) => ({
        ...current,
        [path]: {
          encoding,
          content,
          mediaType: current[path]?.mediaType ?? demoMediaType(path),
        },
      }));
    },
    remove: async (path) => {
      setFiles((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([candidate]) => candidate !== path && !candidate.startsWith(`${path}/`)),
        ),
      );
    },
    rename: async (from, to) => {
      setFiles((current) => {
        const file = current[from];
        if (!file) throw new Error(`File not found: ${from}`);
        if (current[to]) throw new Error(`File already exists: ${to}`);
        const next = { ...current, [to]: file };
        delete next[from];
        return next;
      });
    },
    upload: async (dirPath, selectedFiles) => {
      const additions: Record<string, DemoFile> = {};
      for (const file of selectedFiles) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(String(reader.result)));
          reader.addEventListener("error", () => reject(reader.error ?? new Error(`Failed to read ${file.name}`)));
          reader.readAsDataURL(file);
        });
        const path = `${dirPath === "/" ? "" : dirPath}/${file.name}`;
        additions[path] = {
          encoding: "base64",
          content: dataUrl.slice(dataUrl.indexOf(",") + 1),
          mediaType: file.type || "application/octet-stream",
        };
      }
      setFiles((current) => ({ ...current, ...additions }));
    },
  };

  return (
    <DemoCard
      id="files"
      chip={[
        { kind: "component", name: "FileBrowserPanel", from: "@k2b/ui" },
        { kind: "component", name: "FileTree", from: "@k2b/ui" },
        { kind: "component", name: "FileView", from: "@k2b/ui" },
      ]}
      description="A fully interactive, path-first browser over an application-owned in-memory source. Create, upload, rename, move, delete, edit, save, and download without a backend."
      code={`const source: FileSource = {
  list: async () => entries,
  read: async (path) => content[path],
  write: async (path, value) => update(path, value),
  rename: async (from, to) => move(from, to),
  remove: async (path) => remove(path),
  upload: async (dir, files) => upload(dir, files),
};

<FileBrowserPanel source={source} initialPath="/README.md" />`}
    >
      {/* No showcase wrapper: FileBrowserPanel sizes itself when it is not given
          a `class`, so any sizing failure has to stay visible here. */}
      <FileBrowserPanel source={fileSource} initialPath="/README.md" />
    </DemoCard>
  );
};

const interpolatePreviewTokens = (template: string, values: Readonly<Record<string, string>>): string =>
  Object.entries(values).reduce((preview, [key, replacement]) => preview.replaceAll(`{{ ${key} }}`, replacement), template);

const TemplateDemo = () => {
  const variables = [
    { name: "PROJECT", kind: "string" as const },
    { name: "OWNER", kind: "string" as const },
  ];
  const [value, setValue] = createSignal("<h1>{{ PROJECT }}</h1><p>Owner: {{ OWNER }}</p>");
  const [sample, setSample] = createSignal<Record<string, string>>({ PROJECT: "Atlas", OWNER: "Team" });
  const html = createMemo(() => `<style>body{font:16px sans-serif;padding:24px}</style>${interpolatePreviewTokens(value(), sample())}`);
  return (
    <DemoCard
      id="template-editor"
      chip={[
        { kind: "component", name: "TemplateEditor", from: "@k2b/ui" },
        { kind: "component", name: "TemplatePreview", from: "@k2b/ui" },
        { kind: "component", name: "TemplateSampleData", from: "@k2b/ui" },
      ]}
      description="Portable HTML and Liquid editing with a sandboxed illustrative preview, not a Liquid renderer. Rendering policy and persistence remain application-owned."
      code={`<TemplateEditor value={value()} onValueChange={setValue} variables={variables} />
<TemplatePreview html={interpolatePreviewTokens(value(), sample())} />`}
    >
      <div class="ui-template-demo">
        <section class="ui-showcase-frame">
          <span>TemplateEditor</span>
          <TemplateEditor
            aria-label="Template source"
            value={value()}
            onValueChange={setValue}
            variables={variables}
            lines={8}
          />
        </section>
        <section class="ui-showcase-frame">
          <span>TemplatePreview</span>
          <TemplatePreview html={html()} />
        </section>
        <section class="ui-showcase-frame">
          <span>TemplateSampleData</span>
          <TemplateSampleData
            variables={variables}
            values={sample()}
            onValueChange={(name, next) => setSample((current) => ({ ...current, [name]: next }))}
          />
        </section>
      </div>
    </DemoCard>
  );
};

const DocsDemo = () => (
  <DemoCard
    id="docs"
    chip={[
      { kind: "component", name: "DocPage", from: "@k2b/ui" },
      { kind: "component", name: "DocSection", from: "@k2b/ui" },
    ]}
    description="Portable in-product documentation primitives for an application-owned composition."
    code={`<DocPage>
  <DocLead>…</DocLead>
  <DocSection title="Install"><DocCode code="bun add @k2b/ui" /></DocSection>
</DocPage>`}
  >
    <DocPage>
      <DocLead>Build a consistent application without importing Cloud.</DocLead>
      {/* DocConceptGrid and DocRows prefix `ti ` themselves, so items carry the
          bare icon name — unlike Widget, StatCell, or NoticeCard. */}
      <DocConceptGrid
        items={[
          { title: "Scoped", text: "No global reset.", icon: "ti-box-margin" },
          { title: "Portable", text: "Solid and SSR.", icon: "ti-package" },
        ]}
      />
      <DocSection title="Install" eyebrow="Package">
        <DocCode language="script" code="bun add @k2b/ui" />
        <DocNote title="Keep the scope" variant="tip">
          Wrap component output in <code>.k2b-ui</code>.
        </DocNote>
      </DocSection>
      <DocRows items={[{ title: "Runtime", icon: "ti-server", text: "The host owns data and routes." }]} />
    </DocPage>
  </DemoCard>
);

const MarkdownDemo = (props: { html: string }) => {
  const [value, setValue] = createSignal("# Edit Markdown");
  return (
    <DemoCard
      id="markdown"
      chip={[
        { kind: "component", name: "MarkdownView", from: "@k2b/ui" },
        { kind: "component", name: "MarkdownEditor", from: "@k2b/ui" },
      ]}
      description="Trusted pre-rendered HTML beside a controlled Markdown editor. Rendering and sanitization stay with the host."
      code={`<MarkdownView html={trustedHtml} />
<MarkdownEditor value={source()} onValueChange={setSource} />`}
    >
      <section aria-label="Rendered Markdown">
        <MarkdownView html={props.html} />
      </section>
      <MarkdownEditor value={value()} onValueChange={setValue} aria-label="Markdown source" />
    </DemoCard>
  );
};

const demos: DemoSection = {
  charts: () => (
    <DemoGrid columns="one">
      <ChartDemo />
    </DemoGrid>
  ),
  tables: () => (
    <DemoGrid columns="one">
      <TableDemo />
    </DemoGrid>
  ),
  code: () => (
    <DemoGrid columns="one">
      <CodeDemo />
    </DemoGrid>
  ),
  logs: () => (
    <DemoGrid columns="one">
      <LogsDemo />
    </DemoGrid>
  ),
  "structured-data": () => (
    <DemoGrid columns="one">
      <StructuredDemo />
    </DemoGrid>
  ),
  media: () => (
    <DemoGrid columns="one">
      <MediaDemo />
    </DemoGrid>
  ),
  files: () => (
    <DemoGrid columns="one">
      <FilesDemo />
    </DemoGrid>
  ),
  "template-editor": () => (
    <DemoGrid columns="one">
      <TemplateDemo />
    </DemoGrid>
  ),
  docs: () => (
    <DemoGrid columns="one">
      <DocsDemo />
    </DemoGrid>
  ),
  markdown: (props) => (
    <DemoGrid columns="one">
      <MarkdownDemo html={props.markdownHtml} />
    </DemoGrid>
  ),
};

export default demos;
