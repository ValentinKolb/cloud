import type { AccessEntry } from "@valentinkolb/cloud/contracts/shared";
import {
  CheckboxCard,
  confirmDiscardIfDirty,
  dialogCore,
  IconInput,
  PanelDialog,
  panelDialogOptions,
  prompts,
  Select,
  TextInput,
  toast,
} from "@valentinkolb/cloud/ui";
import { navigateTo, refreshCurrentPath } from "@valentinkolb/ssr/nav";
import type { DateContext } from "@valentinkolb/stdlib";
import { mutation as mutations } from "@valentinkolb/stdlib/solid";
import { createEffect, createSignal, For, Show } from "solid-js";
import { apiClient } from "@/api/client";
import type { Dashboard, DashboardConfig, DashboardRow, Field, Form, View, Widget, Workflow } from "../../../service";
import {
  defaultChartWidget,
  defaultFormWidget,
  defaultLinkWidget,
  defaultMarkdownWidget,
  defaultStatWidget,
  defaultViewStatsWidget,
  defaultViewWidget,
  defaultWorkflowButtonWidget,
  isChartReadyView,
  openCellEditDialog,
} from "../dialogs/DashboardWidgetDialogs";
import { dashboardWorkflowOption } from "../dialogs/dashboard-workflow-options";
import { createDraft } from "../editor-draft";
import { ScopedPermissionEditor } from "../permissions/ScopedPermissionEditor";
import { errorMessage } from "../utils/api-helpers";
import DashboardLayout from "./DashboardLayout";
import { clampInsertionIndex, moveItemByInsertionIndex } from "./dashboard-reorder";
import type { WidgetData } from "./widget-data";

type Props = {
  baseShortId: string;
  initialDashboard: Dashboard;
  isBaseDefault: boolean;
  tables: Array<{ id: string; name: string; slug: string }>;
  dashboards: Dashboard[];
  dashboardWorkflows: Workflow[];
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
  { id: "stat", label: "Number", description: "Highlight one important value.", icon: "ti ti-number" },
  { id: "view", label: "Records", description: "Show a filtered list of records.", icon: "ti ti-table-spark" },
  { id: "chart", label: "Chart", description: "Compare categories or show a trend.", icon: "ti ti-chart-bar" },
  { id: "view-stats", label: "Summary", description: "Show several values at a glance.", icon: "ti ti-layout-2" },
  { id: "form", label: "Form", description: "Let people add a record.", icon: "ti ti-forms" },
  { id: "markdown", label: "Text", description: "Add notes or instructions.", icon: "ti ti-markdown" },
  { id: "link", label: "Link", description: "Open another page or form.", icon: "ti ti-link" },
  { id: "workflow-button", label: "Workflow", description: "Run an automated action.", icon: "ti ti-route" },
];

const newWidget = (kind: Widget["kind"], tableId: string): Widget => {
  if (kind === "stat") return defaultStatWidget(tableId);
  if (kind === "view") return defaultViewWidget(tableId);
  if (kind === "chart") return defaultChartWidget(tableId);
  if (kind === "view-stats") return defaultViewStatsWidget(tableId);
  if (kind === "markdown") return defaultMarkdownWidget();
  if (kind === "link") return defaultLinkWidget();
  if (kind === "workflow-button") return defaultWorkflowButtonWidget();
  return defaultFormWidget();
};

const firstForm = (formsByTable: Record<string, Form[]>) =>
  Object.values(formsByTable)
    .flat()
    .find((form) => !form.deletedAt && !form.isDefault);

