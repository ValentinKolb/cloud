import { Show, createSignal } from "solid-js";
import { apiClient } from "@/api/client";
import {
  Dropdown,
  navigateTo,
  prompts,
  refreshCurrentPath,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { Field, GridRecord, View } from "../../service";
import {
  fieldToPromptSchema,
  isUserEditable,
  sanitizePayload,
} from "./field-prompt-schema";
import { errorMessage } from "./api-helpers";
import FilterPanel, { type FilterLeaf, blankLeaf } from "./FilterPanel";
import SortPanel, { type SortRow, blankSortRow } from "./SortPanel";

type Props = {
  baseId: string;
  tableId: string;
  fields: Field[];
  /** Initial filter leaves parsed by the SSR. */
  initialFilter: FilterLeaf[];
  /** Initial sort rows parsed by the SSR. */
  initialSort: SortRow[];
  /** Raw URL query strings — passed straight to the export endpoint. */
  rawFilter: string | undefined;
  rawSort: string | undefined;
  /** Are we currently looking at deleted records? */
  trashMode: boolean;
  /** Live record count (already filtered SSR-side). */
  recordCount: number;
  /** Permissions: can the user create rows / share views / etc.? */
  canWrite: boolean;
};

/**
 * Compact toolbar over the records table — uses the platform's
 * `btn-input` / `btn-input-sm` / `btn-input-active` button pattern, so
 * it visually matches every other dropdown trigger in the cloud.
 *
 * Filter and sort rows live up here so the panels below appear iff
 * `rows.length > 0`. Clicking Filter / Sort directly appends a blank
 * row — no separate "Add filter" click needed.
 */
export default function GridToolbar(props: Props) {
  const [filterRows, setFilterRows] = createSignal<FilterLeaf[]>(props.initialFilter);
  const [sortRows, setSortRows] = createSignal<SortRow[]>(props.initialSort);

  const baseUrl = () => {
    const params = new URLSearchParams();
    params.set("table", props.tableId);
    if (props.rawFilter) params.set("filter", props.rawFilter);
    if (props.rawSort) params.set("sort", props.rawSort);
    return `/app/grids/${props.baseId}?${params.toString()}`;
  };

  const hasFilter = () => filterRows().length > 0;
  const hasSort = () => sortRows().length > 0;
  const hasFilterOrSort = () => hasFilter() || hasSort();

  // ---- Add row -----------------------------------------------------------
  const addMut = mutations.create<GridRecord, Record<string, unknown>>({
    mutation: async (payload) => {
      const res = await apiClient.records["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: payload,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to create record"));
      return (await res.json()) as GridRecord;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleAddRow = async () => {
    const usableFields = props.fields.filter((f) => !f.deletedAt && isUserEditable(f.type));
    if (usableFields.length === 0) {
      prompts.error("This table has no editable fields. Add one first.");
      return;
    }
    const formFields: Record<string, any> = {};
    for (const field of usableFields) {
      const schema = fieldToPromptSchema(field);
      if (schema) formFields[field.id] = schema;
    }
    const result = await prompts.form({
      title: "New record",
      icon: "ti ti-row-insert-bottom",
      fields: formFields,
      confirmText: "Create",
    });
    if (!result) return;
    addMut.mutate(sanitizePayload(result));
  };

  // ---- Filter / Sort one-click toggles ----------------------------------
  // Click Filter when empty → append a blank row. Panel appears
  // automatically because we render iff filterRows().length > 0.
  // Click Filter when non-empty → append another row (matches the user's
  // mental model: "Filter button = add a filter").
  const onFilterClick = () => {
    const blank = blankLeaf(props.fields);
    if (blank) setFilterRows([...filterRows(), blank]);
  };
  const onSortClick = () => {
    const blank = blankSortRow(props.fields);
    if (blank) setSortRows([...sortRows(), blank]);
  };

  // ---- Save as view ------------------------------------------------------
  const saveViewMut = mutations.create<View, { name: string; shared: boolean }>({
    mutation: async (input) => {
      const filterRaw = props.rawFilter;
      const sortRaw = props.rawSort;
      const config = {
        filter: filterRaw ? JSON.parse(filterRaw) : undefined,
        sort: sortRaw ? JSON.parse(sortRaw) : undefined,
      };
      const res = await apiClient.views["by-table"][":tableId"].$post({
        param: { tableId: props.tableId },
        json: { name: input.name, config, shared: input.shared },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save view"));
      return (await res.json()) as View;
    },
    onSuccess: () => refreshCurrentPath(),
    onError: (e) => prompts.error(e.message),
  });

  const handleSaveView = async () => {
    const result = await prompts.form({
      title: "Save view",
      icon: "ti ti-bookmark-plus",
      fields: {
        name: { type: "text", label: "Name", required: true, placeholder: "e.g. Open tasks" },
        shared: {
          type: "boolean",
          label: props.canWrite
            ? "Share with everyone who can read this table"
            : "Share (requires table-write)",
          default: false,
        },
      },
      confirmText: "Save",
    });
    if (!result) return;
    if (result.shared && !props.canWrite) {
      prompts.error("You don't have permission to share views on this table.");
      return;
    }
    saveViewMut.mutate({ name: String(result.name).trim(), shared: Boolean(result.shared) });
  };

  // ---- Clear filter and/or sort (smart label) ---------------------------
  // Builds a label that names exactly what's currently active so the user
  // sees "Clear filter", "Clear sort", or "Clear filter & sort" depending
  // on which URL params are set.
  const clearLabel = () => {
    if (hasFilter() && hasSort()) return "Clear filter & sort";
    if (hasFilter()) return "Clear filter";
    return "Clear sort";
  };
  const clearAll = () => {
    setFilterRows([]);
    setSortRows([]);
    const url = new URL(`/app/grids/${props.baseId}`, "http://x");
    url.searchParams.set("table", props.tableId);
    if (props.trashMode) url.searchParams.set("trash", "1");
    navigateTo(`${url.pathname}${url.search}`);
  };

  // ---- Show-deleted toggle URL ------------------------------------------
  const trashToggleUrl = () => {
    const url = new URL(`/app/grids/${props.baseId}`, "http://x");
    url.searchParams.set("table", props.tableId);
    if (props.rawFilter) url.searchParams.set("filter", props.rawFilter);
    if (props.rawSort) url.searchParams.set("sort", props.rawSort);
    if (!props.trashMode) url.searchParams.set("trash", "1");
    return `${url.pathname}${url.search}`;
  };

  // ---- Export URL --------------------------------------------------------
  const exportUrl = (format: "csv" | "json") => {
    const url = new URL(
      `/api/grids/records/by-table/${props.tableId}/export`,
      typeof window !== "undefined" ? window.location.origin : "http://x",
    );
    url.searchParams.set("format", format);
    if (props.rawFilter) url.searchParams.set("filter", props.rawFilter);
    if (props.rawSort) url.searchParams.set("sort", props.rawSort);
    return url.pathname + url.search;
  };

  return (
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center gap-2">
        {/* Add row — leftmost. Uses the same btn-input style as the rest. */}
        <Show when={props.canWrite && !props.trashMode}>
          <button
            type="button"
            class="btn-input btn-input-sm"
            onClick={handleAddRow}
            disabled={addMut.loading()}
          >
            <Show when={addMut.loading()} fallback={<i class="ti ti-plus" />}>
              <i class="ti ti-loader-2 animate-spin" />
            </Show>
            Add row
          </button>
        </Show>

        <Show when={!props.trashMode}>
          {/* Order: Add (left, primary) → Actions → Filter → Sort →
              Clear (conditional) → Save as view (conditional). */}

          {/* Actions: Export + Show deleted. No leading icon — chevron is
              enough to signal a dropdown trigger. */}
          <Dropdown
            trigger={
              <span class="btn-input btn-input-sm">
                Actions
                <i class="ti ti-chevron-down text-[10px] opacity-60" />
              </span>
            }
            elements={[
              { icon: "ti ti-file-type-csv", label: "Export CSV", href: exportUrl("csv") },
              { icon: "ti ti-braces", label: "Export JSON", href: exportUrl("json") },
              { icon: "ti ti-archive", label: "Show deleted", href: trashToggleUrl() },
            ]}
          />

          {/* Filter — clicking adds a blank row; the panel below renders iff rows > 0. */}
          <button
            type="button"
            class={`btn-input btn-input-sm ${hasFilter() ? "btn-input-active" : ""}`}
            onClick={onFilterClick}
          >
            <i class="ti ti-filter" />
            Filter
          </button>

          {/* Sort — same pattern. */}
          <button
            type="button"
            class={`btn-input btn-input-sm ${hasSort() ? "btn-input-active" : ""}`}
            onClick={onSortClick}
          >
            <i class="ti ti-arrows-sort" />
            Sort
          </button>

          {/* Smart Clear — only when at least one of filter/sort is active.
              Label adapts to "Clear filter", "Clear sort", or "Clear filter
              & sort" so the user always knows what's about to be wiped. */}
          <Show when={hasFilterOrSort()}>
            <button
              type="button"
              class="btn-input btn-input-sm text-red-500"
              onClick={clearAll}
              title={clearLabel()}
            >
              <i class="ti ti-filter-off" />
              {clearLabel()}
            </button>
          </Show>

          {/* Save as view — only when filter or sort is set. */}
          <Show when={hasFilterOrSort()}>
            <button
              type="button"
              class="btn-input btn-input-sm text-emerald-700 dark:text-emerald-300"
              onClick={handleSaveView}
              disabled={saveViewMut.loading()}
              title="Save current filter/sort as a view"
            >
              <i class="ti ti-bookmark-plus" />
              Save as view
            </button>
          </Show>
        </Show>

        {/* Back-from-trash chip — only in trash mode */}
        <Show when={props.trashMode}>
          <a
            href={`/app/grids/${props.baseId}?table=${props.tableId}`}
            class="btn-input btn-input-sm"
          >
            <i class="ti ti-arrow-back" />
            Back to live records
          </a>
        </Show>

        {/* Record count */}
        <span class="ml-auto text-xs text-dimmed whitespace-nowrap">
          {props.trashMode && "Deleted: "}
          {props.recordCount === 0
            ? "No records"
            : props.recordCount === 1
            ? "1 record"
            : `${props.recordCount} records`}
        </span>
      </div>

      {/* Filter panel — render iff there's at least one filter row */}
      <Show when={!props.trashMode && hasFilter()}>
        <div class="paper p-3">
          <FilterPanel
            fields={props.fields}
            rows={filterRows}
            onRowsChange={setFilterRows}
            initialFromUrl={props.initialFilter}
            baseUrl={baseUrl()}
          />
        </div>
      </Show>

      {/* Sort panel */}
      <Show when={!props.trashMode && hasSort()}>
        <div class="paper p-3">
          <SortPanel
            fields={props.fields}
            rows={sortRows}
            onRowsChange={setSortRows}
            initialFromUrl={props.initialSort}
            baseUrl={baseUrl()}
          />
        </div>
      </Show>
    </div>
  );
}
