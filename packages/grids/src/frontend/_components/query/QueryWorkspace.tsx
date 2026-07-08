import { AutocompleteEditor, DataTable, type DataTableColumn, Panes, type PanesValue, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewDiagnostic, DslQueryPreviewResponse } from "../../../contracts";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { FieldValue } from "../table/FieldValue";
import { errorMessage } from "../utils/api-helpers";
import { buildBackendGqlCompletions } from "./query-autocomplete";
import { currentSourceForApi, type QueryWorkspaceCurrentSource, visibleFields, visibleViews } from "./query-workspace-model";

type Props = {
  baseId: string;
  baseShortId: string;
  initialQuery: string;
  initialPreview?: DslQueryPreviewResponse | null;
  queryPath: string;
  currentSource?: QueryWorkspaceCurrentSource;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  syncQueryToUrl?: boolean;
};

type PreviewSuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
type PreviewRow = PreviewSuccess["rows"][number] & { __rowKey: string };
type PreviewColumn = PreviewSuccess["columns"][number];
type QuerySourceRow = {
  id: string;
  kind: "table" | "view";
  name: string;
  parent?: string;
  icon: string;
  metaLabel: string;
  fields: Field[];
  fromLine: string;
  search: string;
};
const MAX_SYNCED_QUERY_HREF_LENGTH = 2800;

const createQueryWorkspacePanesValue = (): PanesValue => ({
  root: {
    type: "split",
    id: "gql-query-root",
    direction: "vertical",
    sizes: [56, 44],
    children: [
      {
        type: "leaf",
        id: "gql-query-results",
        elementIds: ["results"],
        activeElementId: "results",
        presentation: "single",
      },
      {
        type: "split",
        id: "gql-query-bottom",
        direction: "horizontal",
        sizes: [62, 38],
        children: [
          {
            type: "leaf",
            id: "gql-query-editor",
            elementIds: ["query"],
            activeElementId: "query",
            presentation: "single",
          },
          {
            type: "leaf",
            id: "gql-query-sources",
            elementIds: ["sources"],
            activeElementId: "sources",
            presentation: "single",
          },
        ],
      },
    ],
  },
});

const queryHighlight = highlight.compile(
  [
    { kind: "field", match: /"(?:""|[^"])*"/ },
    { kind: "string", match: /'(?:\\[\s\S]|[^'\\])*'/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|as|on|where|formula|group|by|aggregate|having|sort|search|include|deleted|only|nulls|first|last|limit|offset|asc|desc|and|or|not)\b/i,
    },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
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

const queryReferenceHref = (baseShortId: string) => `/app/grids/${encodeURIComponent(baseShortId)}/reference/gql?defaultTab=gql`;

const openQueryReferenceWindow = (baseShortId: string) => {
  if (typeof window === "undefined") return;
  window.open(queryReferenceHref(baseShortId), "grids-gql-reference", "popup,width=1120,height=820,resizable=yes,scrollbars=yes");
};

const safeQueryHref = (queryPath: string, query: string) => {
  const href = queryHref(queryPath, query);
  return href.length <= MAX_SYNCED_QUERY_HREF_LENGTH ? href : queryPath;
};

const plural = (count: number, singular: string, pluralLabel = `${singular}s`) => `${count} ${count === 1 ? singular : pluralLabel}`;

const compactCount = (count: number, suffix: string) => `${count}${suffix}`;

const replaceOrPrependSourceClause = (source: string, fromLine: string) => {
  if (!source.trim()) return fromLine;
  const lines = source.split(/\r\n|\r|\n/);
  const sourceIndex = lines.findIndex((line) => /^\s*from\s+(?:table|view)\b/i.test(line));
  if (sourceIndex >= 0) {
    lines[sourceIndex] = fromLine;
    return lines.join("\n");
  }
  return `${fromLine}\n${source}`;
};

