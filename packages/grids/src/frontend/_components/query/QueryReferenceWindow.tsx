import {
  AppWorkspace,
  CopyButton,
  DataTable,
  type DataTableColumn,
  DocCode,
  DocConceptGrid,
  DocInlineCode,
  DocLead,
  DocNote,
  DocPage,
  DocRows,
  DocSection,
} from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { createMemo, For, type JSX, Show } from "solid-js";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { GRID_FORMULA_FUNCTIONS } from "../fields/formula-authoring";

const TAB_ALIASES = {
  overview: "basics",
  "data-types": "datatypes",
  "available-data": "tables",
  "query-language": "gql",
} as const;

export type GqlReferenceTab = "basics" | "datatypes" | "tables" | "formulas" | "gql" | "examples" | "how-it-works";
export type QueryReferenceTab = GqlReferenceTab;

export const QUERY_REFERENCE_TABS: readonly GqlReferenceTab[] = [
  "basics",
  "datatypes",
  "tables",
  "formulas",
  "gql",
  "examples",
  "how-it-works",
];

export const normalizeQueryReferenceTab = (value: string | null | undefined): GqlReferenceTab | null => {
  if (!value) return null;
  if (QUERY_REFERENCE_TABS.includes(value as GqlReferenceTab)) return value as GqlReferenceTab;
  return TAB_ALIASES[value as keyof typeof TAB_ALIASES] ?? null;
};

export const isQueryReferenceTab = (value: string | null | undefined): value is GqlReferenceTab =>
  normalizeQueryReferenceTab(value) !== null;

type Props = {
  baseShortId: string;
  baseName: string;
  defaultTab?: GqlReferenceTab;
  inspectedSourceId?: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  recordCountsByTable: Record<string, number>;
};

type SourceRow = {
  id: string;
  shortId: string;
  kind: "table" | "view";
  tableId?: string;
  parentTableId?: string;
  name: string;
  ref: string;
  parent?: string;
  description: string;
  fieldCount: number;
  recordCount: number;
  search: string;
};

type FieldRow = {
  id: string;
  tableId: string;
  table: string;
  name: string;
  ref: string;
  type: string;
  typeLabel: string;
  description: string;
  search: string;
};

type FunctionRow = {
  name: string;
  category: string;
  signature: string;
  description: string;
  returnType: string;
  search: string;
};

type DataTypeRow = {
  type: string;
  icon: string;
  use: JSX.Element;
  watch: JSX.Element;
};

type Example = {
  title: string;
  description: string;
  code: string;
};

const REFERENCE_TABS: Array<{ value: GqlReferenceTab; label: string; icon: string; description: string }> = [
  { value: "basics", label: "Grids basics", icon: "ti-layout-grid", description: "Mental model and workflow" },
  { value: "datatypes", label: "Data & datatypes", icon: "ti-table", description: "Tables, fields, views, forms" },
  { value: "tables", label: "Tables & views", icon: "ti-database", description: "Available data in this base" },
  { value: "formulas", label: "Formulas", icon: "ti-function", description: "Fields, computed columns, predicates" },
  { value: "gql", label: "GQL", icon: "ti-code", description: "Grids Query Language" },
  { value: "examples", label: "Examples", icon: "ti-copy", description: "Copyable patterns" },
  { value: "how-it-works", label: "How it works", icon: "ti-shield-check", description: "Resolution, permissions, limits" },
];

const QUERY_EXAMPLES: Example[] = [
  {
    title: "Open work",
    description: "A normal filtered table view.",
    code: `from table Tasks
select Name, Status, Due
where Status = 'Open'
sort Due asc
limit 50`,
  },
  {
    title: "Monthly chart source",
    description: "A grouped view that can feed a chart.",
    code: `from table Orders
group by "Ordered at" by month
aggregate sum("Line total") as revenue
sort "Ordered at" asc`,
  },
  {
    title: "Computed output",
    description: "A temporary computed column in a query result.",
    code: `from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price > 0
limit 20`,
  },
  {
    title: "Readable names",
    description: "Double quotes keep names with spaces unambiguous.",
    code: `from table "Order lines"
select "Order no", "Line total"
where Status = 'Paid'`,
  },
];

const QUERY_KEYWORDS =
  "from|table|view|select|join|left|as|on|where|formula|group|by|aggregate|having|sort|search|include|deleted|only|nulls|first|last|limit|offset|asc|desc|and|or|not";

const queryHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "keyword", match: new RegExp(`\\b(?:${QUERY_KEYWORDS})\\b`, "i") },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const formulaHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    { kind: "function", match: new RegExp(`\\b(?:${GRID_FORMULA_FUNCTIONS.map((fn) => fn.name).join("|")})\\b`, "i") },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const functionCategory = (name: string, returnType: string): string => {
  if (["SUM", "AVG", "MEAN", "COUNT", "MIN", "MAX", "MEDIAN"].includes(name)) return "Aggregate";
  if (["ABS", "ROUND", "FLOOR", "CEIL", "SQRT", "POW", "MOD", "PERCENT"].includes(name)) return "Number";
  if (["IF", "IFEMPTY", "IFERROR", "AND", "OR", "NOT", "ISBLANK"].includes(name)) return "Logic";
  if (["CONTAINS", "CONCAT", "LEN", "LOWER", "UPPER", "TRIM", "LEFT", "RIGHT", "SUBSTRING", "REPLACE"].includes(name)) return "Text";
  if (["TODAY", "NOW", "YEAR", "MONTH", "DAY", "DATEADD", "DATEDIFF"].includes(name)) return "Date";
  return returnType === "number" ? "Number" : "General";
};

const firstTableName = (tables: Table[]) => tables[0]?.name ?? "Orders";
const firstDateField = (fields: Field[]) => fields.find((field) => field.type === "date")?.name ?? "Created at";
const firstNumberField = (fields: Field[]) =>
  fields.find((field) => field.type === "number" || field.type === "decimal" || field.type === "percent")?.name ?? "Amount";

const buildExampleForCatalog = (tables: Table[], fieldsByTable: Record<string, Field[]>): string => {
  const table = tables[0];
  if (!table) return QUERY_EXAMPLES[0]!.code;
  const fields = fieldsByTable[table.id] ?? [];
  const date = firstDateField(fields);
  const amount = firstNumberField(fields);
  return `from table ${formatIdentifierRef(table.name)}
select ${
    fields
      .slice(0, 3)
      .map((field) => formatIdentifierRef(field.name))
      .join(", ") || formatIdentifierRef(amount)
  }
where ${formatIdentifierRef(amount)} > 0
sort ${formatIdentifierRef(date)} desc
limit 20`;
};

const Doc = (props: { children: JSX.Element }) => <DocPage class="!mx-0 !max-w-none w-full">{props.children}</DocPage>;

const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;

const FormulaSnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={formulaHighlight} copy />
);

const QuerySnippet = (props: { code: string; title?: string }) => (
  <DocCode title={props.title} code={props.code} highlight={queryHighlight} copy />
);

