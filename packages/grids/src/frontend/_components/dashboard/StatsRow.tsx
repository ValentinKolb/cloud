import { For } from "solid-js";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import type { StatWidget, StatsRow as StatsRowType } from "../../../service";
import { formatWidgetValue } from "./widget-format";
import type { WidgetData } from "./widget-data";

type Props = {
  row: StatsRowType;
  widgetData: Record<string, WidgetData>;
};

/**
 * Renders a row of stat cells as a {@link StatGrid}. Each cell is a
 * {@link StatCell} configured from a single `StatWidget`.
 *
 * Per-cell mapping rules:
 * - **Label**: explicit `widget.title` wins; otherwise we derive a
 *   compact label from the first aggregation (`COUNT(*)`, `SUM(x)`, …).
 * - **Value**: formatted via `formatWidgetValue` for stat data; the
 *   em-dash fallback for missing / errored data keeps the row's
 *   typography stable.
 * - **Error state**: when the source fails we render the cell red and
 *   surface the reason as the sub line — no separate error UI, the
 *   widget keeps its slot in the grid.
 * - **Icon**: stored as a full Tabler class on the widget. We render
 *   it as a small blue accent icon only when there is no error;
 *   showing both a red error reason and a hopeful blue icon would be
 *   contradictory.
 */
export default function StatsRow(props: Props) {
  return (
    <StatGrid columns={props.row.cells.length}>
      <For each={props.row.cells}>
        {(widget) => <StatWidgetCell widget={widget} data={props.widgetData[widget.id]} />}
      </For>
    </StatGrid>
  );
}

/** One stat-cell with widget-shaped data. Split out so the For loop
 *  in `StatsRow` stays readable and the mapping logic lives next to
 *  what it produces. */
function StatWidgetCell(props: { widget: StatWidget; data: WidgetData | undefined }) {
  const labelOf = (): string => {
    if (props.widget.title) return props.widget.title;
    const agg = props.widget.source.aggregations[0];
    if (!agg) return "Stat";
    if (agg.fieldId === "*") return `${agg.agg}(*)`;
    return agg.label ?? agg.agg;
  };

  const data = (): WidgetData => props.data ?? { kind: "error", reason: "no data" };
  const isError = () => data().kind === "error";
  const errorReason = (): string | null => {
    const d = data();
    return d.kind === "error" ? d.reason : null;
  };
  const valueText = (): string => {
    const d = data();
    if (d.kind !== "stat") return "—";
    return formatWidgetValue(d.value, props.widget.format);
  };

  // `sub` precedence: explicit widget.sub → error reason → undefined
  // (cell omits the sub row entirely, see StatCell docs).
  const subText = (): string | undefined => props.widget.sub ?? errorReason() ?? undefined;

  return (
    <StatCell
      label={labelOf()}
      value={valueText()}
      title={valueText()}
      sub={subText()}
      valueClass={isError() ? "text-red-600 dark:text-red-400" : undefined}
      accent={
        props.widget.icon && !errorReason()
          ? { tone: "blue", icon: props.widget.icon }
          : undefined
      }
    />
  );
}