function QueryPreview(props: {
  preview: DslQueryPreviewResponse | null;
  loading: boolean;
  baseShortId: string;
  tables: Table[];
  fieldsByTable: Record<string, Field[]>;
}) {
  const success = createMemo(() => (props.preview?.ok ? props.preview : null));
  const diagnostics = createMemo(() => (props.preview && !props.preview.ok ? props.preview.diagnostics : []));
  const rows = createMemo<PreviewRow[]>(() =>
    props.preview?.ok ? props.preview.rows.map((row, index) => ({ ...row, __rowKey: row.recordId ?? `row-${index}` })) : [],
  );
  const tableShortIds = createMemo(() => Object.fromEntries(props.tables.map((table) => [table.id, table.shortId])));
  const fieldForColumn = (column: PreviewColumn): Field | null => {
    if (column.type === "aggregate" || !column.tableId || !column.fieldId) return null;
    return props.fieldsByTable[column.tableId]?.find((field) => field.id === column.fieldId && !field.deletedAt) ?? null;
  };
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
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <Show
        when={props.preview}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-dimmed">
            <div class="flex max-w-sm flex-col items-center gap-2 text-center">
              <span class="grid h-11 w-11 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
                <i class={props.loading ? "ti ti-loader-2 animate-spin text-lg" : "ti ti-table-spark text-lg"} />
              </span>
              <p class="font-medium text-primary">{props.loading ? "Running query" : "No result yet"}</p>
            </div>
          </div>
        }
      >
        <Show
          when={success()}
          fallback={
            <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div class="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
                <span class="inline-flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
                  <i class="ti ti-alert-triangle" /> Diagnostics
                </span>
                <span class="text-dimmed">{plural(diagnostics().length, "issue")}</span>
              </div>
              <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 text-sm">
                <For each={diagnostics()}>
                  {(diagnostic) => (
                    <div class="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-900 dark:bg-red-950/45 dark:text-red-300">
                      <div class="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide">
                        <Show when={diagnostic.line} fallback={<span>Query</span>}>
                          {(line) => (
                            <span class="rounded bg-white/70 px-1.5 py-0.5 dark:bg-black/20">
                              Line {line()}
                              <Show when={diagnostic.column}>{(column) => ` · Col ${column()}`}</Show>
                            </span>
                          )}
                        </Show>
                      </div>
                      <p class="leading-relaxed">{diagnostic.message}</p>
                    </div>
                  )}
                </For>
              </div>
            </div>
          }
        >
          {(preview) => (
            <DataTable
              rows={rows()}
              columns={columns()}
              getRowId={(row) => row.__rowKey}
              class="paper h-full min-h-0 flex-1 overflow-auto"
              density="compact"
              fillHeight
              hoverRows={false}
              cellContentClass="max-h-24 overflow-auto whitespace-pre-wrap break-words"
              empty={<span>No rows match this query.</span>}
              renderCell={({ col, value }) => {
                const column = preview().columns.find((item) => item.key === col.id);
                const field = column ? fieldForColumn(column) : null;
                if (!field) return <span>{displayValue(value)}</span>;
                return (
                  <FieldValue
                    field={field}
                    value={value}
                    baseId={props.baseShortId}
                    tableShortIds={tableShortIds()}
                    fieldsByTable={props.fieldsByTable}
                    mode="table"
                    relationValueMode={field.type === "relation" ? "labels" : "ids"}
                  />
                );
              }}
              scrollPreserveKey="grids-query-preview"
            />
          )}
        </Show>
      </Show>
    </div>
  );
}

