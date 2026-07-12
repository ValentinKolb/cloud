import { Chart, DataTable, SelectInput, StructuredDataPreview, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { Show, type Accessor, type JSX, type Setter } from "solid-js";
import {
  isEventAggregateQuery,
  type MetricQueryPoint,
  type PanelVisual,
  type PulseCurrentState,
  type PulseExplorerQuery,
  type PulseRecordedEvent,
} from "../../contracts";
import type { ExplorerResultView } from "./types";
import {
  compactDate,
  formatMetricValue,
  gaugeMax,
  pointsToBars,
  pointsToHeatmap,
  pointsToHistogram,
  queryPointColumns,
  RESULT_VIEW_OPTIONS,
  stateRowId,
  type PulseDateContext,
  VISUAL_OPTIONS,
} from "./helpers";

type CellRenderer<Row> = (row: Row, col: DataTableColumn<Row>, render: (value: unknown) => JSX.Element) => JSX.Element;
type PreviewSeries = Array<{ label: string; data: Array<{ x: number; y: number }> }>;

type QueryExplorerResultPaneProps = {
  compiled: Accessor<PulseExplorerQuery | null>;
  resultView: Accessor<ExplorerResultView>;
  setResultView: Setter<ExplorerResultView>;
  visual: Accessor<PanelVisual>;
  setVisual: Setter<PanelVisual>;
  points: Accessor<MetricQueryPoint[]>;
  events: Accessor<PulseRecordedEvent[]>;
  states: Accessor<PulseCurrentState[]>;
  eventColumns: DataTableColumn<PulseRecordedEvent>[];
  stateColumns: DataTableColumn<PulseCurrentState>[];
  renderEventCell: CellRenderer<PulseRecordedEvent>;
  renderStateCell: CellRenderer<PulseCurrentState>;
  queryWasRun: Accessor<boolean>;
  previewTitle: Accessor<string>;
  previewUnit: Accessor<string | null>;
  previewSeries: Accessor<PreviewSeries>;
  dateContext: Accessor<PulseDateContext>;
  onCopyWidgetSnippet: () => void | Promise<void>;
};

function QueryExplorerChart(props: {
  visual: Accessor<PanelVisual>;
  points: Accessor<MetricQueryPoint[]>;
  title: Accessor<string>;
  unit: Accessor<string | null>;
  series: Accessor<PreviewSeries>;
  dateContext: Accessor<PulseDateContext>;
}) {
  const valueFormat = (value: number) => formatMetricValue(value, props.unit());
  const data = () => props.points();
  const last = () => data().at(-1)?.value ?? null;

  if (props.visual() === "stat") {
    return (
      <Chart
        kind="stat"
        class="h-full min-h-0 text-primary"
        label={props.title()}
        value={formatMetricValue(last(), props.unit())}
        sparkline={data().map((point) => point.value ?? 0)}
      />
    );
  }
  if (props.visual() === "gauge") {
    const value = last() ?? 0;
    return (
      <Chart
        kind="gauge"
        class="h-full min-h-0 text-primary"
        value={value}
        min={0}
        max={gaugeMax(props.unit(), value)}
        label={props.title()}
        format={valueFormat}
      />
    );
  }
  if (props.visual() === "barGauge") {
    const value = last() ?? 0;
    return (
      <Chart
        kind="barGauge"
        class="h-full min-h-0 text-primary"
        data={[{ label: props.title(), value, min: 0, max: gaugeMax(props.unit(), value) }]}
        min={0}
        max={gaugeMax(props.unit(), value)}
        format={valueFormat}
      />
    );
  }
  if (props.visual() === "bar") {
    return (
      <Chart kind="bar" class="h-full min-h-0 text-dimmed" data={pointsToBars(data(), props.dateContext())} showValues={data().length <= 16} />
    );
  }
  if (props.visual() === "histogram") {
    return (
      <Chart kind="histogram" class="h-full min-h-0 text-dimmed" data={pointsToHistogram(data())} bins={12} yAxis={{ label: "Count" }} />
    );
  }
  if (props.visual() === "heatmap") {
    return (
      <Chart
        kind="heatmap"
        class="h-full min-h-0 text-dimmed"
        data={pointsToHeatmap(data(), props.dateContext())}
        format={valueFormat}
        showValues={data().length <= 48}
      />
    );
  }
  return (
    <Chart
      kind="line"
      class="h-full min-h-0 text-dimmed"
      series={props.series()}
      xAxis={{ format: (value) => compactDate(new Date(value).toISOString(), props.dateContext()) }}
      yAxis={{ format: valueFormat }}
      smooth
      area
    />
  );
}

const noMetricPointsMessage = (queryWasRun: boolean): string =>
  queryWasRun
    ? "No points matched this metric query. Try a wider since range or check whether the source is still ingesting."
    : "Run a metric query to preview data.";

const renderEventsResult = (props: QueryExplorerResultPaneProps): JSX.Element => (
  <DataTable
    rows={props.events()}
    columns={props.eventColumns}
    getRowId={(event) => event.id}
    selectedRowId={null}
    density="compact"
    class="h-full min-h-0 overflow-auto"
    empty="Run an events query to see events."
    renderCell={({ row: event, col, render }) => props.renderEventCell(event, col, render)}
  />
);

const renderStatesResult = (props: QueryExplorerResultPaneProps): JSX.Element => (
  <DataTable
    rows={props.states()}
    columns={props.stateColumns}
    getRowId={stateRowId}
    selectedRowId={null}
    density="compact"
    class="h-full min-h-0 overflow-auto"
    empty="Run a states query to see current states."
    renderCell={({ row: state, col, render }) => props.renderStateCell(state, col, render)}
  />
);

const renderMetricTableResult = (props: QueryExplorerResultPaneProps): JSX.Element => (
  <DataTable
    rows={props.points()}
    columns={queryPointColumns}
    getRowId={(point) => point.bucket}
    density="compact"
    class="h-full min-h-0 overflow-auto"
    empty={props.queryWasRun() ? noMetricPointsMessage(true) : "Run a metric query to see points."}
  />
);

const renderMetricChartResult = (props: QueryExplorerResultPaneProps): JSX.Element => (
  <QueryExplorerChart
    visual={props.visual}
    points={props.points}
    title={props.previewTitle}
    unit={props.previewUnit}
    series={props.previewSeries}
    dateContext={props.dateContext}
  />
);

const renderEmptyMetricResult = (queryWasRun: boolean): JSX.Element => (
  <div class="flex h-full min-h-0 items-center justify-center px-6 text-center text-sm text-dimmed">
    {noMetricPointsMessage(queryWasRun)}
  </div>
);

const renderNonMetricChartFallback = (): JSX.Element => (
  <div class="flex h-full min-h-0 items-center justify-center text-sm text-dimmed">Use Table or Compiled for this query type.</div>
);

const renderChartResult = (props: QueryExplorerResultPaneProps, compiled: PulseExplorerQuery | null): JSX.Element => {
  if (compiled && compiled.kind !== "metric" && !(compiled.kind === "events" && isEventAggregateQuery(compiled)))
    return renderNonMetricChartFallback();
  if (props.points().length === 0) return renderEmptyMetricResult(props.queryWasRun());
  return renderMetricChartResult(props);
};

const renderDataResult = (props: QueryExplorerResultPaneProps, compiled: PulseExplorerQuery | null): JSX.Element => {
  if (compiled?.kind === "events" && !isEventAggregateQuery(compiled)) return renderEventsResult(props);
  if (compiled?.kind === "states") return renderStatesResult(props);
  if (props.resultView() === "table") return renderMetricTableResult(props);
  return renderChartResult(props, compiled);
};

const renderQueryExplorerResult = (props: QueryExplorerResultPaneProps): JSX.Element => {
  const compiled = props.compiled();
  if (props.resultView() === "compiled") return <StructuredDataPreview data={compiled ?? {}} empty="Run a query to see the compiled shape." />;
  return renderDataResult(props, compiled);
};

export default function QueryExplorerResultPane(props: QueryExplorerResultPaneProps) {
  return (
    <div class="paper flex h-full min-h-0 flex-col overflow-hidden">
      <div class="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2">
        <div class="min-w-40">
          <SelectInput
            icon="ti ti-layout"
            value={props.resultView}
            onChange={(value) =>
              props.setResultView(
                props.compiled()?.kind !== "metric" &&
                  !(props.compiled()?.kind === "events" && isEventAggregateQuery(props.compiled() as Extract<PulseExplorerQuery, { kind: "events" }>)) &&
                  value === "chart"
                  ? "table"
                  : (value as ExplorerResultView),
              )
            }
            options={RESULT_VIEW_OPTIONS}
          />
        </div>
        <Show when={props.resultView() === "chart"}>
          <div class="min-w-44">
            <SelectInput
              icon="ti ti-chart-line"
              value={props.visual}
              onChange={(value) => props.setVisual(value as PanelVisual)}
              options={VISUAL_OPTIONS}
            />
          </div>
        </Show>
        <button
          type="button"
          class="btn-input btn-input-sm"
          disabled={!props.compiled()}
          onClick={() => void props.onCopyWidgetSnippet()}
          title="Copy a Dashboard DSL widget snippet for this query"
        >
          <i class="ti ti-copy" /> Copy widget
        </button>
        <span class="ml-auto text-xs text-dimmed">
          {props.compiled()?.kind === "events" && !isEventAggregateQuery(props.compiled() as Extract<PulseExplorerQuery, { kind: "events" }>)
            ? `${props.events().length} events`
            : props.compiled()?.kind === "states"
              ? `${props.states().length} states`
              : `${props.points().length} points`}
        </span>
      </div>
      <div class={props.resultView() === "table" ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden p-3"}>
        {renderQueryExplorerResult(props)}
      </div>
    </div>
  );
}
