import type { DateContext } from "@k2b/stdlib";
import { Button, Checkbox, DataTable, type DataTableColumn, IconButton, Placeholder, TextInput, toast } from "@k2b/ui";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import type { DslQueryPreviewResponse, Field, GridRecord, RecordDisplayConfig } from "../../contracts";
import type { CustomAppRowNavigation } from "../../custom-apps/contracts";
import { customAppRowHref } from "../../custom-apps/routing";
import type { GridFilePreview } from "../../service";
import { RecordCardsView } from "../_components/records-view/RecordCardsView";
import { customAppCardFileUrl } from "./records-card-url";
import { customAppRecordsResultColumns } from "./records-table-model";
import { invokeCustomAppWorkflow } from "./workflow-action-client";

type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;
export type CustomAppRecordsSuccess = QuerySuccess & {
  cards?: {
    displayConfig: RecordDisplayConfig;
    fields: Field[];
    records?: GridRecord[];
    relationLabels: Record<string, string>;
    filePreviews: Record<string, Record<string, GridFilePreview & { contentToken: string }>>;
  };
};

export type CustomAppRenderedRowAction = {
  id: string;
  label: string;
  icon?: string;
  showLabel: boolean;
  endpoint: string;
  confirm?: string;
};
export type CustomAppRenderedBulkAction = {
  id: string;
  label: string;
  icon?: string;
  endpoint: string;
  confirm?: string;
};

export const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value);
};

const resultFromResponse = async (response: Response): Promise<CustomAppRecordsSuccess> => {
  const body = (await response.json().catch(() => null)) as
    | CustomAppRecordsSuccess
    | DslQueryPreviewResponse
    | { message?: unknown }
    | null;
  if (!response.ok || !body || !("ok" in body) || !body.ok) {
    const message =
      body && "diagnostics" in body && Array.isArray(body.diagnostics)
        ? body.diagnostics[0]?.message
        : body && "message" in body && typeof body.message === "string"
          ? body.message
          : "Records could not be loaded.";
    throw new Error(message);
  }
  return body as CustomAppRecordsSuccess;
};

