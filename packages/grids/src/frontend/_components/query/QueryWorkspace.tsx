import { AutocompleteEditor, Panes, type PanesValue, prompts, TextInput } from "@valentinkolb/cloud/ui";
import { highlight } from "@valentinkolb/stdlib";
import { mutation as mutations, timed } from "@valentinkolb/stdlib/solid";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { aggregateKindPattern } from "../../../aggregate-catalog";
import { apiClient } from "../../../api/client";
import type { DslQueryPreviewDiagnostic, DslQueryPreviewResponse } from "../../../contracts";
import { formatIdentifierRef } from "../../../ref-syntax";
import type { Field, Table, View } from "../../../service";
import { errorMessage } from "../utils/api-helpers";
import QueryResultTable from "./QueryResultTable";
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
const QUERY_EDITOR_SELECTOR = 'textarea[aria-label="GQL query"]';

type QueryEditorSelection = Pick<HTMLTextAreaElement, "selectionEnd" | "selectionStart">;

export const queryEditorForScope = (scope: ParentNode | undefined): HTMLTextAreaElement | null =>
  scope?.querySelector<HTMLTextAreaElement>(QUERY_EDITOR_SELECTOR) ?? null;

export const insertTextAtEditorSelection = (
  source: string,
  text: string,
  editor: QueryEditorSelection | null,
): { caret: number; value: string } => {
  const start = editor?.selectionStart ?? source.length;
  const end = editor?.selectionEnd ?? start;
  return {
    caret: start + text.length,
    value: `${source.slice(0, start)}${text}${source.slice(end)}`,
  };
};

const isAbortError = (error: unknown): boolean => error instanceof DOMException && error.name === "AbortError";

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
    { kind: "function", match: aggregateKindPattern() },
    { kind: "placeholder", match: /\{[A-Za-z0-9_-]{1,200}\}/i },
    { kind: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { kind: "operator", match: /<=|>=|!=|=|<|>|\+|-|\*|\/|%|,|\(|\)/ },
  ],
  { classPrefix: "doc-token-" },
);

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

  return (
    <div class="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <Show
        when={props.preview}
        fallback={
          <div class="flex flex-1 items-center justify-center text-sm text-dimmed">
            <div class="flex max-w-sm flex-col items-center gap-2 text-center">
              <span class="state-placeholder-icon state-placeholder-icon-panel">
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
              <div class="flex shrink-0 items-center justify-between gap-2 bg-[var(--ui-surface-subtle)] px-3 py-2 text-xs">
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
            <QueryResultTable
              result={preview()}
              baseShortId={props.baseShortId}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
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
  let previewAbort: AbortController | undefined;
  let lastPreviewQuery = props.initialPreview !== undefined ? props.initialQuery : "";
  let queryEditorScope: HTMLDivElement | undefined;

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
    previewAbort?.abort();
    previewAbort = undefined;
    if (!source.trim()) {
      setPreview(null);
      setLoading(false);
      return;
    }
    const abort = new AbortController();
    previewAbort = abort;
    setLoading(true);
    try {
      const response = await apiClient.gql["by-base"][":baseId"].execute.$post(
        {
          param: { baseId: props.baseId },
          json: { query: source, ...(apiSource() ? { currentSource: apiSource() } : {}) },
        },
        { init: { signal: abort.signal } },
      );
      if (!response.ok) throw new Error(await errorMessage(response, "Could not execute query."));
      const data = await response.json();
      if (token === previewToken) setPreview(data);
    } catch (error) {
      if (isAbortError(error)) return;
      if (token === previewToken) {
        setPreview({
          ok: false,
          diagnostics: [{ message: error instanceof Error ? error.message : "Could not preview query." }],
        });
      }
    } finally {
      if (token === previewToken) {
        previewAbort = undefined;
        setLoading(false);
      }
    }
  };

  const previewDebounce = timed.debounce(loadPreview, 250);

  createEffect(() => {
    const source = query();
    if (source === lastPreviewQuery) return;
    lastPreviewQuery = source;
    previewDebounce.debouncedFn(source);
  });

  onCleanup(() => {
    previewToken++;
    previewAbort?.abort();
    previewAbort = undefined;
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
    const textarea = queryEditorForScope(queryEditorScope);
    const insertion = insertTextAtEditorSelection(query(), text, textarea);
    onInput(insertion.value);
    if (!textarea || typeof requestAnimationFrame === "undefined") return;
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(insertion.caret, insertion.caret);
    });
  };

  const insertField = (field: Field) => {
    insertAtEditorCursor(formatIdentifierRef(field.name));
  };

  const saveViewMut = mutations.create<void, void>({
    mutation: async () => {
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
    },
    onError: (error) => prompts.error(error.message),
  });

  const handleSaveAsView = () => {
    if (!query().trim() || saveViewMut.loading()) return;
    saveViewMut.mutate(undefined);
  };

  const saveButtonLabel = () => "Save";
  const saveButtonTitle = () => "Save view";
  const saveButtonIcon = () => (saveViewMut.loading() ? "ti ti-loader-2 animate-spin" : "ti ti-bookmark-plus");
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
    <div class="flex min-h-0 flex-1 flex-col bg-[var(--ui-surface-subtle)] p-2" data-scroll-preserve="grids-query-workspace">
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
            <div ref={(element) => (queryEditorScope = element)} class="min-h-0 flex-1">
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

            <div class="flex shrink-0 flex-wrap items-center gap-2 pt-2">
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
                disabled={!query().trim() || saveViewMut.loading()}
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
                      <span class="state-placeholder-icon state-placeholder-icon-panel">
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
                              <span class="grid h-6 w-6 shrink-0 place-items-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-secondary">
                                <i class={source.icon} />
                              </span>
                              <span class="min-w-0">
                                <span class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                  <span class="truncate text-sm font-medium text-primary group-hover:text-[var(--ui-app-accent-text)]">
                                    {source.name}
                                  </span>
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
                                  class="inline-flex max-w-full items-center gap-1 rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-1.5 py-0.5 text-left text-[11px] text-secondary hover:bg-[var(--ui-hover)] hover:text-[var(--ui-app-accent-text)]"
                                  onClick={() => insertField(field)}
                                  title={field.description || `${field.name} (${field.type})`}
                                >
                                  <span class="truncate">{formatIdentifierRef(field.name)}</span>
                                  <span class="text-[10px] text-dimmed">{field.type}</span>
                                </button>
                              )}
                            </For>
                            <Show when={hidden() > 0}>
                              <span class="rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] px-1.5 py-0.5 text-[11px] text-dimmed">
                                +{hidden()}
                              </span>
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
