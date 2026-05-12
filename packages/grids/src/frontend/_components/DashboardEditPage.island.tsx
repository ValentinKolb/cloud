import type { AccessEntry, Principal, PermissionLevel } from "@valentinkolb/cloud/contracts/shared";
import {
  DialogHeader,
  dialogCore,
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
// Row card — one editor for the unified row. Cells are listed
// vertically with ↑/↓ chevrons (mirrors the field-list pattern in
// TableEditPage) and editable via a Save-on-confirm modal (mirrors
// `openFieldEditDialog`).
// =============================================================================

const HEIGHT_OPTIONS = [
  { id: "sm", label: "Small (96px)" },
  { id: "md", label: "Medium (192px)" },
  { id: "lg", label: "Large (360px)" },
];

/** Cell-kind picker for the "Add cell" buttons. Each entry maps to
 *  its factory + icon for the row-list display. */
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

/** Resolves the icon + title + summary string shown in the collapsed
 *  CellRow. Kind-specific because each cell type carries different
 *  identifying info — stats have a title + agg, charts have a chart
 *  type + view, etc. Used by `<CellRow>` (read-only render) so it
 *  doesn't need to know cell-kind internals. */
const summarizeCell = (
  widget: Widget,
  ctx: { tables: Array<{ id: string; name: string }>; viewsByTable: Record<string, View[]>; formsByTable: Record<string, Form[]> },
): { icon: string; title: string; subtitle: string } => {
  switch (widget.kind) {
    case "stat": {
      const agg = widget.source.aggregations[0];
      const t = ctx.tables.find((x) => x.id === widget.source.tableId)?.name ?? "?";
      const aggLabel = agg ? `${agg.agg}(${agg.fieldId === "*" ? "*" : "…"})` : "?";
      return {
        icon: "ti ti-number",
        title: widget.title || "(untitled stat)",
        subtitle: `${t} · ${aggLabel}`,
      };
    }
    case "view": {
      const src = widget.source;
      if (src.kind === "table") {
        const t = ctx.tables.find((x) => x.id === src.tableId)?.name ?? "?";
        return {
          icon: "ti ti-table-spark",
          title: widget.title || "(untitled view)",
          subtitle: `table · ${t}`,
        };
      }
      const v = findViewById(src.viewId, ctx.viewsByTable);
      return {
        icon: "ti ti-table-spark",
        title: widget.title || "(untitled view)",
        subtitle: v ? `view · ${v.tableName} · ${v.view.name}` : "(pick a view)",
      };
    }
    case "chart": {
      const v = findViewById(widget.viewId, ctx.viewsByTable);
      return {
        icon: "ti ti-chart-bar",
        title: widget.title || "(untitled chart)",
        subtitle: v
          ? `${widget.chartType} · ${v.tableName} · ${v.view.name}`
          : `${widget.chartType} · (pick a view)`,
      };
    }
    case "view-stats": {
      const v = findViewById(widget.viewId, ctx.viewsByTable);
      return {
        icon: "ti ti-layout-2",
        title: widget.title || "View stats",
        subtitle: v ? `${v.tableName} · ${v.view.name}` : "(pick a view)",
      };
    }
    case "form": {
      const f = findFormById(widget.formId, ctx.formsByTable);
      return {
        icon: "ti ti-forms",
        title: widget.title || (f?.form.name ?? "Form"),
        subtitle: f ? `${f.tableName} · ${f.form.name}` : "(pick a form)",
      };
    }
  }
};

/** Finds a view across all tables-by-base by id. Cell editors / row
 *  cards use this for the summary line; cross-table lookup keeps the
 *  picker uniform regardless of which table the view lives under. */
const findViewById = (
  viewId: string,
  viewsByTable: Record<string, View[]>,
): { view: View; tableName: string } | null => {
  if (!viewId) return null;
  for (const [_tableId, views] of Object.entries(viewsByTable)) {
    for (const v of views) {
      if (v.id === viewId) {
        // tableName isn't on the view itself, but we know each view
        // belongs to v.tableId. Return a placeholder; the cell editor
        // will fill in the proper tableName from its own context.
        return { view: v, tableName: "" };
      }
    }
  }
  return null;
};

/** Same shape as findViewById but scanning the forms-by-table map. */
const findFormById = (
  formId: string,
  formsByTable: Record<string, Form[]>,
): { form: Form; tableName: string } | null => {
  if (!formId) return null;
  for (const [_tableId, forms] of Object.entries(formsByTable)) {
    for (const f of forms) {
      if (f.id === formId) return { form: f, tableName: "" };
    }
  }
  return null;
};

/**
 * Compact list-item for a single cell inside RowCard. Mirrors the
 * field-list row pattern in TableEditPage (chevron column on left,
 * summary in the middle, edit + delete buttons on the right) so the
 * two reorder surfaces feel consistent.
 *
 * Click anywhere on the summary opens the edit modal (same as the
 * pencil button). Reorder arrows live in a fixed-width column on the
 * left; they disable at top/bottom so the user gets clear feedback
 * when they've hit the boundary.
 */
function CellRow(props: {
  widget: Widget;
  cellIdx: number;
  cellCount: number;
  ctx: {
    tables: Array<{ id: string; name: string; slug: string }>;
    fieldsByTable: Record<string, Field[]>;
    viewsByTable: Record<string, View[]>;
    formsByTable: Record<string, Form[]>;
  };
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const summary = () => summarizeCell(props.widget, props.ctx);
  return (
    // Hover bg lives on the WHOLE row (via `group`) — same pattern
    // as TableEditPage's field rows. Without this, only the inner
    // button (the click target) would highlight on hover, leaving
    // the chevrons + action buttons feeling detached from the row.
    // The pencil icon turns blue-500 on group-hover as an affordance
    // cue that the whole row is clickable.
    <div class="group border border-zinc-200 dark:border-zinc-700/50 rounded-md flex items-stretch overflow-hidden hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors">
      {/* Reorder column — same chevron-up/down stack as TableEditPage's
          field rows. Buttons disable at the boundaries; pl-2 inset
          matches the field-list rhythm. */}
      <div class="flex flex-col pl-2 shrink-0 justify-center">
        <button
          type="button"
          class="h-4 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
          onClick={() => props.onMove(-1)}
          disabled={props.cellIdx === 0}
          title="Move up"
          aria-label="Move up"
        >
          <i class="ti ti-chevron-up text-xs" />
        </button>
        <button
          type="button"
          class="h-4 flex items-center justify-center text-dimmed hover:text-blue-500 disabled:opacity-30 transition-colors"
          onClick={() => props.onMove(1)}
          disabled={props.cellIdx === props.cellCount - 1}
          title="Move down"
          aria-label="Move down"
        >
          <i class="ti ti-chevron-down text-xs" />
        </button>
      </div>
      {/* Summary — clickable; click anywhere opens the edit modal.
          Hover bg is on the row (group), so we don't add it here —
          the button just inherits. */}
      <button
        type="button"
        class="flex flex-1 min-w-0 items-center gap-2 px-3 py-2 text-left"
        onClick={props.onEdit}
        aria-label={`Edit ${summary().title}`}
      >
        <i class={`${summary().icon} text-sm shrink-0 text-dimmed`} />
        <span class="text-sm font-medium truncate">{summary().title}</span>
        <span class="text-[10px] text-dimmed shrink-0 truncate">{summary().subtitle}</span>
      </button>
      <div class="flex items-center gap-1 pr-2 shrink-0">
        <button
          type="button"
          class="text-dimmed group-hover:text-blue-500 p-1 transition-colors"
          onClick={props.onEdit}
          title="Edit"
          aria-label="Edit cell"
        >
          <i class="ti ti-pencil text-xs" />
        </button>
        <Show when={props.canRemove}>
          <button
            type="button"
            class="text-dimmed hover:text-red-600 dark:hover:text-red-400 p-1"
            onClick={props.onRemove}
            title="Delete cell"
            aria-label="Delete cell"
          >
            <i class="ti ti-trash text-xs" />
          </button>
        </Show>
      </div>
    </div>
  );
}

/**
 * Opens a save-on-confirm modal for editing a single cell. The
 * dialog owns a draft signal seeded from the input cell; the inner
 * editor body reads `draft()` and calls `setDraft(...)` on every
 * input change. Save resolves with the draft; Cancel resolves with
 * `null` (caller discards). Mirrors `openFieldEditDialog` in
 * TableEditPage.
 *
 * Per-kind dispatch by widget.kind — each kind has its own body
 * component (StatCellBody / ViewCellBody / etc.) that knows how to
 * render the right inputs. The dialog header carries a kind-specific
 * icon + title for orientation.
 */
const openCellEditDialog = (
  widget: Widget,
  ctx: {
    tables: Array<{ id: string; name: string; slug: string }>;
    fieldsByTable: Record<string, Field[]>;
    viewsByTable: Record<string, View[]>;
    formsByTable: Record<string, Form[]>;
  },
): Promise<Widget | undefined> => {
  const kindLabel: Record<Widget["kind"], string> = {
    stat: "Edit stat cell",
    view: "Edit view cell",
    chart: "Edit chart cell",
    "view-stats": "Edit view-stats cell",
    form: "Edit form cell",
  };
  const kindIcon: Record<Widget["kind"], string> = {
    stat: "ti ti-number",
    view: "ti ti-table-spark",
    chart: "ti ti-chart-bar",
    "view-stats": "ti ti-layout-2",
    form: "ti ti-forms",
  };

  return dialogCore.open<Widget>(
    (close) => {
      const [draft, setDraft] = createSignal<Widget>(widget);
      return (
        <div class="flex flex-col gap-4">
          <DialogHeader
            title={kindLabel[widget.kind]}
            icon={kindIcon[widget.kind]}
            close={() => close()}
          />
          <CellEditorBody
            widget={draft()}
            onUpdate={(next) => setDraft(next)}
            tables={ctx.tables}
            fieldsByTable={ctx.fieldsByTable}
            viewsByTable={ctx.viewsByTable}
            formsByTable={ctx.formsByTable}
          />
          <footer class="flex justify-end gap-2 border-t border-zinc-100 dark:border-zinc-800/60 pt-3">
            <button
              type="button"
              class="btn-secondary btn-sm"
              onClick={() => close()}
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn-primary btn-sm"
              onClick={() => close(draft())}
            >
              <i class="ti ti-device-floppy" /> Save
            </button>
          </footer>
        </div>
      );
    },
    {
      // Same panel sizing as openFieldEditDialog — 48rem wide,
      // 86vh capped scroll. Keeps the two modal-edit surfaces visually
      // identical, so the user's mental model carries across.
      panelClassName:
        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 m-0 w-[min(96vw,48rem)] max-h-[86vh] overflow-x-hidden overflow-y-auto rounded-2xl border-0 bg-white/95 p-4 text-zinc-900 shadow-none ring-1 ring-inset ring-zinc-300/60 dark:bg-zinc-950/95 dark:text-zinc-100 dark:ring-zinc-700/60 backdrop:bg-black/45 dark:backdrop:bg-black/35 backdrop:backdrop-blur-sm",
    },
  );
};

/** Per-kind dispatcher for the modal body. Each cell-kind has its
 *  own body component carrying the actual inputs — `CellEditorBody`
 *  picks the matching one based on widget.kind. The wrapping modal
 *  provides the header + footer chrome, so these bodies render just
 *  the form fields. */
function CellEditorBody(props: {
  widget: Widget;
  onUpdate: (w: Widget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
}) {
  switch (props.widget.kind) {
    case "stat":
      return (
        <StatCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: StatWidget) => void}
          tables={props.tables}
          fieldsByTable={props.fieldsByTable}
        />
      );
    case "view":
      return (
        <ViewCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "chart":
      return (
        <ChartCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ChartWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "view-stats":
      return (
        <ViewStatsCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: ViewStatsWidget) => void}
          tables={props.tables}
          viewsByTable={props.viewsByTable}
        />
      );
    case "form":
      return (
        <FormCellBody
          widget={props.widget}
          onUpdate={props.onUpdate as (w: FormWidget) => void}
          tables={props.tables}
          formsByTable={props.formsByTable}
        />
      );
  }
}

function RowCard(props: {
  row: DashboardRow;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
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

  /**
   * Reorder cells within the row. Same swap-and-replace pattern as
   * `moveField` in TableEditPage (and `moveRow` above). The cells
   * array's order is the visual order in the dashboard row, so the
   * up/down arrows on the row card move the cell left/right in the
   * rendered row.
   */
  const moveCell = (cellIdx: number, direction: -1 | 1) => {
    const target = cellIdx + direction;
    if (target < 0 || target >= props.row.cells.length) return;
    const next = [...props.row.cells];
    [next[cellIdx], next[target]] = [next[target]!, next[cellIdx]!];
    props.onUpdate({ ...props.row, cells: next });
  };

  /** Opens the modal editor for a cell. On Save (modal resolves with
   *  the edited widget), splices into the row at the original index.
   *  On Cancel (modal resolves with undefined), no-ops — local draft
   *  is discarded. */
  const editCell = async (cellIdx: number) => {
    const current = props.row.cells[cellIdx];
    if (!current) return;
    const next = await openCellEditDialog(current, {
      tables: props.tables,
      fieldsByTable: props.fieldsByTable,
      viewsByTable: props.viewsByTable,
      formsByTable: props.formsByTable,
    });
    if (next) updateCell(cellIdx, next);
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
        {/* Index keys cells by position — survives the row-object
            recreations that updateCell triggers, so the row-card
            (and any in-flight modal) stays mounted across edits. */}
        <Index each={props.row.cells}>
          {(cell, cellIdx) => (
            <CellRow
              widget={cell()}
              cellIdx={cellIdx}
              cellCount={props.row.cells.length}
              ctx={{
                tables: props.tables,
                fieldsByTable: props.fieldsByTable,
                viewsByTable: props.viewsByTable,
                formsByTable: props.formsByTable,
              }}
              onEdit={() => editCell(cellIdx)}
              onMove={(dir) => moveCell(cellIdx, dir)}
              onRemove={() => removeCell(cellIdx)}
              canRemove={props.row.cells.length > 1}
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

/**
 * StatCellBody — modal-rendered editor for a single StatWidget.
 * Inputs only; the wrapping modal supplies the header + Save/Cancel
 * footer. Mirrors the way `<FieldEditor>` works inside
 * `openFieldEditDialog`.
 */
function StatCellBody(props: {
  widget: StatWidget;
  onUpdate: (w: StatWidget) => void;
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

  return (
    <div class="flex flex-col gap-3">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
        />
        <TextInput
          label="Sub-line (optional)"
          value={() => props.widget.sub ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, sub: v || undefined })}
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
          onChange={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
          placeholder="Search icons…"
        />
        <div class="md:col-span-2 text-[11px] text-dimmed">
          Preview:{" "}
          <code class="font-mono">{formatWidgetValue(0, props.widget.format)}</code>{" "}
          (style only — real value resolves at render time)
        </div>
      </div>

      {/* Trend (optional inline sparkline) — same agg + filter,
          bucketed by a date field. Hidden when the source table has
          zero date fields. */}
      <StatTrendSection
        widget={props.widget}
        fields={fields()}
        onUpdate={props.onUpdate}
      />
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

/** ViewStatsCellBody — modal-rendered editor body. Picks a saved
 *  view; the cell renders the auto-derived 2×N stat grid at runtime. */
function ViewStatsCellBody(props: {
  widget: ViewStatsWidget;
  onUpdate: (w: ViewStatsWidget) => void;
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

  return (
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
      <TextInput
        label="Title (optional override)"
        value={() => props.widget.title ?? ""}
        onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
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
        Cells are derived from the view automatically. Ungrouped views
        render the first record's columns; grouped views render the
        first bucket's aggregations.
      </div>
    </div>
  );
}

// ── Form cell editor ──────────────────────────────────────────────
// Pick a form by id from the base-wide forms list. Renderer embeds
// the form inline; submit triggers a full page reload.

/** FormCellBody — modal-rendered editor body. Picks a form from the
 *  base-wide forms list. */
function FormCellBody(props: {
  widget: FormWidget;
  onUpdate: (w: FormWidget) => void;
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

  return (
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
      <TextInput
        label="Title (optional override)"
        value={() => props.widget.title ?? ""}
        onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
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
        On successful submit, the dashboard reloads so every other widget
        re-resolves with the new record visible.
      </div>
    </div>
  );
}

// =============================================================================
// View cell editor
// =============================================================================

/** ViewCellBody — modal-rendered editor body. Two source kinds (view /
 *  table) drive different sub-pickers; the binary toggle is a pair of
 *  segmented buttons rather than a Select. */
function ViewCellBody(props: {
  widget: ViewWidget;
  onUpdate: (w: ViewWidget) => void;
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
    <div class="flex flex-col gap-2">
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
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
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
                props.widget.source.kind === "table" ? props.widget.source.tableId : ""
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
              props.widget.source.kind === "view" ? props.widget.source.viewId : ""
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

/** ChartCellBody — modal-rendered editor body. chartType picker +
 *  view picker + optional limit + axis cosmetics. View supplies the
 *  filter/groupBy/granularity/aggregations. */
function ChartCellBody(props: {
  widget: ChartWidget;
  onUpdate: (w: ChartWidget) => void;
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

  return (
    <div class="flex flex-col gap-3">
      {/* Chart kind picker — segmented buttons. Hint underneath
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
              onClick={() => props.onUpdate({ ...props.widget, chartType: opt.id })}
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

      <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
        <TextInput
          label="Title"
          value={() => props.widget.title ?? ""}
          onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
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
