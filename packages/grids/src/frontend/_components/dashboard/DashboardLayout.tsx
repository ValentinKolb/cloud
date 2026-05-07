import { For, Show } from "solid-js";
import type { Dashboard, Widget } from "../../../service";
import StatCardWidget from "./StatCardWidget";
import ViewWidget from "./ViewWidget";
import ChartWidgetStub from "./ChartWidgetStub";
import type { WidgetData } from "./widget-data";

type Props = {
  dashboard: Dashboard;
  /** Pre-resolved per-widget data, keyed by `widget.id`. The SSR page
   *  fetches every widget in parallel via Promise.all and threads the
   *  result map down. Missing entries render as a "no data" stub
   *  rather than throwing — defensive against config/data drift. */
  widgetData: Record<string, WidgetData>;
  /** Slug of the parent base — needed by the View-widget header link. */
  baseSlug: string;
};

/** Vertical pixels per row-height tier. Matches the design discussion:
 *  sm = single line of stat cards, md = comfortable for compact
 *  charts, lg = embedded view with breathing room. */
const ROW_HEIGHT_PX = {
  sm: 96,
  md: 192,
  lg: 360,
} as const;

/**
 * Top-level read-only dashboard render. Consumed by the SSR page when
 * the URL pins a dashboard, and by the dashboard-edit page in preview
 * mode (the edit page wraps each cell with controls; the layout itself
 * is the same component).
 *
 * Mobile: rows collapse to 1-column stacks at < md (handled via
 * `grid-cols-1 md:grid-cols-N`). Each cell sets `min-w-0` so long
 * field names truncate instead of forcing horizontal scroll.
 *
 * Empty dashboard (no rows): a friendly empty-state nudges the user
 * toward the editor instead of staring at blank space.
 */
export default function DashboardLayout(props: Props) {
  return (
    <div class="flex flex-col gap-3 p-4 md:p-6 max-w-7xl mx-auto w-full">
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
            <div
              class={`grid grid-cols-1 gap-3 md:grid-cols-${row.cells.length}`}
              style={`min-height: ${ROW_HEIGHT_PX[row.height]}px`}
            >
              <For each={row.cells}>
                {(widget) => (
                  <div class="min-w-0 min-h-0">
                    <WidgetCell
                      widget={widget}
                      data={props.widgetData[widget.id]}
                      baseSlug={props.baseSlug}
                    />
                  </div>
                )}
              </For>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}

function WidgetCell(props: {
  widget: Widget;
  data: WidgetData | undefined;
  baseSlug: string;
}) {
  // Missing data entry → show a placeholder that mirrors error styling
  // but with a less alarming tone. Most likely cause: a widget was
  // added but the SSR page fetched data before the user saved.
  const data = (): WidgetData =>
    props.data ?? { kind: "error", reason: "no data resolved for this widget" };

  if (props.widget.kind === "stat") {
    return <StatCardWidget widget={props.widget} data={data()} />;
  }
  if (props.widget.kind === "view") {
    return <ViewWidget widget={props.widget} data={data()} baseSlug={props.baseSlug} />;
  }
  return <ChartWidgetStub widget={props.widget} data={data()} />;
}

function EmptyDashboardState() {
  return (
    <div class="paper px-6 py-10 text-center flex flex-col items-center gap-2">
      <i class="ti ti-layout-dashboard text-3xl text-dimmed" />
      <p class="text-sm text-dimmed">
        This dashboard has no widgets yet.
      </p>
      <p class="text-xs text-dimmed">
        Open the editor to add stat cards or embed a saved view.
      </p>
    </div>
  );
}