const functionColumns: DataTableColumn<FunctionRow>[] = [
  { id: "category", header: "Group", value: (row) => row.category },
  { id: "signature", header: "Function", value: (row) => row.signature, cellClass: "font-mono text-xs min-w-48" },
  { id: "description", header: "What it does", value: (row) => row.description, cellClass: "min-w-72" },
  { id: "returnType", header: "Returns", value: (row) => row.returnType },
  { id: "copy", header: "", value: (row) => row.name, cellClass: "w-12 text-right" },
];

const dataTypeRows: DataTypeRow[] = [
  {
    type: "Text",
    icon: "ti-typography",
    use: "Short names, titles, codes, email addresses, URLs, and labels.",
    watch: "Use regex templates or validation when the value must follow a format.",
  },
  {
    type: "Long text",
    icon: "ti-align-left",
    use: "Notes, instructions, descriptions, and Markdown content.",
    watch: "Do not use long text as the record label; it makes relations and detail headers hard to scan.",
  },
  {
    type: "Number / decimal / percent",
    icon: "ti-decimal",
    use: "Counts, money, measurements, ratios, progress, and calculations.",
    watch: "Use decimal for money. Percent values are stored as ratios, so 0.75 displays as 75%.",
  },
  {
    type: "Date / date-time",
    icon: "ti-calendar",
    use: "Due dates, event dates, publication dates, timestamps, and calendar views.",
    watch: "Use date for whole days. Use date-time only when the exact moment matters.",
  },
  {
    type: "Select",
    icon: "ti-tags",
    use: "Known option lists such as status, priority, type, condition, or category labels.",
    watch: "Use relations instead when options need their own fields, permissions, forms, or history.",
  },
  {
    type: "Relation",
    icon: "ti-link",
    use: "Links between records: order to customer, item to location, loan to kit.",
    watch: "Set a good record label in the target table. Self-relations are useful for parent-child structures.",
  },
  {
    type: "Lookup / rollup",
    icon: "ti-corner-down-right",
    use: "Display or summarize values through a relation without copying the source field.",
    watch: "Formatting is configured on the lookup/rollup field; it does not blindly inherit source formatting.",
  },
  {
    type: "Formula",
    icon: "ti-function",
    use: "Computed values that should recalculate from other fields when a record is read.",
    watch: "Formula errors render as an error value. Use IFERROR for expected empty or divide-by-zero cases.",
  },
  {
    type: "ID",
    icon: "ti-id",
    use: "Stable human or machine identifiers such as SKU, asset ID, order number, UUID, or ULID.",
    watch: "Use a visible ID only when people or external systems need to refer to it.",
  },
  {
    type: "File",
    icon: "ti-paperclip",
    use: "Attachments, images, documents, and files that belong to a record.",
    watch: "Put searchable metadata in normal fields; file bytes are not the filter model.",
  },
];

const renderCopyCell = (value: unknown) => (
  <CopyButton text={String(value ?? "")} class="btn-ghost btn-sm inline-flex h-7 w-7 items-center justify-center p-0" />
);

const referenceTabHref = (baseShortId: string, tab: GqlReferenceTab) =>
  `/app/grids/${encodeURIComponent(baseShortId)}/reference/${encodeURIComponent(tab)}`;

const referenceSourceHref = (baseShortId: string, source: SourceRow) =>
  `/app/grids/${encodeURIComponent(baseShortId)}/reference/tables/${encodeURIComponent(source.shortId)}`;

function ReferenceSidebar(props: { activeTab: GqlReferenceTab; baseShortId: string; baseName: string }) {
  const items = (
    <AppWorkspace.SidebarSection title="Reference">
      <For each={REFERENCE_TABS}>
        {(tab) => (
          <AppWorkspace.SidebarItem
            href={referenceTabHref(props.baseShortId, tab.value)}
            navigation="document"
            icon={tab.icon}
            active={props.activeTab === tab.value}
            title={tab.description}
          >
            {tab.label}
          </AppWorkspace.SidebarItem>
        )}
      </For>
    </AppWorkspace.SidebarSection>
  );

  return (
    <AppWorkspace.Sidebar>
      <AppWorkspace.SidebarHeader title="Grids reference" subtitle={props.baseName} icon="ti-layout-grid" />
      <AppWorkspace.SidebarMobile>
        <AppWorkspace.SidebarMobileBody scrollPreserveKey="grids-query-reference-mobile">{items}</AppWorkspace.SidebarMobileBody>
      </AppWorkspace.SidebarMobile>
      <AppWorkspace.SidebarDesktop>
        <AppWorkspace.SidebarBody scrollPreserveKey="grids-query-reference-sidebar">{items}</AppWorkspace.SidebarBody>
      </AppWorkspace.SidebarDesktop>
    </AppWorkspace.Sidebar>
  );
}

