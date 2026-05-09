import { For, Show } from "solid-js";
import { formatWidgetValue } from "./widget-format";
import type { ViewStatsRowData } from "./widget-data";

type Props = {
  data: ViewStatsRowData;
  baseSlug: string;
};

/** Same responsive grid as StatsRow — capped at 6 visible columns
 *  per row; views with more visible fields just get a scrollable
 *  paper. KISS over yet another wrap-strategy. */
const GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-6",
};

/**
 * Renders a `view-stats` row. Same ui-lab "Small grid only" pattern
 * as `StatsRow` — one paper container with hairline-separated cells —
 * but every cell is auto-derived by the resolver from the source
 * view's first row / first bucket. No per-cell config, no editor
 * per cell.
 *
 * Header carries the row title (defaulting to the view's name) and
 * a small "Open full view →" link to the source view's full records
 * page, mirroring the embedded-view widget's header for visual
 * consistency.
 */
export default function ViewStatsRow(props: Props) {
  const fullViewHref = () => {
    if (!props.data.fullViewLink) return null;
    const { tableSlug, viewSlug } = props.data.fullViewLink;
    return `/app/grids/${props.baseSlug}?table=${tableSlug}&view=${viewSlug}`;
  };

  // Cell-count cap matches GRID_CLASS keys. Excess cells stack into
  // the last grid track at narrow viewports — acceptable for a
  // power-user feature.
  const gridCols = () => {
    const n = props.data.cells.length;
    return GRID_CLASS[n] ?? "grid-cols-2 sm:grid-cols-3 md:grid-cols-6";
  };

  return (
    <div class="paper overflow-hidden">
      <header class="px-3 py-2 flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-800/60">
        <span class="text-xs font-semibold text-primary truncate">
          {props.data.title}
        </span>
        <Show when={fullViewHref()}>
          <a
            href={fullViewHref()!}
            class="text-[11px] text-dimmed hover:text-primary inline-flex items-center gap-1 shrink-0"
          >
            <span>Open full view</span>
            <i class="ti ti-arrow-up-right text-[10px]" />
          </a>
        </Show>
      </header>

      <Show
        when={props.data.cells.length > 0}
        fallback={
          <div class="px-4 py-6 text-center text-xs text-dimmed">
            {props.data.notice ?? "No data"}
          </div>
        }
      >
        <div
          class={`grid gap-px p-px bg-zinc-100 dark:bg-zinc-800 ${gridCols()}`}
        >
          <For each={props.data.cells}>
            {(cell) => (
              <div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5 min-w-0">
                <span class="text-[10px] uppercase tracking-wider text-dimmed truncate">
                  {cell.label}
                </span>
                <span
                  class="text-xl font-bold tabular-nums leading-tight truncate text-primary"
                  title={formatWidgetValue(cell.value, cell.format)}
                >
                  {formatWidgetValue(cell.value, cell.format)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
