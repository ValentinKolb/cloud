import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  navigateTo,
  PermissionEditor,
  prompts,
  Select,
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
  View,
  Widget,
  WidgetSource,
} from "../../service";
import type { AggregationSpec } from "../../contracts";
import { errorMessage } from "./api-helpers";
import { SectionCard } from "./SectionCard";
import { formatWidgetValue } from "./dashboard/widget-format";

type Props = {
  baseSlug: string;
  initialDashboard: Dashboard;
  /** Whether this dashboard is the base's default — surfaces as a
   *  read-only badge with a link to base settings (the canonical place
   *  to change it). */
  isBaseDefault: boolean;
  /** Tables the viewer can read on this base. Source for the stat /
   *  chart widget table-pickers. */
  tables: Array<{ id: string; name: string; slug: string }>;
  /** Fields by table — drives the aggregation field-picker. Pre-loaded
   *  server-side so the picker doesn't round-trip per click. */
  fieldsByTable: Record<string, Field[]>;
  /** Views by table — view-picker for embedded-view widgets. */
  viewsByTable: Record<string, View[]>;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
};

type WidgetKind = Widget["kind"];

const DEFAULT_AGG: AggregationSpec = { fieldId: "*", agg: "count" };

const newId = () => `w_${crypto.randomUUID()}`;

const newRowId = () => `r_${crypto.randomUUID()}`;

/**
 * Builds a "best-guess sensible" widget when the user adds a new cell
 * of a given kind. Source defaults to the first readable table so the
 * cell renders something instead of a "pick a table" placeholder.
 */
const buildNewWidget = (
  kind: WidgetKind,
  defaultTableId: string | null,
): Widget => {
  if (kind === "stat") {
    return {
      id: newId(),
      kind: "stat",
      title: "New stat",
      source: defaultSource(defaultTableId),
      format: "plain",
    };
  }
  if (kind === "chart") {
    return {
      id: newId(),
      kind: "chart",
      title: "New chart",
      chartType: "donut",
      source: defaultSource(defaultTableId),
    };
  }
  return { id: newId(), kind: "view", viewId: "", title: undefined };
};

const defaultSource = (tableId: string | null): WidgetSource => ({
  tableId: tableId ?? "",
  aggregations: [DEFAULT_AGG],
});

/**
 * Top-level editor island. Stateful: every mutation goes through a
 * single `setConfig` setter that diffs against the last-saved snapshot
 * to drive the dirty-state Save button. We deliberately avoid per-cell
 * mutations against the server — the layout is small (typically <30
 * widgets) and a single PATCH for the whole config keeps the model
 * simple and survives concurrent edits with last-write-wins.
 */
