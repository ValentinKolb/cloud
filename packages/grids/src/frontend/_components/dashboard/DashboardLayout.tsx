import { dnd, type DndBuildIntentContext } from "@valentinkolb/stdlib/solid";
import type { DateContext } from "@valentinkolb/stdlib";
import { For, Show, onCleanup } from "solid-js";
import type { Dashboard, DashboardRow, Widget } from "../../../service";
import AutomationButtonWidget from "./AutomationButtonWidget";
import ChartWidget from "./ChartWidget";
import FormCell from "./FormCell";
import LinkWidget from "./LinkWidget";
import MarkdownWidget from "./MarkdownWidget";
import StatWidgetCell from "./StatWidgetCell";
import ViewStatsCell from "./ViewStatsCell";
import EmbeddedViewWidget from "./ViewWidget";
import type { WidgetData } from "./widget-data";

type Props = {
  dashboard: Dashboard;
  /** Pre-resolved per-widget data, keyed by `widget.id`. Includes every
   *  cell across every row — the dashboard fan-out happens server-side
   *  in [baseId]/page.tsx, one Promise.all per page render. */
  widgetData: Record<string, WidgetData>;
  /** Slug of the parent base — needed by view-cell / chart-cell links. */
  baseShortId: string;
  dateConfig?: DateContext;
  onWidgetRecordsChanged?: () => void;
  edit?: {
    onGeneral: () => void;
    onAddRowAt: (rowIdx: number) => void;
    onMoveRow: (fromRowIdx: number, toRowIdx: number) => void;
    onEditRow: (rowIdx: number) => void;
    onAddCell: (rowIdx: number) => void;
    onEditCell: (rowIdx: number, cellIdx: number) => void;
    onMoveCell: (fromRowIdx: number, fromCellIdx: number, toRowIdx: number, toCellIdx: number) => void;
  };
};

/** Minimum cell heights per row's height tier. Stat-only rows ignore
 *  this (they have their natural padded height); mixed and non-stat
 *  rows use it to give views, charts, and forms vertical breathing room. */
const ROW_MIN_HEIGHT_PX = {
  sm: 96,
  md: 192,
  lg: 360,
} as const;

const DASHBOARD_CELL_MAX_HEIGHT = "min(70vh, 820px)";
const EDIT_ICON_CLASS = "icon-btn text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200";

type RowDragMeta = { rowIdx: number };
type RowDropMeta = { insertionIdx: number };
type RowDropIntent = { fromRowIdx: number; toRowIdx: number };

type CellDragMeta = { rowIdx: number; cellIdx: number };
type CellDropMeta = { rowIdx: number; cellIdx: number | null; cellCount?: number; forceEnd?: boolean };
type CellDropIntent = { fromRowIdx: number; fromCellIdx: number; toRowIdx: number; toCellIdx: number };

const clampSpan = (span: number) => Math.max(1, Math.min(12, span));

const defaultSpan = (cellCount: number) => clampSpan(Math.max(1, Math.floor(12 / Math.max(1, cellCount))));

const widgetSpan = (widget: Widget, cellCount: number) => clampSpan(widget.span ?? defaultSpan(cellCount));

const cellFlexStyle = (span: number, minHeight: number) => {
  const s = clampSpan(span);
  const basis = `${(s / 12) * 100}%`;
  return `flex: ${s} 1 calc(${basis} - 0.75rem); min-height: ${minHeight}px; max-height: ${DASHBOARD_CELL_MAX_HEIGHT}`;
};

const emptyRowMinHeightStyle = (row: DashboardRow) => `min-height: ${Math.max(144, ROW_MIN_HEIGHT_PX[row.height])}px`;

const sameRowIntent = (a: RowDropIntent | null, b: RowDropIntent | null) => a?.fromRowIdx === b?.fromRowIdx && a?.toRowIdx === b?.toRowIdx;

const sameCellIntent = (a: CellDropIntent | null, b: CellDropIntent | null) =>
  a?.fromRowIdx === b?.fromRowIdx && a?.fromCellIdx === b?.fromCellIdx && a?.toRowIdx === b?.toRowIdx && a?.toCellIdx === b?.toCellIdx;

