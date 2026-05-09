import { For, Show } from "solid-js";
import type { StatWidget, StatsRow as StatsRowType } from "../../../service";
import { formatWidgetValue } from "./widget-format";
import type { WidgetData } from "./widget-data";

type Props = {
  row: StatsRowType;
  widgetData: Record<string, WidgetData>;
};

/** Static `md:grid-cols-N` map for cell counts 1-6. Tailwind's JIT
 *  bundles only literal class names found in source — interpolated
 *  `md:grid-cols-${n}` strings get silently stripped. */
const GRID_CLASS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 md:grid-cols-6",
};

/**
 * Renders a row of stat cells using the ui-lab "Small grid only"
 * pattern: a single `paper` container holding cells separated by 1px
 * hairlines via `gap-px p-px bg-zinc`. Cells share visual context
 * (uppercase 10px label, `text-xl tabular-nums` value, optional 10px
 * sub line) and stay readable down to a 2-column grid at narrow
 * viewports — strictly better than independent gap-3 paper cards
 * which collapse to a 1-column tower at high zoom.
 *
 * The markup is intentionally inlined and small. We don't wrap a
 * platform `WidgetStat` here because that defaults to `text-3xl`,
 * meant for the stand-alone dashboard app's wider lead-metric
 * layout. Stats inside a dashboard cell need the tighter ui-lab
 * spec to fit.
 */
export default function StatsRow(props: Props) {
  const gridCols = () =>
    GRID_CLASS[props.row.cells.length] ?? "grid-cols-2 md:grid-cols-4";

  return (
    <div class="paper overflow-hidden">
      <div
        class={`grid gap-px p-px bg-zinc-100 dark:bg-zinc-800 ${gridCols()}`}
      >
        <For each={props.row.cells}>
          {(widget) => (
            <StatCell
              widget={widget}
              data={props.widgetData[widget.id]}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function StatCell(props: { widget: StatWidget; data: WidgetData | undefined }) {
  const labelOf = () => {
    if (props.widget.title) return props.widget.title;
    const agg = props.widget.source.aggregations[0];
    if (!agg) return "Stat";
    if (agg.fieldId === "*") return `${agg.agg}(*)`;
    return agg.label ?? agg.agg;
  };

  const data = (): WidgetData =>
    props.data ?? { kind: "error", reason: "no data" };

  const isError = () => data().kind === "error";
  const valueText = () => {
    const d = data();
    if (d.kind === "error") return "—";
    if (d.kind !== "stat") return "—";
    return formatWidgetValue(d.value, props.widget.format);
  };
  const errorReason = () => {
    const d = data();
    return d.kind === "error" ? d.reason : null;
  };

  // Sub-line: explicit `widget.sub` wins; otherwise show error reason
  // when the source failed; otherwise blank (no row, keeps layout
  // tight when the user didn't configure sub-text).
  const subText = () => props.widget.sub ?? errorReason();

  return (
    <div class="bg-white dark:bg-zinc-900 px-4 py-4 flex flex-col gap-0.5 min-w-0">
      <span class="text-[10px] uppercase tracking-wider text-dimmed truncate">
        {labelOf()}
      </span>
      <span
        class={`text-xl font-bold tabular-nums leading-tight truncate ${
          isError() ? "text-red-600 dark:text-red-400" : "text-primary"
        }`}
        title={valueText()}
      >
        {valueText()}
      </span>
      <Show when={subText() || props.widget.icon}>
        <div class="flex items-center gap-1.5 min-w-0">
          <Show when={subText()}>
            <span
              class={`text-[10px] truncate ${
                isError() ? "text-red-600 dark:text-red-400" : "text-dimmed"
              }`}
            >
              {subText()}
            </span>
          </Show>
          <Show when={props.widget.icon && !errorReason()}>
            {/* widget.icon stores the option id from ICON_OPTIONS
                (e.g. "ti-shopping-cart") — same convention notebooks
                use for their settings. Prepend the `ti` family class
                at render time. */}
            <i
              class={`ti ${props.widget.icon} text-[12px] text-blue-600 dark:text-blue-400 shrink-0`}
            />
          </Show>
        </div>
      </Show>
    </div>
  );
}
