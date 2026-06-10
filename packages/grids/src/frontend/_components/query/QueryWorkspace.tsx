import { AutocompleteEditor, DataTable, prompts, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewResponse } from "../../../contracts";
import type { Field, Table, View } from "../../../service";
import { errorMessage } from "../utils/api-helpers";

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
    { kind: "string", match: /"(?:\\[\s\S]|[^"\\])*"/ },
    {
      kind: "keyword",
      match:
        /\b(?:from|table|view|select|join|left|inner|as|on|where|formula|group|by|aggregate|having|sort|limit|offset|skip|asc|ascending|desc|descending)\b/i,
    },
    { kind: "function", match: /\b(?:count|countEmpty|countUnique|sum|avg|min|max|median|earliest|latest)\b/i },
    { kind: "placeholder", match: /#[A-Za-z0-9_-]+/ },
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

const safeQueryHref = (queryPath: string, query: string) => {
  const href = queryHref(queryPath, query);
  return href.length <= MAX_SYNCED_QUERY_HREF_LENGTH ? href : queryPath;
};

const modeLabel = (mode: PreviewSuccess["mode"]) => (mode === "groups" ? "Grouped preview" : "Row preview");

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
    <div class="paper flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 class="text-sm font-semibold text-primary">Preview</h2>
          <p class="text-xs text-dimmed">Server-compiled result. No filtering runs in the browser.</p>
        </div>
        <Show when={props.loading}>
          <span class="inline-flex items-center gap-1 text-xs text-dimmed">
            <i class="ti ti-loader-2 animate-spin" /> Checking
          </span>
        </Show>
      </div>

      <Show
        when={props.preview}
        fallback={<div class="flex flex-1 items-center justify-center p-8 text-sm text-dimmed">Write a query to preview records.</div>}
      >
        <Show
          when={success()}
          fallback={
            <div class="flex flex-col gap-2 p-4 text-sm">
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
            <div class="flex min-h-0 flex-1 flex-col">
              <div class="flex items-center justify-between gap-3 px-4 py-2 text-xs text-dimmed">
                <span>
                  {modeLabel(preview().mode)} · {preview().rows.length} rows
                </span>
                <Show when={preview().truncated}>
                  <span>Limited to {preview().limit}</span>
                </Show>
              </div>
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
    return [
      {
        label: "Rows",
        code: `from table #${table.shortId}\nselect #${props.fieldsByTable[table.id]?.[0]?.shortId ?? "field"}\nlimit 20`,
      },
      ...(amount && date
        ? [
            {
              label: "Grouped",
              code: `from table #${table.shortId}\ngroup by #${date.shortId} by month\naggregate sum(#${amount.shortId}) as total\nsort total descending`,
            },
          ]
        : []),
    ];
  };

  return (
    <div class="flex min-h-0 flex-1 flex-col gap-3" data-scroll-preserve="grids-query-workspace">
      <div class="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(420px,0.9fr)_minmax(0,1.4fr)]">
        <div class="flex min-h-0 flex-col gap-3">
          <section class="paper flex flex-col gap-3 p-4">
            <div>
              <h1 class="text-lg font-semibold text-primary">Query workspace</h1>
              <p class="text-sm text-dimmed">Write SQL-backed Grids DSL. The visual UI can stay simpler; this workspace is the superset.</p>
            </div>

            <Show when={props.currentSource}>
              {(source) => (
                <div class="flex items-center justify-between gap-3 rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950/70">
                  <span class="inline-flex min-w-0 items-center gap-2 text-dimmed">
                    <i class={source().kind === "view" ? "ti ti-table-spark" : "ti ti-table"} />
                    <span class="shrink-0">Implicit source</span>
                    <span class="truncate font-medium text-primary">{source().label}</span>
                  </span>
                  <code class="shrink-0 text-xs text-dimmed">
                    from {source().kind} #{source().ref}
                  </code>
                </div>
              )}
            </Show>

            <AutocompleteEditor
              value={query}
              onInput={onInput}
              highlight={queryHighlight}
              restoreExpansionOnBackspace={false}
              lines={12}
              placeholder={'from table #Orders\nwhere #status = "Open"\nsort #created_at descending\nlimit 50\nskip 0'}
              ariaLabel="Grids query"
            />
            <Show when={queryHref(props.queryPath, query()).length > MAX_SYNCED_QUERY_HREF_LENGTH}>
              <p class="text-xs text-dimmed">
                This query is too long for the URL. Preview still works, but reload will start with an empty query.
              </p>
            </Show>

            <div class="flex flex-wrap items-center gap-2">
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
                onClick={handleSaveAsView}
                disabled={!query().trim() || saveLoading()}
                title="Save query as a regular view"
              >
                <i class={saveLoading() ? "ti ti-loader-2 animate-spin" : "ti ti-bookmark-plus"} /> Save as view
              </button>
            </div>
          </section>

          <section class="paper flex min-h-0 flex-col overflow-hidden">
            <div class="border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
              <h2 class="text-sm font-semibold text-primary">Available sources</h2>
              <p class="text-xs text-dimmed">
                Use stable slugs like <code>#Orders</code>. The server still checks permissions.
              </p>
            </div>
            <div class="min-h-0 overflow-auto p-2">
              <For each={props.tables}>
                {(table) => (
                  <div class="rounded-md px-2 py-2">
                    <div class="flex items-center justify-between gap-3">
                      <span class="inline-flex min-w-0 items-center gap-2 text-sm font-medium text-primary">
                        <i class={table.icon ?? "ti ti-table"} /> <span class="truncate">{table.name}</span>
                      </span>
                      <code class="text-xs text-dimmed">#{table.shortId}</code>
                    </div>
                    <div class="mt-1 flex flex-wrap gap-1.5">
                      <For each={(props.fieldsByTable[table.id] ?? []).slice(0, 8)}>
                        {(field) => (
                          <code class="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-dimmed dark:bg-zinc-900">#{field.shortId}</code>
                        )}
                      </For>
                    </div>
                    <Show when={(props.viewsByTable[table.id] ?? []).length > 0}>
                      <div class="mt-1 flex flex-wrap gap-1.5">
                        <For each={props.viewsByTable[table.id]}>
                          {(view) => (
                            <code class="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                              view #{view.shortId}
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
        </div>

        <QueryPreview preview={preview()} loading={loading()} />
      </div>
    </div>
  );
}
