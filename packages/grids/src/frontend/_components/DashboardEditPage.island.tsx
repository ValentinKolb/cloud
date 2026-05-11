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
import { createMemo, createSignal, For, Index, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type {
  ChartWidget,
  Dashboard,
  DashboardConfig,
  DashboardRow,
  Field,
  Form,
  FormWidget,
  StatWidget,
  View,
  ViewStatsWidget,
  ViewWidget,
  Widget,
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
  formsByTable: Record<string, Form[]>;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
};

const DEFAULT_AGG: AggregationSpec = { fieldId: "*", agg: "count" };

const newId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().slice(0, 8)}`;

// ── Cell factories ────────────────────────────────────────────────
// Each cell-kind has its own factory. The "Add cell" dropdown picks
// the matching one and pushes a fresh cell into the row.

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

/** Seed for a fresh chart widget. Bar chart, no view picked yet —
 *  the user fills in the viewId via the editor; before then the
 *  renderer shows an empty-state. */
const defaultChartWidget = (): ChartWidget => ({
  id: newId("w"),
  kind: "chart",
  chartType: "bar",
  title: "New chart",
  viewId: "",
});

const defaultViewStatsWidget = (): ViewStatsWidget => ({
  id: newId("w"),
  kind: "view-stats",
  viewId: "",
});

const defaultFormWidget = (): FormWidget => ({
  id: newId("w"),
  kind: "form",
  formId: "",
});

// ── Row factory ───────────────────────────────────────────────────
// One row type for everything. The cells array is the only thing
// that varies; "Add row" creates a row with a default-stat cell so
// the user immediately sees content to configure.

const defaultRow = (tableId: string): DashboardRow => ({
  id: newId("r"),
  kind: "row",
  height: "md",
  cells: [defaultStatWidget(tableId)],
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
        subtitle="One row, any mix of cells: stats / views / charts / view-stats / forms. All-stat rows auto-render as one hairline paper; mixed rows get one paper-card per cell."
      >
        <LayoutEditor
          config={config}
          setConfig={setConfig}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
          viewsByTable={props.viewsByTable}
          formsByTable={props.formsByTable}
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
  formsByTable: Record<string, Form[]>;
}) {
  // Single source of truth for which cell editor is expanded across
  // all rows — keyed by stable widget.id. Avoids the row-remount
  // focus loss a per-row local signal would cause.
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

  const addRow = () => {
    const tableId = props.tables[0]?.id ?? "";
    props.setConfig({
      ...props.config(),
      rows: [...props.config().rows, defaultRow(tableId)],
    });
  };

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={props.config().rows.length > 0}
        fallback={
          <div class="info-block-info text-xs text-center py-4">
            No rows yet. Add a row to get started.
          </div>
        }
      >
        {/* Index (not For) — keys by position so updateRow's row-object
            replacement doesn't remount the row card and steal focus
            from an open inline input. */}
        <Index each={props.config().rows}>
          {(row, rowIdx) => (
            <RowCard
              row={row()}
              rowIdx={rowIdx}
              rowCount={props.config().rows.length}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
              viewsByTable={props.viewsByTable}
              formsByTable={props.formsByTable}
              expandedCellId={expandedCellId}
              toggleCell={toggleCell}
              onUpdate={(next) => updateRow(rowIdx, next)}
              onMoveRow={(dir) => moveRow(rowIdx, dir)}
              onRemoveRow={() => removeRow(rowIdx)}
            />
          )}
        </Index>
      </Show>
      <div class="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          class="btn-input btn-sm"
          onClick={addRow}
          disabled={props.tables.length === 0}
        >
          <i class="ti ti-plus" /> Add row
        </button>
      </div>
    </div>
  );
}

// =============================================================================
// Row card — one editor for the unified row. Dispatches cell editors
// by kind; "Add cell" button cycles through the five available kinds.
// =============================================================================

const HEIGHT_OPTIONS = [
  { id: "sm", label: "Small (96px)" },
  { id: "md", label: "Medium (192px)" },
  { id: "lg", label: "Large (360px)" },
];

/** Cell-kind picker for the "Add cell" dropdown. Each entry maps to
 *  its factory; the button picks the first non-disabled one. We use
 *  segmented buttons (visible at a glance) rather than a Select. */
const CELL_KIND_OPTIONS: Array<{
  id: Widget["kind"];
  label: string;
  icon: string;
}> = [
  { id: "stat", label: "Stat", icon: "ti ti-number" },
  { id: "view", label: "View", icon: "ti ti-table-spark" },
  { id: "chart", label: "Chart", icon: "ti ti-chart-bar" },
  { id: "view-stats", label: "View stats", icon: "ti ti-layout-2" },
  { id: "form", label: "Form", icon: "ti ti-forms" },
];

function RowCard(props: {
  row: DashboardRow;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  expandedCellId: () => string | null;
  toggleCell: (id: string) => void;
  onUpdate: (row: DashboardRow) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
}) {
  const updateCell = (cellIdx: number, widget: Widget) => {
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.map((c, i) => (i === cellIdx ? widget : c)),
    });
  };

  const removeCell = (cellIdx: number) => {
    if (props.row.cells.length <= 1) return; // keep at least one
    props.onUpdate({
      ...props.row,
      cells: props.row.cells.filter((_, i) => i !== cellIdx),
    });
  };

  const addCell = (kind: Widget["kind"]) => {
    if (props.row.cells.length >= 4) return;
    const tableId = props.tables[0]?.id ?? "";
    let cell: Widget;
    switch (kind) {
      case "stat":
        cell = defaultStatWidget(tableId);
        break;
      case "view":
        cell = defaultViewWidget();
        break;
      case "chart":
        cell = defaultChartWidget();
        break;
      case "view-stats":
        cell = defaultViewStatsWidget();
        break;
      case "form":
        cell = defaultFormWidget();
        break;
    }
    props.onUpdate({ ...props.row, cells: [...props.row.cells, cell] });
  };

  return (
    <div class="paper p-3 flex flex-col gap-3">
      <RowHeader
        kindLabel="Row"
        kindIcon="ti ti-layout-rows"
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
        {/* Index keys cells by position so per-keystroke updates don't
            remount the cell editor and steal focus. */}
        <Index each={props.row.cells}>
          {(cell, cellIdx) => (
            <CellEditor
              widget={cell()}
              isExpanded={props.expandedCellId() === cell().id}
              canRemove={props.row.cells.length > 1}
              onToggle={() => props.toggleCell(cell().id)}
              onUpdate={(w) => updateCell(cellIdx, w)}
              onRemove={() => removeCell(cellIdx)}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
              viewsByTable={props.viewsByTable}
              formsByTable={props.formsByTable}
            />
          )}
        </Index>
      </div>

      <Show when={props.row.cells.length < 4}>
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[11px] text-dimmed mr-1">Add cell:</span>
          <For each={CELL_KIND_OPTIONS}>
            {(opt) => (
              <button
                type="button"
                class="btn-input btn-sm"
                onClick={() => addCell(opt.id)}
              >
                <i class={opt.icon} /> {opt.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Per-cell dispatcher inside RowCard. Picks the matching editor
 *  based on widget.kind. Each editor is a self-contained inline-
 *  expand card with its own header (collapsed summary) + expanded
 *  body (configuration fields). */
function CellEditor(props: {
  widget: Widget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: Widget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
}) {
  switch (props.widget.kind) {
    case "stat":
      return (
        <StatCellEditor
          widget={props.widget}
          isExpanded={props.isExpanded}
          canRemove={props.canRemove}
          onToggle={props.onToggle}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
        />
      );
    case "view":
      return (
        <ViewCellEditor
          widget={props.widget}
          isExpanded={props.isExpanded}
          canRemove={props.canRemove}
          onToggle={props.onToggle}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "chart":
      return (
        <ChartCellEditor
          widget={props.widget}
          isExpanded={props.isExpanded}
          canRemove={props.canRemove}
          onToggle={props.onToggle}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "view-stats":
      return (
        <ViewStatsCellEditor
          widget={props.widget}
          isExpanded={props.isExpanded}
          canRemove={props.canRemove}
          onToggle={props.onToggle}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "form":
      return (
        <FormCellEditor
          widget={props.widget}
          isExpanded={props.isExpanded}
          canRemove={props.canRemove}
          onToggle={props.onToggle}
          onUpdate={props.onUpdate}
          onRemove={props.onRemove}
          tables={props.tables}
          formsByTable={props.formsByTable}
        />
      );
  }
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

// ── ViewStats cell editor ─────────────────────────────────────────
// Cell-level version of the deprecated view-stats row. Picks a view;
// the cell renders the auto-derived 2×N stat grid at runtime.

function ViewStatsCellEditor(props: {
  widget: ViewStatsWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: ViewStatsWidget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
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
    const v = allViews().find((x) => x.view.id === props.widget.viewId);
    return v ? `${v.tableName} · ${v.view.name}` : "(pick a view)";
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col overflow-hidden">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ti ti-layout-2 text-sm shrink-0 text-dimmed" />
          <span class="text-sm font-medium truncate">
            {props.widget.title || "View stats"}
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
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2 flex flex-col gap-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="Title (optional override)"
              value={() => props.widget.title ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, title: v || undefined })
              }
              placeholder="Defaults to the view's name"
            />
            <Select
              label="View"
              value={() => props.widget.viewId}
              onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
              options={[
                { id: "", label: "(pick a view)" },
                ...allViews().map(({ view, tableName }) => ({
                  id: view.id,
                  label: `${tableName} · ${view.name}`,
                })),
              ]}
            />
            <div class="md:col-span-2 text-[11px] text-dimmed">
              Cells are derived from the view automatically. Ungrouped
              views render the first record's columns; grouped views
              render the first bucket's aggregations.
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

// ── Form cell editor ──────────────────────────────────────────────
// Pick a form by id from the base-wide forms list. Renderer embeds
// the form inline; submit triggers a full page reload.

function FormCellEditor(props: {
  widget: FormWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: FormWidget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  formsByTable: Record<string, Form[]>;
}) {
  const allForms = createMemo(() => {
    const flat: { form: Form; tableName: string }[] = [];
    for (const t of props.tables) {
      for (const f of props.formsByTable[t.id] ?? []) {
        flat.push({ form: f, tableName: t.name });
      }
    }
    flat.sort((a, b) =>
      a.form.name.localeCompare(b.form.name, undefined, { sensitivity: "base" }),
    );
    return flat;
  });

  const summary = () => {
    const f = allForms().find((x) => x.form.id === props.widget.formId);
    return f ? `${f.tableName} · ${f.form.name}` : "(pick a form)";
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col overflow-hidden">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i class="ti ti-forms text-sm shrink-0 text-dimmed" />
          <span class="text-sm font-medium truncate">
            {props.widget.title || "Form"}
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
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2 flex flex-col gap-2">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="Title (optional override)"
              value={() => props.widget.title ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, title: v || undefined })
              }
              placeholder="Defaults to the form's name"
            />
            <Select
              label="Form"
              value={() => props.widget.formId}
              onChange={(v) => props.onUpdate({ ...props.widget, formId: v })}
              options={[
                { id: "", label: "(pick a form)" },
                ...allForms().map(({ form, tableName }) => ({
                  id: form.id,
                  label: `${tableName} · ${form.name}`,
                })),
              ]}
            />
            <div class="md:col-span-2 text-[11px] text-dimmed">
              On successful submit, the dashboard reloads so every other
              widget re-resolves with the new record visible.
            </div>
          </div>
        </div>
      </Show>
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
// The chart pulls its source from a saved view (filter / groupBy with
// granularity / aggregations all live on the view). The editor is
// therefore a thin layer: chartType picker, view picker, optional
// limit + axis cosmetics. The heavy "configure a query" UX happens
// in the view editor, where the user already does that for the
// records page.
// =============================================================================

const CHART_TYPE_OPTIONS: { id: ChartWidget["chartType"]; label: string; icon: string }[] = [
  { id: "donut", label: "Donut", icon: "ti ti-chart-donut-4" },
  { id: "bar", label: "Bar", icon: "ti ti-chart-bar" },
  { id: "line", label: "Line", icon: "ti ti-chart-line" },
  { id: "scatter", label: "Scatter", icon: "ti ti-chart-dots" },
];

/** Hint shown under the chartType picker — documents the view-shape
 *  contract so the user knows what kind of view to point at. */
const CHART_TYPE_HINTS: Record<ChartWidget["chartType"], string> = {
  donut: "View must group by 1 field + have ≥1 aggregation. First agg → slice value.",
  bar: "View must group by 1 field + have ≥1 aggregation. First agg → bar value.",
  line: "View must group by 1 field + have N aggregations (one line series per agg).",
  scatter: "View must group by 1 field + have ≥2 aggregations (agg 1 = x, agg 2 = y).",
};

function ChartCellEditor(props: {
  widget: ChartWidget;
  isExpanded: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onUpdate: (w: ChartWidget) => void;
  onRemove: () => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  viewsByTable: Record<string, View[]>;
}) {
  /** Flat list of every view in the base, with its parent table name
   *  for the dropdown label. Sorted by view name (case-insensitive)
   *  so the picker reads alphabetically. */
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
    const v = allViews().find((x) => x.view.id === props.widget.viewId);
    if (!v) return `${props.widget.chartType} · (pick a view)`;
    return `${props.widget.chartType} · ${v.tableName} · ${v.view.name}`;
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
              Segmented buttons (one per chartType). Hint underneath
              documents what kind of view the chart needs. */}
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

          {/* ── Title / subtitle / view picker / limit ──────────── */}
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
              label="Source view"
              value={() => props.widget.viewId}
              onChange={(v) => props.onUpdate({ ...props.widget, viewId: v })}
              options={[
                { id: "", label: "(pick a view)" },
                ...allViews().map(({ view, tableName }) => ({
                  id: view.id,
                  label: `${tableName} · ${view.name}`,
                })),
              ]}
            />
            <TextInput
              label="Limit (optional)"
              value={() =>
                props.widget.limit !== undefined ? String(props.widget.limit) : ""
              }
              onInput={(raw) => {
                const trimmed = raw.trim();
                if (trimmed === "") {
                  // Empty → clear the cap; chart shows all buckets.
                  const { limit: _drop, ...rest } = props.widget;
                  props.onUpdate(rest);
                  return;
                }
                const n = Number(trimmed);
                if (!Number.isFinite(n) || n < 1) return;
                props.onUpdate({
                  ...props.widget,
                  limit: Math.min(Math.floor(n), 1000),
                });
              }}
              placeholder="e.g. 12 (last 12 buckets)"
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

          {/* ── Axis labels (optional override) ──────────────────
              Defaults: x-axis inherits from the view's groupBy field;
              y-axis uses the aggregation label. Override only when
              the inferred ones are wrong. */}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            <TextInput
              label="X-axis label (optional)"
              value={() => props.widget.xAxisLabel ?? ""}
              onInput={(v) =>
                props.onUpdate({ ...props.widget, xAxisLabel: v || undefined })
              }
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