function OverviewTab(props: { tableName: string; dateField: string; numberField: string }) {
  return (
    <Doc>
      <DocLead>
        Grids is a flexible database app for structured work. A base contains tables, tables contain records, and fields describe the facts
        each record can store. Views, forms, dashboards, automations, search, exports, and GQL all read from that saved table data.
      </DocLead>

      <DocSection title="Mental model" eyebrow="Start here">
        <DocConceptGrid
          items={[
            {
              title: "Base",
              icon: "ti-database",
              text: "One workspace for one subject, such as finance, inventory, hiring, or a bookshop.",
            },
            {
              title: "Table",
              icon: "ti-table",
              text: "One kind of record. Customers, invoices, books, items, and loans usually belong in separate tables.",
            },
            {
              title: "Field",
              icon: "ti-columns",
              text: "One fact about a record: status, amount, due date, owner, file, relation, formula, or ID.",
            },
            {
              title: "View",
              icon: "ti-filter",
              text: "A saved way to inspect a table. Views can be table, card, or calendar based.",
            },
            {
              title: "Form",
              icon: "ti-forms",
              text: "A guided create flow for a table, useful for dashboards, public intake, and repeatable internal entry.",
            },
            {
              title: "Dashboard",
              icon: "ti-layout-dashboard",
              text: "A working page with stats, charts, forms, Markdown, links, manual automations, and embedded views.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="How work moves through Grids">
        <DocRows
          items={[
            {
              title: "Model data first",
              icon: "ti-table-plus",
              text: "Create the main table and the smallest useful set of fields. Real sample records reveal bad names and missing rules faster than abstract planning.",
            },
            {
              title: "Shape repeated work",
              icon: "ti-filter",
              text: "Create views for tasks people repeat: open records, recent records, grouped reports, card lists, and calendars.",
            },
            {
              title: "Collect records",
              icon: "ti-forms",
              text: "Use forms when users should create records through a guided flow instead of seeing every table field.",
            },
            {
              title: "Explain and operate",
              icon: "ti-layout-dashboard",
              text: "Use dashboards for operating pages: instructions, forms, stats, charts, links, and the few embedded views that matter.",
            },
            {
              title: "Automate stable events",
              icon: "ti-bolt",
              text: "Add webhook automations once the data model and filters are clear enough to trust.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Small end-to-end example">
        <QuerySnippet
          title="A view that can become a dashboard table"
          code={`from table ${formatIdentifierRef(props.tableName)}
select ${formatIdentifierRef(props.dateField)}, ${formatIdentifierRef(props.numberField)}
where ${formatIdentifierRef(props.numberField)} > 0
sort ${formatIdentifierRef(props.dateField)} desc
limit 20`}
        />
      </DocSection>

      <DocNote title="Source of truth" variant="tip">
        Tables store data. Views shape queries. Forms create records. Dashboards present included data. Automations react to record events.
        GQL is a text interface to the same server-side data model.
      </DocNote>
    </Doc>
  );
}

function DataTypesTab() {
  return (
    <Doc>
      <DocLead>
        Datatypes are the foundation of a Grids base. They decide validation, display, search, filtering, formulas, relation labels,
        dashboard widgets, and what a form can collect.
      </DocLead>

      <DocSection title="Data model layers">
        <DocRows
          items={[
            {
              title: "Tables",
              icon: "ti-table",
              text: "Use a table when records have their own lifecycle, permissions, forms, dashboards, or relations.",
            },
            {
              title: "Fields",
              icon: "ti-columns",
              text: "Use a field when the value is one property of the same record. Keep names short and add descriptions for forms and detail panels.",
            },
            {
              title: "Relations",
              icon: "ti-link",
              text: "Use relations when a value points to another record. This keeps names, metadata, permissions, and history in one source table.",
            },
            {
              title: "Views",
              icon: "ti-filter",
              text: "Use views to save how records should be queried and displayed. A view never duplicates the records it shows.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Datatype reference">
        <div class="grid gap-3 xl:grid-cols-2">
          <For each={dataTypeRows}>
            {(row) => (
              <article class="paper p-4">
                <div class="flex items-center gap-2 font-semibold text-primary">
                  <i class={`ti ${row.icon} text-dimmed`} />
                  <span>{row.type}</span>
                </div>
                <dl class="mt-3 space-y-3 text-sm leading-relaxed">
                  <div>
                    <dt class="text-xs font-semibold uppercase tracking-wide text-dimmed">Use when</dt>
                    <dd class="mt-1 text-primary">{row.use}</dd>
                  </div>
                  <div>
                    <dt class="text-xs font-semibold uppercase tracking-wide text-dimmed">Watch for</dt>
                    <dd class="mt-1 text-primary">{row.watch}</dd>
                  </div>
                </dl>
              </article>
            )}
          </For>
        </div>
      </DocSection>

      <DocSection title="Views and display modes">
        <DocRows
          items={[
            {
              title: "Table",
              icon: "ti-table",
              text: "Best for dense editing, scanning many columns, and operational work.",
            },
            {
              title: "Cards",
              icon: "ti-layout-cards",
              text: "Best when a few fields, a title, and optional image should be read at a glance.",
            },
            {
              title: "Calendar",
              icon: "ti-calendar-event",
              text: "Best when one date or date-time field places each record on a calendar.",
            },
          ]}
        />
      </DocSection>

      <DocNote title="Keep fields useful">
        Prefer a few clear fields over many vague ones. Required, unique, default, index, and display-format settings should explain real
        behavior users will rely on.
      </DocNote>
    </Doc>
  );
}

function AvailableDataTab(props: { baseShortId: string; sourceRows: SourceRow[]; fieldRows: FieldRow[]; inspectedSourceId?: string }) {
  const inspectedSource = createMemo(() =>
    props.inspectedSourceId
      ? props.sourceRows.find((source) => source.shortId === props.inspectedSourceId || source.id.endsWith(`:${props.inspectedSourceId}`))
      : null,
  );
  const inspectedFields = createMemo(() => {
    const source = inspectedSource();
    if (!source) return [];
    const tableId = source.kind === "table" ? source.tableId : source.parentTableId;
    return props.fieldRows.filter((field) => field.tableId === tableId);
  });
  const tableSources = createMemo(() => props.sourceRows.filter((source) => source.kind === "table"));
  const viewsForTable = (table: SourceRow) =>
    props.sourceRows.filter((source) => source.kind === "view" && source.parentTableId === table.tableId);
  const fieldsForTable = (table: SourceRow) => props.fieldRows.filter((field) => field.tableId === table.tableId);
  const refSourceLabel = (source: SourceRow) => `from ${source.kind} ${source.ref}`;
  const shownFields = (table: SourceRow) => fieldsForTable(table).slice(0, 8);
  const hiddenFieldCount = (table: SourceRow) => Math.max(0, fieldsForTable(table).length - shownFields(table).length);
  const fieldReason = (field: FieldRow) => field.description || field.typeLabel;

  const SourceRef = (source: SourceRow) => (
    <div class="inline-flex min-w-0 items-center gap-1.5 rounded-md bg-zinc-50 px-2 py-1 text-xs dark:bg-zinc-950">
      <span class="shrink-0 text-dimmed">use:</span>
      <code class="truncate font-mono text-primary">{refSourceLabel(source)}</code>
    </div>
  );

  const FieldChip = (field: FieldRow) => (
    <code class="inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
      <span class="truncate">{field.ref}</span>
      <span class="text-[10px] text-dimmed">{field.typeLabel}</span>
    </code>
  );

  return (
    <Doc>
      <DocLead>
        Tables and views are the data sources GQL can read. Start from the source you understand, then inspect its fields before writing
        filters, formulas, joins, or grouped reports.
      </DocLead>

      <Show
        when={inspectedSource()}
        fallback={
          <>
            <DocSection title="Sources">
              <div class="space-y-3">
                <For each={tableSources()}>
                  {(table) => (
                    <article class="paper px-4 py-3">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 flex-1">
                          <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 class="inline-flex min-w-0 items-center gap-2 font-semibold text-primary">
                              <i class="ti ti-table text-dimmed" />
                              <span class="truncate">{table.name}</span>
                            </h3>
                            <span class="badge">Table</span>
                            <span class="text-xs text-dimmed">
                              {plural(table.recordCount, "record")} · {plural(table.fieldCount, "field")}
                            </span>
                          </div>
                          <Show when={table.description}>
                            <p class="mt-1 text-sm leading-relaxed text-dimmed">{table.description}</p>
                          </Show>
                        </div>
                        <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                          {SourceRef(table)}
                          <CopyButton text={refSourceLabel(table)} class="btn-input btn-sm" />
                          <a class="btn-input btn-sm" href={referenceSourceHref(props.baseShortId, table)}>
                            <i class="ti ti-eye" /> Inspect
                          </a>
                        </div>
                      </div>

                      <div class="mt-3 flex flex-wrap gap-1.5">
                        <For each={shownFields(table)}>{FieldChip}</For>
                        <Show when={hiddenFieldCount(table) > 0}>
                          <span class="rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] text-dimmed dark:bg-zinc-950">
                            +{hiddenFieldCount(table)}
                          </span>
                        </Show>
                      </div>

                      <Show when={viewsForTable(table).length > 0}>
                        <div class="mt-3 space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
                          <For each={viewsForTable(table)}>
                            {(view) => (
                              <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
                                <div class="min-w-0">
                                  <div class="flex min-w-0 flex-wrap items-center gap-2">
                                    <span class="inline-flex min-w-0 items-center gap-1.5 font-medium text-primary">
                                      <i class="ti ti-table-spark text-dimmed" />
                                      <span class="truncate">{view.name}</span>
                                    </span>
                                    <span class="badge">View</span>
                                    <span class="text-xs text-dimmed">of {view.parent}</span>
                                  </div>
                                </div>
                                <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
                                  {SourceRef(view)}
                                  <CopyButton
                                    text={refSourceLabel(view)}
                                    class="btn-ghost btn-sm inline-flex h-8 w-8 items-center justify-center p-0"
                                  />
                                  <a class="btn-ghost btn-sm" href={referenceSourceHref(props.baseShortId, view)}>
                                    Inspect
                                  </a>
                                </div>
                              </div>
                            )}
                          </For>
                        </div>
                      </Show>
                    </article>
                  )}
                </For>
              </div>
            </DocSection>
          </>
        }
      >
        {(source) => (
          <>
            <DocSection title={source().name}>
              <div class="paper px-4 py-3">
                <div class="flex flex-wrap items-start justify-between gap-4">
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="badge">{source().kind === "view" ? "View" : "Table"}</span>
                      <span class="text-sm text-dimmed">
                        {source().kind === "view" ? `of ${source().parent ?? "a table"}` : "Base source"}
                      </span>
                      <span class="text-sm text-dimmed">
                        {plural(source().recordCount, source().kind === "view" ? "base record" : "record")} ·{" "}
                        {plural(source().fieldCount, "field")}
                      </span>
                    </div>
                    <p class="mt-2 max-w-3xl text-sm leading-relaxed text-dimmed">{source().description || "No description yet."}</p>
                  </div>
                  <div class="flex min-w-0 flex-wrap items-center justify-end gap-2">
                    {SourceRef(source())}
                    <CopyButton text={refSourceLabel(source())} class="btn-input btn-sm" />
                  </div>
                </div>
              </div>
            </DocSection>

            <DocSection title="Fields">
              <div class="paper overflow-auto">
                <table class="min-w-[820px] w-full table-fixed text-sm">
                  <colgroup>
                    <col class="w-[30%]" />
                    <col class="w-[14%]" />
                    <col class="w-[40%]" />
                    <col class="w-[16%]" />
                  </colgroup>
                  <thead class="bg-zinc-50 text-xs font-medium uppercase tracking-wide text-dimmed dark:bg-zinc-950">
                    <tr class="border-b border-zinc-100 dark:border-zinc-800">
                      <th class="px-4 py-2 text-left font-medium">Field</th>
                      <th class="px-4 py-2 text-left font-medium">Type</th>
                      <th class="px-4 py-2 text-left font-medium">Description</th>
                      <th class="px-4 py-2 text-right font-medium">Use as</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-zinc-100 dark:divide-zinc-800">
                    <For each={inspectedFields()}>
                      {(field) => (
                        <tr>
                          <td class="px-4 py-3 align-middle">
                            <h3 class="flex min-w-0 items-center gap-2 font-semibold text-primary">
                              <i class={`${fieldTypeIcon(field.type)} shrink-0 text-dimmed`} />
                              <span class="truncate">{field.name}</span>
                            </h3>
                          </td>
                          <td class="px-4 py-3 align-middle text-dimmed">{field.typeLabel}</td>
                          <td class="px-4 py-3 align-middle leading-relaxed text-dimmed">{fieldReason(field)}</td>
                          <td class="px-4 py-3 align-middle">
                            <div class="flex items-center justify-end gap-2">
                              <code class="inline-flex rounded bg-zinc-100 px-2 py-1 text-xs text-primary dark:bg-zinc-900">
                                {field.ref}
                              </code>
                              <CopyButton text={field.ref} class="btn-ghost btn-sm inline-flex h-8 w-8 items-center justify-center p-0" />
                            </div>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </DocSection>

            <DocNote title="Back to all sources">
              <a class="link" href={referenceTabHref(props.baseShortId, "tables")}>
                Show all tables and views
              </a>
            </DocNote>
          </>
        )}
      </Show>
    </Doc>
  );
}

function FormulasTab(props: { functionRows: FunctionRow[] }) {
  return (
    <Doc>
      <DocLead>
        Formulas calculate values from fields in one record. They are used in formula table fields, in-place computed columns, formula
        previews, and query predicates such as <DocInlineCode>where Status = 'Open'</DocInlineCode>.
      </DocLead>

      <DocSection title="Where formulas are used">
        <DocRows
          items={[
            {
              title: "Formula fields",
              icon: "ti-table",
              text: "A saved table field. It recalculates whenever a record is read and can be shown in tables, cards, detail panels, views, and dashboards.",
            },
            {
              title: "Computed columns",
              icon: "ti-calculator",
              text: "A temporary view/table column for analysis. It does not change the table schema and can be saved in URL-backed view state.",
            },
            {
              title: "Query predicates",
              icon: "ti-filter",
              text: "A condition inside GQL. The predicate filters rows on the server.",
            },
            {
              title: "Query output",
              icon: "ti-code-plus",
              text: "A computed result column written as formula(expression) as alias in GQL.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Formula basics">
        <DocRows
          items={[
            {
              title: "Fields",
              icon: "ti-columns",
              text: (
                <>
                  Reference fields by name. Quote names with spaces: <DocInlineCode>"Unit price"</DocInlineCode>.
                </>
              ),
            },
            {
              title: "Text values",
              icon: "ti-quote",
              text: (
                <>
                  Use single quotes for text values: <DocInlineCode>'Open'</DocInlineCode>. Double quotes mean a field name, not a value.
                </>
              ),
            },
            {
              title: "Empty values",
              icon: "ti-circle-dashed",
              text: "Empty input stays empty unless the formula decides otherwise. Use IFEMPTY for a fallback.",
            },
            {
              title: "Errors",
              icon: "ti-alert-triangle",
              text: "Formula errors render as an error value. Use IFERROR for expected edge cases such as division by zero.",
            },
            {
              title: "Decimal math",
              icon: "ti-decimal",
              text: "Number and decimal calculations use decimal-safe arithmetic when exact values are involved.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Common formulas">
        <div class="grid gap-3 xl:grid-cols-2">
          <FormulaSnippet title="Total" code="price * quantity" />
          <FormulaSnippet title="Gross amount" code='"Unit price" * quantity * 1.19' />
          <FormulaSnippet title="Fallback text" code="IFEMPTY(notes, 'No notes')" />
          <FormulaSnippet title="Conditional label" code="IF(inStock, 'Available', 'Out of stock')" />
          <FormulaSnippet title="Days until due" code="DATEDIFF(TODAY(), dueDate, 'days')" />
          <FormulaSnippet title="Safe division" code="IFERROR(total / quantity, 0)" />
        </div>
      </DocSection>

      <DocSection title="Full function reference">
        <DataTable
          rows={props.functionRows}
          columns={functionColumns}
          getRowId={(row) => row.name}
          density="compact"
          class="paper max-h-[36rem] overflow-auto"
          renderCell={({ col, value, render }) => (col.id === "copy" ? renderCopyCell(value) : render(value))}
        />
      </DocSection>

      <DocNote title="SQL-looking values" variant="warning">
        <DocInlineCode>status = "open"</DocInlineCode> compares the field <DocInlineCode>status</DocInlineCode> with a field named{" "}
        <DocInlineCode>open</DocInlineCode>. Write <DocInlineCode>status = 'open'</DocInlineCode> for a text value.
      </DocNote>
    </Doc>
  );
}

function QueryLanguageTab() {
  return (
    <Doc>
      <DocLead>
        GQL, the Grids Query Language, is a readable way to describe the records you want to see. Use it when dropdowns become slower than
        writing the rule directly: filter rows, pick fields, sort results, group records, calculate summaries, preview the result, and save
        compatible queries as normal views.
      </DocLead>

      <DocSection title="Minimal query">
        <DocRows
          items={[
            {
              title: "Source",
              icon: "ti-table",
              text: (
                <>
                  Start with <DocInlineCode>from table Books</DocInlineCode> or <DocInlineCode>from view "Open loans"</DocInlineCode>. On a
                  table/view page the source can be implied, but saved queries are easier to share when the source is written down.
                </>
              ),
            },
            {
              title: "All fields by default",
              icon: "ti-columns",
              text: (
                <>
                  Leave out <DocInlineCode>select</DocInlineCode> when you want all fields. GQL then returns the source fields in their
                  normal order.
                </>
              ),
            },
            {
              title: "Preview before saving",
              icon: "ti-eye",
              text: "The query workspace previews the result first. Save it as a view only when the result matches what you expect.",
            },
            {
              title: "Line breaks are for people",
              icon: "ti-align-left",
              text: "Clauses can be on separate lines or on one line separated by semicolons. Use line breaks to make longer queries easier to read.",
            },
          ]}
        />
        <QuerySnippet
          title="All records, all fields"
          code={`from table Books
limit 20`}
        />
      </DocSection>

      <DocSection title="What happens when you leave things out">
        <DocRows
          items={[
            {
              title: "No select",
              icon: "ti-columns",
              text: "All source fields are returned. This is useful while exploring, but saved views are easier to read when important fields are listed.",
            },
            {
              title: "No alias",
              icon: "ti-tag-off",
              text: "A selected field keeps its field name. Formulas and aggregates need aliases because they do not have a stable field name.",
            },
            {
              title: "No direction",
              icon: "ti-sort-ascending",
              text: "Sort defaults to asc with empty values last. Write desc when newest, largest, or latest values should come first.",
            },
            {
              title: "No where",
              icon: "ti-filter-off",
              text: "No rows are filtered out. You see every record the source query allows.",
            },
            {
              title: "No sort",
              icon: "ti-arrows-sort",
              text: "The source decides the order. Add sort when the order matters, especially before offset.",
            },
            {
              title: "No limit",
              icon: "ti-list-numbers",
              text: "Saved queries can return all matching rows. The preview still applies a safety cap so the editor stays responsive.",
            },
            {
              title: "No from on a table page",
              icon: "ti-table",
              text: "The current table or view can be used as the source. Write from explicitly when you want the query to be portable and easier to review.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Names and values">
        <DocRows
          items={[
            {
              title: "Simple names",
              icon: "ti-abc",
              text: "Names without spaces can be written directly: Status, Amount, ordered_at.",
            },
            {
              title: "Names with spaces",
              icon: "ti-quote",
              text: (
                <>
                  Use double quotes for table, view, or field names with spaces: <DocInlineCode>"Line total"</DocInlineCode>.
                </>
              ),
            },
            {
              title: "Text values",
              icon: "ti-quotes",
              text: (
                <>
                  Use single quotes for text values: <DocInlineCode>Status = 'Open'</DocInlineCode>. Double quotes mean a field or table
                  name.
                </>
              ),
            },
            {
              title: "Empty values",
              icon: "ti-circle-dashed",
              text: (
                <>
                  In <DocInlineCode>where</DocInlineCode>, use <DocInlineCode>Field = null</DocInlineCode> or{" "}
                  <DocInlineCode>Field != null</DocInlineCode>. In formula fields, use <DocInlineCode>ISBLANK(Field)</DocInlineCode>.
                </>
              ),
            },
            {
              title: "Numbers and booleans",
              icon: "ti-binary",
              text: (
                <>
                  Write numbers without quotes and booleans as <DocInlineCode>true</DocInlineCode> or <DocInlineCode>false</DocInlineCode>.
                </>
              ),
            },
            {
              title: "Dates",
              icon: "ti-calendar",
              text: (
                <>
                  Write date values as text, for example <DocInlineCode>Date &gt;= '2026-06-01'</DocInlineCode>. Date functions can also be
                  used inside formulas.
                </>
              ),
            },
            {
              title: "Aliases",
              icon: "ti-tag",
              text: (
                <>
                  Use <DocInlineCode>as</DocInlineCode> to name output columns, especially formulas and aggregates.
                </>
              ),
            },
            {
              title: "Comments",
              icon: "ti-message-2",
              text: (
                <>
                  Use <DocInlineCode>--</DocInlineCode> for a short comment. Comments are ignored unless they appear inside quoted text.
                </>
              ),
            },
          ]}
        />
      </DocSection>

      <DocSection title="Writing filters">
        <DocRows
          items={[
            {
              title: "Compare a field with a value",
              icon: "ti-equal",
              text: (
                <>
                  Write <DocInlineCode>Status = 'Open'</DocInlineCode>, <DocInlineCode>Amount &gt; 100</DocInlineCode>, or{" "}
                  <DocInlineCode>Done = false</DocInlineCode>.
                </>
              ),
            },
            {
              title: "Field-to-field comparisons",
              icon: "ti-arrows-left-right",
              text: (
                <>
                  <DocInlineCode>Price &gt; Cost</DocInlineCode> compares two fields in the same row. Use single quotes when the right side
                  should be literal text.
                </>
              ),
            },
            {
              title: "Combine conditions",
              icon: "ti-binary-tree",
              text: (
                <>
                  Use <DocInlineCode>and</DocInlineCode> when both rules must match. Use <DocInlineCode>or</DocInlineCode> when either rule
                  may match.
                </>
              ),
            },
            {
              title: "Use formulas when needed",
              icon: "ti-function",
              text: "Most filters are simple comparisons. Calculated predicates are written directly; formula(...) is only for calculated select or aggregate output.",
            },
            {
              title: "Parentheses",
              icon: "ti-parentheses",
              text: "Use parentheses when and and or are mixed, so the rule reads exactly how it should run.",
            },
            {
              title: "Prefer readable output",
              icon: "ti-eye",
              text: "If the query is for other people, select only useful fields and alias calculated columns with clear names.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Everyday records">
        <QuerySnippet
          title="Filtered records"
          code={`from table Transactions
select Date, Merchant, Amount
where Type = 'expense'
sort Date desc
limit 20`}
        />
      </DocSection>

      <DocSection title="Clause order">
        <DocLead>
          GQL reads like a checklist. You do not need every line, but when several lines are present this order is easiest to understand:
        </DocLead>
        <QuerySnippet
          code={`from table ...
select ...
join table ... on ...
where ...
search ...
group by ...
aggregate ...
having ...
sort ...
limit ...
offset ...
include deleted`}
        />
      </DocSection>

      <DocSection title="Clause reference">
        <DocRows
          items={[
            {
              title: "from",
              icon: "ti-database",
              text: "Choose the source table or view. Use it explicitly for saved queries and reference-window examples. It can be implied on a table/view page.",
            },
            {
              title: "select",
              icon: "ti-columns",
              text: "Choose output columns. Omit it for all source fields. Use commas when selecting several fields.",
            },
            {
              title: "where",
              icon: "ti-filter",
              text: (
                <>
                  Filter rows before grouping. Simple comparisons work directly. Functions, math, and, or, and parentheses use the same
                  expression rules as formulas.
                </>
              ),
            },
            {
              title: "search",
              icon: "ti-search",
              text: (
                <>
                  Search all searchable source fields with <DocInlineCode>search 'alice'</DocInlineCode>, or limit it with{" "}
                  <DocInlineCode>search 'alice' in Name, Notes</DocInlineCode>. Joined fields can be searched explicitly, for example{" "}
                  <DocInlineCode>search 'alice' in customer.Name</DocInlineCode>.
                </>
              ),
            },
            {
              title: "join / left join",
              icon: "ti-arrows-join",
              text: "Bring related records into the result through relation fields. Use left join when rows without a match should stay visible.",
            },
            {
              title: "group by",
              icon: "ti-list-tree",
              text: "Bucket records by one or more fields. Date fields can be bucketed by day, week, month, quarter, or year.",
            },
            {
              title: "aggregate",
              icon: "ti-sigma",
              text: (
                <>
                  Calculate summary values such as <DocInlineCode>count</DocInlineCode>, <DocInlineCode>countEmpty</DocInlineCode>,{" "}
                  <DocInlineCode>countUnique</DocInlineCode>, <DocInlineCode>sum</DocInlineCode>, <DocInlineCode>avg</DocInlineCode>,{" "}
                  <DocInlineCode>median</DocInlineCode>, <DocInlineCode>earliest</DocInlineCode>, and <DocInlineCode>latest</DocInlineCode>.
                  Use aliases for clear column names.
                </>
              ),
            },
            {
              title: "having",
              icon: "ti-filter-check",
              text: "Filter grouped rows after aggregate values exist. Use it for rules like revenue > 0. Use where when the rule should apply before grouping.",
            },
            {
              title: "sort",
              icon: "ti-arrows-sort",
              text: (
                <>
                  Order rows or groups with <DocInlineCode>asc</DocInlineCode> or <DocInlineCode>desc</DocInlineCode>. Empty values sort
                  last unless you add <DocInlineCode>nulls first</DocInlineCode>.
                </>
              ),
            },
            {
              title: "limit / offset",
              icon: "ti-list-numbers",
              text: "Limit keeps the first N results. Offset starts after N results. Sort before using it for predictable paging.",
            },
            {
              title: "include deleted / deleted only",
              icon: "ti-trash",
              text: "Include trashed records in the result, or show only trashed records.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Interactions and edge cases">
        <DocRows
          items={[
            {
              title: "where vs having",
              icon: "ti-filter",
              text: "Where filters individual records before groups are built. Having filters the grouped result after aggregate aliases exist.",
            },
            {
              title: "select with group by",
              icon: "ti-columns",
              text: "Grouped queries return group fields and aggregate columns. Row fields that are not grouped do not have one clear value per group.",
            },
            {
              title: "sort with aliases",
              icon: "ti-arrows-sort",
              text: "Sort can use selected fields, aggregate aliases, and formula aliases when that name exists in the result.",
            },
            {
              title: "limit with offset",
              icon: "ti-list-numbers",
              text: "Sort first, then offset, then limit. Without sort, paging is not meaningful because the source order can change.",
            },
            {
              title: "View sources",
              icon: "ti-table-spark",
              text: "Row-shaped saved views can be queried as record sources, including their saved filter, search, sort, limit, trash mode, and record metadata. Grouped or aggregate views are summary tables and are not record sources.",
            },
            {
              title: "Joins and permissions",
              icon: "ti-lock",
              text: "A join only works when the current user can read the joined table through the allowed relation path.",
            },
            {
              title: "Joined fields",
              icon: "ti-arrows-join-2",
              text: "Joined fields can be selected, sorted, searched, grouped, aggregated, and used in formula output through explicit aliases. Grouped joins accept scalar group fields only.",
            },
            {
              title: "Preview-only features",
              icon: "ti-eye",
              text: "Some advanced queries can be previewed before they can be saved as a normal view. The save button reports that instead of silently changing the query.",
            },
            {
              title: "Readable names are rewritten best effort",
              icon: "ti-pencil",
              text: "Saved formulas and queries use readable names for editing. Renaming tables or fields rewrites them best effort; review important saved queries after large renames.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Joins in plain language">
        <DocRows
          items={[
            {
              title: "Use join for related data",
              icon: "ti-link",
              text: "Join when the value you need lives in a linked record, such as customer name on an order or category name on an item.",
            },
            {
              title: "Inner join",
              icon: "ti-arrows-join",
              text: "Keeps rows only when the related record exists. This is best when the relation is required.",
            },
            {
              title: "Left join",
              icon: "ti-arrow-merge-left",
              text: "Keeps the source row even when the related record is empty. This is best for optional relations.",
            },
            {
              title: "Aliases keep names short",
              icon: "ti-tag",
              text: "Use aliases when joined tables have overlapping field names or long names.",
            },
          ]}
        />
        <QuerySnippet
          title="Customer name from a related table"
          code={`from table Orders
left join table Customers as customer on Customer = customer.id
select "Order no", customer.Name as customer_name, "Line total"
limit 25`}
        />
      </DocSection>

      <DocSection title="Filters with formulas">
        <QuerySnippet
          title="Multiple conditions"
          code={`from table Inventory
where Status = 'Available' and Quantity > 0
sort Name asc`}
        />
        <QuerySnippet
          title="Formula in a filter"
          code={`from table Products
where Price <= "Purchase price" * 1.10
select Name, Price, "Purchase price"`}
        />
        <QuerySnippet
          title="Formula over a joined record"
          code={`from table Orders
join table Customers as customer on Customer = customer.id
select "Order no", formula("Line total" + customer.Score) as weighted_total
where customer.Score > 5
sort weighted_total desc`}
        />
      </DocSection>

      <DocSection title="Grouping and summaries">
        <DocRows
          items={[
            {
              title: "Group first",
              icon: "ti-list-tree",
              text: "Group chooses the buckets, such as month, status, category, owner, or location.",
            },
            {
              title: "Aggregate after grouping",
              icon: "ti-sigma",
              text: "Aggregate calculates values inside each bucket: count variants, sum, average, median, min, max, earliest, or latest.",
            },
            {
              title: "Having filters groups",
              icon: "ti-filter-check",
              text: "Where filters records before grouping. Having filters the grouped result after aggregates exist.",
            },
            {
              title: "Chart-ready result",
              icon: "ti-chart-bar",
              text: "A chart source needs at least one group field for labels and one aggregate value for the chart values.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Chart-ready grouped query">
        <QuerySnippet
          title="Monthly revenue"
          code={`from table Orders
group by "Ordered at" by month
aggregate sum("Line total") as revenue, count(*) as rows
having revenue > 0
sort "Ordered at" asc`}
        />
      </DocSection>

      <DocSection title="Computed query output">
        <QuerySnippet
          title="Temporary formula column"
          code={`from table Products
select Name, Price, formula(Price * 1.19) as gross
where Price * 1.19 > 0
limit 20`}
        />
      </DocSection>

      <DocSection title="One-line queries">
        <p class="text-dimmed">
          Line breaks are optional. They make long queries easier to scan. Use semicolons when several clauses share one physical line.
        </p>
        <QuerySnippet
          title="Same query on one line"
          code={`from table Orders; select "Order no", "Line total"; where Status = 'Paid'; sort "Ordered at" desc; limit 10`}
        />
      </DocSection>

      <DocSection title="Paging with limit and offset">
        <DocRows
          items={[
            {
              title: "limit",
              icon: "ti-list-numbers",
              text: "Keeps at most N rows. Use it for short previews, embedded views, and lists where only the newest rows matter.",
            },
            {
              title: "offset",
              icon: "ti-player-skip-forward",
              text: "Starts after N rows. Always sort first, otherwise page two may not be stable.",
            },
            {
              title: "Preview cap",
              icon: "ti-shield",
              text: "The editor may still cap previews to protect the UI. The saved view keeps the query rules.",
            },
          ]}
        />
        <QuerySnippet
          title="Second page of newest orders"
          code={`from table Orders
sort "Ordered at" desc
limit 25
offset 25`}
        />
      </DocSection>

      <DocNote title="Common mistake" variant="warning">
        <DocInlineCode>Status = "Open"</DocInlineCode> compares Status with a field named Open. Write{" "}
        <DocInlineCode>Status = 'Open'</DocInlineCode> when Open is a text value.
      </DocNote>

      <DocNote title="Fastest way to explore" variant="tip">
        Start with <DocInlineCode>from table Name</DocInlineCode> and no <DocInlineCode>select</DocInlineCode>. Add
        <DocInlineCode> where</DocInlineCode>, <DocInlineCode> sort</DocInlineCode>, and <DocInlineCode> select</DocInlineCode>
        only after the preview shows the right records.
      </DocNote>
    </Doc>
  );
}

function HowItWorksTab() {
  return (
    <Doc>
      <DocLead>
        This section explains the mechanics behind GQL for people who need to reason about correctness, permissions, and performance. You
        can use GQL without reading this first.
      </DocLead>

      <DocSection title="Execution model">
        <DocRows
          items={[
            {
              title: "Parsed first",
              icon: "ti-brackets-contain",
              text: "GQL text is parsed into a small known set of clauses. Unknown syntax fails before any data is read.",
            },
            {
              title: "Names are resolved",
              icon: "ti-abc",
              text: "Table, view, field, and alias names are resolved against the base catalog. Renames are rewritten best effort for saved formulas and queries.",
            },
            {
              title: "Permissions are checked",
              icon: "ti-lock",
              text: "A source only runs if the user can read it. Joins and relation targets are checked instead of exposing hidden tables.",
            },
            {
              title: "SQL runs on the server",
              icon: "ti-database",
              text: "Filtering, sorting, grouping, aggregation, joins, offset, and limit happen in SQL. The browser displays the result.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Limits and defaults">
        <DocRows
          items={[
            {
              title: "No select",
              icon: "ti-columns",
              text: "Missing select means all source fields. This is useful for quick inspection, but saved views are clearer when important fields are explicit.",
            },
            {
              title: "Preview limit",
              icon: "ti-list-numbers",
              text: "Preview requests are capped so a test query cannot load an entire large base into the UI.",
            },
            {
              title: "Aliases",
              icon: "ti-tag",
              text: "Aliases must be unique in the result. Use clear names for formulas and aggregates so charts and tables can label them.",
            },
            {
              title: "Formula scope",
              icon: "ti-function",
              text: "Formula syntax is supported in filters, having clauses, and formula(...) output columns. Field names inside formulas follow the same quoting rules.",
            },
          ]}
        />
      </DocSection>
    </Doc>
  );
}

function ExamplesTab(props: { catalogExample: string }) {
  return (
    <Doc>
      <DocLead>
        These examples are learning patterns. Copy one, replace names with fields from your base, then preview before saving the query as a
        view.
      </DocLead>

      <DocSection title="For this base">
        <QuerySnippet title="Starter query" code={props.catalogExample} />
      </DocSection>

      <DocSection title="GQL patterns">
        <div class="grid gap-3 xl:grid-cols-2">
          <For each={QUERY_EXAMPLES}>
            {(example) => (
              <div class="space-y-2">
                <p class="text-sm text-dimmed">{example.description}</p>
                <QuerySnippet title={example.title} code={example.code} />
              </div>
            )}
          </For>
        </div>
      </DocSection>

      <DocSection title="Omitted clause examples">
        <div class="grid gap-3 xl:grid-cols-2">
          <QuerySnippet
            title="No select: all fields"
            code={`from table Books
where "In stock" = true
limit 20`}
          />
          <QuerySnippet
            title="No where: every row"
            code={`from table Orders
select "Order no", Customer, "Line total"
sort "Ordered at" desc
limit 20`}
          />
          <QuerySnippet
            title="No explicit source on a table page"
            code={`select Name, Status
where Status != 'Done'
sort Name asc`}
          />
          <QuerySnippet
            title="No alias for fields, alias for formula"
            code={`from table Products
select Name, Price, formula(Price * 1.19) as gross_price`}
          />
        </div>
      </DocSection>

      <DocSection title="Formula-only patterns">
        <div class="grid gap-3 xl:grid-cols-2">
          <FormulaSnippet title="Fallback value" code="IFEMPTY(Notes, 'No notes')" />
          <FormulaSnippet title="Date age" code="DATEDIFF(TODAY(), Due, 'days')" />
          <FormulaSnippet title="Safe division" code="IFERROR(Amount / Quantity, 0)" />
          <FormulaSnippet title="Text label" code="CONCAT(UPPER(Status), ' · ', Name)" />
        </div>
      </DocSection>

      <DocSection title="GQL patterns with formulas">
        <div class="grid gap-3 xl:grid-cols-2">
          <QuerySnippet
            title="Calculated output"
            code={`from table Products
select Name, Price, formula(Price * 1.19) as gross_price
limit 20`}
          />
          <QuerySnippet
            title="Calculated filter"
            code={`from table Products
where Price - Cost > 0
select Name, Price, Cost
sort Name asc`}
          />
          <QuerySnippet
            title="Safe margin"
            code={`from table Products
select Name, formula(IFERROR((Price - Cost) / Price, 0)) as margin
where Price > 0`}
          />
          <QuerySnippet
            title="Text label"
            code={`from table Tasks
select Name, formula(CONCAT(UPPER(Status), ' · ', Name)) as label
where Status != 'Done'`}
          />
        </div>
      </DocSection>

      <DocSection title="Interaction paths">
        <DocRows
          items={[
            {
              title: "Open from a table",
              icon: "ti-table",
              text: "The current table can be the source. Add from table when you want the saved text to be clear outside that page.",
            },
            {
              title: "Open from a view",
              icon: "ti-table-spark",
              text: "The current view can be the source. The GQL rules are applied on top of the view's saved GQL source.",
            },
            {
              title: "Open reference",
              icon: "ti-book",
              text: "Use the reference window when you need exact table names, field names, formulas, or examples on a second screen.",
            },
            {
              title: "Save as view",
              icon: "ti-bookmark-plus",
              text: "Save when the preview is stable and the query can be represented as a view. Some advanced preview-only features may not save yet.",
            },
            {
              title: "Share a query",
              icon: "ti-link",
              text: "The query workspace keeps the current text in page state. A saved view is the durable way to share the result with other users.",
            },
            {
              title: "Use with dashboards",
              icon: "ti-layout-dashboard",
              text: "Save the query as a view first, then use that view in dashboard table, chart, stat, card, or calendar contexts where supported.",
            },
          ]}
        />
      </DocSection>

      <DocSection title="Learning path">
        <DocRows
          items={[
            {
              title: "Create a table",
              icon: "ti-table-plus",
              text: "Start with records and fields before building views or dashboards.",
            },
            {
              title: "Add a view",
              icon: "ti-filter",
              text: "Save the repeated filter, sort, display mode, or grouped report.",
            },
            {
              title: "Add formulas",
              icon: "ti-function",
              text: "Use formulas for values users should not calculate manually.",
            },
            {
              title: "Use a dashboard",
              icon: "ti-layout-dashboard",
              text: "Bring forms, stats, charts, instructions, and important views into one page.",
            },
          ]}
        />
      </DocSection>
    </Doc>
  );
}

export default function QueryReferenceWindow(props: Props) {
  const activeTab = () => props.defaultTab ?? "basics";

  const sourceRows = createMemo<SourceRow[]>(() => {
    const tableRows = props.tables.map((table) => ({
      id: `table:${table.id}`,
      shortId: table.shortId,
      kind: "table" as const,
      tableId: table.id,
      name: table.name,
      ref: formatIdentifierRef(table.name),
      description: table.description ?? "",
      fieldCount: props.fieldsByTable[table.id]?.length ?? 0,
      recordCount: props.recordCountsByTable[table.id] ?? 0,
      search: [table.name, table.description ?? "", formatIdentifierRef(table.name), "table"].join(" "),
    }));
    const viewRows = props.tables.flatMap((table) =>
      (props.viewsByTable[table.id] ?? []).map((view) => ({
        id: `view:${view.id}`,
        shortId: view.shortId,
        kind: "view" as const,
        parentTableId: table.id,
        name: view.name,
        parent: table.name,
        ref: formatIdentifierRef(view.name),
        description: "Saved view",
        fieldCount: props.fieldsByTable[table.id]?.length ?? 0,
        recordCount: props.recordCountsByTable[table.id] ?? 0,
        search: [view.name, formatIdentifierRef(view.name), table.name, "view"].join(" "),
      })),
    );
    return [...tableRows, ...viewRows];
  });

  const fieldRows = createMemo<FieldRow[]>(() =>
    props.tables.flatMap((table) =>
      (props.fieldsByTable[table.id] ?? []).map((field) => ({
        id: field.id,
        tableId: table.id,
        table: table.name,
        name: field.name,
        ref: formatIdentifierRef(field.name),
        type: field.type,
        typeLabel: fieldTypeLabel(field.type),
        description: field.description ?? "",
        search: [table.name, field.name, formatIdentifierRef(field.name), field.type, field.description ?? ""].join(" "),
      })),
    ),
  );

  const functionRows = createMemo<FunctionRow[]>(() =>
    GRID_FORMULA_FUNCTIONS.map((fn) => {
      const category = functionCategory(fn.name, fn.returnType);
      return {
        name: fn.name,
        category,
        signature: fn.signature,
        description: fn.description,
        returnType: fn.returnType,
        search: [category, fn.name, fn.signature, fn.description, fn.returnType].join(" "),
      };
    }),
  );

  const firstTable = createMemo(() => firstTableName(props.tables));
  const firstFields = createMemo(() => props.fieldsByTable[props.tables[0]?.id ?? ""] ?? []);
  const firstDate = createMemo(() => firstDateField(firstFields()));
  const firstNumber = createMemo(() => firstNumberField(firstFields()));
  const catalogExample = createMemo(() => buildExampleForCatalog(props.tables, props.fieldsByTable));
  const content = (): JSX.Element => {
    switch (activeTab()) {
      case "datatypes":
        return <DataTypesTab />;
      case "tables":
        return (
          <AvailableDataTab
            baseShortId={props.baseShortId}
            sourceRows={sourceRows()}
            fieldRows={fieldRows()}
            inspectedSourceId={props.inspectedSourceId}
          />
        );
      case "formulas":
        return <FormulasTab functionRows={functionRows()} />;
      case "gql":
        return <QueryLanguageTab />;
      case "examples":
        return <ExamplesTab catalogExample={catalogExample()} />;
      case "how-it-works":
        return <HowItWorksTab />;
      case "basics":
      default:
        return <OverviewTab tableName={firstTable()} dateField={firstDate()} numberField={firstNumber()} />;
    }
  };

  return (
    <AppWorkspace class="h-screen bg-surface">
      <ReferenceSidebar activeTab={activeTab()} baseShortId={props.baseShortId} baseName={props.baseName} />
      <AppWorkspace.Main class="bg-surface">
        <div class="flex min-h-0 flex-1 flex-col overflow-auto p-4 md:p-6">{content()}</div>
      </AppWorkspace.Main>
    </AppWorkspace>
  );
}
