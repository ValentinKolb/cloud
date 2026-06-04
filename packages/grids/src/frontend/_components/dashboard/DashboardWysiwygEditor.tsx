import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  Checkbox,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  panelDialogOptions,
  PanelDialog,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { refreshCurrentPath } from "@valentinkolb/ssr/nav";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import type { DateContext } from "@valentinkolb/stdlib";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Automation, Dashboard, DashboardConfig, DashboardRow, Field, Form, View, Widget } from "../../../service";
import {
  defaultAutomationButtonWidget,
  defaultChartWidget,
  defaultFormWidget,
  defaultLinkWidget,
  defaultMarkdownWidget,
  defaultStatWidget,
  defaultViewStatsWidget,
  defaultViewWidget,
  isChartReadyView,
  openCellEditDialog,
} from "../dialogs/DashboardWidgetDialogs";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import { SectionCard } from "../utils/SectionCard";
import DashboardLayout from "./DashboardLayout";
import { clampInsertionIndex, moveItemByInsertionIndex } from "./dashboard-reorder";
import type { WidgetData } from "./widget-data";

type Props = {
  baseShortId: string;
  initialDashboard: Dashboard;
  isBaseDefault: boolean;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
  manualAutomations: Automation[];
  fieldsByTable: Record<string, Field[]>;
  viewsByTable: Record<string, View[]>;
  formsByTable: Record<string, Form[]>;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
  widgetData: Record<string, WidgetData>;
  dateConfig?: DateContext;
  onWidgetRecordsChanged?: () => void;
  onDashboardChanged?: () => void;
};

const CELL_KIND_OPTIONS: Array<{ id: Widget["kind"]; label: string; description: string; icon: string }> = [
  { id: "stat", label: "Stat", description: "One KPI from a table.", icon: "ti ti-number" },
  { id: "view", label: "View", description: "Records from a view or table.", icon: "ti ti-table-spark" },
  { id: "chart", label: "Chart", description: "Buckets from a grouped view.", icon: "ti ti-chart-bar" },
  { id: "view-stats", label: "View stats", description: "Compact summary from a view.", icon: "ti ti-layout-2" },
  { id: "form", label: "Form", description: "Inline record creation.", icon: "ti ti-forms" },
  { id: "markdown", label: "Markdown", description: "Notes or instructions.", icon: "ti ti-markdown" },
  { id: "link", label: "Link", description: "Open a resource or URL.", icon: "ti ti-link" },
  { id: "automation-button", label: "Automation", description: "Run a manual automation.", icon: "ti ti-player-play" },
];

const newWidget = (kind: Widget["kind"], tableId: string): Widget => {
  if (kind === "stat") return defaultStatWidget(tableId);
  if (kind === "view") return defaultViewWidget();
  if (kind === "chart") return defaultChartWidget();
  if (kind === "view-stats") return defaultViewStatsWidget();
  if (kind === "markdown") return defaultMarkdownWidget();
  if (kind === "link") return defaultLinkWidget();
  if (kind === "automation-button") return defaultAutomationButtonWidget();
  return defaultFormWidget();
};

const firstView = (viewsByTable: Record<string, View[]>) =>
  Object.values(viewsByTable)
    .flat()
    .find((view) => !view.deletedAt);

const firstChartReadyView = (viewsByTable: Record<string, View[]>) =>
  Object.values(viewsByTable)
    .flat()
    .find((view) => !view.deletedAt && isChartReadyView(view));

const firstForm = (formsByTable: Record<string, Form[]>) =>
  Object.values(formsByTable)
    .flat()
    .find((form) => !form.deletedAt && !form.isDefault);

