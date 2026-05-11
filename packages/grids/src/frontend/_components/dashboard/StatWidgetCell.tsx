import { StatCell } from "@valentinkolb/cloud/ui";
import type { StatWidget } from "../../../service";
import { formatWidgetValue } from "./widget-format";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: StatWidget;
  data: WidgetData | undefined;
};

/**
 * One stat cell inside a dashboard row. Renders the cloud/ui StatCell
 * with values pulled from a resolved StatWidget's WidgetData.
 *
 * Mapping rules:
 *  - Label: explicit `widget.title` wins; otherwise derive a compact
 *    label from the first aggregation (`COUNT(*)`, `SUM(x)`, …).
 *  - Value: `formatWidgetValue` for stat data; em-dash fallback for
 *    missing / errored data keeps the row's typography stable.
 *  - Error state: render the cell red and surface the reason as the
 *    sub line — no separate error UI, the cell keeps its slot.
 *  - Icon: full Tabler class on the widget. Rendered as a small blue
 *    accent icon only when there is no error.
 *  - Trend: optional sparkline below the value, fed from the resolver's
 *    pre-computed `data.trend` series.
 */
export default function StatWidgetCell(props: Props) {
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
  const subText = (): string | undefined =>
    props.widget.sub ?? errorReason() ?? undefined;

  const trend = (): number[] | undefined => {
    const d = data();
    return d.kind === "stat" ? d.trend : undefined;
  };

  return (
    <StatCell
      label={labelOf()}
      value={valueText()}
      title={valueText()}
      sub={subText()}
      trend={trend()}
      valueClass={isError() ? "text-red-600 dark:text-red-400" : undefined}
      accent={
        props.widget.icon && !errorReason()
          ? { tone: "blue", icon: props.widget.icon }
          : undefined
      }
    />
  );
}