const buildRowIntent = (ctx: DndBuildIntentContext<RowDragMeta, RowDropMeta, RowDropIntent>): RowDropIntent | null => {
  if (!ctx.over) return null;
  return {
    fromRowIdx: ctx.active.meta.rowIdx,
    toRowIdx: ctx.over.meta.insertionIdx,
  };
};

const buildCellIntent = (ctx: DndBuildIntentContext<CellDragMeta, CellDropMeta, CellDropIntent>): CellDropIntent | null => {
  if (!ctx.over) return null;
  let targetIndex: number;
  if (ctx.over.meta.forceEnd) {
    targetIndex = Number.MAX_SAFE_INTEGER;
  } else if (ctx.over.meta.cellIdx === null) {
    const count = Math.max(0, ctx.over.meta.cellCount ?? 0);
    const ratio = ctx.over.rect.width > 0 ? (ctx.pointer.x - ctx.over.rect.left) / ctx.over.rect.width : 1;
    targetIndex = Math.max(0, Math.min(count, Math.round(ratio * count)));
  } else {
    targetIndex = ctx.over.meta.cellIdx + (ctx.pointer.x > ctx.over.rect.left + ctx.over.rect.width / 2 ? 1 : 0);
  }
  return {
    fromRowIdx: ctx.active.meta.rowIdx,
    fromCellIdx: ctx.active.meta.cellIdx,
    toRowIdx: ctx.over.meta.rowIdx,
    toCellIdx: targetIndex,
  };
};

/**
 * Top-level read-only dashboard render. Single row type with any mix
 * of cell kinds — stat / view / chart / view-stats / form. Layout
 * dispatch happens per cell, while the row owns placement, DnD and
 * edit controls. Each cell keeps the same size in view and edit mode;
 * edit controls are absolute overlays.
 *
 * Empty dashboard: friendly empty-state instead of blank space.
 */
export default function DashboardLayout(props: Props) {
  const rowDnd = dnd.create<RowDragMeta, RowDropMeta, RowDropIntent>({
    buildIntent: buildRowIntent,
    isSameIntent: sameRowIntent,
    onDrop: ({ intent }) => {
      if (!intent || !props.edit) return;
      props.edit.onMoveRow(intent.fromRowIdx, intent.toRowIdx);
    },
  });

  const cellDnd = dnd.create<CellDragMeta, CellDropMeta, CellDropIntent>({
    buildIntent: buildCellIntent,
    isSameIntent: sameCellIntent,
    onDrop: ({ intent }) => {
      if (!intent || !props.edit) return;
      props.edit.onMoveCell(intent.fromRowIdx, intent.fromCellIdx, intent.toRowIdx, intent.toCellIdx);
    },
  });

  onCleanup(() => {
    rowDnd.destroy();
    cellDnd.destroy();
  });

  return (
    <div class="flex flex-col gap-3 w-full h-full">
      <header class="flex flex-col gap-1">
        <div class="flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <h1 class="flex min-w-0 items-center gap-2 text-xl font-semibold text-primary">
              <Show when={props.dashboard.icon}>{(icon) => <i class={`${icon()} shrink-0 text-lg text-dimmed`} />}</Show>
              <span class="truncate">{props.dashboard.name}</span>
            </h1>
            <Show when={props.dashboard.description}>
              <p class="text-sm text-dimmed">{props.dashboard.description}</p>
            </Show>
          </div>
          <Show when={props.edit}>
            {(edit) => (
              <div class="flex shrink-0 flex-wrap items-center justify-end gap-2">
                <button type="button" class="btn-input btn-input-sm" onClick={edit().onGeneral}>
                  <i class="ti ti-settings" /> General
                </button>
              </div>
            )}
          </Show>
        </div>
      </header>

      <Show when={props.dashboard.config.rows.length > 0} fallback={<EmptyDashboardState edit={props.edit} />}>
        <Show when={props.edit}>
          {(edit) => <AddRowRail label="Add row" insertionIdx={0} rowDnd={rowDnd} onAdd={() => edit().onAddRowAt(0)} />}
        </Show>
        <For each={props.dashboard.config.rows}>
          {(row, rowIdx) => (
            <>
              <RowRenderer
                row={row}
                rowIdx={rowIdx()}
                rowCount={props.dashboard.config.rows.length}
                dashboardId={props.dashboard.id}
                widgetData={props.widgetData}
                baseShortId={props.baseShortId}
                onWidgetRecordsChanged={props.onWidgetRecordsChanged}
                edit={props.edit}
                rowDnd={rowDnd}
                cellDnd={cellDnd}
                dateConfig={props.dateConfig}
              />
              <Show when={props.edit}>
                {(edit) => (
                  <AddRowRail
                    label="Add row"
                    insertionIdx={rowIdx() + 1}
                    rowDnd={rowDnd}
                    active={rowDnd.intent()?.toRowIdx === rowIdx() + 1}
                    onAdd={() => edit().onAddRowAt(rowIdx() + 1)}
                  />
                )}
              </Show>
            </>
          )}
        </For>
      </Show>
    </div>
  );
}