const configuredNewWidget = (
  kind: Widget["kind"],
  ctx: {
    tableId: string;
    dashboards: Dashboard[];
    manualAutomations: Automation[];
    viewsByTable: Record<string, View[]>;
    formsByTable: Record<string, Form[]>;
  },
): Widget | null => {
  const widget = newWidget(kind, ctx.tableId);
  if (widget.kind === "view") {
    const view = firstView(ctx.viewsByTable);
    return view ? ({ ...widget, source: { kind: "view", viewId: view.id }, title: view.name } as Widget) : null;
  }
  if (widget.kind === "chart") {
    const view = firstChartReadyView(ctx.viewsByTable);
    return view ? ({ ...widget, viewId: view.id } as Widget) : null;
  }
  if (widget.kind === "view-stats") {
    const view = firstView(ctx.viewsByTable);
    return view ? ({ ...widget, viewId: view.id, title: view.name } as Widget) : null;
  }
  if (widget.kind === "form") {
    const form = firstForm(ctx.formsByTable);
    return form ? ({ ...widget, formId: form.id, title: form.name } as Widget) : null;
  }
  if (widget.kind === "link") {
    const dashboard = ctx.dashboards.find((d) => !d.deletedAt);
    if (dashboard) return { ...widget, title: dashboard.name, target: { kind: "dashboard", dashboardId: dashboard.id } } as Widget;
    const tableId = ctx.tableId;
    return tableId ? ({ ...widget, title: "Open table", target: { kind: "table", tableId } } as Widget) : null;
  }
  if (widget.kind === "automation-button") {
    const automation = ctx.manualAutomations.find((candidate) => candidate.enabled);
    return automation ? ({ ...widget, automationId: automation.id, title: automation.name, buttonLabel: "Run" } as Widget) : null;
  }
  return widget;
};

const newRowId = () => `r_${crypto.randomUUID().slice(0, 8)}`;
const clampSpan = (span: number) => Math.max(1, Math.min(12, span));
const spanOf = (widget: Widget) => clampSpan(widget.span ?? 12);

const withSpan = (widget: Widget, span: number): Widget => ({ ...widget, span: clampSpan(span) }) as Widget;

const cellsAreEven = (cells: Widget[]) => {
  if (cells.length <= 1) return true;
  const first = spanOf(cells[0]!);
  return cells.every((cell) => spanOf(cell) === first);
};

const rebalanceEvenCells = (cells: Widget[]) => {
  if (cells.length === 0) return cells;
  const span = Math.max(1, Math.floor(12 / cells.length));
  return cells.map((cell) => withSpan(cell, span));
};

