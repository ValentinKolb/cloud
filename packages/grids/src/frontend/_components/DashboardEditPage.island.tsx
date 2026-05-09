import type { AccessEntry, Principal, PermissionLevel } from "@valentinkolb/cloud/contracts/shared";
import { icons } from "@valentinkolb/cloud/shared";
import {
  navigateTo,
  PermissionEditor,
  prompts,
  Select,
  SelectInput,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type {
  Dashboard,
  DashboardConfig,
  DashboardRow,
  Field,
  StatWidget,
  StatsRow as StatsRowType,
  View,
  ViewStatsRow as ViewStatsRowType,
  ViewWidget,
  WidgetsRow as WidgetsRowType,
} from "../../service";
import type { AggregationSpec } from "../../contracts";
import { errorMessage } from "./api-helpers";
import { SectionCard } from "./SectionCard";
import { formatWidgetValue } from "./dashboard/widget-format";

// =============================================================================
// Dashboard editor — split into "stats rows" (ui-lab small-grid pattern)
// and "widgets rows" (one paper per widget, sm/md/lg height tier). The
// row-kind discriminant decides both the renderer and the cell-editor
// shape; mixing widget kinds inside a row was deliberately removed
// after the user pointed out it never made visual sense (charts and
// stats need very different vertical real estate).
// =============================================================================

type Props = {
  baseSlug: string;
  initialDashboard: Dashboard;
  /** Whether this dashboard is the base's default — surfaces as a
   *  read-only badge with a link to base settings. */
  isBaseDefault: boolean;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
};

const DEFAULT_AGG: AggregationSpec = { fieldId: "*", agg: "count" };

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

const defaultStatWidget = (tableId: string): StatWidget => ({
  id: newId("w"),
  kind: "stat",
  title: "New stat",
  format: "plain",
  source: { tableId, aggregations: [DEFAULT_AGG] },
});

const defaultViewWidget = (): ViewWidget => ({
  id: newId("w"),
  kind: "view",
  source: { kind: "view", viewId: "" },
});

const defaultStatsRow = (tableId: string): StatsRowType => ({
  id: newId("r"),
  kind: "stats",
  cells: [defaultStatWidget(tableId)],
});

const defaultViewStatsRow = (): ViewStatsRowType => ({
  id: newId("r"),
  kind: "view-stats",
  viewId: "",
});

const defaultWidgetsRow = (): WidgetsRowType => ({
  id: newId("r"),
  kind: "widgets",
  height: "lg",
  cells: [defaultViewWidget()],
});

export default function DashboardEditPage(props: Props) {
  const [config, setConfig] = createSignal<DashboardConfig>(
    props.initialDashboard.config,
  );
  const [savedConfig, setSavedConfig] = createSignal<DashboardConfig>(
    props.initialDashboard.config,
  );
  const dirty = createMemo(
    () => JSON.stringify(config()) !== JSON.stringify(savedConfig()),
  );

  const saveLayoutMut = mutations.create<Dashboard, void>({
    mutation: async () => {
      const res = await apiClient.dashboards[":dashboardId"].$patch({
        param: { dashboardId: props.initialDashboard.id },
        json: { config: config() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save layout"));
      return (await res.json()) as Dashboard;
    },
    onSuccess: () => setSavedConfig(config()),
    onError: (e) => prompts.error(e.message),
  });

  return (
    <div class="flex flex-col gap-4 p-6">
      <header class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <h1 class="text-xl font-semibold text-primary truncate">
            Dashboard settings
          </h1>
          <Show when={props.isBaseDefault}>
            <a
              href={`/app/grids/${props.baseSlug}/settings`}
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
              title="This dashboard opens when no specific table or dashboard is set in the URL"
            >
              base default
            </a>
          </Show>
        </div>
        <a
          href={`/app/grids/${props.baseSlug}?dashboard=${props.initialDashboard.slug}`}
          class="btn-input btn-input-sm"
        >
          <i class="ti ti-arrow-left" /> Back to dashboard
        </a>
      </header>

      <GeneralSection dashboard={props.initialDashboard} />

      <SectionCard
        title="Layout"
        subtitle="Stats rows render the small-grid pattern (one paper, hairline cells). View rows give each widget its own paper card with a height tier."
      >
        <LayoutEditor
          config={config}
          setConfig={setConfig}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
          viewsByTable={props.viewsByTable}
        />
        <div class="flex items-center justify-end gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-800/60 mt-3">
          <Show when={dirty()}>
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => setConfig(savedConfig())}
              disabled={saveLayoutMut.loading()}
            >
              Discard changes
            </button>
          </Show>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => saveLayoutMut.mutate(undefined)}
            disabled={!dirty() || saveLayoutMut.loading()}
          >
            {saveLayoutMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-device-floppy" />}
            Save layout
          </button>
        </div>
      </SectionCard>

      <SectionCard
        title="Permissions"
        subtitle="Grant read access on this dashboard to specific users or groups. Only Read is offered — write/admin don't apply to a saved layout."
      >
        <DashboardPermissions
          dashboardId={props.initialDashboard.id}
          initialEntries={props.initialAccessEntries}
          canEdit={props.canEditAccess}
        />
      </SectionCard>

      <SectionCard
        title="Danger zone"
        subtitle="Permanently delete this dashboard. The widgets are gone; source data stays untouched."
        variant="danger"
      >
        <DeleteButton
          dashboardId={props.initialDashboard.id}
          baseSlug={props.baseSlug}
          name={props.initialDashboard.name}
        />
      </SectionCard>
    </div>
  );
}

// =============================================================================
// General section
// =============================================================================

function GeneralSection(props: { dashboard: Dashboard }) {
  const [name, setName] = createSignal(props.dashboard.name);
  const [description, setDescription] = createSignal(
    props.dashboard.description ?? "",
  );
  const [shared, setShared] = createSignal(props.dashboard.ownerUserId === null);

  const mutation = mutations.create<Dashboard, void>({
    mutation: async () => {
      const res = await apiClient.dashboards[":dashboardId"].$patch({
        param: { dashboardId: props.dashboard.id },
        json: {
          name: name().trim(),
          description: description().trim() || null,
          shared: shared(),
        },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save dashboard"));
      return (await res.json()) as Dashboard;
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <SectionCard title="General" subtitle="Name, description, and sharing.">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TextInput label="Name" value={name} onInput={setName} required />
        <TextInput
          label="Description"
          value={description}
          onInput={setDescription}
          placeholder="Optional"
        />
      </div>

      <label class="flex items-center gap-2 mt-3 text-sm">
        <input
          type="checkbox"
          class="checkbox"
          checked={shared()}
          onChange={(e) => setShared(e.currentTarget.checked)}
        />
        <span>
          <span class="font-medium">Shared</span>{" "}
          <span class="text-dimmed">
            — visible to anyone with base-read. Untoggle to make it personal.
          </span>
        </span>
      </label>

      <div class="flex justify-end mt-3">
        <button
          type="button"
          class="btn-primary btn-sm"
          onClick={() => mutation.mutate(undefined)}
          disabled={mutation.loading() || name().trim().length === 0}
        >
          {mutation.loading() ? <i class="ti ti-loader-2 animate-spin" /> : null}
          Save
        </button>
      </div>
    </SectionCard>
  );
}

// =============================================================================
// Layout editor — top-level row list with two add-row buttons
// =============================================================================

function LayoutEditor(props: {
  config: () => DashboardConfig;
  setConfig: (next: DashboardConfig) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
}) {
  // Single source of truth for which cell editor is expanded —
  // keyed by stable widget.id (not array index), so it survives
  // the row-object recreations that Solid's <For> would otherwise
  // unmount when `setConfig` produces a fresh row reference. A
  // local signal in each row card was the original design, but a
  // change anywhere in that row → new row object → component
  // remount → state reset → user re-opens the panel after every
  // edit, which is exactly what the user reported.
  //
  // One global signal keeps the model trivial (only one cell open
  // at a time across the whole editor; opening a new one collapses
  // the previous). Multi-open felt like a YAGNI complication.
  const [expandedCellId, setExpandedCellId] = createSignal<string | null>(null);
  const toggleCell = (id: string) =>
    setExpandedCellId(expandedCellId() === id ? null : id);

  const updateRow = (rowIdx: number, next: DashboardRow) => {
    const cfg = props.config();
    props.setConfig({
      ...cfg,
      rows: cfg.rows.map((r, i) => (i === rowIdx ? next : r)),
    });
  };

  const moveRow = (rowIdx: number, dir: -1 | 1) => {
    const target = rowIdx + dir;
    const rows = props.config().rows;
    if (target < 0 || target >= rows.length) return;
    const next = [...rows];
    [next[rowIdx], next[target]] = [next[target]!, next[rowIdx]!];
    props.setConfig({ ...props.config(), rows: next });
  };

  const removeRow = (rowIdx: number) => {
    const cfg = props.config();
    props.setConfig({
      ...cfg,
      rows: cfg.rows.filter((_, i) => i !== rowIdx),
    });
  };

  const addStatsRow = () => {
    const tableId = props.tables[0]?.id ?? "";
    props.setConfig({
      ...props.config(),
      rows: [...props.config().rows, defaultStatsRow(tableId)],
    });
  };

  const addViewStatsRow = () => {
    props.setConfig({
      ...props.config(),
      rows: [...props.config().rows, defaultViewStatsRow()],
    });
  };

  const addWidgetsRow = () => {
    props.setConfig({
      ...props.config(),
      rows: [...props.config().rows, defaultWidgetsRow()],
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={props.config().rows.length > 0}
        fallback={
          <div class="info-block-info text-xs text-center py-4">
            No rows yet. Pick a row type below.
          </div>
        }
      >
        <For each={props.config().rows}>
          {(row, rowIdx) => {
            const r = row;
            if (r.kind === "stats") {
              return (
                <StatsRowCard
                  row={r}
                  rowIdx={rowIdx()}
                  rowCount={props.config().rows.length}
                  tables={props.tables}
                  fieldsByTable={props.fieldsByTable}
                  expandedCellId={expandedCellId}
                  toggleCell={toggleCell}
                  onUpdate={(next) => updateRow(rowIdx(), next)}
                  onMoveRow={(dir) => moveRow(rowIdx(), dir)}
                  onRemoveRow={() => removeRow(rowIdx())}
                />
              );
            }
            if (r.kind === "view-stats") {
              return (
                <ViewStatsRowCard
                  row={r}
                  rowIdx={rowIdx()}
                  rowCount={props.config().rows.length}
                  tables={props.tables}
                  viewsByTable={props.viewsByTable}
                  onUpdate={(next) => updateRow(rowIdx(), next)}
                  onMoveRow={(dir) => moveRow(rowIdx(), dir)}
                  onRemoveRow={() => removeRow(rowIdx())}
                />
              );
            }
            return (
              <WidgetsRowCard
                row={r}
                rowIdx={rowIdx()}
                rowCount={props.config().rows.length}
                tables={props.tables}
                viewsByTable={props.viewsByTable}
                expandedCellId={expandedCellId}
                toggleCell={toggleCell}
                onUpdate={(next) => updateRow(rowIdx(), next)}
                onMoveRow={(dir) => moveRow(rowIdx(), dir)}
                onRemoveRow={() => removeRow(rowIdx())}
              />
            );
          }}
        </For>
      </Show>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={addStatsRow}
          disabled={props.tables.length === 0}
        >
          <i class="ti ti-number" /> Add stats row
        </button>
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={addViewStatsRow}
        >
          <i class="ti ti-table-spark" /> Add view stats row
        </button>
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={addWidgetsRow}
        >
          <i class="ti ti-layout-rows" /> Add view row
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Stats row card — 1-6 stat cells (matches StatsRow renderer cap)
// =============================================================================

function StatsRowCard(props: {
  row: StatsRowType;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  /** Hoisted expansion state — keyed by stable widget.id so it
   *  survives the row-object recreations triggered by every cell
   *  edit. See LayoutEditor for the rationale. */
  expandedCellId: () => string | null;
  toggleCell: (id: string) => void;
  onUpdate: (row: StatsRowType) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
}) {
  const updateCell = (cellIdx: number, widget: StatWidget) => {
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.map((c, i) => (i === cellIdx ? widget : c)),
    });
  };

  const addCell = () => {
    if (props.row.cells.length >= 6) return;
    const tableId = props.tables[0]?.id ?? "";
    props.onUpdate({
      ...props.row,
      cells: [...props.row.cells, defaultStatWidget(tableId)],
    });
  };

  const removeCell = (cellIdx: number) => {
    if (props.row.cells.length <= 1) return; // keep at least one
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.filter((_, i) => i !== cellIdx),
    });
  };

  return (
    <div class="paper p-3 flex flex-col gap-3">
      <RowHeader
        kindLabel="Stats row"
        kindIcon="ti ti-number"
        rowIdx={props.rowIdx}
        rowCount={props.rowCount}
        onMoveRow={props.onMoveRow}
        onRemoveRow={props.onRemoveRow}
      />

      <div class="flex flex-col gap-2">
        <For each={props.row.cells}>
          {(cell, cellIdx) => (
            <StatCellEditor
              widget={cell}
              isExpanded={props.expandedCellId() === cell.id}
              canRemove={props.row.cells.length > 1}
              onToggle={() => props.toggleCell(cell.id)}
              onUpdate={(w) => updateCell(cellIdx(), w)}
              onRemove={() => removeCell(cellIdx())}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
            />
          )}
        </For>
      </div>

      <Show when={props.row.cells.length < 6}>
        <button
          type="button"
          class="btn-input btn-sm self-start"
          onClick={addCell}
        >
          <i class="ti ti-plus" /> Add stat
        </button>
      </Show>
    </div>
  );
}

// =============================================================================
// Widgets row card — 1-4 view cells (chart later) with sm/md/lg height
// =============================================================================

const HEIGHT_OPTIONS = [
  { id: "sm", label: "Small (96px)" },
  { id: "md", label: "Medium (192px)" },
  { id: "lg", label: "Large (360px)" },
];

function WidgetsRowCard(props: {
  row: WidgetsRowType;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
  /** Hoisted expansion state — see StatsRowCard for the rationale. */
  expandedCellId: () => string | null;
  toggleCell: (id: string) => void;
  onUpdate: (row: WidgetsRowType) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
}) {
  // Chart variant exists in the schema but the render stub ships in P1.
  // The editor only offers `view` cells until then; an existing chart
  // cell on a saved dashboard is preserved via the `cell.kind` check
  // below but can't be added here.
  const updateCell = (cellIdx: number, widget: ViewWidget) => {
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.map((c, i) => (i === cellIdx ? widget : c)),
    });
  };

  const addCell = () => {
    if (props.row.cells.length >= 4) return;
    props.onUpdate({
      ...props.row,
      cells: [...props.row.cells, defaultViewWidget()],
    });
  };

  const removeCell = (cellIdx: number) => {
    if (props.row.cells.length <= 1) return;
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.filter((_, i) => i !== cellIdx),
    });
  };

  return (
    <div class="paper p-3 flex flex-col gap-3">
      <RowHeader
        kindLabel="View row"
        kindIcon="ti ti-table-spark"
        rowIdx={props.rowIdx}
        rowCount={props.rowCount}
        onMoveRow={props.onMoveRow}
        onRemoveRow={props.onRemoveRow}
        extra={
          <Select
            value={() => props.row.height}
            onChange={(v) =>
              props.onUpdate({ ...props.row, height: v as "sm" | "md" | "lg" })
            }
            options={HEIGHT_OPTIONS}
          />
        }
      />

      <div class="flex flex-col gap-2">
        <For each={props.row.cells}>
          {(cell, cellIdx) =>
            cell.kind === "view" ? (
              <ViewCellEditor
                widget={cell}
                isExpanded={props.expandedCellId() === cell.id}
                canRemove={props.row.cells.length > 1}
                onToggle={() => props.toggleCell(cell.id)}
                onUpdate={(w) => updateCell(cellIdx(), w)}
                onRemove={() => removeCell(cellIdx())}
                viewsByTable={props.viewsByTable}
                tables={props.tables}
              />
            ) : (
              <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md p-2 text-xs text-dimmed">
                Chart widget — renderer ships in P1. Stays in the saved
                config; can't be edited from here yet.
              </div>
            )
          }
        </For>
      </div>

      <Show when={props.row.cells.length < 4}>
        <button
          type="button"
          class="btn-input btn-sm self-start"
          onClick={addCell}
        >
          <i class="ti ti-plus" /> Add view
        </button>
      </Show>
    </div>
  );
}

// Shared row-header strip — rendered above both stats and widgets cards
// so reorder + delete affordances stay in the same screen position
// regardless of the row kind.
import type { JSX } from "solid-js";
function RowHeader(props: {
  kindLabel: string;
  kindIcon: string;
  rowIdx: number;
  rowCount: number;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
  /** Optional inline control rendered before the move/delete buttons —
   *  used by widget-rows to surface the height select. */
  extra?: JSX.Element;
}) {
  return (
    <header class="flex items-center justify-between gap-2">
      <span class="text-xs font-medium text-dimmed flex items-center gap-1.5">
        <i class={`${props.kindIcon} text-[12px]`} />
        {props.kindLabel} · row {props.rowIdx + 1}
      </span>
      <div class="flex items-center gap-2">
        {props.extra}
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={() => props.onMoveRow(-1)}
          disabled={props.rowIdx === 0}
          title="Move row up"
        >
          <i class="ti ti-arrow-up" />
        </button>
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={() => props.onMoveRow(1)}
          disabled={props.rowIdx === props.rowCount - 1}
          title="Move row down"
        >
          <i class="ti ti-arrow-down" />
        </button>
        <button
          type="button"
          class="btn-input btn-sm text-red-600 dark:text-red-400"
          onClick={async () => {
            if (await prompts.confirm("Delete this row and its widgets?")) {
              props.onRemoveRow();
            }
          }}
          title="Delete row"
        >
          <i class="ti ti-trash" />
        </button>
      </div>
    </header>
  );
}

// =============================================================================
// Stat cell editor — inline expandable, configures a single StatWidget
// =============================================================================

const AGG_OPTIONS = [
  { id: "count", label: "count" },
  { id: "countEmpty", label: "count empty" },
  { id: "countUnique", label: "count unique" },
  { id: "sum", label: "sum" },
  { id: "avg", label: "avg" },
  { id: "min", label: "min" },
  { id: "max", label: "max" },
];

const FORMAT_OPTIONS = [
  { id: "plain", label: "Plain number" },
  { id: "integer", label: "Integer" },
  { id: "currency", label: "Currency (EUR)" },
  { id: "percent", label: "Percent" },
];

function StatCellEditor(props: {
  widget: StatWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: StatWidget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
}) {
  const fields = () =>
    (props.fieldsByTable[props.widget.source.tableId] ?? []).filter(
      (f) => !f.deletedAt,
    );

  const updateAgg = (patch: Partial<AggregationSpec>) => {
    const current = props.widget.source.aggregations[0] ?? DEFAULT_AGG;
    props.onUpdate({
      ...props.widget,
      source: {
        ...props.widget.source,
        aggregations: [{ ...current, ...patch }],
      },
    });
  };

  const summary = () => {
    const agg = props.widget.source.aggregations[0];
    if (!agg) return "?";
    const fieldName =
      agg.fieldId === "*"
        ? "*"
        : fields().find((f) => f.id === agg.fieldId)?.name ?? "?";
    return `${agg.agg}(${fieldName})`;
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ti ti-number text-sm shrink-0 text-dimmed" />
          <span class="text-sm font-medium truncate">
            {props.widget.title || "(untitled)"}
          </span>
          <span class="text-[10px] text-dimmed shrink-0">{summary()}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={props.canRemove}>
            <button
              type="button"
              class="text-dimmed hover:text-primary p-1"
              onClick={(e) => {
                e.stopPropagation();
                props.onRemove();
              }}
              title="Delete cell"
            >
              <i class="ti ti-trash text-xs" />
            </button>
          </Show>
          <i
            class={`ti ti-chevron-down text-xs text-dimmed transition-transform ${
              props.isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      <Show when={props.isExpanded}>
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="Title"
              value={() => props.widget.title ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, title: v || undefined })
              }
            />
            <TextInput
              label="Sub-line (optional)"
              value={() => props.widget.sub ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, sub: v || undefined })
              }
              placeholder="e.g. last 24h"
            />
            <Select
              label="Source table"
              value={() => props.widget.source.tableId}
              onChange={(v) =>
                props.onUpdate({
                  ...props.widget,
                  source: {
                    ...props.widget.source,
                    tableId: v,
                    aggregations: [DEFAULT_AGG],
                  },
                })
              }
              options={props.tables.map((t) => ({ id: t.id, label: t.name }))}
            />
            <Select
              label="Aggregation"
              value={() => props.widget.source.aggregations[0]?.agg ?? "count"}
              onChange={(v) => updateAgg({ agg: v as AggregationSpec["agg"] })}
              options={AGG_OPTIONS}
            />
            <Select
              label="Field"
              value={() => props.widget.source.aggregations[0]?.fieldId ?? "*"}
              onChange={(v) => updateAgg({ fieldId: v })}
              options={[
                { id: "*", label: "* (records)" },
                ...fields().map((f) => ({ id: f.id, label: f.name })),
              ]}
            />
            <Select
              label="Format"
              value={() => props.widget.format ?? "plain"}
              onChange={(v) =>
                props.onUpdate({
                  ...props.widget,
                  format: v as "plain" | "currency" | "percent" | "integer",
                })
              }
              options={FORMAT_OPTIONS}
            />
            <SelectInput
              label="Icon"
              value={() => props.widget.icon ?? ""}
              onChange={(v) =>
                props.onUpdate({ ...props.widget, icon: v || undefined })
              }
              placeholder="Pick an icon…"
              options={icons.ICON_OPTIONS}
              clearable
              icon="ti ti-icons"
            />
            <div class="md:col-span-2 text-[11px] text-dimmed">
              Preview:{" "}
              <code class="font-mono">
                {formatWidgetValue(0, props.widget.format)}
              </code>{" "}
              (style only — real value resolves at render time)
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// =============================================================================
// View-stats row card — only a view-picker, zero per-cell config.
// Cells get auto-derived from the view at render time; the editor's
// only job is choosing the source view + an optional title override.
// =============================================================================

function ViewStatsRowCard(props: {
  row: ViewStatsRowType;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
  onUpdate: (row: ViewStatsRowType) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
}) {
  const allViews = createMemo(() => {
    const flat: { view: View; tableName: string }[] = [];
    for (const t of props.tables) {
      for (const v of props.viewsByTable[t.id] ?? []) {
        flat.push({ view: v, tableName: t.name });
      }
    }
    flat.sort((a, b) =>
      a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }),
    );
    return flat;
  });

  const summary = () => {
    const v = allViews().find((x) => x.view.id === props.row.viewId);
    return v ? `view · ${v.tableName} · ${v.view.name}` : "(pick a view)";
  };

  return (
    <div class="paper p-3 flex flex-col gap-3">
      <RowHeader
        kindLabel="View stats row"
        kindIcon="ti ti-table-spark"
        rowIdx={props.rowIdx}
        rowCount={props.rowCount}
        onMoveRow={props.onMoveRow}
        onRemoveRow={props.onRemoveRow}
      />

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <TextInput
          label="Title (optional override)"
          value={() => props.row.title ?? ""}
          onInput={(v) =>
            props.onUpdate({ ...props.row, title: v || undefined })
          }
          placeholder="Defaults to the view's name"
        />
        <Select
          label="View"
          value={() => props.row.viewId}
          onChange={(v) => props.onUpdate({ ...props.row, viewId: v })}
          options={[
            { id: "", label: "(pick a view)" },
            ...allViews().map(({ view, tableName }) => ({
              id: view.id,
              label: `${tableName} · ${view.name}`,
            })),
          ]}
        />
        <div class="md:col-span-2 text-[11px] text-dimmed">
          Cells are derived from the view automatically. Ungrouped views
          render the first record's columns; grouped views render the
          first bucket's aggregations. Need per-cell control? Use a
          regular Stats row instead.
          <Show when={summary()}>
            <span class="block mt-1 text-dimmed">→ {summary()}</span>
          </Show>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// View cell editor
// =============================================================================

function ViewCellEditor(props: {
  widget: ViewWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: ViewWidget) => void;
  onRemove: () => void;
  viewsByTable: Record<string, View[]>;
  tables: Array<{ id: string; name: string; slug: string }>;
}) {
  const allViews = createMemo(() => {
    const flat: { view: View; tableName: string }[] = [];
    for (const t of props.tables) {
      for (const v of props.viewsByTable[t.id] ?? []) {
        flat.push({ view: v, tableName: t.name });
      }
    }
    flat.sort((a, b) =>
      a.view.name.localeCompare(b.view.name, undefined, { sensitivity: "base" }),
    );
    return flat;
  });

  const summary = () => {
    const src = props.widget.source;
    if (src.kind === "table") {
      const t = props.tables.find((x) => x.id === src.tableId);
      return t ? `table · ${t.name}` : "(pick a table)";
    }
    const v = allViews().find((x) => x.view.id === src.viewId);
    return v ? `view · ${v.tableName} · ${v.view.name}` : "(pick a view)";
  };

  // Toggle source kind without losing the title or id. When switching,
  // we reset the inner ref since `viewId` and `tableId` aren't
  // interchangeable.
  const setSourceKind = (kind: "view" | "table") => {
    if (props.widget.source.kind === kind) return;
    props.onUpdate({
      ...props.widget,
      source:
        kind === "view"
          ? { kind: "view", viewId: "" }
          : { kind: "table", tableId: props.tables[0]?.id ?? "" },
    });
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ti ti-table-spark text-sm shrink-0 text-dimmed" />
          <span class="text-sm font-medium truncate">
            {props.widget.title || "(untitled)"}
          </span>
          <span class="text-[10px] text-dimmed shrink-0 truncate">
            {summary()}
          </span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Show when={props.canRemove}>
            <button
              type="button"
              class="text-dimmed hover:text-primary p-1"
              onClick={(e) => {
                e.stopPropagation();
                props.onRemove();
              }}
              title="Delete cell"
            >
              <i class="ti ti-trash text-xs" />
            </button>
          </Show>
          <i
            class={`ti ti-chevron-down text-xs text-dimmed transition-transform ${
              props.isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      <Show when={props.isExpanded}>
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2 flex flex-col gap-2">
          {/* Source-kind toggle. Plain segmented buttons rather than a
              Select — only two options, the visual choice itself
              communicates the binary. */}
          <div class="flex items-center gap-2 text-[11px]">
            <span class="text-dimmed">Source:</span>
            <button
              type="button"
              class={`px-2 py-0.5 rounded ${
                props.widget.source.kind === "view"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-zinc-100 text-dimmed hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              }`}
              onClick={() => setSourceKind("view")}
            >
              Saved view
            </button>
            <button
              type="button"
              class={`px-2 py-0.5 rounded ${
                props.widget.source.kind === "table"
                  ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                  : "bg-zinc-100 text-dimmed hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
              }`}
              onClick={() => setSourceKind("table")}
            >
              Table
            </button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="Title (optional override)"
              value={() => props.widget.title ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, title: v || undefined })
              }
              placeholder={
                props.widget.source.kind === "view"
                  ? "Defaults to the view's name"
                  : "Defaults to the table's name"
              }
            />
            <Show
              when={props.widget.source.kind === "view"}
              fallback={
                <Select
                  label="Table"
                  value={() =>
                    props.widget.source.kind === "table"
                      ? props.widget.source.tableId
                      : ""
                  }
                  onChange={(v) =>
                    props.onUpdate({
                      ...props.widget,
                      source: { kind: "table", tableId: v },
                    })
                  }
                  options={[
                    { id: "", label: "(pick a table)" },
                    ...props.tables.map((t) => ({ id: t.id, label: t.name })),
                  ]}
                />
              }
            >
              <Select
                label="View"
                value={() =>
                  props.widget.source.kind === "view"
                    ? props.widget.source.viewId
                    : ""
                }
                onChange={(v) =>
                  props.onUpdate({
                    ...props.widget,
                    source: { kind: "view", viewId: v },
                  })
                }
                options={[
                  { id: "", label: "(pick a view)" },
                  ...allViews().map(({ view, tableName }) => ({
                    id: view.id,
                    label: `${tableName} · ${view.name}`,
                  })),
                ]}
              />
            </Show>
            <div class="md:col-span-2 text-[11px] text-dimmed">
              {props.widget.source.kind === "view"
                ? 'Embedded views show 25 records with the saved view\'s filter and sort plus an "Open full view →" link to the records page.'
                : "Raw-table source shows the latest 25 records, no filter applied. Save a view if you need filtering."}
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// =============================================================================
// Permissions
// =============================================================================

function DashboardPermissions(props: {
  dashboardId: string;
  initialEntries: AccessEntry[];
  canEdit: boolean;
}) {
  const grantAccess = async (
    principal: Principal,
    permission: Exclude<PermissionLevel, "none">,
  ): Promise<AccessEntry> => {
    const res = await apiClient.access["by-dashboard"][":dashboardId"].$post({
      param: { dashboardId: props.dashboardId },
      json: { principal, permission },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
    const created = (await res.json()) as { accessId: string };
    // Round-trip the access entry from the list endpoint so the editor
    // gets a fully populated row (display name etc.) — POST returns
    // only the id.
    const listRes = await apiClient.access["by-dashboard"][":dashboardId"].$get({
      param: { dashboardId: props.dashboardId },
    });
    if (!listRes.ok) throw new Error(await errorMessage(listRes, "Failed to refresh access"));
    const entries = (await listRes.json()) as AccessEntry[];
    const entry = entries.find((e) => e.id === created.accessId);
    if (!entry) throw new Error("granted access entry vanished");
    return entry;
  };

  const updateAccess = async (
    accessId: string,
    permission: Exclude<PermissionLevel, "none">,
  ): Promise<void> => {
    const res = await apiClient.access[":accessId"].$patch({
      param: { accessId },
      json: { permission },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to update access"));
  };

  const revokeAccess = async (accessId: string): Promise<void> => {
    const res = await apiClient.access[":accessId"].$delete({
      param: { accessId },
    });
    if (!res.ok) throw new Error(await errorMessage(res, "Failed to revoke access"));
  };

  return (
    <PermissionEditor
      initialEntries={props.initialEntries}
      allowedLevels={["read"]}
      grantAccess={grantAccess}
      updateAccess={updateAccess}
      revokeAccess={revokeAccess}
      canEdit={props.canEdit}
    />
  );
}

// =============================================================================
// Delete button
// =============================================================================

function DeleteButton(props: { dashboardId: string; baseSlug: string; name: string }) {
  const mut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.dashboards[":dashboardId"].$delete({
        param: { dashboardId: props.dashboardId },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete dashboard"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.baseSlug}`),
    onError: (e) => prompts.error(e.message),
  });

  const onClick = async () => {
    if (
      !(await prompts.confirm(
        `Delete the "${props.name}" dashboard? Restorable from base settings (admin).`,
      ))
    ) {
      return;
    }
    mut.mutate(undefined);
  };

  return (
    <button
      type="button"
      class="btn-danger btn-sm"
      onClick={onClick}
      disabled={mut.loading()}
    >
      {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
      Delete dashboard
    </button>
  );
}
