import { For, Show } from "solid-js";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { formatWidgetValue } from "./widget-format";
import type { ViewStatsRowData } from "./widget-data";

type Props = {
  data: ViewStatsRowData;
  baseShortId: string;
};

/**
 * Renders a `view-stats` row inside a {@link StatGrid}. Cells are
 * auto-derived by the resolver from the source view's first row /
 * first bucket — no per-cell config, no editor per cell.
 *
 * The grid carries a header with the row title (defaulting to the
 * view's name) and an "Open full view" action when the source view
 * has a published full-view route. Empty / no-data state renders an
 * inline notice instead of an empty cell strip — an empty grid would
 * just look broken.
 */
export default function ViewStatsRow(props: Props) {
  const fullViewAction = (): { label: string; href: string } | undefined => {
    if (!props.data.fullViewLink) return undefined;
    const { tableShortId, viewShortId } = props.data.fullViewLink;
    return {
      label: "Open full view",
      href: `/app/grids/${props.baseShortId}?table=${tableShortId}&view=${viewShortId}`,
    };
  };

  return (
    <Show
      when={props.data.cells.length > 0}
      fallback={
        // Empty state — same paper frame, same header, but with a
        // centered notice instead of cells. Keeps the row's vertical
        // rhythm aligned with sibling stat-rows above and below.
        <StatGrid title={props.data.title} action={fullViewAction()}>
          <div class="bg-white dark:bg-zinc-900 px-4 py-6 text-center text-xs text-dimmed col-span-full">
            {props.data.notice ?? "No data"}
          </div>
        </StatGrid>
      }
    >
      <StatGrid
        title={props.data.title}
        action={fullViewAction()}
        columns={props.data.cells.length}
      >
        <For each={props.data.cells}>
          {(cell) => {
            const formatted = formatWidgetValue(cell.value, cell.format);
            return <StatCell label={cell.label} value={formatted} title={formatted} />;
          }}
        </For>
      </StatGrid>
    </Show>
  );
}