export default function DashboardWysiwygEditor(props: Props) {
  const [config, setConfig] = createSignal<DashboardConfig>(props.initialDashboard.config);
  const [widgetData, setWidgetData] = createSignal<Record<string, WidgetData>>(props.widgetData);
  let saveToken = 0;

  createEffect(() => {
    const incoming = props.widgetData;
    setWidgetData((current) => ({ ...current, ...incoming }));
  });

  const saveConfigMut = mutations.create<
    Dashboard,
    DashboardConfig,
    { previous: DashboardConfig; widgetsToResolve: Widget[]; token: number }
  >({
    onBefore: (next) => {
      const previous = config();
      const token = ++saveToken;
      setConfig(next);
      return { previous, widgetsToResolve: changedServerWidgets(previous, next, widgetData()), token };
    },
    mutation: async (next) => {
      const res = await apiClient.dashboards[":dashboardId"].$patch({
        param: { dashboardId: props.initialDashboard.id },
        json: { config: next },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save dashboard"));
      return res.json();
    },
    onSuccess: (dashboard, ctx) => {
      if (ctx?.token !== saveToken) return;
      setConfig(dashboard.config);
      setWidgetData((current) => pruneWidgetData(current, dashboard.config));
      if (ctx.widgetsToResolve.length) void resolveWidgets(ctx.widgetsToResolve, ctx.token);
      props.onDashboardChanged?.();
    },
    onError: (e, ctx) => {
      if (ctx?.token !== saveToken) return;
      if (ctx?.previous) setConfig(ctx.previous);
      prompts.error(e.message);
    },
  });

  const resolveWidgets = async (widgets: Widget[], token: number) => {
    await Promise.all(
      widgets.map(async (widget) => {
        const res = await apiClient.dashboards[":dashboardId"].widgets.resolve.$post({
          param: { dashboardId: props.initialDashboard.id },
          json: widget,
        });
        if (!res.ok) {
          const reason = await errorMessage(res, "Failed to refresh widget");
          if (token !== saveToken) return;
          setWidgetData((current) => ({ ...current, [widget.id]: { kind: "error", reason } }));
          return;
        }
        const data = await res.json();
        if (token !== saveToken) return;
        setWidgetData((current) => ({ ...current, [widget.id]: data }));
      }),
    );
  };

  const commitRows = (rows: DashboardRow[]) => {
    const next = { ...config(), rows };
    void saveConfigMut.mutate(next);
  };

  const addRowAt = (rowIdx: number) => {
    const rows = [...config().rows];
    rows.splice(Math.max(0, Math.min(rowIdx, rows.length)), 0, { id: newRowId(), kind: "row", height: "md", cells: [] });
    commitRows(rows);
  };

  const moveRow = (fromRowIdx: number, toRowIdx: number) => {
    const rows = config().rows;
    const next = moveItemByInsertionIndex(rows, fromRowIdx, toRowIdx);
    if (next !== rows) commitRows(next);
  };

  const updateRow = (rowIdx: number, row: DashboardRow) => commitRows(config().rows.map((r, idx) => (idx === rowIdx ? row : r)));

  const editRow = async (rowIdx: number) => {
    const row = config().rows[rowIdx];
    if (!row) return;
    const result = await openRowSettingsDialog(row.height);
    if (!result) return;
    if (result.action === "delete") {
      commitRows(config().rows.filter((_, idx) => idx !== rowIdx));
      return;
    }
    updateRow(rowIdx, { ...row, height: result.height });
  };

  const addCell = async (rowIdx: number) => {
    const row = config().rows[rowIdx];
    if (!row || row.cells.length >= 12) return;
    const kind = await chooseCellKind();
    if (!kind) return;
    const initialWidget = configuredNewWidget(kind, {
      tableId: props.tables[0]?.id ?? "",
      dashboards: props.dashboards,
      manualAutomations: props.manualAutomations,
      viewsByTable: props.viewsByTable,
      formsByTable: props.formsByTable,
    });
    if (!initialWidget) {
      prompts.error(
        kind === "form"
          ? "Create a form before adding a form widget."
          : kind === "chart"
            ? "Create a grouped view with at least one summary value first."
            : kind === "automation-button"
              ? "Create an enabled manual automation before adding this widget."
              : "Create a view before adding this widget.",
      );
      return;
    }
    const result = await openCellEditDialog(withSpan(initialWidget, row.cells.length === 0 ? 12 : (initialWidget.span ?? 3)), {
      tables: props.tables,
      dashboards: props.dashboards,
      manualAutomations: props.manualAutomations,
      fieldsByTable: props.fieldsByTable,
      viewsByTable: props.viewsByTable,
      formsByTable: props.formsByTable,
    });
    if (!result || result.action !== "save") return;
    const configuredWidget = result.widget;
    const nextCells = [...row.cells, configuredWidget];
    updateRow(rowIdx, { ...row, cells: cellsAreEven(row.cells) ? rebalanceEvenCells(nextCells) : nextCells });
  };

  const editCell = async (rowIdx: number, cellIdx: number) => {
    const row = config().rows[rowIdx];
    const cell = row?.cells[cellIdx];
    if (!row || !cell) return;
    const result = await openCellEditDialog(
      cell,
      {
        tables: props.tables,
        dashboards: props.dashboards,
        manualAutomations: props.manualAutomations,
        fieldsByTable: props.fieldsByTable,
        viewsByTable: props.viewsByTable,
        formsByTable: props.formsByTable,
      },
      { allowDelete: true },
    );
    if (!result) return;
    if (result.action === "delete") {
      updateRow(rowIdx, { ...row, cells: row.cells.filter((_, idx) => idx !== cellIdx) });
      return;
    }
    updateRow(rowIdx, { ...row, cells: row.cells.map((c, idx) => (idx === cellIdx ? result.widget : c)) });
  };

  const moveCell = (fromRowIdx: number, fromCellIdx: number, toRowIdx: number, toCellIdx: number) => {
    const rows = config().rows.map((row) => ({ ...row, cells: [...row.cells] }));
    const fromRow = rows[fromRowIdx];
    const toRow = rows[toRowIdx];
    if (!fromRow || !toRow) return;

    if (fromRowIdx === toRowIdx) {
      const nextCells = moveItemByInsertionIndex(fromRow.cells, fromCellIdx, toCellIdx);
      if (nextCells === fromRow.cells) return;
      rows[fromRowIdx] = { ...fromRow, cells: nextCells };
      commitRows(rows);
      return;
    }

    const targetIdx = toCellIdx === Number.MAX_SAFE_INTEGER ? toRow.cells.length : clampInsertionIndex(toCellIdx, toRow.cells.length);
    const [cell] = fromRow.cells.splice(fromCellIdx, 1);
    if (!cell) return;
    toRow.cells.splice(targetIdx, 0, cell);
    commitRows(rows);
  };

  const dashboard = () => ({ ...props.initialDashboard, config: config() });

  return (
    <DashboardLayout
      dashboard={dashboard()}
      widgetData={widgetData()}
      baseShortId={props.baseShortId}
      dateConfig={props.dateConfig}
      onWidgetRecordsChanged={props.onWidgetRecordsChanged}
      edit={{
        onGeneral: () =>
          openDashboardGeneralDialog({
            dashboard: props.initialDashboard,
            isBaseDefault: props.isBaseDefault,
            baseShortId: props.baseShortId,
            initialAccessEntries: props.initialAccessEntries,
            canEditAccess: props.canEditAccess,
          }),
        onAddRowAt: addRowAt,
        onMoveRow: moveRow,
        onEditRow: editRow,
        onAddCell: addCell,
        onEditCell: editCell,
        onMoveCell: moveCell,
      }}
    />
  );
}

const configWidgets = (config: DashboardConfig): Widget[] => config.rows.flatMap((row) => row.cells);

const needsServerData = (widget: Widget): boolean => widget.kind !== "markdown";

const changedServerWidgets = (previous: DashboardConfig, next: DashboardConfig, currentData: Record<string, WidgetData>): Widget[] => {
  const previousById = new Map(configWidgets(previous).map((widget) => [widget.id, widget]));
  return configWidgets(next).filter((widget) => {
    if (!needsServerData(widget)) return false;
    const previousWidget = previousById.get(widget.id);
    return !currentData[widget.id] || !previousWidget || JSON.stringify(previousWidget) !== JSON.stringify(widget);
  });
};

const pruneWidgetData = (current: Record<string, WidgetData>, config: DashboardConfig): Record<string, WidgetData> => {
  const alive = new Set(configWidgets(config).map((widget) => widget.id));
  return Object.fromEntries(Object.entries(current).filter(([id]) => alive.has(id)));
};

const chooseCellKind = () =>
  dialogCore.open<Widget["kind"] | undefined>(
    (close) => (
      <PanelDialog>
        <PanelDialog.Header title="Add cell" icon="ti ti-plus" close={() => close(undefined)} />
        <PanelDialog.Body>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={CELL_KIND_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  class="paper flex items-center gap-3 p-4 text-left transition hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  onClick={() => close(opt.id)}
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-dimmed dark:bg-zinc-800">
                    <i class={opt.icon} />
                  </span>
                  <span class="min-w-0">
                    <span class="block font-semibold text-primary">{opt.label}</span>
                    <span class="mt-0.5 block text-xs text-dimmed">{opt.description}</span>
                  </span>
                </button>
              )}
            </For>
          </div>
        </PanelDialog.Body>
      </PanelDialog>
    ),
    panelDialogOptions,
  );

const ROW_HEIGHT_OPTIONS: Array<{ id: DashboardRow["height"]; label: string; description: string; icon: string }> = [
  { id: "sm", label: "Compact", description: "Short rows for stats and small snippets.", icon: "ti ti-line-height" },
  { id: "md", label: "Standard", description: "Balanced height for most dashboard rows.", icon: "ti ti-layout-list" },
  { id: "lg", label: "Tall", description: "More space for charts, embedded views, and forms.", icon: "ti ti-maximize" },
];

type RowSettingsResult = { action: "save"; height: DashboardRow["height"] } | { action: "delete" };

const openRowSettingsDialog = (current: DashboardRow["height"]) =>
  dialogCore.open<RowSettingsResult | undefined>((close) => {
    const [height, setHeight] = createSignal<DashboardRow["height"]>(current);
    return (
      <PanelDialog>
        <PanelDialog.Header title="Row settings" icon="ti ti-settings" close={() => close(undefined)} />
        <PanelDialog.Body>
          <Select
            label="Row height"
            description="Controls the minimum height of widgets in this row."
            value={height}
            onChange={(value) => setHeight(value as DashboardRow["height"])}
            options={ROW_HEIGHT_OPTIONS.map((opt) => ({ id: opt.id, label: opt.label, description: opt.description }))}
          />
        </PanelDialog.Body>
        <PanelDialog.Footer>
          <button type="button" class="btn-danger btn-sm" onClick={() => close({ action: "delete" })}>
            <i class="ti ti-trash" /> Delete row
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="btn-simple btn-sm" onClick={() => close(undefined)}>
              Cancel
            </button>
            <button type="button" class="btn-primary btn-sm" onClick={() => close({ action: "save", height: height() })}>
              Save
            </button>
          </div>
        </PanelDialog.Footer>
      </PanelDialog>
    );
  }, panelDialogOptions);

function openDashboardGeneralDialog(props: {
  dashboard: Dashboard;
  isBaseDefault: boolean;
  baseShortId: string;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
}) {
  return dialogCore.open<void>((close) => <DashboardGeneralDialog {...props} close={close} />, panelDialogOptions);
}

function DashboardGeneralDialog(props: {
  dashboard: Dashboard;
  isBaseDefault: boolean;
  baseShortId: string;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
  close: () => void;
}) {
  const [dirty, setDirty] = createSignal(false);
  const closeIfClean = async () => {
    if (await confirmDiscardIfDirty(dirty)) props.close();
  };
  return (
    <PanelDialog>
      <PanelDialog.Header title={`Dashboard settings — ${props.dashboard.name}`} icon="ti ti-layout-dashboard" close={closeIfClean} />
      <DashboardGeneralBody {...props} onDirtyChange={setDirty} close={closeIfClean} />
    </PanelDialog>
  );
}

function DashboardGeneralBody(props: {
  dashboard: Dashboard;
  isBaseDefault: boolean;
  baseShortId: string;
  initialAccessEntries: AccessEntry[];
  canEditAccess: boolean;
  close: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const draft = createDraft({
    name: props.dashboard.name,
    description: props.dashboard.description ?? "",
    icon: props.dashboard.icon ?? "",
    shared: props.dashboard.ownerUserId === null,
  });
  const patch = (partial: Partial<ReturnType<typeof draft.draft>>) => {
    draft.patch(partial);
    props.onDirtyChange?.(true);
  };
  const name = () => draft.draft().name;
  const description = () => draft.draft().description;
  const icon = () => draft.draft().icon;
  const shared = () => draft.draft().shared;

  const saveMut = mutations.create<Dashboard, void>({
    mutation: async () => {
      if (!name().trim()) throw new Error("Name is required");
      const res = await apiClient.dashboards[":dashboardId"].$patch({
        param: { dashboardId: props.dashboard.id },
        json: { name: name().trim(), description: description().trim() || null, icon: icon() || null, shared: shared() },
      });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to save dashboard"));
      return res.json();
    },
    onSuccess: (saved) => {
      draft.markSaved({
        name: saved.name,
        description: saved.description ?? "",
        icon: saved.icon ?? "",
        shared: saved.ownerUserId === null,
      });
      props.onDirtyChange?.(false);
      toast.success("Dashboard settings saved");
      refreshCurrentPath();
    },
    onError: (e) => prompts.error(e.message),
  });

  return (
    <>
      <PanelDialog.Body>
        <SectionCard title="General" subtitle="Name, description, and sharing.">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextInput label="Name" value={name} onInput={(v) => patch({ name: v })} required />
            <TextInput label="Description" value={description} onInput={(v) => patch({ description: v })} />
            <IconInput label="Icon" value={icon} onChange={(v) => patch({ icon: v })} placeholder="Search icons..." />
          </div>
          <Checkbox
            label="Shared dashboard"
            description="Visible to users who can open this base. Permissions below can narrow access."
            value={shared}
            onChange={(v) => patch({ shared: v })}
          />
          <Show when={props.isBaseDefault}>
            <p class="text-xs text-blue-700 dark:text-blue-300">This dashboard is the base default.</p>
          </Show>
        </SectionCard>

        <SectionCard title="Permissions" subtitle="Choose who can open this dashboard. Dashboards only support View access.">
          <DashboardPermissions
            dashboardId={props.dashboard.id}
            initialEntries={props.initialAccessEntries}
            canEdit={props.canEditAccess}
          />
        </SectionCard>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <DeleteDashboardButton dashboardId={props.dashboard.id} baseShortId={props.baseShortId} name={props.dashboard.name} />
        <div class="flex items-center gap-2">
          <button type="button" class="btn-input btn-sm" onClick={props.close}>
            Cancel
          </button>
          <button
            type="button"
            class="btn-primary btn-sm"
            onClick={() => saveMut.mutate(undefined)}
            disabled={!draft.dirty() || saveMut.loading()}
          >
            {saveMut.loading() ? <i class="ti ti-loader-2 animate-spin" /> : "Save"}
          </button>
        </div>
      </PanelDialog.Footer>
    </>
  );
}

function DashboardPermissions(props: { dashboardId: string; initialEntries: AccessEntry[]; canEdit: boolean }) {
  if (!props.canEdit) return <p class="text-xs text-dimmed">You can view these permissions, but not change them.</p>;
  return (
    <ScopedPermissionEditor
      scope={{ type: "dashboard", id: props.dashboardId }}
      initialEntries={props.initialEntries}
      allowedLevels={["read"]}
    />
  );
}

function DeleteDashboardButton(props: { dashboardId: string; baseShortId: string; name: string }) {
  const mut = mutations.create<void, void>({
    mutation: async () => {
      const res = await apiClient.dashboards[":dashboardId"].$delete({ param: { dashboardId: props.dashboardId } });
      if (!res.ok) throw new Error(await errorMessage(res, "Failed to delete dashboard"));
    },
    onSuccess: () => {
      window.location.href = `/app/grids/${props.baseShortId}`;
    },
    onError: (e) => prompts.error(e.message),
  });
  return (
    <button
      type="button"
      class="btn-danger btn-sm self-start"
      onClick={async () => {
        if (
          await prompts.confirm(`Delete dashboard "${props.name}"?`, {
            title: "Delete dashboard?",
            variant: "danger",
            confirmText: "Delete",
          })
        ) {
          mut.mutate(undefined);
        }
      }}
      disabled={mut.loading()}
    >
      <i class="ti ti-trash" /> Delete dashboard
    </button>
  );
}
