import { For, Show } from "solid-js";
import type {
  Dashboard,
  ChartWidget as ChartWidgetType,
  ViewWidget,
  WidgetsRow,
} from "../../../service";
import StatsRow from "./StatsRow";
import ViewStatsRow from "./ViewStatsRow";
import EmbeddedViewWidget from "./ViewWidget";
import ChartWidget from "./ChartWidget";
import type { WidgetData, ViewStatsRowData } from "./widget-data";

type Props = {
  dashboard: Dashboard;
  /** Pre-resolved per-widget data for `stats` and `widgets` rows,
   *  keyed by `widget.id`. */
  widgetData: Record<string, WidgetData>;
  /** Pre-resolved per-row data for `view-stats` rows, keyed by
   *  `row.id`. Cells are derived by the resolver from the source
   *  view's first row / first bucket. */
  viewStatsData: Record<string, ViewStatsRowData>;
  /** Slug of the parent base — needed by the view-link header. */
  baseShortId: string;
};

/** Minimum cell heights for widget rows (sm/md/lg tier on
 *  `WidgetsRow`). Stats rows have no height tier — the small-grid
 *  has its natural padded height per the ui-lab spec. */
const WIDGET_CELL_MIN_HEIGHT_PX = {
  sm: 96,
  md: 192,
  lg: 360,
} as const;

/** Static `md:grid-cols-N` map. JIT can't resolve interpolated
 *  Tailwind classes; we keep literals so all four cell-count
 *  variants make it into the bundle. */
const WIDGET_GRID_CLASS: Record<number, string> = {
  1: "md:grid-cols-1",
  2: "md:grid-cols-2",
  3: "md:grid-cols-3",
  4: "md:grid-cols-4",
};

/**
 * Top-level read-only dashboard render. Dispatches each row by its
 * discriminant: `stats` rows go through the ui-lab small-grid
 * pattern (one paper, hairline cells); `widgets` rows render each
 * cell as its own paper card with a per-row sm/md/lg height tier
 * because views and (P1) charts need vertical breathing room.
 *
 * Empty dashboard: a friendly empty-state nudges the user toward
 * the editor instead of showing blank space.
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
          {(row) => {
            if (row.kind === "stats") {
              return <StatsRow row={row} widgetData={props.widgetData} />;
            }
            if (row.kind === "view-stats") {
              const data = props.viewStatsData[row.id];
              if (!data) {
                return (
                  <div class="paper px-4 py-3 text-xs text-dimmed">
                    View stats row had no resolved data
                  </div>
                );
              }
              return <ViewStatsRow data={data} baseShortId={props.baseShortId} />;
            }
            return (
              <WidgetsRowRender
                row={row}
                widgetData={props.widgetData}
                baseShortId={props.baseShortId}
              />
            );
          }}
        </For>
      </Show>
    </div>
  );
}

function WidgetsRowRender(props: {
  row: WidgetsRow;
  widgetData: Record<string, WidgetData>;
  baseShortId: string;
}) {
  return (
    <div
      class={`grid grid-cols-1 gap-3 ${WIDGET_GRID_CLASS[props.row.cells.length] ?? "md:grid-cols-4"}`}
    >
      <For each={props.row.cells}>
        {(widget) => (
          <div
            class="min-w-0 flex flex-col"
            style={`min-height: ${WIDGET_CELL_MIN_HEIGHT_PX[props.row.height]}px`}
          >
            <WidgetCell
              widget={widget}
              data={props.widgetData[widget.id]}
              baseShortId={props.baseShortId}
            />
          </div>
        )}
      </For>
    </div>
  );
}

function WidgetCell(props: {
  widget: ViewWidget | ChartWidgetType;
  data: WidgetData | undefined;
  baseShortId: string;
}) {
  const data = (): WidgetData =>
    props.data ?? { kind: "error", reason: "no data resolved for this widget" };
  if (props.widget.kind === "view") {
    return (
      <EmbeddedViewWidget
        widget={props.widget}
        data={data()}
        baseShortId={props.baseShortId}
      />
    );
  }
  return <ChartWidget widget={props.widget} data={data()} />;
}

function EmptyDashboardState() {
  return (
    <div class="paper px-6 py-10 text-center flex flex-col items-center gap-2">
      <i class="ti ti-layout-dashboard text-3xl text-dimmed" />
      <p class="text-sm text-dimmed">This dashboard has no rows yet.</p>
      <p class="text-xs text-dimmed">
        Open the editor to add a stats row or embed a saved view.
      </p>
    </div>
  );
}
