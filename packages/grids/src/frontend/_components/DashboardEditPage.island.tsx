import type { AccessEntry, Principal, PermissionLevel } from "@valentinkolb/cloud/contracts/shared";
import {
  IconInput,
  navigateTo,
  PermissionEditor,
  prompts,
  Select,
  TextInput,
} from "@valentinkolb/cloud/ui";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createMemo, createSignal, Index, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type {
  ChartWidget,
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
import type { AggregationSpec, GroupBySpec } from "../../contracts";
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
  baseShortId: string;
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

/** Seed for a fresh chart widget. Bar + COUNT(*) is the safest
 *  default — works on any table, no field required, produces a
 *  visible chart the moment a groupBy field is picked. The empty
 *  groupBy array intentionally renders an empty-state chart so the
 *  user is nudged to configure one. */
const defaultChartWidget = (tableId: string): ChartWidget => ({
  id: newId("w"),
  kind: "chart",
  chartType: "bar",
  title: "New chart",
  source: { tableId, aggregations: [DEFAULT_AGG] },
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
              href={`/app/grids/${props.baseShortId}/settings`}
              class="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50"
              title="This dashboard opens when no specific table or dashboard is set in the URL"
            >
              base default
            </a>
          </Show>
        </div>
        <a
          href={`/app/grids/${props.baseShortId}?dashboard=${props.initialDashboard.shortId}`}
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
          baseShortId={props.baseShortId}
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
        {/* Index (not For) — keys by position. updateRow replaces the
            row object at index `rowIdx`, which a reference-keyed For
            interprets as "row replaced", remounting the row card and
            stealing focus from any input the user is typing in. Index
            keeps the row card mounted; only the bound `row()` accessor
            updates. JSX prop bindings (`row={row()}`) stay reactive
            via Solid's compiled getter wrappers, so child components
            still see the current row value through `props.row`. The
            kind discriminant is stable in practice (you don't change
            a stats row to a view-stats row), so the Switch/Match
            doesn't churn on edits. */}
        <Index each={props.config().rows}>
          {(row, rowIdx) => {
            const kind = () => row().kind;
            return (
              <>
                <Show when={kind() === "stats"}>
                  <StatsRowCard
                    row={row() as import("../../service").StatsRow}
                    rowIdx={rowIdx}
                    rowCount={props.config().rows.length}
                    tables={props.tables}
                    fieldsByTable={props.fieldsByTable}
                    expandedCellId={expandedCellId}
                    toggleCell={toggleCell}
                    onUpdate={(next) => updateRow(rowIdx, next)}
                    onMoveRow={(dir) => moveRow(rowIdx, dir)}
                    onRemoveRow={() => removeRow(rowIdx)}
                  />
                </Show>
                <Show when={kind() === "view-stats"}>
                  <ViewStatsRowCard
                    row={row() as import("../../service").ViewStatsRow}
                    rowIdx={rowIdx}
                    rowCount={props.config().rows.length}
                    tables={props.tables}
                    viewsByTable={props.viewsByTable}
                    onUpdate={(next) => updateRow(rowIdx, next)}
                    onMoveRow={(dir) => moveRow(rowIdx, dir)}
                    onRemoveRow={() => removeRow(rowIdx)}
                  />
                </Show>
                <Show when={kind() === "widgets"}>
                  <WidgetsRowCard
                    row={row() as import("../../service").WidgetsRow}
                    rowIdx={rowIdx}
                    rowCount={props.config().rows.length}
                    tables={props.tables}
                    viewsByTable={props.viewsByTable}
                    fieldsByTable={props.fieldsByTable}
                    expandedCellId={expandedCellId}
                    toggleCell={toggleCell}
                    onUpdate={(next) => updateRow(rowIdx, next)}
                    onMoveRow={(dir) => moveRow(rowIdx, dir)}
                    onRemoveRow={() => removeRow(rowIdx)}
                  />
                </Show>
              </>
            );
          }}
        </Index>
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
        {/* Index — same focus-loss-prevention story as the outer rows
            loop: typing in StatCellEditor's title/sub TextInput would
            otherwise replace the cell object in row.cells, which a
            ref-keyed For would interpret as "cell replaced" → remount
            → focus lost. */}
        <Index each={props.row.cells}>
          {(cell, cellIdx) => (
            <StatCellEditor
              widget={cell()}
              isExpanded={props.expandedCellId() === cell().id}
              canRemove={props.row.cells.length > 1}
              onToggle={() => props.toggleCell(cell().id)}
              onUpdate={(w) => updateCell(cellIdx, w)}
              onRemove={() => removeCell(cellIdx)}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
            />
          )}
        </Index>
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
  fieldsByTable: Record<string, Field[]>;
  /** Hoisted expansion state — see StatsRowCard for the rationale. */
  expandedCellId: () => string | null;
  toggleCell: (id: string) => void;
  onUpdate: (row: WidgetsRowType) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
}) {
  // Widgets-row cells are a `view | chart` union — both routed through
  // a single onUpdate callback. The cell index is the position; we
  // splice in the new widget without touching siblings to keep the
  // For/Index reconciler stable.
  const updateCell = (cellIdx: number, widget: ViewWidget | ChartWidget) => {
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.map((c, i) => (i === cellIdx ? widget : c)),
    });
  };

  const addView = () => {
    if (props.row.cells.length >= 4) return;
    props.onUpdate({
      ...props.row,
      cells: [...props.row.cells, defaultViewWidget()],
    });
  };

  const addChart = () => {
    if (props.row.cells.length >= 4) return;
    const tableId = props.tables[0]?.id ?? "";
    props.onUpdate({
      ...props.row,
      cells: [...props.row.cells, defaultChartWidget(tableId)],
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
        kindLabel="Widget row"
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
        {/* Index — same rationale as StatsRowCard's cells loop. The
            cell-kind switch picks the matching editor; both update
            paths flow through the same `updateCell` so the parent
            row only sees one source of truth. */}
        <Index each={props.row.cells}>
          {(cell, cellIdx) => (
            <Show
              when={cell().kind === "view"}
              fallback={
                <ChartCellEditor
                  widget={cell() as ChartWidget}
                  isExpanded={props.expandedCellId() === cell().id}
                  canRemove={props.row.cells.length > 1}
                  onToggle={() => props.toggleCell(cell().id)}
                  onUpdate={(w) => updateCell(cellIdx, w)}
                  onRemove={() => removeCell(cellIdx)}
                  tables={props.tables}
                  fieldsByTable={props.fieldsByTable}
                />
              }
            >
              <ViewCellEditor
                widget={cell() as ViewWidget}
                isExpanded={props.expandedCellId() === cell().id}
                canRemove={props.row.cells.length > 1}
                onToggle={() => props.toggleCell(cell().id)}
                onUpdate={(w) => updateCell(cellIdx, w)}
                onRemove={() => removeCell(cellIdx)}
                viewsByTable={props.viewsByTable}
                tables={props.tables}
              />
            </Show>
          )}
        </Index>
      </div>

      <Show when={props.row.cells.length < 4}>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={addView}
          >
            <i class="ti ti-table-spark" /> Add view
          </button>
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={addChart}
          >
            <i class="ti ti-chart-bar" /> Add chart
          </button>
        </div>
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
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col overflow-hidden">
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
            <IconInput
              label="Icon"
              value={() => props.widget.icon ?? ""}
              onChange={(v) =>
                props.onUpdate({ ...props.widget, icon: v || undefined })
              }
              placeholder="Search icons…"
            />
            <div class="md:col-span-2 text-[11px] text-dimmed">
              Preview:{" "}
              <code class="font-mono">
                {formatWidgetValue(0, props.widget.format)}
              </code>{" "}
              (style only — real value resolves at render time)
            </div>
          </div>

          {/* ── Trend (optional inline sparkline) ──────────────────
              Configured separately from the main stat: same agg +
              filter, but bucketed by a date field at a chosen
              granularity. The resolver runs the extra group() query
              in parallel and feeds the result through to the cell's
              `trend` prop. Hidden when the source table has no date
              fields — there's nothing sensible to bucket on. */}
          <StatTrendSection
            widget={props.widget}
            fields={fields()}
            onUpdate={props.onUpdate}
          />
        </div>
      </Show>
    </div>
  );
}

/**
 * Trend sub-section inside `StatCellEditor`. Toggleable: when off,
 * `source.trend` is undefined (no extra resolver work, no sparkline);
 * when on, the user picks a date field, granularity, and window size.
 *
 * Hidden entirely when the source table has zero date fields — the
 * feature is meaningless without one, and showing a dead checkbox
 * confuses more than it helps.
 */
function StatTrendSection(props: {
  widget: StatWidget;
  fields: Field[];
  onUpdate: (w: StatWidget) => void;
}) {
  const dateFields = () => props.fields.filter((f) => f.type === "date");
  const trend = () => props.widget.source.trend;

  const enable = () => {
    const firstDateField = dateFields()[0];
    if (!firstDateField) return;
    props.onUpdate({
      ...props.widget,
      source: {
        ...props.widget.source,
        trend: {
          fieldId: firstDateField.id,
          granularity: "month",
          windowSize: 12,
        },
      },
    });
  };

  const disable = () => {
    const { trend: _drop, ...rest } = props.widget.source;
    props.onUpdate({ ...props.widget, source: rest });
  };

  const patchTrend = (patch: Partial<NonNullable<StatWidget["source"]["trend"]>>) => {
    const current = trend();
    if (!current) return;
    props.onUpdate({
      ...props.widget,
      source: { ...props.widget.source, trend: { ...current, ...patch } },
    });
  };

  return (
    <Show
      when={dateFields().length > 0}
      fallback={
        <div class="text-[11px] text-dimmed italic">
          Inline trend sparkline needs a date field on the source table.
        </div>
      }
    >
      <div class="flex flex-col gap-2 border-t border-zinc-200 dark:border-zinc-700/50 pt-2">
        <div class="flex items-center justify-between">
          <span class="text-[11px] uppercase tracking-wider text-dimmed">
            Inline trend
          </span>
          <Show
            when={trend()}
            fallback={
              <button
                type="button"
                class="btn-input btn-sm"
                onClick={enable}
              >
                <i class="ti ti-plus" /> Add trend
              </button>
            }
          >
            <button
              type="button"
              class="text-[11px] text-dimmed hover:text-red-600 dark:hover:text-red-400"
              onClick={disable}
            >
              Remove
            </button>
          </Show>
        </div>
        <Show when={trend()}>
          {(t) => (
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              <Select
                label="Date field"
                value={() => t().fieldId}
                onChange={(v) => patchTrend({ fieldId: v })}
                options={dateFields().map((f) => ({ id: f.id, label: f.name }))}
              />
              <Select
                label="Bucket by"
                value={() => t().granularity}
                onChange={(v) =>
                  patchTrend({
                    granularity: v as NonNullable<StatWidget["source"]["trend"]>["granularity"],
                  })
                }
                options={[
                  { id: "day", label: "Day" },
                  { id: "week", label: "Week" },
                  { id: "month", label: "Month" },
                  { id: "quarter", label: "Quarter" },
                  { id: "year", label: "Year" },
                ]}
              />
              <Select
                label="Window size"
                value={() => String(t().windowSize)}
                onChange={(v) => patchTrend({ windowSize: Number(v) })}
                options={[6, 8, 12, 24, 30].map((n) => ({
                  id: String(n),
                  label: `Last ${n}`,
                }))}
              />
            </div>
          )}
        </Show>
      </div>
    </Show>
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
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col overflow-hidden">
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
// Chart cell editor — inline expandable, configures a single ChartWidget.
//
// Chart sources are richer than stat sources (multiple aggregations,
// an optional groupBy with date-granularity, axis labels) so the
// editor has more knobs than StatCellEditor — but the visual rhythm
// matches: title row + chevron-collapse, expanded body uses the same
// 2-column grid for inputs.
// =============================================================================

const CHART_TYPE_OPTIONS: { id: ChartWidget["chartType"]; label: string; icon: string }[] = [
  { id: "donut", label: "Donut", icon: "ti ti-chart-donut-4" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "scatter", label: "Scatter", icon: "ti ti-chart-dots" },
];

/** Hint shown under the chartType picker — documents the source-shape
 *  contract so the user knows what to configure (e.g. scatter needs
 *  ≥2 aggs). Mirrors the ChartWidgetSchema JSDoc in contracts.ts. */
const CHART_TYPE_HINTS: Record<ChartWidget["chartType"], string> = {
  donut: "1 group-by → slice label, first aggregation → slice value.",
  bar: "1 group-by → bar label, first aggregation → bar value.",
  line: "1 group-by → x-axis, each aggregation → 1 line series.",
  scatter: "1 group-by → buckets, agg 1 = x, agg 2 = y, agg 3 = bubble size.",
};

const GRANULARITY_OPTIONS = [
  { id: "", label: "(none — bucket per value)" },
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "quarter", label: "Quarter" },
  { id: "year", label: "Year" },
];

function ChartCellEditor(props: {
  widget: ChartWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: ChartWidget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
}) {
  const tableFields = () =>
    (props.fieldsByTable[props.widget.source.tableId] ?? []).filter((f) => !f.deletedAt);

  const groupBy = () => props.widget.source.groupBy?.[0];

  /** True when the configured groupBy targets a date field — used to
   *  gate the granularity picker (no point asking for "month"
   *  bucketing on a text field). */
  const isDateGroupBy = () => {
    const g = groupBy();
    if (!g) return false;
    return tableFields().find((f) => f.id === g.fieldId)?.type === "date";
  };

  const summary = () => {
    const t = props.tables.find((x) => x.id === props.widget.source.tableId)?.name ?? "?";
    return `${props.widget.chartType} · ${t}`;
  };

  // ── Source patches ────────────────────────────────────────────────
  const patchSource = (patch: Partial<typeof props.widget.source>) => {
    props.onUpdate({
      ...props.widget,
      source: { ...props.widget.source, ...patch },
    });
  };

  const setTableId = (tableId: string) => {
    // Field IDs are scoped to a table, so switching tables invalidates
    // every fieldId reference. Reset groupBy + aggregations to the
    // safe defaults — the user picks new ones from the new table's
    // fields. Keep `chartType` and title since those are table-agnostic.
    props.onUpdate({
      ...props.widget,
      source: {
        tableId,
        aggregations: [DEFAULT_AGG],
        groupBy: undefined,
      },
    });
  };

  const setGroupByField = (fieldId: string) => {
    if (!fieldId) {
      patchSource({ groupBy: undefined });
      return;
    }
    const current = groupBy();
    // Preserve existing granularity when the new field is still a
    // date; otherwise drop it (granularity is meaningless on non-date
    // fields and the group-compiler would refuse it).
    const newField = tableFields().find((f) => f.id === fieldId);
    const keepGranularity =
      newField?.type === "date" ? current?.granularity : undefined;
    const next: GroupBySpec = { fieldId, granularity: keepGranularity };
    patchSource({ groupBy: [next] });
  };

  const setGranularity = (g: string) => {
    const current = groupBy();
    if (!current) return;
    const granularity = g === "" ? undefined : (g as GroupBySpec["granularity"]);
    patchSource({ groupBy: [{ ...current, granularity }] });
  };

  // ── Aggregation patches ───────────────────────────────────────────
  const updateAgg = (idx: number, patch: Partial<AggregationSpec>) => {
    patchSource({
      aggregations: props.widget.source.aggregations.map((a, i) =>
        i === idx ? { ...a, ...patch } : a,
      ),
    });
  };

  const addAgg = () => {
    patchSource({
      aggregations: [...props.widget.source.aggregations, DEFAULT_AGG],
    });
  };

  const removeAgg = (idx: number) => {
    // The schema requires ≥1 aggregation; the editor enforces that
    // here so we can't dispatch an invalid save.
    if (props.widget.source.aggregations.length <= 1) return;
    patchSource({
      aggregations: props.widget.source.aggregations.filter((_, i) => i !== idx),
    });
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col overflow-hidden">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ti ti-chart-bar text-sm shrink-0 text-dimmed" />
          <span class="text-sm font-medium truncate">
            {props.widget.title || "(untitled)"}
          </span>
          <span class="text-[10px] text-dimmed shrink-0 truncate">{summary()}</span>
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
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2 flex flex-col gap-3">
          {/* ── Chart kind picker ─────────────────────────────────
              Segmented buttons (one per chartType) instead of a Select
              — only 4 options and the icons disambiguate the choice
              at a glance. */}
          <div class="flex flex-col gap-1">
            <span class="text-[11px] text-dimmed">Chart type</span>
            <div class="flex flex-wrap items-center gap-1">
              {CHART_TYPE_OPTIONS.map((opt) => (
                <button
                  type="button"
                  class={`px-2 py-1 rounded text-[11px] inline-flex items-center gap-1.5 ${
                    props.widget.chartType === opt.id
                      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300"
                      : "bg-zinc-100 text-dimmed hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700"
                  }`}
                  onClick={() =>
                    props.onUpdate({ ...props.widget, chartType: opt.id })
                  }
                >
                  <i class={opt.icon} />
                  {opt.label}
                </button>
              ))}
            </div>
            <span class="text-[11px] text-dimmed italic">
              {CHART_TYPE_HINTS[props.widget.chartType]}
            </span>
          </div>

          {/* ── Title / subtitle / source table ─────────────────── */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="Title"
              value={() => props.widget.title ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, title: v || undefined })
              }
              placeholder="e.g. Revenue by quarter"
            />
            <TextInput
              label="Subtitle (optional)"
              value={() => props.widget.subtitle ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, subtitle: v || undefined })
              }
              placeholder="e.g. last 12 months"
            />
            <Select
              label="Source table"
              value={() => props.widget.source.tableId}
              onChange={setTableId}
              options={props.tables.map((t) => ({ id: t.id, label: t.name }))}
            />
            <Select
              label="Y-axis format"
              value={() => props.widget.format ?? "plain"}
              onChange={(v) =>
                props.onUpdate({
                  ...props.widget,
                  format: v as "plain" | "currency" | "percent" | "integer",
                })
              }
              options={FORMAT_OPTIONS}
            />
          </div>

          {/* ── Group by + granularity ──────────────────────────────
              Single groupBy in v1 — the schema supports up to 3 but
              none of the chartTypes use the extras yet. Keeping the
              editor minimal until a real use case appears. */}
          <div class="flex flex-col gap-1">
            <span class="text-[11px] text-dimmed">Group by</span>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
              <Select
                label="Field"
                value={() => groupBy()?.fieldId ?? ""}
                onChange={setGroupByField}
                options={[
                  { id: "", label: "(none)" },
                  ...tableFields().map((f) => ({ id: f.id, label: f.name })),
                ]}
              />
              <Show when={isDateGroupBy()}>
                <Select
                  label="Granularity"
                  value={() => groupBy()?.granularity ?? ""}
                  onChange={setGranularity}
                  options={GRANULARITY_OPTIONS}
                />
              </Show>
            </div>
          </div>

          {/* ── Aggregations list ──────────────────────────────────
              One row per agg with agg-kind + field picker. Donut/bar
              only read the first; line emits one series per agg;
              scatter needs ≥2 (the hint above tells the user). Add/
              remove keep schema's ≥1 constraint enforced. */}
          <div class="flex flex-col gap-1">
            <span class="text-[11px] text-dimmed">Aggregations</span>
            <div class="flex flex-col gap-1.5">
              <Index each={props.widget.source.aggregations}>
                {(agg, idx) => (
                  <div class="flex items-center gap-2 text-xs">
                    <Select
                      value={() => agg().agg}
                      onChange={(v) =>
                        updateAgg(idx, { agg: v as AggregationSpec["agg"] })
                      }
                      options={AGG_OPTIONS}
                    />
                    <Select
                      value={() => agg().fieldId}
                      onChange={(v) => updateAgg(idx, { fieldId: v })}
                      options={[
                        { id: "*", label: "* (records)" },
                        ...tableFields().map((f) => ({ id: f.id, label: f.name })),
                      ]}
                    />
                    <Show when={props.widget.source.aggregations.length > 1}>
                      <button
                        type="button"
                        class="text-dimmed hover:text-red-600 dark:hover:text-red-400 p-1"
                        onClick={() => removeAgg(idx)}
                        title="Remove aggregation"
                      >
                        <i class="ti ti-x text-xs" />
                      </button>
                    </Show>
                  </div>
                )}
              </Index>
              <button
                type="button"
                class="btn-input btn-sm self-start mt-1"
                onClick={addAgg}
              >
                <i class="ti ti-plus" /> Add aggregation
              </button>
            </div>
          </div>

          {/* ── Axis labels (optional override) ─────────────────── */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="X-axis label (optional)"
              value={() => props.widget.xAxisLabel ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, xAxisLabel: v || undefined })
              }
              placeholder={groupBy() ? "Inferred from group-by field" : ""}
            />
            <TextInput
              label="Y-axis label (optional)"
              value={() => props.widget.yAxisLabel ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, yAxisLabel: v || undefined })
              }
            />
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

function DeleteButton(props: { dashboardId: string; baseShortId: string; name: string }) {
  const mut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.dashboards[":dashboardId"].$delete({
        param: { dashboardId: props.dashboardId },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete dashboard"));
    },
    onSuccess: () => navigateTo(`/app/grids/${props.baseShortId}`),
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
      // `self-start` keeps the button auto-width inside the SectionCard's
      // flex-col stretch — without it the button fills the full row
      // width which makes a destructive primary look like a banner.
      // Mirrors the other danger-zone buttons (table / view / base).
      class="btn-danger btn-sm self-start"
      onClick={onClick}
      disabled={mut.loading()}
    >
      {mut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : <i class="ti ti-trash" />}
      Delete dashboard
    </button>
  );
}