/** Per-row dispatcher. Kept small so row placement and cell rendering
 *  stay separate. */
function RowRenderer(props: {
  row: DashboardRow;
  rowIdx: number;
  rowCount: number;
  dashboardId: string;
  widgetData: Record<string, WidgetData>;
  baseShortId: string;
  onWidgetRecordsChanged?: () => void;
  edit?: Props["edit"];
  rowDnd: ReturnType<typeof dnd.create<RowDragMeta, RowDropMeta, RowDropIntent>>;
  cellDnd: ReturnType<typeof dnd.create<CellDragMeta, CellDropMeta, CellDropIntent>>;
  dateConfig?: DateContext;
}) {
  return (
    <DashboardRowGrid
      row={props.row}
      rowIdx={props.rowIdx}
      rowCount={props.rowCount}
      dashboardId={props.dashboardId}
      widgetData={props.widgetData}
      baseShortId={props.baseShortId}
      onWidgetRecordsChanged={props.onWidgetRecordsChanged}
      edit={props.edit}
      rowDnd={props.rowDnd}
      cellDnd={props.cellDnd}
      dateConfig={props.dateConfig}
    />
  );
}

function DashboardRowGrid(props: {
  row: DashboardRow;
  rowIdx: number;
  rowCount: number;
  dashboardId: string;
  widgetData: Record<string, WidgetData>;
  baseShortId: string;
  onWidgetRecordsChanged?: () => void;
  edit?: Props["edit"];
  rowDnd: ReturnType<typeof dnd.create<RowDragMeta, RowDropMeta, RowDropIntent>>;
  cellDnd: ReturnType<typeof dnd.create<CellDragMeta, CellDropMeta, CellDropIntent>>;
  dateConfig?: DateContext;
}) {
  const insertIndex = () => {
    const intent = props.cellDnd.intent();
    if (!props.cellDnd.isDragging() || intent?.toRowIdx !== props.rowIdx) return null;
    return Math.max(0, Math.min(intent.toCellIdx, props.row.cells.length));
  };
  const showInsertAt = (idx: number) => insertIndex() === idx;

  return (
    <div
      class={`group/row relative rounded-lg ${props.edit ? "pl-10" : ""}`}
      style={props.edit && props.row.cells.length === 0 ? emptyRowMinHeightStyle(props.row) : undefined}
    >
      <Show when={props.edit}>
        <RowEditRail row={props.row} rowIdx={props.rowIdx} edit={props.edit} rowDnd={props.rowDnd} />
      </Show>
      <div
        ref={(element) => {
          props.cellDnd.droppable(element, () => ({
            id: `dashboard-row-cell-drop:${props.row.id}`,
            meta: { rowIdx: props.rowIdx, cellIdx: null, cellCount: props.row.cells.length },
            disabled: !props.edit,
          }));
        }}
        class="relative flex min-w-0 flex-1 flex-col gap-3 rounded-lg md:flex-row md:flex-nowrap"
        style={props.edit && props.row.cells.length === 0 ? emptyRowMinHeightStyle(props.row) : undefined}
      >
        <For each={props.row.cells}>
          {(cell, cellIdx) => (
            <>
              <Show when={showInsertAt(cellIdx())}>
                <DropIndicator />
              </Show>
              <div
                ref={(element) => {
                  props.cellDnd.droppable(element, () => ({
                    id: `dashboard-cell-drop:${props.row.id}:${cell.id}`,
                    meta: { rowIdx: props.rowIdx, cellIdx: cellIdx() },
                    disabled: !props.edit,
                  }));
                  props.cellDnd.draggable(element, () => ({
                    id: `dashboard-cell-drag:${cell.id}`,
                    meta: { rowIdx: props.rowIdx, cellIdx: cellIdx() },
                    disabled: !props.edit,
                    focusable: false,
                    keyboard: false,
                    handleSelector: "[data-dashboard-cell-drag]",
                  }));
                }}
                class={`group/cell relative min-w-0 flex flex-col overflow-hidden ${
                  props.cellDnd.activeId() === `dashboard-cell-drag:${cell.id}` ? "opacity-40" : ""
                }`}
                style={cellFlexStyle(widgetSpan(cell, props.row.cells.length), ROW_MIN_HEIGHT_PX[props.row.height])}
              >
                <EditCellControls rowIdx={props.rowIdx} cellIdx={cellIdx()} edit={props.edit} />
                <CellRenderer
                  widget={cell}
                  data={props.widgetData[cell.id]}
                  dashboardId={props.dashboardId}
                  baseShortId={props.baseShortId}
                  onWidgetRecordsChanged={props.onWidgetRecordsChanged}
                  dateConfig={props.dateConfig}
                />
              </div>
            </>
          )}
        </For>
        <Show when={showInsertAt(props.row.cells.length)}>
          <DropIndicator />
        </Show>
        <Show when={props.edit}>
          {(edit) => (
            <button
              ref={(element) => {
                props.cellDnd.droppable(element, () => ({
                  id: `dashboard-row-end-drop:${props.row.id}`,
                  meta: { rowIdx: props.rowIdx, cellIdx: null, forceEnd: true },
                  disabled: !props.edit,
                }));
              }}
              type="button"
              class={`btn-input-success min-h-16 w-16 shrink-0 justify-center ${
                props.cellDnd.intent()?.toRowIdx === props.rowIdx && (props.cellDnd.intent()?.toCellIdx ?? 0) >= props.row.cells.length
                  ? "bg-emerald-50 dark:bg-emerald-950"
                  : ""
              }`}
              onClick={() => edit().onAddCell(props.rowIdx)}
              title="Add widget to row"
              aria-label="Add widget to row"
            >
              <i class="ti ti-plus" />
            </button>
          )}
        </Show>
        <Show when={props.row.cells.length === 0 && !props.edit}>
          <div class="w-full" />
        </Show>
      </div>
    </div>
  );
}

