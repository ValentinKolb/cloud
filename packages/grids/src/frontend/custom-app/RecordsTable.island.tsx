import { Button, DataTable, type DataTableColumn, IconButton, Placeholder } from "@k2b/ui";
import { createSignal, For, onCleanup, Show } from "solid-js";
import type { DslQueryPreviewResponse } from "../../contracts";
import type { CustomAppRowNavigation } from "../../custom-apps/contracts";
import { customAppRowHref } from "../../custom-apps/routing";
import { customAppRecordsResultColumns } from "./records-table-model";
import { invokeCustomAppWorkflow } from "./workflow-action-client";

type QuerySuccess = Extract<DslQueryPreviewResponse, { ok: true }>;

export type CustomAppRenderedRowAction = {
  id: string;
  label: string;
  icon?: string;
  showLabel: boolean;
  endpoint: string;
  confirm?: string;
};

const displayValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return JSON.stringify(value);
};

export default function RecordsTable(props: {
  title: string;
  emptyText: string;
  shortId: string;
  selectedColumnIds?: string[];
  result: QuerySuccess;
  rowNavigate?: CustomAppRowNavigation;
  rowActions?: CustomAppRenderedRowAction[];
  preview?: boolean;
}) {
  const [pendingKey, setPendingKey] = createSignal<string | null>(null);
  const [status, setStatus] = createSignal<{
    key: string;
    kind: "running" | "success" | "error";
    message: string;
  } | null>(null);
  let controller: AbortController | null = null;
  let reloadTimer: number | null = null;
  onCleanup(() => {
    controller?.abort();
    if (reloadTimer !== null) window.clearTimeout(reloadTimer);
  });
  const resultColumns = customAppRecordsResultColumns(props.result.columns, props.selectedColumnIds);
  const rows = props.result.rows.map((row, index) => ({
    ...row,
    rowKey: row.recordId ? `${row.recordId}:${index}` : `row-${index}`,
    href: row.recordId && props.rowNavigate ? customAppRowHref(props.shortId, props.rowNavigate, row.recordId) : null,
  }));
  const firstColumnId = resultColumns[0]?.key;
  const columns: DataTableColumn<(typeof rows)[number]>[] = resultColumns.map((column) => ({
    id: column.key,
    header: column.label,
    subtitle: column.type,
    value: (row) => row.values[column.key],
  }));
  if ((props.rowActions?.length ?? 0) > 0) {
    columns.push({ id: "__actions", header: "Actions", value: (row) => row.recordId });
  }
  if (resultColumns.length === 0) {
    return (
      <Placeholder
        state="error"
        variant="compact"
        align="left"
        title="Records unavailable"
        description="The selected fields are not part of this view result."
      />
    );
  }

  const invoke = async (rowId: string, action: CustomAppRenderedRowAction) => {
    const key = `${rowId}:${action.id}`;
    if (props.preview || pendingKey() || (action.confirm && !window.confirm(action.confirm))) return;
    setPendingKey(key);
    setStatus(null);
    const current = new AbortController();
    controller = current;
    try {
      const outcome = await invokeCustomAppWorkflow({
        endpoint: action.endpoint,
        body: { rowId },
        signal: current.signal,
        onRunning: () => setStatus({ key, kind: "running", message: "Workflow is running…" }),
      });
      setStatus({ key, ...outcome });
      if (outcome.kind === "success") reloadTimer = window.setTimeout(() => window.location.reload(), 600);
    } catch (cause) {
      if (current.signal.aborted) return;
      setStatus({ key, kind: "error", message: cause instanceof Error ? cause.message : "The workflow could not be started." });
    } finally {
      if (controller === current) controller = null;
      setPendingKey(null);
    }
  };

  return (
    <div class="overflow-x-auto">
      <DataTable
        ariaLabel={props.title}
        rows={rows}
        columns={columns}
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
        empty={<span>{props.emptyText}</span>}
        renderCell={({ row, col, value }) => {
          if (col.id === "__actions") {
            if (!row.recordId) return null;
            return (
              <div class="flex min-w-max flex-col items-start gap-1">
                <div class="flex flex-wrap items-center gap-1">
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
                              if (props.preview) return;
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
                            if (props.preview) return;
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
                <Show when={status()?.key.startsWith(`${row.recordId}:`) ? status() : null}>
                  {(current) => (
                    <span
                      role={current().kind === "error" ? "alert" : "status"}
                      class={`max-w-64 text-xs ${current().kind === "error" ? "text-danger" : current().kind === "success" ? "text-success" : "text-secondary"}`}
                    >
                      {current().message}
                    </span>
                  )}
                </Show>
              </div>
            );
          }
          const text = displayValue(value);
          return row.href && col.id === firstColumnId ? (
            <a href={row.href} class="font-medium text-accent hover:underline">
              {text}
            </a>
          ) : (
            <span class="whitespace-pre-wrap break-words">{text}</span>
          );
        }}
      />
    </div>
  );
}