export default function DashboardEditPage(props: Props) {
  const [config, setConfig] = createSignal<DashboardConfig>(
    props.initialDashboard.config,
  );
  const [savedConfig, setSavedConfig] = createSignal<DashboardConfig>(
    props.initialDashboard.config,
  );
  const dirty = createMemo(() => JSON.stringify(config()) !== JSON.stringify(savedConfig()));

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
        subtitle="Rows of 1-4 cells. Each cell is one widget. Click a cell to edit its source."
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
  const [description, setDescription] = createSignal(props.dashboard.description ?? "");
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
            — visible to anyone with base-read. Untoggle to make it personal (only you can see it).
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
// Layout editor
// =============================================================================

const HEIGHT_OPTIONS = [
  { value: "sm", label: "Small (96px)" },
  { value: "md", label: "Medium (192px)" },
  { value: "lg", label: "Large (360px)" },
] as const;

function LayoutEditor(props: {
  config: () => DashboardConfig;
  setConfig: (next: DashboardConfig) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
}) {
  const updateRow = (rowIdx: number, patch: Partial<DashboardRow>) => {
    const next = { ...props.config() };
    next.rows = next.rows.map((r, i) => (i === rowIdx ? { ...r, ...patch } : r));
    props.setConfig(next);
  };

  const updateCell = (rowIdx: number, cellIdx: number, widget: Widget) => {
    const next = { ...props.config() };
    next.rows = next.rows.map((r, i) =>
      i === rowIdx
        ? { ...r, cells: r.cells.map((c, j) => (j === cellIdx ? widget : c)) }
        : r,
    );
    props.setConfig(next);
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
    const next = { ...props.config() };
    next.rows = next.rows.filter((_, i) => i !== rowIdx);
    props.setConfig(next);
  };

  const addRow = () => {
    const next = { ...props.config() };
    next.rows = [
      ...next.rows,
      {
        id: newRowId(),
        height: "md",
        cells: [buildNewWidget("stat", props.tables[0]?.id ?? null)],
      },
    ];
    props.setConfig(next);
  };

  const addCell = (rowIdx: number, kind: WidgetKind) => {
    const next = { ...props.config() };
    next.rows = next.rows.map((r, i) =>
      i === rowIdx && r.cells.length < 4
        ? {
            ...r,
            cells: [...r.cells, buildNewWidget(kind, props.tables[0]?.id ?? null)],
          }
        : r,
    );
    props.setConfig(next);
  };

  const removeCell = (rowIdx: number, cellIdx: number) => {
    const next = { ...props.config() };
    next.rows = next.rows
      .map((r, i) =>
        i === rowIdx
          ? { ...r, cells: r.cells.filter((_, j) => j !== cellIdx) }
          : r,
      )
      // A row with zero cells has no business existing; collapse it.
      .filter((r) => r.cells.length > 0);
    props.setConfig(next);
  };

  return (
    <div class="flex flex-col gap-3">
      <Show
        when={props.config().rows.length > 0}
        fallback={
          <div class="info-block-info text-xs text-center py-4">
            No rows yet. Click "Add row" below to start.
          </div>
        }
      >
        <For each={props.config().rows}>
          {(row, rowIdx) => (
            <RowCard
              row={row}
              rowIdx={rowIdx()}
              rowCount={props.config().rows.length}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
              viewsByTable={props.viewsByTable}
              onUpdateRow={(patch) => updateRow(rowIdx(), patch)}
              onUpdateCell={(cellIdx, widget) => updateCell(rowIdx(), cellIdx, widget)}
              onMoveRow={(dir) => moveRow(rowIdx(), dir)}
              onRemoveRow={() => removeRow(rowIdx())}
              onAddCell={(kind) => addCell(rowIdx(), kind)}
              onRemoveCell={(cellIdx) => removeCell(rowIdx(), cellIdx)}
            />
          )}
        </For>
      </Show>
      <button type="button" class="btn-input btn-sm self-start" onClick={addRow}>
        <i class="ti ti-plus" /> Add row
      </button>
    </div>
  );
}

// =============================================================================
// Row card
// =============================================================================

function RowCard(props: {
  row: DashboardRow;
  rowIdx: number;
  rowCount: number;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  onUpdateRow: (patch: Partial<DashboardRow>) => void;
  onUpdateCell: (cellIdx: number, widget: Widget) => void;
  onMoveRow: (dir: -1 | 1) => void;
  onRemoveRow: () => void;
  onAddCell: (kind: WidgetKind) => void;
  onRemoveCell: (cellIdx: number) => void;
}) {
  const [expandedCellIdx, setExpandedCellIdx] = createSignal<number | null>(null);

  return (
    <div class="paper p-3 flex flex-col gap-3">
      <header class="flex items-center justify-between gap-2">
        <span class="text-xs font-medium text-dimmed">Row {props.rowIdx + 1}</span>
        <div class="flex items-center gap-2">
          <Select
            value={() => props.row.height}
            onChange={(v) => props.onUpdateRow({ height: v as "sm" | "md" | "lg" })}
            options={HEIGHT_OPTIONS as unknown as { value: string; label: string }[]}
          />
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
              if (await prompts.confirm("Delete this row and all its widgets?")) {
                props.onRemoveRow();
              }
            }}
            title="Delete row"
          >
            <i class="ti ti-trash" />
          </button>
        </div>
      </header>

      <div
        class={`grid grid-cols-1 gap-2 md:grid-cols-${props.row.cells.length}`}
      >
        <For each={props.row.cells}>
          {(cell, cellIdx) => (
            <CellPreview
              widget={cell}
              isExpanded={expandedCellIdx() === cellIdx()}
              onToggle={() =>
                setExpandedCellIdx(expandedCellIdx() === cellIdx() ? null : cellIdx())
              }
              onRemove={() => props.onRemoveCell(cellIdx())}
              tables={props.tables}
              fields={
                cell.kind === "view"
                  ? []
                  : props.fieldsByTable[cell.source.tableId] ?? []
              }
              viewsByTable={props.viewsByTable}
              fieldsByTable={props.fieldsByTable}
              onUpdate={(w) => props.onUpdateCell(cellIdx(), w)}
            />
          )}
        </For>
      </div>

      <Show when={props.row.cells.length < 4}>
        <div class="flex items-center gap-2">
          <span class="text-xs text-dimmed">Add cell:</span>
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => props.onAddCell("stat")}
          >
            <i class="ti ti-number" /> Stat
          </button>
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => props.onAddCell("view")}
          >
            <i class="ti ti-table-spark" /> View
          </button>
          <button
            type="button"
            class="btn-input btn-sm"
            onClick={() => props.onAddCell("chart")}
            title="Chart rendering ships in P1 — bucket preview only for now"
          >
            <i class="ti ti-chart-pie" /> Chart (preview)
          </button>
        </div>
      </Show>
    </div>
  );
}