const configuredNewWidget = (
  kind: Widget["kind"],
  ctx: {
    tableId: string;
    dashboards: Dashboard[];
    dashboardWorkflows: Workflow[];
    formsByTable: Record<string, Form[]>;
    viewsByTable: Record<string, View[]>;
  },
): Widget | null => {
  const widget = newWidget(kind, ctx.tableId);
  const views = Object.values(ctx.viewsByTable)
    .flat()
    .filter((view) => !view.deletedAt);
  if (widget.kind === "view" || widget.kind === "view-stats") {
    const view = views[0];
    return view ? ({ ...widget, title: view.name, source: { kind: "view", viewId: view.id } } as Widget) : widget;
  }
  if (widget.kind === "chart") {
    const view = views.find(isChartReadyView);
    return view ? ({ ...widget, title: view.name, source: { kind: "view", viewId: view.id } } as Widget) : widget;
  }
  if (widget.kind === "stat") return widget;
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
  if (widget.kind === "workflow-button") {
    const workflow = ctx.dashboardWorkflows.find((candidate) => dashboardWorkflowOption(candidate).dashboardLauncher.enabled);
    return workflow
      ? ({
          ...widget,
          launcherId: dashboardWorkflowOption(workflow).dashboardLauncher.id,
          title: workflow.name,
          buttonLabel: "Run",
        } as Widget)
      : null;
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

const dashboardScroller = () => document.querySelector('[data-scroll-preserve^="grids-main-"]');

const captureDashboardScrollTop = () => {
  const scroller = dashboardScroller();
  return scroller instanceof HTMLElement ? scroller.scrollTop : null;
};

const restoreDashboardScrollTop = (scrollTop: number | null) => {
  const scroller = dashboardScroller();
  if (!(scroller instanceof HTMLElement) || scrollTop === null) return;
  requestAnimationFrame(() => {
    scroller.scrollTop = scrollTop;
  });
};

const withDashboardScrollPreserved = (update: () => void, scrollTop = captureDashboardScrollTop()) => {
  update();
  restoreDashboardScrollTop(scrollTop);
};

export default function DashboardWysiwygEditor(props: Props) {
  const [config, setConfig] = createSignal<DashboardConfig>(props.initialDashboard.config);
  const [widgetData, setWidgetData] = createSignal<Record<string, WidgetData>>(props.widgetData);
  const [saveState, setSaveState] = createSignal<"idle" | "saving" | "saved" | "error">("idle");
  let confirmedConfig = props.initialDashboard.config;
  let saveQueue: Promise<void> = Promise.resolve();
  let saveToken = 0;
  let pendingScrollTop: number | null | undefined;

  createEffect(() => {
    const incoming = props.widgetData;
    setWidgetData((current) => ({ ...current, ...incoming }));
  });

  const saveConfigMut = mutations.create<
    Dashboard,
    DashboardConfig,
    { widgetsToResolve: Widget[]; token: number; scrollTop: number | null }
  >({
    onBefore: (next) => {
      setSaveState("saving");
      const previous = config();
      const token = ++saveToken;
      const scrollTop = pendingScrollTop ?? captureDashboardScrollTop();
      pendingScrollTop = undefined;
      withDashboardScrollPreserved(() => setConfig(next), scrollTop);
      return { widgetsToResolve: changedServerWidgets(previous, next, widgetData()), token, scrollTop };
    },
    mutation: (next) => {
      const save = async () => {
        const res = await apiClient.dashboards[":dashboardId"].$patch({
          param: { dashboardId: props.initialDashboard.id },
          json: { config: next },
        });
        if (!res.ok) throw new Error(await errorMessage(res, "Failed to save dashboard"));
        const dashboard = await res.json();
        confirmedConfig = dashboard.config;
        return dashboard;
      };
      const pending = saveQueue.then(save);
      saveQueue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    },
    onSuccess: (dashboard, ctx) => {
      if (ctx?.token !== saveToken) return;
      setSaveState("saved");
      withDashboardScrollPreserved(() => setWidgetData((current) => pruneWidgetData(current, dashboard.config)), ctx.scrollTop);
      if (ctx.widgetsToResolve.length) void resolveWidgets(ctx.widgetsToResolve, ctx.token, ctx.scrollTop);
    },
    onError: (e, ctx) => {
      if (ctx?.token !== saveToken) return;
      setSaveState("error");
      withDashboardScrollPreserved(() => setConfig(confirmedConfig), ctx.scrollTop);
      prompts.error(e.message);
    },
  });

  const resolveWidgets = async (widgets: Widget[], token: number, scrollTop: number | null) => {
    await Promise.all(
      widgets.map(async (widget) => {
        const res = await apiClient.dashboards[":dashboardId"].widgets.resolve.$post({
          param: { dashboardId: props.initialDashboard.id },
          json: widget,
        });
        if (!res.ok) {
          const reason = await errorMessage(res, "Failed to refresh widget");
          if (token !== saveToken) return;
          withDashboardScrollPreserved(
            () => setWidgetData((current) => ({ ...current, [widget.id]: { kind: "error", reason } })),
            scrollTop,
          );
          return;
        }
        const data = await res.json();
        if (token !== saveToken) return;
        withDashboardScrollPreserved(() => setWidgetData((current) => ({ ...current, [widget.id]: data })), scrollTop);
      }),
    );
  };

  const commitRows = (rows: DashboardRow[]) => {
    const next = { ...config(), rows };
    pendingScrollTop ??= captureDashboardScrollTop();
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
    const scrollTop = captureDashboardScrollTop();
    const result = await openRowSettingsDialog(row.height);
    if (!result) return;
    if (result.action === "delete") {
      const widgetCount = row.cells.length;
      const confirmed = await prompts.confirm(
        widgetCount > 0 ? `Delete this row and its ${widgetCount} ${widgetCount === 1 ? "widget" : "widgets"}?` : "Delete this empty row?",
        { title: "Delete row?", variant: "danger", confirmText: "Delete" },
      );
      if (!confirmed) return;
      pendingScrollTop = scrollTop;
      commitRows(config().rows.filter((_, idx) => idx !== rowIdx));
      return;
    }
    if (result.height === row.height) return;
    pendingScrollTop = scrollTop;
    updateRow(rowIdx, { ...row, height: result.height });
  };

  const configureWidget = async (kind: Widget["kind"], cellCount: number) => {
    const initialWidget = configuredNewWidget(kind, {
      tableId: props.tables[0]?.id ?? "",
      dashboards: props.dashboards,
      dashboardWorkflows: props.dashboardWorkflows,
      formsByTable: props.formsByTable,
      viewsByTable: props.viewsByTable,
    });
    if (!initialWidget) {
      prompts.error(
        kind === "form"
          ? "Create a form before adding a form widget."
          : "Create an enabled dashboard or scanner workflow launcher before adding this widget.",
      );
      return;
    }
    const result = await openCellEditDialog(withSpan(initialWidget, cellCount === 0 ? 12 : (initialWidget.span ?? 3)), {
      baseId: props.initialDashboard.baseId,
      dashboardId: props.initialDashboard.id,
      tables: props.tables,
      dashboards: props.dashboards,
      dashboardWorkflows: props.dashboardWorkflows,
      fieldsByTable: props.fieldsByTable,
      viewsByTable: props.viewsByTable,
      formsByTable: props.formsByTable,
    });
    return result?.action === "save" ? result.widget : undefined;
  };

  const addCell = async (rowIdx: number) => {
    const row = config().rows[rowIdx];
    if (!row || row.cells.length >= 12) return;
    const kind = await chooseCellKind();
    if (!kind) return;
    const configuredWidget = await configureWidget(kind, row.cells.length);
    if (!configuredWidget) return;
    const nextCells = [...row.cells, configuredWidget];
    updateRow(rowIdx, { ...row, cells: cellsAreEven(row.cells) ? rebalanceEvenCells(nextCells) : nextCells });
  };

  const addFirstWidget = async () => {
    if (config().rows.length > 0) return;
    const kind = await chooseCellKind();
    if (!kind) return;
    const widget = await configureWidget(kind, 0);
    if (!widget) return;
    commitRows([{ id: newRowId(), kind: "row", height: "md", cells: [widget] }]);
  };

  const editCell = async (rowIdx: number, cellIdx: number) => {
    const row = config().rows[rowIdx];
    const cell = row?.cells[cellIdx];
    if (!row || !cell) return;
    const result = await openCellEditDialog(
      cell,
      {
        baseId: props.initialDashboard.baseId,
        dashboardId: props.initialDashboard.id,
        tables: props.tables,
        dashboards: props.dashboards,
        dashboardWorkflows: props.dashboardWorkflows,
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
    const currentRows = config().rows;
    const fromRow = currentRows[fromRowIdx];
    const toRow = currentRows[toRowIdx];
    if (!fromRow || !toRow) return;

    if (fromRowIdx === toRowIdx) {
      const nextCells = moveItemByInsertionIndex(fromRow.cells, fromCellIdx, toCellIdx);
      if (nextCells === fromRow.cells) return;
      const rows = [...currentRows];
      rows[fromRowIdx] = { ...fromRow, cells: nextCells };
      commitRows(rows);
      return;
    }

    const targetIdx = toCellIdx === Number.MAX_SAFE_INTEGER ? toRow.cells.length : clampInsertionIndex(toCellIdx, toRow.cells.length);
    const fromCells = [...fromRow.cells];
    const toCells = [...toRow.cells];
    const [cell] = fromCells.splice(fromCellIdx, 1);
    if (!cell) return;
    toCells.splice(targetIdx, 0, cell);
    const rows = [...currentRows];
    rows[fromRowIdx] = { ...fromRow, cells: fromCells };
    rows[toRowIdx] = { ...toRow, cells: toCells };
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
        saveState: saveState(),
        onGeneral: () =>
          openDashboardGeneralDialog({
            dashboard: props.initialDashboard,
            isBaseDefault: props.isBaseDefault,
            baseShortId: props.baseShortId,
            initialAccessEntries: props.initialAccessEntries,
            canEditAccess: props.canEditAccess,
          }),
        onAddFirstWidget: addFirstWidget,
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
        <PanelDialog.Header title="Add widget" icon="ti ti-plus" close={() => close(undefined)} />
        <PanelDialog.Body>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <For each={CELL_KIND_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  class="paper flex items-center gap-3 p-4 text-left transition hover:paper-highlighted"
                  onClick={() => close(opt.id)}
                >
                  <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ui-radius-control)] bg-[var(--ui-surface-subtle)] text-dimmed">
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
      <DashboardGeneralBody {...props} onDirtyChange={setDirty} close={closeIfClean} onDuplicated={props.close} />
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
  onDuplicated: () => void;
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
        <PanelDialog.Section title="General" subtitle="Name, description, and sharing." icon="ti ti-id">
          <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
            <TextInput label="Name" value={name} onInput={(v) => patch({ name: v })} required />
            <TextInput label="Description" value={description} onInput={(v) => patch({ description: v })} />
            <IconInput label="Icon" value={icon} onChange={(v) => patch({ icon: v })} placeholder="Search icons..." />
          </div>
          <CheckboxCard
            label="Shared dashboard"
            description="Visible to users who can open this base. Permissions below can narrow access."
            icon="ti ti-users"
            value={shared}
            onChange={(v) => patch({ shared: v })}
          />
          <Show when={props.isBaseDefault}>
            <p class="app-accent-text text-xs">
              <i class="ti ti-home mr-1" /> This dashboard is the base default.
            </p>
          </Show>
        </PanelDialog.Section>

        <PanelDialog.Section
          title="Permissions"
          subtitle="Viewers see dashboard widgets. Source pages keep their own access."
          icon="ti ti-lock"
        >
          <DashboardPermissions
            dashboardId={props.dashboard.id}
            initialEntries={props.initialAccessEntries}
            canEdit={props.canEditAccess}
          />
        </PanelDialog.Section>
      </PanelDialog.Body>
      <PanelDialog.Footer>
        <div class="flex items-center gap-2">
          <DuplicateDashboardButton
            dashboard={props.dashboard}
            baseShortId={props.baseShortId}
            onDuplicated={props.onDuplicated}
            dirty={draft.dirty}
          />
          <DeleteDashboardButton dashboardId={props.dashboard.id} baseShortId={props.baseShortId} name={props.dashboard.name} />
        </div>
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

function DuplicateDashboardButton(props: { dashboard: Dashboard; baseShortId: string; onDuplicated: () => void; dirty: () => boolean }) {
  const mut = mutations.create<Dashboard, { name: string; shared: boolean }>({
    mutation: async (input) => {
      const currentRes = await apiClient.dashboards[":dashboardId"].$get({
        param: { dashboardId: props.dashboard.id },
      });
      if (!currentRes.ok) throw new Error(await errorMessage(currentRes, "Failed to load dashboard"));
      const current = await currentRes.json();

      const createRes = await apiClient.dashboards["by-base"][":baseId"].$post({
        param: { baseId: current.baseId },
        json: {
          name: input.name,
          description: current.description,
          icon: current.icon,
          config: current.config,
          shared: input.shared,
        },
      });
      if (!createRes.ok) throw new Error(await errorMessage(createRes, "Failed to duplicate dashboard"));
      return createRes.json();
    },
    onSuccess: (dashboard) => {
      props.onDuplicated();
      toast.success("Dashboard duplicated");
      navigateTo(`/app/grids/${props.baseShortId}/dashboard/${dashboard.shortId}?edit=true`);
    },
    onError: (e) => prompts.error(e.message),
  });

  const duplicate = async () => {
    if (props.dirty()) {
      prompts.error("Save or discard your dashboard settings before duplicating it.");
      return;
    }
    const result = await prompts.form({
      title: "Duplicate dashboard",
      icon: "ti ti-copy",
      fields: {
        name: {
          type: "text",
          label: "Name",
          required: true,
          default: `${props.dashboard.name} copy`,
          description: "Copies the latest saved layout and widgets. Permissions are not copied.",
        },
        shared: {
          type: "boolean",
          label: "Shared dashboard",
          description: "Visible to everyone who can open this base.",
          default: false,
        },
      },
      confirmText: "Duplicate",
    });
    if (!result) return;
    const name = String(result.name).trim();
    if (!name) {
      prompts.error("Name is required");
      return;
    }
    mut.mutate({ name, shared: Boolean(result.shared) });
  };

  return (
    <button type="button" class="btn-input btn-sm" disabled={mut.loading()} onClick={() => void duplicate()}>
      <i class={`ti ${mut.loading() ? "ti-loader-2 animate-spin" : "ti-copy"}`} /> Duplicate dashboard
    </button>
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
