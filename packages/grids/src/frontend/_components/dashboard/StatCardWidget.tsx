import { WidgetStat } from "@valentinkolb/cloud/ui";
import type { Widget } from "../../../service";
import { formatWidgetValue } from "./widget-format";
import type { WidgetData } from "./widget-data";

type Props = {
  widget: Extract<Widget, { kind: "stat" }>;
  data: WidgetData;
};

/**
 * Stat-card widget — a single big number plus a label. Wraps the
 * platform `WidgetStat` (used elsewhere as part of the dashboard
 * widget catalogue), so visual conventions stay aligned across the
 * cloud apps.
 *
 * Title fallback: when the user didn't set an explicit widget title,
 * we synthesise one from the aggregation kind plus the field id —
 * e.g. "sum of price" — so the card never renders unlabeled.
 */
export default function StatCardWidget(props: Props) {
  const labelOf = () => {
    if (props.widget.title) return props.widget.title;
    const agg = props.widget.source.aggregations[0];
    if (!agg) return "Stat";
    if (agg.fieldId === "*") return `${agg.agg}(*)`;
    return agg.label ?? `${agg.agg}`;
  };

  const valueText = () => {
    if (props.data.kind === "error") return "—";
    if (props.data.kind !== "stat") return "—";
    return formatWidgetValue(props.data.value, props.widget.format);
  };

  const isError = () => props.data.kind === "error";

  return (
    <div class="paper h-full flex flex-col justify-center min-w-0">
      <WidgetStat
        value={valueText()}
        label={labelOf()}
        valueClass={isError() ? "text-red-600 dark:text-red-400" : undefined}
        accent={
          props.widget.icon
            ? { tone: "blue", icon: props.widget.icon }
            : undefined
        }
        sub={
          isError() && props.data.kind === "error"
            ? `Error: ${props.data.reason}`
            : undefined
        }
      />
    </div>
  );
}