export default function RecordsTable(props: {
  title: string;
  emptyText: string;
  baseId: string;
  dateConfig?: DateContext;
  shortId: string;
  endpoint?: string;
  searchable?: boolean;
  selectedColumnIds?: string[];
  result: CustomAppRecordsSuccess;
  rowNavigate?: CustomAppRowNavigation;
  rowActions?: CustomAppRenderedRowAction[];
  bulkActions?: CustomAppRenderedBulkAction[];
  preview?: boolean;
}) {
  const [result, setResult] = createSignal(props.result);
  const [query, setQuery] = createSignal("");
  const [appliedQuery, setAppliedQuery] = createSignal("");
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [history, setHistory] = createSignal<Array<string | null>>([]);
  const [loading, setLoading] = createSignal(false);
  const [pendingKey, setPendingKey] = createSignal<string | null>(null);
  const [selectedRecordIds, setSelectedRecordIds] = createSignal<Set<string>>(new Set());
  let queryTimer: number | null = null;
  let requestController: AbortController | null = null;
  let workflowController: AbortController | null = null;

  onCleanup(() => {
    if (queryTimer !== null) window.clearTimeout(queryTimer);
    requestController?.abort();
    workflowController?.abort();
  });

  const loadPage = async (nextCursor: string | null, nextQuery: string, nextHistory: Array<string | null>) => {
    if (props.preview || !props.endpoint) return;
    requestController?.abort();
    const controller = new AbortController();
    requestController = controller;
    setLoading(true);
    try {
      const url = new URL(props.endpoint, window.location.origin);
      if (nextQuery) url.searchParams.set("q", nextQuery);
      if (nextCursor) url.searchParams.set("cursor", nextCursor);
      const response = await fetch(`${url.pathname}${url.search}`, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      const next = await resultFromResponse(response);
      if (controller.signal.aborted) return;
      setResult(next);
      setSelectedRecordIds(new Set<string>());
      setAppliedQuery(nextQuery);
      setCursor(nextCursor);
      setHistory(nextHistory);
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(cause instanceof Error ? cause.message : "Records could not be loaded.");
    } finally {
      if (requestController === controller) requestController = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };

  const onSearch = (value: string) => {
    setQuery(value);
    if (queryTimer !== null) window.clearTimeout(queryTimer);
    queryTimer = window.setTimeout(() => void loadPage(null, value.trim(), []), 250);
  };

  const resultColumns = createMemo(() => customAppRecordsResultColumns(result().columns, props.selectedColumnIds));
  const rows = createMemo(() =>
    result().rows.map((row, index) => ({
      ...row,
      rowKey: row.recordId ? `${row.recordId}:${index}` : `row-${index}`,
      href: row.recordId && props.rowNavigate ? customAppRowHref(props.shortId, props.rowNavigate, row.recordId) : null,
    })),
  );
  const cardRecords = createMemo<GridRecord[]>(() => {
    const cards = result().cards;
    if (cards?.records) return cards.records;
    return result().rows.flatMap((row) => {
      if (!row.recordId || !row.tableId) return [];
      const data = Object.fromEntries(
        result().columns.flatMap((column) => (column.fieldId ? [[column.fieldId, row.values[column.key]]] : [])),
      );
      return [
        {
          id: row.recordId,
          tableId: row.tableId,
          data,
          version: row.recordMeta?.version ?? 1,
          deletedAt: row.recordMeta?.deletedAt ?? null,
          createdBy: row.recordMeta?.createdBy ?? null,
          updatedBy: row.recordMeta?.updatedBy ?? null,
          createdAt: row.recordMeta?.createdAt ?? "1970-01-01T00:00:00.000Z",
          updatedAt: row.recordMeta?.updatedAt ?? "1970-01-01T00:00:00.000Z",
        },
      ];
    });
  });
  const appFileUrl = (preview: GridFilePreview & { contentToken?: string }) => {
    if (!props.endpoint || !preview.contentToken) return "";
    return customAppCardFileUrl(props.endpoint, preview.contentToken);
  };
  const firstColumnId = createMemo(() => resultColumns()[0]?.key);
  const columns = createMemo<DataTableColumn<ReturnType<typeof rows>[number]>[]>(() => {
    const value = resultColumns().map((column) => ({
      id: column.key,
      header: column.label,
      subtitle: column.type,
      value: (row: ReturnType<typeof rows>[number]) => row.values[column.key],
    }));
    if ((props.bulkActions?.length ?? 0) > 0)
      value.unshift({ id: "__select", header: "Select", subtitle: "", value: (row) => row.recordId });
    if ((props.rowActions?.length ?? 0) > 0) value.push({ id: "__actions", header: "Actions", subtitle: "", value: (row) => row.recordId });
    return value;
  });

  const toggleSelection = (recordId: string, selected: boolean) => {
    setSelectedRecordIds((current) => {
      const next = new Set(current);
      if (selected) next.add(recordId);
      else next.delete(recordId);
      return next;
    });
  };

  const invokeBulk = async (action: CustomAppRenderedBulkAction) => {
    const recordIds = [...selectedRecordIds()];
    const key = `bulk:${action.id}`;
    if (props.preview || recordIds.length === 0 || pendingKey() || (action.confirm && !window.confirm(action.confirm))) return;
    setPendingKey(key);
    const controller = new AbortController();
    workflowController = controller;
    try {
      const outcome = await invokeCustomAppWorkflow({
        endpoint: action.endpoint,
        body: { recordIds, search: appliedQuery() || undefined, cursor: cursor() || undefined },
        signal: controller.signal,
      });
      if (outcome.kind === "success") {
        toast.success(outcome.message);
        setSelectedRecordIds(new Set<string>());
        await loadPage(cursor(), appliedQuery(), history());
      } else if (outcome.kind === "error") toast.error(outcome.message);
      else toast(outcome.message);
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(cause instanceof Error ? cause.message : "The workflow could not be started.");
    } finally {
      if (workflowController === controller) workflowController = null;
      setPendingKey(null);
    }
  };

  const invoke = async (rowId: string, action: CustomAppRenderedRowAction) => {
    const key = `${rowId}:${action.id}`;
    if (props.preview || pendingKey() || (action.confirm && !window.confirm(action.confirm))) return;
    setPendingKey(key);
    const controller = new AbortController();
    workflowController = controller;
    try {
      const outcome = await invokeCustomAppWorkflow({
        endpoint: action.endpoint,
        body: { rowId, search: appliedQuery() || undefined, cursor: cursor() || undefined },
        signal: controller.signal,
      });
      if (outcome.kind === "success") {
        toast.success(outcome.message);
        await loadPage(cursor(), appliedQuery(), history());
      } else if (outcome.kind === "error") toast.error(outcome.message);
      else toast(outcome.message);
    } catch (cause) {
      if (!controller.signal.aborted) toast.error(cause instanceof Error ? cause.message : "The workflow could not be started.");
    } finally {
      if (workflowController === controller) workflowController = null;
      setPendingKey(null);
    }
  };

  return (
    <DataTable.Panel class="overflow-hidden">
      <DataTable.Header title={props.title} as="h2" size="md" />
      <Show when={!props.preview && (props.searchable || (props.bulkActions?.length ?? 0) > 0)}>
        <DataTable.Controls>
          <Show when={props.searchable}>
            <TextInput
              type="search"
              aria-label={`Search ${props.title}`}
              placeholder={`Search ${props.title.toLowerCase()}...`}
              icon="ti ti-search"
              activeIcon="ti ti-search"
              value={query}
              onValueChange={onSearch}
              clearable
              onClear={() => onSearch("")}
            />
          </Show>
          <Show when={(props.bulkActions?.length ?? 0) > 0}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelectedRecordIds(new Set(rows().flatMap((row) => (row.recordId ? [row.recordId] : []))))}
            >
              Select page
            </Button>
            <Show when={selectedRecordIds().size > 0}>
              <Button size="sm" variant="secondary" onClick={() => setSelectedRecordIds(new Set())}>
                {selectedRecordIds().size} selected
                <i class="ti ti-x" aria-hidden="true" />
              </Button>
              <For each={props.bulkActions ?? []}>
                {(action) => (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={pendingKey() === `bulk:${action.id}`}
                    loadingLabel={`${action.label}…`}
                    disabled={Boolean(pendingKey())}
                    onClick={() => void invokeBulk(action)}
                  >
                    <Show when={action.icon}>{(icon) => <i class={`ti ti-${icon()}`} aria-hidden="true" />}</Show>
                    {action.label}
                  </Button>
                )}
              </For>
            </Show>
          </Show>
        </DataTable.Controls>
      </Show>
      <Show
        when={result().cards}
        fallback={
          <Show
            when={resultColumns().length > 0}
            fallback={
              <Placeholder
                state="error"
                variant="compact"
                align="left"
                title="Records unavailable"
                description="The selected fields are not part of this view result."
              />
            }
          >
            <DataTable
              ariaLabel={props.title}
              rows={rows()}
              columns={columns()}
              getRowId={(row) => row.rowKey}
              density="compact"
              surface="plain"
              hoverRows={Boolean(props.rowNavigate)}
              rowClass={(row) => (row.href ? "cursor-pointer" : undefined)}
              onRowClick={
                props.rowNavigate
                  ? (row) => {
                      if (!row.href) return;
                      if (props.rowNavigate?.history === "replace") window.location.replace(row.href);
                      else window.location.assign(row.href);
                    }
                  : undefined
              }
              empty={<span>{appliedQuery() ? `No records match “${appliedQuery()}”.` : props.emptyText}</span>}
              renderCell={({ row, col, value }) => {
                if (col.id === "__select") {
                  if (!row.recordId) return null;
                  return (
                    <Checkbox
                      aria-label={`Select record ${row.recordId}`}
                      value={() => selectedRecordIds().has(row.recordId!)}
                      disabled={props.preview || Boolean(pendingKey())}
                      onValueChange={(selected) => toggleSelection(row.recordId!, selected)}
                    />
                  );
                }
                if (col.id === "__actions") {
                  if (!row.recordId) return null;
                  return (
                    <div class="flex min-w-max flex-wrap items-center gap-1">
                      <For each={props.rowActions ?? []}>
                        {(action) => (
                          <Show
                            when={action.showLabel}
                            fallback={
                              <IconButton
                                label={action.label}
                                size="xs"
                                variant="secondary"
                                loading={pendingKey() === `${row.recordId}:${action.id}`}
                                loadingLabel={`${action.label}…`}
                                disabled={props.preview || Boolean(pendingKey())}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void invoke(row.recordId!, action);
                                }}
                              >
                                <i class={`ti ti-${action.icon}`} aria-hidden="true" />
                              </IconButton>
                            }
                          >
                            <Button
                              size="xs"
                              variant="secondary"
                              loading={pendingKey() === `${row.recordId}:${action.id}`}
                              loadingLabel={`${action.label}…`}
                              disabled={props.preview || Boolean(pendingKey())}
                              onClick={(event) => {
                                event.stopPropagation();
                                void invoke(row.recordId!, action);
                              }}
                            >
                              <Show when={action.icon}>
                                <i class={`ti ti-${action.icon}`} aria-hidden="true" />
                              </Show>
                              {action.label}
                            </Button>
                          </Show>
                        )}
                      </For>
                    </div>
                  );
                }
                const text = displayValue(value);
                return row.href && col.id === firstColumnId() ? (
                  <a href={row.href} class="font-medium text-accent hover:underline">
                    {text}
                  </a>
                ) : (
                  <span class="whitespace-pre-wrap break-words">{text}</span>
                );
              }}
            />
          </Show>
        }
      >
        {(cards) => (
          <RecordCardsView
            items={cardRecords()}
            fields={cards().fields}
            displayConfig={cards().displayConfig}
            filePreviews={cards().filePreviews}
            baseId={props.baseId}
            tableId={cardRecords()[0]?.tableId ?? ""}
            dateConfig={props.dateConfig}
            relationLabels={cards().relationLabels}
            emptyText={appliedQuery() ? `No records match “${appliedQuery()}”.` : props.emptyText}
            onRecordClick={(record) => {
              if (!props.rowNavigate) return;
              const href = customAppRowHref(props.shortId, props.rowNavigate, record.id);
              if (props.rowNavigate.history === "replace") window.location.replace(href);
              else window.location.assign(href);
            }}
            coverUrl={(preview) => appFileUrl(preview as GridFilePreview & { contentToken?: string })}
          />
        )}
      </Show>
      <Show when={!props.preview && (history().length > 0 || Boolean(result().page?.nextCursor))}>
        <DataTable.Footer>
          <div class="flex w-full items-center justify-between gap-2">
            <span class="text-sm text-dimmed">
              {result().page ? `${result().page!.start + 1}–${result().page!.start + result().page!.returned}` : ""}
            </span>
            <div class="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={loading() || history().length === 0}
                onClick={() => {
                  const nextHistory = history().slice(0, -1);
                  void loadPage(history().at(-1) ?? null, appliedQuery(), nextHistory);
                }}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={loading() || !result().page?.nextCursor}
                onClick={() => void loadPage(result().page?.nextCursor ?? null, appliedQuery(), [...history(), cursor()])}
              >
                Next
              </Button>
            </div>
          </div>
        </DataTable.Footer>
      </Show>
    </DataTable.Panel>
  );
}