function AddRowRail(props: {
  label: string;
  insertionIdx: number;
  rowDnd: ReturnType<typeof dnd.create<RowDragMeta, RowDropMeta, RowDropIntent>>;
  active?: boolean;
  onAdd: () => void;
}) {
  const active = () => props.rowDnd.isDragging() && props.rowDnd.intent()?.toRowIdx === props.insertionIdx;
  return (
    <div
      ref={(element) => {
        props.rowDnd.droppable(element, () => ({
          id: `dashboard-row-insert-drop:${props.insertionIdx}`,
          meta: { insertionIdx: props.insertionIdx },
        }));
      }}
      class="-my-2 py-2"
    >
      <button
        type="button"
        class={`btn-input-success btn-input-sm flex min-h-9 w-full items-center justify-center ${
          active() || props.active ? "bg-emerald-50 dark:bg-emerald-950" : ""
        }`}
        onClick={props.onAdd}
      >
        <i class={`ti ${active() ? "ti-arrow-down" : "ti-plus"} mr-1`} /> {active() ? "Drop here" : props.label}
      </button>
    </div>
  );
}

function RowEditRail(props: {
  row: DashboardRow;
  rowIdx: number;
  edit?: Props["edit"];
  rowDnd: ReturnType<typeof dnd.create<RowDragMeta, RowDropMeta, RowDropIntent>>;
}) {
  return (
    <div
      ref={(element) => {
        props.rowDnd.draggable(element, () => ({
          id: `dashboard-row-drag:${props.row.id}`,
          meta: { rowIdx: props.rowIdx },
          disabled: !props.edit,
          focusable: false,
          keyboard: false,
          handleSelector: "[data-dashboard-row-drag]",
        }));
      }}
      class="absolute left-0 top-0 z-20 flex w-9 flex-col items-center justify-start gap-1 pt-2"
    >
      <button type="button" class={`${EDIT_ICON_CLASS} cursor-grab active:cursor-grabbing`} data-dashboard-row-drag title="Drag row">
        <i class="ti ti-grip-vertical" />
      </button>
      <button type="button" class={EDIT_ICON_CLASS} onClick={() => props.edit?.onEditRow(props.rowIdx)} title="Row settings">
        <i class="ti ti-settings" />
      </button>
    </div>
  );
}

