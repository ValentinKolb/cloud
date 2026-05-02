import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import type { Field, GridRecord } from "../../service";
import {
  RECORD_DETAIL_EVENT,
  setSelectedRecordInUrl,
  getSelectedRecordIdFromUrl,
  type RecordDetailMode,
  type RecordDetailPayload,
} from "./record-detail-context";

type Props = {
  tableId: string;
  fields: Field[];
  records: GridRecord[];
  canWrite: boolean;
  /** "live" = edit/delete via the detail panel; "trash" = restore. */
  mode?: RecordDetailMode;
  /** Initial selected record id from `?record=<id>` (SSR). */
  initialSelectedId?: string | null;
  /**
   * Aggregate values keyed `<fieldId>__<agg>` (matches the API's keying).
   * Rendered as a footer row: count for every field + sum for numerics.
   * Empty object = footer row hidden (trash mode, empty table, etc).
   */
  aggregates?: Record<string, unknown>;
};


const formatCell = (value: unknown, type: string, fieldConfig?: Record<string, unknown>): string => {
  if (value === null || value === undefined || value === "") return "";
  if (type === "boolean") return value ? "Yes" : "No";
  if (type === "multi-select" && Array.isArray(value)) {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    const labels = value.map((id) => options.find((o) => o.id === id)?.label ?? String(id));
    return labels.join(", ");
  }
  if (type === "single-select") {
    const options = (fieldConfig?.options as Array<{ id: string; label: string }> | undefined) ?? [];
    return options.find((o) => o.id === value)?.label ?? String(value);
  }
  if (type === "currency" && typeof value === "object") {
    const obj = value as { amount?: string; currency?: string };
    if (obj.amount !== undefined) return `${obj.amount} ${obj.currency ?? ""}`.trim();
  }
  if (type === "percent" && typeof value === "number") return `${value}%`;
  if (type === "duration" && typeof value === "number") {
    const h = Math.floor(value / 3600);
    const m = Math.floor((value % 3600) / 60);
    const s = value % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (type === "location" && typeof value === "object") {
    const obj = value as { lat?: number; lng?: number; label?: string };
    if (obj.label) return obj.label;
    if (obj.lat !== undefined && obj.lng !== undefined) return `${obj.lat}, ${obj.lng}`;
  }
  if (type === "signature" && typeof value === "string" && value.startsWith("data:image/")) {
    return "✍ signature";
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/**
 * Records table. Rows are clickable: clicking a row sets `?record=<id>` on
 * the URL and dispatches the `grids-record-select` event so the
 * RecordDetailPanel mounted in the third column updates without a full SSR
 * round-trip. Edit / delete / restore actions live entirely in that panel
 * — there are no inline row buttons here anymore.
 */
export default function RecordsGrid(props: Props) {
  const [selectedId, setSelectedId] = createSignal<string | null>(props.initialSelectedId ?? null);
  const mode: RecordDetailMode = props.mode ?? "live";

  // Listen for the detail-panel selection event so the highlight stays in
  // sync when the user closes the panel or navigates back/forward.
  onMount(() => {
    const onEvent = (e: Event) => {
      const payload = (e as CustomEvent<RecordDetailPayload>).detail;
      setSelectedId(payload.itemKey);
    };
    const onPop = () => setSelectedId(getSelectedRecordIdFromUrl());
    window.addEventListener(RECORD_DETAIL_EVENT, onEvent);
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener(RECORD_DETAIL_EVENT, onEvent);
      window.removeEventListener("popstate", onPop);
    });
  });

  const visibleFields = () => props.fields.filter((f) => !f.deletedAt);

  const onRowClick = (rec: GridRecord) => {
    setSelectedId(rec.id);
    setSelectedRecordInUrl({ recordId: rec.id, record: rec, mode });
  };

  const onRowKeyDown = (event: KeyboardEvent, rec: GridRecord) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onRowClick(rec);
  };

  return (
    <Show
      when={visibleFields().length > 0}
      fallback={
        <div class="paper p-6 text-center text-sm text-dimmed">
          No fields. Add one in the sidebar to populate this table.
        </div>
      }
    >
      {/*
        Two-layer wrapper so wide tables (lots of fields, long values) scroll
        horizontally inside the paper border without forcing the whole page
        wider. Mirrors the spaces ItemsTable pattern.
      */}
      <div class="paper overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-zinc-100 dark:border-zinc-800">
                {/* Two-line headers — explicitly breaking the platform's
                    single-line table convention because grids tables are far
                    more dynamic (any field type, user-defined names) than
                    the static-schema tables elsewhere in the cloud. Top
                    line = column name (primary, semibold); bottom line =
                    data type (small, dimmed). */}
                <For each={visibleFields()}>
                  {(f) => (
                    <th class="px-3 py-2 text-left">
                      <div class="flex flex-col gap-0.5 leading-tight">
                        <span class="text-primary font-semibold">{f.name}</span>
                        <span class="text-[10px] text-dimmed font-normal">{f.type}</span>
                      </div>
                    </th>
                  )}
                </For>
              </tr>
            </thead>
            <Show when={props.aggregates && Object.keys(props.aggregates).length > 0}>
              <tfoot>
                <tr class="border-t border-zinc-100 dark:border-zinc-800">
                  <For each={visibleFields()}>
                    {(f) => {
                      const agg = props.aggregates ?? {};
                      const count = agg[`${f.id}__count`];
                      const sum = agg[`${f.id}__sum`];
                      return (
                        <td class="px-3 py-1.5 text-[11px] text-dimmed">
                          <Show when={count !== undefined && count !== null}>
                            <span class="block whitespace-nowrap" title="non-empty count">
                              {String(count)} {Number(count) === 1 ? "value" : "values"}
                            </span>
                          </Show>
                          <Show when={sum !== undefined && sum !== null}>
                            <span class="block whitespace-nowrap" title="sum">
                              Σ {String(sum)}
                            </span>
                          </Show>
                        </td>
                      );
                    }}
                  </For>
                </tr>
              </tfoot>
            </Show>
            <tbody>
              <Show
                when={props.records.length > 0}
                fallback={
                  <tr>
                    <td
                      colspan={visibleFields().length}
                      class="px-3 py-3 text-left text-dimmed text-xs"
                    >
                      {mode === "trash" ? "No deleted records." : "No records."}
                    </td>
                  </tr>
                }
              >
                <For each={props.records}>
                  {(rec) => {
                    const isSelected = () => selectedId() === rec.id;
                    return (
                      <tr
                        // Row is the click target — opens the detail panel.
                        // Tabindex + role + keydown make it keyboard-accessible.
                        tabindex={0}
                        role="button"
                        aria-pressed={isSelected()}
                        class={`cursor-pointer border-b border-zinc-50 last:border-0 dark:border-zinc-800/50 ${
                          isSelected()
                            ? "bg-blue-50 dark:bg-blue-950/30"
                            : "hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                        }`}
                        onClick={() => onRowClick(rec)}
                        onKeyDown={(e) => onRowKeyDown(e, rec)}
                      >
                        <For each={visibleFields()}>
                          {(f) => (
                            <td class="px-3 py-2 text-primary">
                              {formatCell(rec.data[f.id], f.type, f.config)}
                            </td>
                          )}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </Show>
            </tbody>
          </table>
        </div>
      </div>
    </Show>
  );
}
