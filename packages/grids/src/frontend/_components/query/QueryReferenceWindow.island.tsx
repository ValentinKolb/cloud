import { CopyButton, DataTable, TextInput, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { fuzzy } from "@valentinkolb/stdlib";
import { createMemo, createSignal, For, Show } from "solid-js";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { fieldTypeIcon, fieldTypeLabel } from "../fields/field-type-meta";
import { GRID_FORMULA_FUNCTIONS } from "../fields/formula-authoring";

type SourceRow = {
  kind: "table" | "view";
  id: string;
  label: string;
  ref: string;
  tableName?: string;
  search: string;
};

type FieldRow = {
  tableName: string;
  field: Field;
  search: string;
};

type FunctionRow = {
  name: string;
  signature: string;
  description: string;
  search: string;
};

const QUERY_EXAMPLES = [
  { label: "Rows", code: "from table Orders\nselect Customer, Amount\nwhere formula(Status = 'Open')\nsort CreatedAt descending\nlimit 50" },
  { label: "Computed value", code: "from table Orders\nselect Price, Quantity, formula(Price * Quantity) as total\nlimit 50" },
  {
    label: "Grouped chart source",
    code: "from table Orders\ngroup by OrderedAt by month\naggregate sum(LineTotal) as total\nsort total descending",
  },
];

export default function QueryReferenceWindow(props: {
  baseName: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
}) {
  const [query, setQuery] = createSignal("");
  const sourceRows = createMemo<SourceRow[]>(() => {
    const rows = props.tables.flatMap((table) => {
      const tableRow: SourceRow = {
        kind: "table",
        id: table.id,
        label: table.name,
        ref: formatIdentifierRef(table.name),
        search: `table ${table.name} ${table.shortId}`,
      };
      const viewRows = (props.viewsByTable[table.id] ?? []).map((view) => ({
        kind: "view" as const,
        id: view.id,
        label: view.name,
        tableName: table.name,
        ref: formatIdentifierRef(view.name),
        search: `view ${view.name} ${table.name} ${view.shortId}`,
      }));
      return [tableRow, ...viewRows];
    });
    const q = query().trim();
    if (!q) return rows;
    return fuzzy.filter(q, rows, { key: (item) => item.search, limit: 80 }).map((hit) => hit.item);
  });
  const fieldRows = createMemo<FieldRow[]>(() => {
    const rows = props.tables.flatMap((table) =>
      (props.fieldsByTable[table.id] ?? []).map((field) => ({
        tableName: table.name,
        field,
        search: `${table.name} ${field.name} ${field.shortId} ${field.type} ${fieldTypeLabel(field.type)}`,
      })),
    );
    const q = query().trim();
    if (!q) return rows;
    return fuzzy.filter(q, rows, { key: (item) => item.search, limit: 120 }).map((hit) => hit.item);
  });
  const functionRows = createMemo<FunctionRow[]>(() => {
    const rows = GRID_FORMULA_FUNCTIONS.map((fn) => ({
      name: fn.name,
      signature: fn.signature,
      description: fn.description,
      search: `${fn.name} ${fn.signature} ${fn.description}`,
    }));
    const q = query().trim();
    if (!q) return rows;
    return fuzzy.filter(q, rows, { key: (item) => item.search, limit: 80 }).map((hit) => hit.item);
  });

  const sourceColumns: DataTableColumn<SourceRow>[] = [
    { id: "source", header: "Source", value: (row) => row.label },
    { id: "ref", header: "Ref", value: (row) => row.ref, headerClass: "w-28", cellClass: "w-28" },
    { id: "copy", header: "", value: (row) => row.ref, headerClass: "w-12", cellClass: "w-12" },
  ];
  const fieldColumns: DataTableColumn<FieldRow>[] = [
    { id: "field", header: "Field", value: (row) => row.field.name },
    { id: "table", header: "Table", value: (row) => row.tableName },
    { id: "ref", header: "Ref", value: (row) => formatIdentifierRef(row.field.name), headerClass: "w-36", cellClass: "w-36" },
    { id: "copy", header: "", value: (row) => formatIdentifierRef(row.field.name), headerClass: "w-12", cellClass: "w-12" },
  ];
  const functionColumns: DataTableColumn<FunctionRow>[] = [
    { id: "function", header: "Function", value: (row) => row.name },
    { id: "signature", header: "Signature", value: (row) => row.signature },
    { id: "copy", header: "", value: (row) => `formula(${row.name}())`, headerClass: "w-12", cellClass: "w-12" },
  ];

  return (
    <main class="flex h-screen overflow-hidden bg-zinc-50 p-4 dark:bg-zinc-950 md:p-6">
      <div class="mx-auto flex h-full min-h-0 w-full max-w-7xl flex-col gap-4">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 class="text-2xl font-semibold tracking-normal">Query reference</h1>
            <p class="text-sm text-dimmed">{props.baseName}</p>
          </div>
          <div class="w-full max-w-md">
            <TextInput value={query} onInput={setQuery} icon="ti ti-search" placeholder="Search sources, fields, functions..." clearable />
          </div>
        </header>

        <div class="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section class="flex min-h-0 flex-col gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-database" /> Sources <span class="text-dimmed">{sourceRows().length}</span>
            </h2>
            <DataTable
              rows={sourceRows()}
              columns={sourceColumns}
              getRowId={(row) => `${row.kind}:${row.id}`}
              class="paper min-h-0 flex-1 overflow-auto"
              empty="No matching sources"
              renderCell={({ row, col, value }) => {
                if (col.id === "source") {
                  return (
                    <span class="flex min-w-0 flex-col">
                      <span class="inline-flex min-w-0 items-center gap-2">
                        <i class={row.kind === "view" ? "ti ti-table-spark text-blue-500" : "ti ti-table text-dimmed"} />
                        <span class="truncate font-medium text-primary">{row.label}</span>
                      </span>
                      <Show when={row.tableName}>
                        <span class="truncate text-xs text-dimmed">{row.tableName}</span>
                      </Show>
                    </span>
                  );
                }
                if (col.id === "ref") return <code class="font-mono text-primary">{String(value)}</code>;
                return <CopyButton text={String(value)} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;
              }}
            />
          </section>

          <section class="flex min-h-0 flex-col gap-2">
            <h2 class="flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-columns" /> Fields <span class="text-dimmed">{fieldRows().length}</span>
            </h2>
            <DataTable
              rows={fieldRows()}
              columns={fieldColumns}
              getRowId={(row) => row.field.id}
              class="paper min-h-0 flex-1 overflow-auto"
              empty="No matching fields"
              renderCell={({ row, col, value }) => {
                if (col.id === "field") {
                  return (
                    <span class="flex min-w-0 flex-col">
                      <span class="inline-flex min-w-0 items-center gap-2">
                        <i class={`${fieldTypeIcon(row.field.type, row.field.icon)} text-sm text-dimmed`} />
                        <span class="truncate font-medium text-primary">{row.field.name}</span>
                      </span>
                      <span class="text-xs text-dimmed">{fieldTypeLabel(row.field.type)}</span>
                    </span>
                  );
                }
                if (col.id === "table") return <span class="truncate text-dimmed">{String(value)}</span>;
                if (col.id === "ref") return <code class="font-mono text-primary">{String(value)}</code>;
                return <CopyButton text={String(value)} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;
              }}
            />
          </section>
        </div>

        <section class="grid shrink-0 grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div class="paper overflow-hidden p-3">
            <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-function" /> Formula functions
            </h2>
            <DataTable
              rows={functionRows().slice(0, 8)}
              columns={functionColumns}
              getRowId={(row) => row.name}
              class="max-h-72 overflow-auto"
              empty="No matching functions"
              renderCell={({ row, col, value }) => {
                if (col.id === "function") {
                  return (
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate font-medium text-primary">{row.name}</span>
                      <span class="truncate text-xs text-dimmed">{row.description}</span>
                    </span>
                  );
                }
                if (col.id === "signature") return <code class="text-xs text-dimmed">{String(value)}</code>;
                return <CopyButton text={String(value)} class="icon-btn h-8 w-8 text-dimmed hover:text-primary" />;
              }}
            />
          </div>

          <div class="paper overflow-auto p-3">
            <h2 class="mb-2 flex items-center gap-2 text-sm font-semibold text-secondary">
              <i class="ti ti-code" /> Examples
            </h2>
            <div class="grid gap-2">
              <For each={QUERY_EXAMPLES}>
                {(example) => (
                  <div class="rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
                    <div class="mb-2 text-xs font-semibold uppercase tracking-wide text-dimmed">{example.label}</div>
                    <pre class="overflow-auto whitespace-pre-wrap font-mono text-xs text-secondary">{example.code}</pre>
                  </div>
                )}
              </For>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
