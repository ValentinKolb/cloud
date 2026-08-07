import { Chart, Placeholder } from "@k2b/ui";
import type { DateContext } from "@k2b/stdlib";
import type { CustomAppChartData } from "../../service/custom-app-insights";
import type { CustomAppValueFormat } from "../../custom-apps/contracts";
import { buildChartRenderData } from "./chart-data";
import { formatCustomAppValue } from "./value-format";

type ChartType = "bar" | "line" | "donut" | "scatter" | "sparkline";

export default function CustomAppChart(props: {
  chartType: ChartType;
  data: CustomAppChartData;
  valueFormat?: CustomAppValueFormat;
  dateConfig: DateContext;
}) {
  if (props.data.kind === "error") {
    return <Placeholder variant="compact" description={props.data.reason} />;
  }

  const renderData = buildChartRenderData({
    widget: { chartType: props.chartType },
    groupBy: props.data.viewQuery.groupBy,
    aggregations: props.data.viewQuery.aggregations,
    buckets: props.data.buckets,
    fieldsById: new Map(props.data.fields.map((field) => [field.id, field])),
    relationLabels: props.data.relationLabels,
  });
  const format = (value: number) => formatCustomAppValue(value, props.valueFormat, props.dateConfig);
  if (renderData.kind === "donut") return <Chart kind="donut" data={renderData.data} legend />;
  if (renderData.kind === "bar") return <Chart kind="bar" data={renderData.data} yAxis={{ format }} />;
  if (renderData.kind === "sparkline") return <Chart kind="sparkline" data={renderData.data} showLast />;
  if (renderData.kind === "line") {
    return <Chart kind="line" series={renderData.series} xAxis={{ format: renderData.xAxisFormat }} yAxis={{ format }} />;
  }
  return <Chart kind="scatter" series={renderData.series} xAxis={{ format }} yAxis={{ format }} />;
}