export default function QueryWorkspace(props: Props) {
  const [query, setQuery] = createSignal(props.initialQuery);
  const [preview, setPreview] = createSignal<DslQueryPreviewResponse | null>(props.initialPreview ?? null);
  const [loading, setLoading] = createSignal(false);
  const [saveLoading, setSaveLoading] = createSignal(false);
  const [panes, setPanes] = createSignal<PanesValue>(createQueryWorkspacePanesValue());
  const [sourceSearch, setSourceSearch] = createSignal("");
  const apiSource = createMemo(() => currentSourceForApi(props.currentSource));
  const sourceTables = createMemo(() => props.tables.filter((table) => !table.deletedAt));
  const sourceRows = createMemo<QuerySourceRow[]>(() =>
    sourceTables().flatMap((table) => {
      const fields = visibleFields(props.fieldsByTable[table.id]);
      const tableRow: QuerySourceRow = {
        id: `table:${table.id}`,
        kind: "table",
        name: table.name,
        icon: table.icon ?? "ti ti-table",
        metaLabel: compactCount(fields.length, "f"),
        fields,
        fromLine: `from table ${formatIdentifierRef(table.name)}`,
        search: [table.name, table.description ?? "", fields.map((field) => `${field.name} ${field.type}`).join(" ")]
          .join(" ")
          .toLowerCase(),
      };
      const viewRows = visibleViews(props.viewsByTable[table.id]).map(
        (view): QuerySourceRow => ({
          id: `view:${view.id}`,
          kind: "view",
          name: view.name,
          parent: table.name,
          icon: "ti ti-table-spark",
          metaLabel: `view · ${compactCount(fields.length, "f")}`,
          fields,
          fromLine: `from view ${formatIdentifierRef(view.name)}`,
          search: [view.name, table.name, fields.map((field) => `${field.name} ${field.type}`).join(" ")].join(" ").toLowerCase(),
        }),
      );
      return [tableRow, ...viewRows];
    }),
  );
  const filteredSourceRows = createMemo(() => {
    const search = sourceSearch().trim().toLowerCase();
    if (!search) return sourceRows();
    return sourceRows().filter((source) => source.search.includes(search));
  });
  const completions = createMemo(() =>
    buildBackendGqlCompletions({
      currentSource: apiSource(),
      fetchAutocomplete: async (request, signal) => {
        const response = await apiClient.gql["by-base"][":baseId"].autocomplete.$post(
          { param: { baseId: props.baseId }, json: request },
          { init: { signal } },
        );
        if (!response.ok) throw new Error(await errorMessage(response, "Could not load query suggestions."));
        return response.json();
      },
    }),
  );
  let previewToken = 0;
  let lastPreviewQuery = props.initialPreview !== undefined ? props.initialQuery : "";

  createEffect(() => {
    setQuery((current) => (current === props.initialQuery ? current : props.initialQuery));
    if (props.initialPreview !== undefined) {
      setPreview(props.initialPreview);
      setLoading(false);
      lastPreviewQuery = props.initialQuery;
    }
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
      const response = await apiClient.gql["by-base"][":baseId"].execute.$post({
        param: { baseId: props.baseId },
        json: { query: source, ...(apiSource() ? { currentSource: apiSource() } : {}) },
      });
      if (!response.ok) throw new Error(await errorMessage(response, "Could not execute query."));
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
    const source = query();
    if (source === lastPreviewQuery) return;
    lastPreviewQuery = source;
    previewDebounce.debouncedFn(source);
  });

  const onInput = (next: string) => {
    if (next === query()) return;
    setQuery(next);
    if (props.syncQueryToUrl !== false && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", safeQueryHref(props.queryPath, next));
    }
  };

  const insertExample = (source: string) => {
    onInput(source);
  };

  const insertSource = (source: QuerySourceRow) => {
    onInput(replaceOrPrependSourceClause(query(), source.fromLine));
  };

  const insertAtEditorCursor = (text: string) => {
    if (typeof document === "undefined") {
      onInput(`${query()}${text}`);
      return;
    }
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[aria-label="GQL query"]');
    if (!textarea) {
      onInput(`${query()}${text}`);
      return;
    }
    const start = textarea.selectionStart ?? query().length;
    const end = textarea.selectionEnd ?? start;
    const current = query();
    const next = `${current.slice(0, start)}${text}${current.slice(end)}`;
    onInput(next);
    requestAnimationFrame(() => {
      textarea.focus();
      const caret = start + text.length;
      textarea.setSelectionRange(caret, caret);
    });
  };

  const insertField = (field: Field) => {
    insertAtEditorCursor(formatIdentifierRef(field.name));
  };

  const handleSaveAsView = async () => {
    if (!query().trim() || saveLoading()) return;
    setSaveLoading(true);
    try {
      const compiledResponse = await apiClient.gql["by-base"][":baseId"]["compile-view"].$post({
        param: { baseId: props.baseId },
        json: { query: query(), ...(apiSource() ? { currentSource: apiSource() } : {}) },
      });
      if (!compiledResponse.ok) throw new Error(await errorMessage(compiledResponse, "Could not compile query."));
      const compiled = await compiledResponse.json();
      if (!compiled.ok) {
        const message = compiled.diagnostics.map((diagnostic: DslQueryPreviewDiagnostic) => diagnostic.message).join("\n");
        prompts.error(message || "This query could not be saved as a view.");
        return;
      }

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

      const createResponse = await apiClient.views["by-table"][":tableId"].$post({
        param: { tableId: compiled.tableId },
        json: {
          name: String(result.name).trim(),
          source: compiled.source,
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

  const saveButtonLabel = () => "Save";
  const saveButtonTitle = () => "Save view";
  const saveButtonIcon = () => (saveLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-bookmark-plus");
  const handleSave = () => handleSaveAsView();

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
              code: `from table ${formatIdentifierRef(table.name)}\ngroup by ${formatIdentifierRef(date.name)} by month\naggregate sum(${formatIdentifierRef(amount.name)}) as total\nsort total desc`,
            },
          ]
        : []),
    ];
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col bg-zinc-100 p-2 dark:bg-zinc-900" data-scroll-preserve="grids-query-workspace">
      <Panes.Root value={panes()} onChange={setPanes} class="h-full w-full flex-1">
        <Panes.Element id="results" title="Results" icon="ti ti-table-spark">
          <QueryPreview
            preview={preview()}
            loading={loading()}
            baseShortId={props.baseShortId}
            tables={props.tables}
            fieldsByTable={props.fieldsByTable}
          />
        </Panes.Element>

        <Panes.Element id="query" title="Query" icon="ti ti-code">
          <section class="flex h-full min-h-0 flex-col overflow-hidden">
            <div class="min-h-0 flex-1">
              <AutocompleteEditor
                value={query}
                onInput={onInput}
                completions={completions()}
                highlight={queryHighlight}
                restoreExpansionOnBackspace={false}
                variant="paper"
                fill
                placeholder={"from table Orders\nwhere Status = 'Open'\nsort CreatedAt desc\nlimit 50\noffset 0"}
                ariaLabel="GQL query"
              />
            </div>
            <Show when={queryHref(props.queryPath, query()).length > MAX_SYNCED_QUERY_HREF_LENGTH}>
              <div class="info-block-warning mx-3 mt-3 text-xs">
                This query is too long for the URL. Results still work, but reload will start with an empty query.
              </div>
            </Show>

            <div class="flex shrink-0 flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                <For each={examples()}>
                  {(example) => (
                    <button
                      type="button"
                      class="btn-input btn-sm"
                      onClick={() => insertExample(example.code)}
                      title={`Insert ${example.label} example`}
                    >
                      <i class="ti ti-sparkles" /> {example.label}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="btn-input btn-sm"
                onClick={() => openQueryReferenceWindow(props.baseShortId)}
                title="Open GQL reference"
              >
                <i class="ti ti-external-link" /> Reference
              </button>
              <button
                type="button"
                class="btn-input-primary btn-sm"
                onClick={handleSave}
                disabled={!query().trim() || saveLoading()}
                title={saveButtonTitle()}
              >
                <i class={saveButtonIcon()} /> {saveButtonLabel()}
              </button>
            </div>
          </section>
        </Panes.Element>

        <Panes.Element id="sources" title="Sources" icon="ti ti-database">
          <section class="flex h-full min-h-0 flex-col gap-1 overflow-hidden">
            <TextInput
              type="search"
              icon="ti ti-search"
              activeIcon="ti ti-search"
              placeholder="Search sources and fields..."
              ariaLabel="Search query sources"
              value={sourceSearch}
              onInput={setSourceSearch}
              clearable
            />

            <div class="min-h-0 flex-1 overflow-auto">
              <Show
                when={filteredSourceRows().length > 0}
                fallback={
                  <div class="flex h-full items-center justify-center p-6 text-center text-sm text-dimmed">
                    <div class="flex max-w-xs flex-col items-center gap-2">
                      <span class="grid h-10 w-10 place-items-center rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-950">
                        <i class="ti ti-database-off text-lg" />
                      </span>
                      <span>{sourceSearch().trim() ? "No matching sources." : "No readable sources."}</span>
                    </div>
                  </div>
                }
              >
                <div class="space-y-2">
                  <For each={filteredSourceRows()}>
                    {(source) => {
                      const shown = () => source.fields.slice(0, 8);
                      const hidden = () => Math.max(0, source.fields.length - shown().length);
                      return (
                        <article class="paper px-2.5 py-2">
                          <div class="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              class="group flex min-w-0 flex-1 items-center gap-2 text-left"
                              onClick={() => insertSource(source)}
                              title={`Insert ${source.fromLine}`}
                            >
                              <span class="grid h-6 w-6 shrink-0 place-items-center rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                                <i class={source.icon} />
                              </span>
                              <span class="min-w-0">
                                <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span class="truncate text-sm font-medium text-primary group-hover:text-blue-600">{source.name}</span>
                                  <span class="text-[11px] text-dimmed">{source.metaLabel}</span>
                                </span>
                                <Show when={source.parent}>
                                  <span class="block truncate text-[11px] text-dimmed">of {source.parent}</span>
                                </Show>
                              </span>
                            </button>
                            <button
                              type="button"
                              class="btn-ghost btn-sm shrink-0 px-2"
                              onClick={() => insertSource(source)}
                              title={`Insert ${source.fromLine}`}
                            >
                              from
                            </button>
                          </div>

                          <div class="mt-2 flex flex-wrap gap-1">
                            <For each={shown()}>
                              {(field) => (
                                <button
                                  type="button"
                                  class="inline-flex max-w-full items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-left text-[11px] text-zinc-700 hover:bg-blue-50 hover:text-blue-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
                                  onClick={() => insertField(field)}
                                  title={field.description || `${field.name} (${field.type})`}
                                >
                                  <span class="truncate">{formatIdentifierRef(field.name)}</span>
                                  <span class="text-[10px] text-dimmed">{field.type}</span>
                                </button>
                              )}
                            </For>
                            <Show when={hidden() > 0}>
                              <span class="rounded bg-zinc-50 px-1.5 py-0.5 text-[11px] text-dimmed dark:bg-zinc-950">+{hidden()}</span>
                            </Show>
                          </div>
                        </article>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </section>
        </Panes.Element>
      </Panes.Root>
    </div>
  );
}