// =============================================================================
// Cell preview + editors
// =============================================================================

function CellPreview(props: {
  widget: Widget;
  isExpanded: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onUpdate: (w: Widget) => void;
  tables: Array<{ id: string; name: string; slug: string }>;
  fields: Field[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
}) {
  const summary = () => {
    if (props.widget.kind === "stat") {
      const agg = props.widget.source.aggregations[0];
      const fieldName =
        agg?.fieldId === "*"
          ? "*"
          : props.fields.find((f) => f.id === agg?.fieldId)?.name ?? "?";
      return `${agg?.agg ?? "?"}(${fieldName})`;
    }
    if (props.widget.kind === "chart") {
      return `${props.widget.chartType} chart`;
    }
    const allViews = Object.values(props.viewsByTable).flat();
    const v = allViews.find((vv) => vv.id === props.widget.viewId);
    return v ? v.name : "(pick a view)";
  };

  return (
    <div class="border border-zinc-200 dark:border-zinc-700/50 rounded-md flex flex-col">
      <div
        class="px-2 py-1.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
        onClick={props.onToggle}
      >
        <div class="flex items-center gap-2 min-w-0">
          <i
            class={`ti ${
              props.widget.kind === "stat"
                ? "ti-number"
                : props.widget.kind === "view"
                ? "ti-table-spark"
                : "ti-chart-pie"
            } text-sm shrink-0 text-dimmed`}
          />
          <span class="text-sm font-medium truncate">
            {("title" in props.widget && props.widget.title) || "(untitled)"}
          </span>
          <span class="text-[10px] text-dimmed shrink-0">{summary()}</span>
        </div>
        <div class="flex items-center gap-1 shrink-0">
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
          <i
            class={`ti ti-chevron-down text-xs text-dimmed transition-transform ${
              props.isExpanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>

      <Show when={props.isExpanded}>
        <div class="border-t border-zinc-200 dark:border-zinc-700/50 p-2">
          {props.widget.kind === "stat" && (
            <StatCellEditor
              widget={props.widget}
              tables={props.tables}
              fieldsByTable={props.fieldsByTable}
              onUpdate={props.onUpdate}
            />
          )}
          {props.widget.kind === "view" && (
            <ViewCellEditor
              widget={props.widget}
              viewsByTable={props.viewsByTable}
              tables={props.tables}
              onUpdate={props.onUpdate}
            />
          )}
          {props.widget.kind === "chart" && (
            <div class="text-xs text-dimmed py-2">
              Chart rendering lands in P1. Source stats are still saved so the
              widget will render once the chart layer ships.
            </div>
          )}
        </div>
      </Show>
    </div>
  );
}

// =============================================================================
// Stat editor
// =============================================================================

const AGG_OPTIONS = [
  { value: "count", label: "count" },
  { value: "countEmpty", label: "count empty" },
  { value: "countUnique", label: "count unique" },
  { value: "sum", label: "sum" },
  { value: "avg", label: "avg" },
  { value: "min", label: "min" },
  { value: "max", label: "max" },
];

const FORMAT_OPTIONS = [
  { value: "plain", label: "Plain number" },
  { value: "integer", label: "Integer" },
  { value: "currency", label: "Currency (EUR)" },
  { value: "percent", label: "Percent" },
];

function StatCellEditor(props: {
  widget: Extract<Widget, { kind: "stat" }>;
  tables: Array<{ id: string; name: string; slug: string }>;
  fieldsByTable: Record<string, Field[]>;
  onUpdate: (w: Widget) => void;
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
    <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
      <TextInput
        label="Title"
        value={() => props.widget.title ?? ""}
        onInput={(v) => props.onUpdate({ ...props.widget, title: v || undefined })}
      />
      <TextInput
        label="Icon (Tabler class)"
        value={() => props.widget.icon ?? ""}
        onInput={(v) => props.onUpdate({ ...props.widget, icon: v || undefined })}
        placeholder="e.g. ti ti-shopping-cart"
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
              aggregations: [DEFAULT_AGG], // reset agg — old fieldId may not exist on new table
            },
          })
        }
        options={props.tables.map((t) => ({ value: t.id, label: t.name }))}
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
          { value: "*", label: "* (records)" },
          ...fields().map((f) => ({ value: f.id, label: f.name })),
        ]}
      />
      <Select
        label="Format"
        value={() => props.widget.format ?? "plain"}
        onChange={(v) =>
          props.onUpdate({ ...props.widget, format: v as "plain" | "currency" | "percent" | "integer" })
        }
        options={FORMAT_OPTIONS}
      />
      <div class="md:col-span-2 text-[11px] text-dimmed">
        Preview: <code class="font-mono">{formatWidgetValue(0, props.widget.format)}</code> (style only — real value resolves at render time)
      </div>
    </div>
  );
}

// =============================================================================
// View editor
// =============================================================================

function ViewCellEditor(props: {
  widget: Extract<Widget, { kind: "view" }>;
  viewsByTable: Record<string, View[]>;
  tables: Array<{ id: string; name: string; slug: string }>;
  onUpdate: (w: Widget) => void;
}) {
  // Flat alphabetical view list across all tables, with "table · view"
  // labels so the user can disambiguate views with the same name.
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
          { value: "", label: "(pick a view)" },
          ...allViews().map(({ view, tableName }) => ({
            value: view.id,
            label: `${tableName} · ${view.name}`,
          })),
        ]}
      />
      <div class="md:col-span-2 text-[11px] text-dimmed">
        Embedded views show 25 records inline with an "Open full view →" link
        to the records page.
      </div>
    </div>
  );
}

// =============================================================================
// Permissions section
// =============================================================================

function DashboardPermissions(props: {
  dashboardId: string;
  initialEntries: AccessEntry[];
  canEdit: boolean;
}) {
  const [entries, setEntries] = createSignal(props.initialEntries);

  const grant = mutations.create<
    { accessId: string },
    { principal: import("@valentinkolb/cloud/contracts").Principal; permission: "read" | "none" }
  >({
    mutation: async (input) => {
      const res = await apiClient.access["by-dashboard"][":dashboardId"].$post({
        param: { dashboardId: props.dashboardId },
        json: input,
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to grant access"));
      return (await res.json()) as { accessId: string };
    },
    onSuccess: async () => {
      const listRes = await apiClient.access["by-dashboard"][":dashboardId"].$get({
        param: { dashboardId: props.dashboardId },
      });
      if (listRes.ok) setEntries((await listRes.json()) as AccessEntry[]);
    },
    onError: (e) => prompts.error(e.message),
  });

  const revoke = async (accessId: string) => {
    const res = await apiClient.access[":accessId"].$delete({ param: { accessId } });
    if (!res.ok) {
      prompts.error(await errorMessage(res, "Failed to revoke access"));
      return;
    }
    setEntries(entries().filter((e) => e.id !== accessId));
  };

  return (
    <PermissionEditor
      entries={entries()}
      allowedLevels={["read"]}
      onGrant={(principal, permission) =>
        grant.mutate({ principal, permission: permission as "read" | "none" })
      }
      onRevoke={revoke}
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
        `Delete the "${props.name}" dashboard? This cannot be undone from the UI (admin can restore from the trash).`,
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
