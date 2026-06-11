import { AutocompleteEditor, DataTable, DockWorkspace, prompts, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import { buildQueryCompletions } from "./query-completions";

type Props = {
  baseId: string;
  baseShortId: string;
  initialQuery: string;
  queryPath: string;
  currentSource?:
    | { kind: "table"; tableId: string; label: string; ref: string }
    | { kind: "view"; viewId: string; label: string; ref: string };
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
};

type PreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type PreviewRow = PreviewSuccess["rows"][number] & { __rowKey: string };
const MAX_SYNCED_QUERY_HREF_LENGTH = 2800;

const queryHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|inner|as|on|where|formula|group|by|aggregate|having|sort|limit|offset|skip|asc|ascending|desc|descending)\b/i,
    },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+|\{[0-9a-f-]{36}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value, null, 2);
};

const queryHref = (queryPath: string, query: string) => {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query);
  const search = params.toString();
  return `${queryPath}${search ? `?${search}` : ""}`;
};

const queryReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/query-reference`;

const openQueryReferenceWindow = (baseShortId: string) => {
  if (typeof window === "undefined") return;
  window.open(queryReferenceHref(baseShortId), "grids-query-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

const safeQueryHref = (queryPath: string, query: string) => {
  const href = queryHref(queryPath, query);
  return href.length <= MAX_SYNCED_QUERY_HREF_LENGTH ? href : queryPath;
};

function QueryPreview(props: { preview: DslQueryPreviewResponse | null; loading: boolean }) {
  const success = createMemo(() => (props.preview?.ok ? props.preview : null));
  const diagnostics = createMemo(() => (props.preview && !props.preview.ok ? props.preview.diagnostics : []));
  const rows = createMemo<PreviewRow[]>(() =>
    props.preview?.ok ? props.preview.rows.map((row, index) => ({ ...row, __rowKey: row.recordId ?? `row-${index}` })) : [],
  );
  const columns = createMemo<DataTableColumn<PreviewRow>[]>(() => {
    if (!props.preview?.ok) return [];
    return props.preview.columns.map((column) => ({
      id: column.key,
      header: column.label,
      subtitle: column.joinAlias ? `${column.joinAlias} · ${column.type}` : column.type,
      value: (row) => row.values[column.key],
    }));
  });

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface p-3">
      <Show
        when={props.preview}
        fallback={
          <div class="paper flex flex-1 items-center justify-center p-8 text-sm text-dimmed">
            <Show when={props.loading} fallback="Write a query to preview records.">
              <span class="inline-flex items-center gap-2">
                <i class="ti ti-loader-2 animate-spin" /> Checking
              </span>
            </Show>
          </div>
        }
      >
        <Show
          when={success()}
          fallback={
            <div class="paper flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4 text-sm">
              <For each={diagnostics()}>
                {(diagnostic) => (
                  <div class="info-block-danger">
                    <Show when={diagnostic.line}>
                      <span class="font-medium">Line {diagnostic.line}: </span>
                    </Show>
                    {diagnostic.message}
                  </div>
                )}
              </For>
            </div>
          }
        >
          {(preview) => (
            <div class="paper flex min-h-0 flex-1 flex-col overflow-hidden">
              <DataTable
                rows={rows()}
                columns={columns()}
                getRowId={(row) => row.__rowKey}
                class="flex-1 overflow-auto"
                density="compact"
                hoverRows={false}
                cellContentClass="max-h-24 overflow-auto whitespace-pre-wrap break-words"
                empty={<span>No rows match this query.</span>}
                renderCell={({ value }) => <span>{displayValue(value)}</span>}
                scrollPreserveKey="grids-query-preview"
              />
              <Show when={preview().truncated}>
                <div class="shrink-0 px-3 py-2 text-xs text-dimmed">Limited to {preview().limit} rows.</div>
              </Show>
            </div>
          )}
        </Show>
      </Show>
    </div>
  );
}

export default function QueryWorkspace(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [preview, setPreview] = createSignal<DslQueryPreviewResponse | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [saveLoading, setSaveLoading] = createSignal(false);
  const completions = createMemo(() =>
    buildQueryCompletions({
      currentSource: props.currentSource,
      tables: props.tables,
      fieldsByTable: props.fieldsByTable,
      viewsByTable: props.viewsByTable,
    }),
  );
  let previewToken = 0;

  createEffect(() => {
    setQuery(props.initialQuery);
  });

  const loadPreview = async (source: string) => {
    const token = ++previewToken;
    if (!source.trim()) {
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await apiClient["query-dsl"]["by-base"][":baseId"].preview.$post({
        param: { baseId: props.baseId },
        json: { query: source, limit: 100, ...(props.currentSource ? { currentSource: props.currentSource } : {}) },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not preview query."));
      const data = await response.json();
      if (token === previewToken) setPreview(data);
    } catch (error) {
      if (token === previewToken) {
        setPreview({
          ok: false,
          diagnostics: [{ message: error instanceof Error ? error.message : "Could not preview query." }],
        });
      }
    } finally {
      if (token === previewToken) setLoading(false);
    }
  };

  const previewDebounce = timed.debounce(loadPreview, 250);

  createEffect(() => {
    previewDebounce.debouncedFn(query());
  });

  const onInput = (next: string) => {
    setQuery(next);
    if (typeof window !== "undefined") window.history.replaceState(window.history.state, "", safeQueryHref(props.queryPath, next));
  };

  const insertExample = (source: string) => {
    onInput(source);
  };

  const handleSaveAsView = async () => {
    if (!query().trim() || saveLoading()) return;
    const result = await prompts.form({
      title: "Save view",
      icon: "ti ti-bookmark-plus",
      fields: {
        name: {
          type: "text",
          label: "Name",
          required: true,
          placeholder: "e.g. Open orders",
        },
        shared: {
          type: "boolean",
          label: "Share with everyone who can read this table",
          default: false,
        },
      },
      confirmText: "Save",
    });
    if (!result) return;

    setSaveLoading(true);
    try {
      const compiledResponse = await apiClient["query-dsl"]["by-base"][":baseId"]["compile-view"].$post({
        param: { baseId: props.baseId },
        json: { query: query(), ...(props.currentSource ? { currentSource: props.currentSource } : {}) },
      });
      if (!compiledResponse.ok) throw new Error(await errorMessage(compiledResponse, "Could not compile query."));
      const compiled = await compiledResponse.json();
      if (!compiled.ok) {
        const message = compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n");
        prompts.error(message || "This query cannot be saved as a regular view yet.");
        return;
      }

      const createResponse = await apiClient.views["by-table"][":tableId"].$post({
        param: { tableId: compiled.tableId },
        json: {
          name: String(result.name).trim(),
          query: compiled.query,
          shared: Boolean(result.shared),
        },
      });
      if (!createResponse.ok) throw new Error(await errorMessage(createResponse, "Could not save view."));
      const view = await createResponse.json();
      const table = props.tables.find((item) => item.id === view.tableId);
      if (typeof window !== "undefined" && table) {
        window.location.assign(`/app/grids/${props.baseShortId}/table/${table.shortId}/view/${view.shortId}`);
      }
    } catch (error) {
      prompts.error(error instanceof Error ? error.message : "Could not save view.");
    } finally {
      setSaveLoading(false);
    }
  };

  const firstTable = () => props.tables[0];
  const firstNumericField = () =>
    firstTable()
      ? props.fieldsByTable[firstTable()!.id]?.find((field) => ["number", "percent", "decimal"].includes(field.type))
      : undefined;
  const firstDateField = () => (firstTable() ? props.fieldsByTable[firstTable()!.id]?.find((field) => field.type === "date") : undefined);

  const examples = () => {
    const table = firstTable();
    if (!table) return [];
    const amount = firstNumericField();
    const date = firstDateField();
    const firstField = props.fieldsByTable[table.id]?.[0];
    return [
      {
        label: "Rows",
        code: `from table ${formatIdentifierRef(table.name)}\nselect ${formatIdentifierRef(firstField?.name ?? "field")}\nlimit 20`,
      },
      ...(amount && date
        ? [
            {
              label: "Grouped",
              code: `from table ${formatIdentifierRef(table.name)}\ngroup by ${formatIdentifierRef(date.name)} by month\naggregate sum(${formatIdentifierRef(amount.name)}) as total\nsort total descending`,
            },
          ]
        : []),
    ];
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col" data-scroll-preserve="grids-query-workspace">
      <DockWorkspace storageKey={`grids-query-${props.baseShortId}`} defaultResultSize={58} class="flex-1">
        <DockWorkspace.Result title="Preview" icon="ti ti-table-spark">
          <QueryPreview preview={preview()} loading={loading()} />
        </DockWorkspace.Result>

        <DockWorkspace.Pane id="query" title="Query" icon="ti ti-code" section="editor">
          <section class="flex h-full min-h-0 flex-col gap-3 overflow-hidden p-3">
            <Show when={props.currentSource}>
              {(source) => (
                <div class="flex items-center justify-between gap-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950/70">
                  <span class="inline-flex min-w-0 items-center gap-2 text-dimmed">
                    <i class={source().kind === "view" ? "ti ti-table-spark" : "ti ti-table"} />
                    <span class="shrink-0">Implicit source</span>
                    <span class="truncate font-medium text-primary">{source().label}</span>
                  </span>
                  <code class="shrink-0 text-xs text-dimmed">
                    from {source().kind} {formatIdentifierRef(source().label)}
                  </code>
                </div>
              )}
            </Show>

            <div class="min-h-0 flex-1">
              <AutocompleteEditor
                value={query}
                onInput={onInput}
                completions={completions()}
                highlight={queryHighlight}
                restoreExpansionOnBackspace={false}
                fill
                placeholder={"from table Orders\nwhere formula(Status = 'Open')\nsort CreatedAt descending\nlimit 50\nskip 0"}
                ariaLabel="Grids query"
              />
            </div>
            <p class="text-xs text-dimmed leading-snug">
              Saved views use stable field IDs. Readable query text and formulas are rewritten best effort on renames; review important queries after renaming tables or fields.
            </p>
            <Show when={queryHref(props.queryPath, query()).length > MAX_SYNCED_QUERY_HREF_LENGTH}>
              <p class="text-xs text-dimmed">
                This query is too long for the URL. Preview still works, but reload will start with an empty query.
              </p>
            </Show>

            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <For each={examples()}>
                {(example) => (
                  <button type="button" class="btn-input btn-sm" onClick={() => insertExample(example.code)}>
                    <i class="ti ti-sparkles" /> {example.label}
                  </button>
                )}
              </For>
              <button
                type="button"
                class="btn-input btn-sm ml-auto"
                onClick={() => openQueryReferenceWindow(props.baseShortId)}
                title="Open query reference"
              >
                <i class="ti ti-external-link" /> Open reference
              </button>
              <button
                type="button"
                class="btn-input btn-sm"
                onClick={handleSaveAsView}
                disabled={!query().trim() || saveLoading()}
                title="Save query as a regular view"
              >
                <i class={saveLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-bookmark-plus"} /> Save as view
              </button>
            </div>
          </section>
        </DockWorkspace.Pane>

        <DockWorkspace.Pane id="sources" title="Sources" icon="ti ti-database" section="context">
          <section class="flex h-full min-h-0 flex-col overflow-hidden p-3">
            <div class="paper min-h-0 flex-1 overflow-auto p-2">
              <For each={props.tables}>
                {(table) => (
                  <div class="rounded-md px-2 py-2">
                    <div class="flex items-center justify-between gap-3">
                      <span class="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-primary">
                        <i class={table.icon ?? "ti ti-table"} /> <span class="truncate">{table.name}</span>
                      </span>
                      <code class="text-xs text-dimmed">{formatIdentifierRef(table.name)}</code>
                    </div>
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      <For each={(props.fieldsByTable[table.id] ?? []).slice(0, 8)}>
                        {(field) => (
                          <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-dimmed dark:bg-zinc-900">
                            {formatIdentifierRef(field.name)}
                          </code>
                        )}
                      </For>
                    </div>
                    <Show when={(props.viewsByTable[table.id] ?? []).length > 0}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={props.viewsByTable[table.id]}>
                          {(view) => (
                            <code class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              view {formatIdentifierRef(view.name)}
                            </code>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </section>
        </DockWorkspace.Pane>
      </DockWorkspace>
    </div>
  );
}
