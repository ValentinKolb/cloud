import { For, Show } from "solid-js";
import { StatGrid } from "@valentinkolb/cloud/ui";
import type { Dashboard, DashboardRow, Widget } from "../../../service";
import EmbeddedViewWidget from "./ViewWidget";
import ChartWidget from "./ChartWidget";
import ViewStatsCell from "./ViewStatsCell";
import FormCell from "./FormCell";
import StatWidgetCell from "./StatWidgetCell";
import type { WidgetData } from "./widget-data";

type Props = {
  dashboard: Dashboard;
  /** Pre-resolved per-widget data, keyed by `widget.id`. Includes every
   *  cell across every row — the dashboard fan-out happens server-side
   *  in [baseId]/page.tsx, one Promise.all per page render. */
  widgetData: Record<string, WidgetData>;
  /** Slug of the parent base — needed by view-cell / chart-cell links. */
  baseShortId: string;
};

/** Minimum cell heights per row's height tier. Stat-only rows ignore
 *  this (they have their natural padded height); mixed and non-stat
 *  rows use it to give views, charts, and forms vertical breathing room. */
const ROW_MIN_HEIGHT_PX = {
  sm: 96,
  md: 192,
  lg: 360,
} as const;

/** Static cell-count → grid-cols Tailwind classes. JIT can't resolve
 *  interpolated `md:grid-cols-${n}`; explicit map keeps all variants
 *  in the bundle. */
const CELL_GRID_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

/**
 * Top-level read-only dashboard render. Single row type with any mix
 * of cell kinds — stat / view / chart / view-stats / form. Layout
 * dispatch happens per row (not per cell):
 *
 *   - All cells of kind="stat" → render as ONE paper with hairline
 *     dividers (StatGrid). Keeps the dense KPI rhythm when stats
 *     belong together; matches the ui-lab "small-grid" pattern.
 *   - Mixed or non-stat → each cell is its own paper-card in a
 *     responsive grid, stretched to the row's height tier.
 *
 * Empty dashboard: friendly empty-state instead of blank space.
 */
export default function DashboardLayout(props: Props) {
  return (
    <div class="flex flex-col gap-3 w-full h-full">
      <header class="flex flex-col gap-1">
        <h1 class="text-xl font-semibold text-primary">{props.dashboard.name}</h1>
        <Show when={props.dashboard.description}>
          <p class="text-sm text-dimmed">{props.dashboard.description}</p>
        </Show>
      </header>

      <Show
        when={props.dashboard.config.rows.length > 0}
        fallback={<EmptyDashboardState />}
      >
        <For each={props.dashboard.config.rows}>
          {(row) => (
            <RowRenderer
              row={row}
              widgetData={props.widgetData}
              baseShortId={props.baseShortId}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

/** Per-row dispatcher — picks the all-stats layout (dense StatGrid)
 *  vs the mixed-cells layout (paper-card per cell). */
function RowRenderer(props: {
  row: DashboardRow;
  widgetData: Record<string, WidgetData>;
  baseShortId: string;
}) {
  const isAllStats = () => props.row.cells.every((c) => c.kind === "stat");

  return (
    <Show
      when={isAllStats()}
      fallback={
        <MixedRow
          row={props.row}
          widgetData={props.widgetData}
          baseShortId={props.baseShortId}
        />
      }
    >
      <StatsOnlyRow row={props.row} widgetData={props.widgetData} />
    </Show>
  );
}

/** All-stats row → one paper with hairline dividers between cells.
 *  Uses cloud/ui StatGrid + StatCell; the dense "small-grid" rhythm
 *  matches the rest of the platform's KPI strips. */
function StatsOnlyRow(props: {
  row: DashboardRow;
  widgetData: Record<string, WidgetData>;
}) {
  return (
    <StatGrid columns={props.row.cells.length}>
      <For each={props.row.cells}>
        {(cell) => {
          // The all-stats guard above means every cell here is "stat".
          // Narrow explicitly so the StatWidgetCell prop type is happy.
          if (cell.kind !== "stat") return null;
          return <StatWidgetCell widget={cell} data={props.widgetData[cell.id]} />;
        }}
      </For>
    </StatGrid>
  );
}

/** Mixed / non-stat row → grid of paper-cards, one per cell, each
 *  stretched to the row's height tier. */
function MixedRow(props: {
  row: DashboardRow;
  widgetData: Record<string, WidgetData>;
  baseShortId: string;
}) {
  return (
    <div
      class={`grid grid-cols-1 gap-3 ${
        CELL_GRID_CLASS[props.row.cells.length] ?? "md:grid-cols-4"
      }`}
    >
      <For each={props.row.cells}>
        {(cell) => (
          <div
            class="min-w-0 flex flex-col"
            style={`min-height: ${ROW_MIN_HEIGHT_PX[props.row.height]}px`}
          >
            <CellRenderer
              widget={cell}
              data={props.widgetData[cell.id]}
              baseShortId={props.baseShortId}
            />
          </div>
        )}
      </For>
    </div>
  );
}

/** Per-cell dispatcher inside a mixed row. Switches on kind and hands
 *  off to the matching cell renderer. Missing data resolves to an
 *  error sentinel so the cell shows a red notice instead of crashing. */
function CellRenderer(props: {
  widget: Widget;
  data: WidgetData | undefined;
  baseShortId: string;
}) {
  const data = (): WidgetData =>
    props.data ?? { kind: "error", reason: "no data resolved for this widget" };

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
      return (
        <EmbeddedViewWidget
          widget={props.widget}
          data={data()}
          baseShortId={props.baseShortId}
        />
      );
    case "chart":
      return <ChartWidget widget={props.widget} data={data()} />;
    case "view-stats":
      return (
        <ViewStatsCell
          widget={props.widget}
          data={data()}
          baseShortId={props.baseShortId}
        />
      );
    case "form":
      return <FormCell widget={props.widget} data={data()} />;
  }
}

function EmptyDashboardState() {
  return (
    <div class="paper px-6 py-10 text-center flex flex-col items-center gap-2">
      <i class="ti ti-layout-dashboard text-3xl text-dimmed" />
      <p class="text-sm text-dimmed">This dashboard has no rows yet.</p>
      <p class="text-xs text-dimmed">
        Open the editor to add a row and configure cells.
      </p>
    </div>
  );
}
