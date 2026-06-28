import { For, Show } from "solid-js";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import type { ViewStatsWidget } from "../../../service";
import { formatWidgetValue } from "./widget-format";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: ViewStatsWidget;
  data: WidgetData;
  baseShortId: string;
};

/**
 * View-stats cell — embeds a saved view's first row (ungrouped) or
 * first bucket (grouped) as a compact 2-column hairline stat-grid
 * inside a single paper-card. Renders inside a row's cell slot,
 * unlike the (deprecated) row-level view-stats which took the full
 * row width.
 *
 * Internal layout: title-bar header (with optional "Open full view"
 * link), then a 2-column StatGrid below — auto-derived cells stack
 * top-to-bottom into the slot, so the user sees a tight summary
 * without having to hand-configure each stat. Width comes from the
 * row's cell-count division (1/N of the row).
 *
 * Empty / error states: surface a tonal notice in the cell body and
 * keep the slot. Header still renders so the cell remains visually
 * stable across users with different data availability.
 */
export default function ViewStatsCell(props: Props) {
  const isViewStats = (d: WidgetData): d is Extract<WidgetData, { kind: "view-stats" }> => d.kind === "view-stats";

  const fullViewHref = (): string | null => {
    if (!isViewStats(props.data) || !props.data.fullViewLink) return null;
    const { tableShortId, viewShortId } = props.data.fullViewLink;
    return `/app/grids/${props.baseShortId}?table=${tableShortId}&view=${viewShortId}`;
  };

  const titleOf = () => props.widget.title ?? (isViewStats(props.data) ? props.data.title : "View stats");

  return (
    <div class="paper flex-1 w-full flex flex-col min-h-0 min-w-0 overflow-hidden">
      <header class="px-3 py-2 flex items-center justify-between gap-2">
        <span class="text-xs font-semibold text-primary truncate">{titleOf()}</span>
        <Show when={fullViewHref()}>
          <a href={fullViewHref()!} class="text-[11px] text-dimmed hover:text-primary inline-flex items-center gap-1 shrink-0">
            <span>Open full view</span>
            <i class="ti ti-arrow-up-right text-[10px]" />
          </a>
        </Show>
      </header>

      <Show
        when={isViewStats(props.data)}
        fallback={
          <div class="flex-1 flex items-center justify-center text-xs text-dimmed">
            <Show when={props.data.kind === "error"} fallback="Loading…">
              <span class="text-red-600 dark:text-red-400">{(props.data as { kind: "error"; reason: string }).reason}</span>
            </Show>
          </div>
        }
      >
        {(() => {
          const d = props.data as Extract<WidgetData, { kind: "view-stats" }>;
          // Empty buckets / no records → render the notice inside the
          // cell body instead of an empty 2×N grid (an empty grid would
          // look broken).
          if (d.cells.length === 0) {
            return (
              <div class="flex-1 flex items-center justify-center text-xs text-dimmed px-3 py-2 text-center">{d.notice ?? "No data"}</div>
            );
          }
          return (
            <div class="flex-1 min-h-0 overflow-auto px-3 pb-3">
              <StatGrid columns={2}>
                <For each={d.cells}>
                  {(cell) => {
                    const formatted = formatWidgetValue(cell.value, cell.format);
                    return <StatCell label={cell.label} value={formatted} title={formatted} />;
                  }}
                </For>
              </StatGrid>
            </div>
          );
        })()}
      </Show>
    </div>
  );
}