function DropIndicator() {
  return (
    <div class="pointer-events-none my-2 min-h-16 w-1.5 shrink-0 self-stretch rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
  );
}

function EditCellControls(props: { rowIdx: number; cellIdx: number; edit?: Props["edit"] }) {
  return (
    <Show when={props.edit}>
      {(edit) => (
        <div class="grids-edit-control-surface absolute right-2 top-2 z-20 flex items-center gap-0 rounded-lg bg-white p-1 dark:bg-zinc-950">
          <button
            type="button"
            class={`${EDIT_ICON_CLASS} cursor-grab active:cursor-grabbing`}
            data-dashboard-cell-drag
            title="Drag widget"
          >
            <i class="ti ti-grip-vertical" />
          </button>
          <button type="button" class={EDIT_ICON_CLASS} onClick={() => edit().onEditCell(props.rowIdx, props.cellIdx)}>
            <i class="ti ti-settings" />
          </button>
        </div>
      )}
    </Show>
  );
}

/** Per-cell dispatcher inside a mixed row. Switches on kind and hands
 *  off to the matching cell renderer. Missing data resolves to an
 *  error sentinel so the cell shows a red notice instead of crashing. */
function CellRenderer(props: {
  widget: Widget;
  data: WidgetData | undefined;
  dashboardId: string;
  baseShortId: string;
  onWidgetRecordsChanged?: () => void;
  dateConfig?: DateContext;
}) {
  const data = (): WidgetData => props.data ?? { kind: "error", reason: "no data resolved for this widget" };

  switch (props.widget.kind) {
    case "stat":
      // A solo stat cell inside a mixed row gets its own paper-card
      // (vs the dense StatGrid hairline look reserved for all-stats
      // rows). flex-col + justify-center centers the StatCell content
      // vertically in the row's min-height tier. We deliberately
      // avoid the previous `flex items-center justify-center` row-
      // direction wrapper — its single `w-full` child path was
      // forcing the sparkline below the sub-row in some layouts.
      return (
        <div class="paper flex-1 w-full flex flex-col justify-center min-h-0 overflow-hidden">
          <StatWidgetCell widget={props.widget} data={props.data} />
        </div>
      );
    case "view":
      return <EmbeddedViewWidget widget={props.widget} data={data()} baseShortId={props.baseShortId} dateConfig={props.dateConfig} />;
    case "chart":
      return <ChartWidget widget={props.widget} data={data()} />;
    case "view-stats":
      return <ViewStatsCell widget={props.widget} data={data()} baseShortId={props.baseShortId} />;
    case "form":
      return <FormCell widget={props.widget} data={data()} onSubmitted={props.onWidgetRecordsChanged} dateConfig={props.dateConfig} />;
    case "markdown":
      return <MarkdownWidget widget={props.widget} data={data()} />;
    case "link":
      return (
        <LinkWidget
          widget={props.widget}
          data={data()}
          baseShortId={props.baseShortId}
          onSubmitted={props.onWidgetRecordsChanged}
          dateConfig={props.dateConfig}
        />
      );
    case "automation-button":
      return <AutomationButtonWidget dashboardId={props.dashboardId} widget={props.widget} data={data()} />;
  }
}

function EmptyDashboardState(props: { edit?: Props["edit"] }) {
  return (
    <div class="flex min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <i class="ti ti-layout-dashboard text-2xl text-dimmed" />
      <p class="text-sm text-dimmed">This dashboard has no rows yet.</p>
      <Show when={props.edit} fallback={<p class="text-xs text-dimmed">Open the editor to add rows and widgets.</p>}>
        {(edit) => (
          <button type="button" class="btn-input-success btn-input-sm mt-1" onClick={() => edit().onAddRowAt(0)}>
            <i class="ti ti-plus" /> Add row
          </button>
        )}
      </Show>
    </div>
  );
}
