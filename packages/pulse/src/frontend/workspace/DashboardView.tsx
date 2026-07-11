import { Chart, DataTable, MarkdownView, SelectInput, TextInput } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import { createMemo, For, Show, type Accessor } from "solid-js";
import type {
  MetricQueryPoint,
  PulseCurrentState,
  PulseDashboard,
  PulseDashboardCardWidget,
  PulseDashboardConfig,
  PulseDashboardControl,
  PulseDashboardEventsWidget,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseMetricSummary,
  PulseRecordedEvent,
  PulseSource,
} from "../../contracts";
import { formatDashboardConditionText, matchDashboardCondition } from "../dashboard-conditions";
import {
  compactDate,
  compactDateWithDelta,
  dashboardCellSpan,
  dashboardLayoutWidgets,
  formatMetricValue,
  formatSignalValue,
  gaugeMax,
  pointsToBars,
  pointsToHeatmap,
  pointsToHistogram,
  queryPointColumns,
  signalSubject,
  sourceKindIcon,
  stateRowId,
} from "./helpers";

export type DashboardRenderContext = {
  metricWidgetPoints: Accessor<Record<string, MetricQueryPoint[]>>;
  dashboardEvents: Accessor<Record<string, PulseRecordedEvent[]>>;
  dashboardStates: Accessor<Record<string, PulseCurrentState[]>>;
  metricByName: Accessor<Map<string, PulseMetricSummary>>;
  sourceNameById: Accessor<Map<string, string>>;
  sources: Accessor<PulseSource[]>;
  dashboardControlValues: Accessor<Record<string, Record<string, string>>>;
  dateContext: Accessor<DateContext>;
  onControlChange: (dashboard: PulseDashboard, control: PulseDashboardControl, value: string, config: PulseDashboardConfig) => void;
  onOpenPublicDisplay: (dashboard: PulseDashboard) => void;
};

const dashboardSpanClasses: Record<number, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6",
  7: "lg:col-span-7",
  8: "lg:col-span-8",
  9: "lg:col-span-9",
  10: "lg:col-span-10",
  11: "lg:col-span-11",
  12: "lg:col-span-12",
};

const dashboardControlOptions = (control: PulseDashboardControl, context: DashboardRenderContext) => {
  if (control.options?.length) return control.options.map((value) => ({ id: value, label: value }));
  if (control.kind === "source")
    return context.sources().map((source) => ({ id: source.id, label: source.name, icon: sourceKindIcon(source.kind) }));
  if (control.kind === "range") return ["1h", "6h", "24h", "7d", "30d"].map((value) => ({ id: value, label: value }));
  return [];
};

const dashboardControlValue = (dashboard: PulseDashboard, control: PulseDashboardControl, context: DashboardRenderContext) =>
  context.dashboardControlValues()[dashboard.id]?.[control.variable] ?? control.defaultValue;

const MetricWidgetChart = (props: { widget: PulseDashboardMetricWidget; context: DashboardRenderContext }) => {
  const data = () => props.context.metricWidgetPoints()[props.widget.id] ?? [];
  const last = () => data().at(-1)?.value ?? null;
  const summary = () => props.context.metricByName().get(props.widget.metric);
  const rawUnit = () => summary()?.unit ?? null;
  const valueFormat = (value: number) => formatMetricValue(value, rawUnit());

  if (props.widget.visual === "stat") {
    return (
      <Chart
        kind="stat"
        class="h-36 text-primary"
        label={props.widget.title}
        value={formatMetricValue(last(), rawUnit())}
        sparkline={data().map((point) => point.value ?? 0)}
      />
    );
  }
  if (props.widget.visual === "gauge") {
    const value = () => last() ?? 0;
    return (
      <Chart
        kind="gauge"
        class="h-44 text-primary"
        value={value()}
        min={0}
        max={gaugeMax(rawUnit(), value())}
        label={props.widget.title}
        format={valueFormat}
      />
    );
  }
  if (props.widget.visual === "barGauge") {
    const value = () => last() ?? 0;
    return (
      <Chart
        kind="barGauge"
        class="h-36 text-primary"
        data={[{ label: props.widget.title, value: value(), min: 0, max: gaugeMax(rawUnit(), value()) }]}
        min={0}
        max={gaugeMax(rawUnit(), value())}
        format={valueFormat}
      />
    );
  }
  if (props.widget.visual === "bar") {
    return (
      <Chart
        kind="bar"
        class="h-48 text-dimmed"
        data={pointsToBars(data(), props.context.dateContext())}
        showValues={data().length <= 16}
      />
    );
  }
  if (props.widget.visual === "histogram") {
    return <Chart kind="histogram" class="h-48 text-dimmed" data={pointsToHistogram(data())} bins={12} yAxis={{ label: "Count" }} />;
  }
  if (props.widget.visual === "heatmap") {
    return (
      <Chart
        kind="heatmap"
        class="h-48 text-dimmed"
        data={pointsToHeatmap(data(), props.context.dateContext())}
        format={valueFormat}
        showValues={data().length <= 48}
      />
    );
  }
  if (props.widget.visual === "table") {
    return (
      <DataTable
        rows={data()}
        columns={queryPointColumns}
        getRowId={(point) => point.bucket}
        density="compact"
        class="max-h-64 overflow-auto"
        empty="No points yet."
      />
    );
  }
  return (
    <Chart
      kind="line"
      class="h-48 text-dimmed"
      series={[{ label: props.widget.title, data: data().map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
      xAxis={{ format: (value) => compactDate(new Date(value).toISOString(), props.context.dateContext()) }}
      yAxis={{ format: valueFormat }}
      smooth
      area
    />
  );
};

const MetricWidgetCard = (props: { widget: PulseDashboardMetricWidget; context: DashboardRenderContext; description?: string | null }) => {
  const condition = () => matchDashboardCondition(props.widget.conditions, props.context.metricWidgetPoints()[props.widget.id]?.at(-1)?.value ?? null);
  const level = () => condition()?.level ?? null;
  return (
    <article
      class="paper h-full p-4"
      classList={{
        "border-yellow-300 bg-yellow-50/70 dark:border-yellow-800 dark:bg-yellow-950/30": level() === "warn",
        "border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30": level() === "critical",
      }}
    >
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-primary">{props.widget.title}</p>
          <p class="mt-1 truncate text-xs text-dimmed">
            {props.widget.metric} · {props.widget.aggregation} / {props.widget.bucket}
            {props.widget.sourceId ? ` · ${props.context.sourceNameById().get(props.widget.sourceId) ?? "source"}` : ""}
          </p>
          <Show when={condition()}>
            {(matched) => (
              <p
                class={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  matched().level === "critical"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
                }`}
              >
                <i class={`ti ${matched().level === "critical" ? "ti-alert-triangle" : "ti-alert-circle"}`} />
                <span>{formatDashboardConditionText(matched())}</span>
              </p>
            )}
          </Show>
          <Show when={props.description}>{(description) => <p class="mt-2 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
      </div>
      <MetricWidgetChart widget={props.widget} context={props.context} />
    </article>
  );
};

const MarkdownWidget = (props: { widget: PulseDashboardMarkdownWidget }) => (
  <article class="paper h-full p-4">
    <Show when={props.widget.title || props.widget.description}>
      <div class="mb-3">
        <Show when={props.widget.title}>{(title) => <p class="text-sm font-semibold text-primary">{title()}</p>}</Show>
        <Show when={props.widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
      </div>
    </Show>
    <MarkdownView html={markdown.render(props.widget.markdown)} smallHeadings class="text-sm" />
  </article>
);

const DashboardWidget = (props: { widget: PulseDashboardWidget; cellCount: number; context: DashboardRenderContext }) => {
  const span = () => dashboardCellSpan(props.widget.span, props.cellCount);
  return (
    <div class={`col-span-1 h-full min-w-0 ${dashboardSpanClasses[span()] ?? dashboardSpanClasses[12]}`}>
      {props.widget.kind === "metric" ? (
        <MetricWidgetCard widget={props.widget} context={props.context} description={props.widget.description} />
      ) : props.widget.kind === "markdown" ? (
        <MarkdownWidget widget={props.widget} />
      ) : props.widget.kind === "events" ? (
        <EventsWidget widget={props.widget} context={props.context} />
      ) : props.widget.kind === "states" ? (
        <StatesWidget widget={props.widget} context={props.context} />
      ) : (
        <CardWidget widget={props.widget} context={props.context} />
      )}
    </div>
  );
};

const DashboardRow = (props: { row: PulseDashboardRow; context: DashboardRenderContext }) => (
  <div class="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-12">
    <For each={props.row.cells}>{(widget) => <DashboardWidget widget={widget} cellCount={props.row.cells.length} context={props.context} />}</For>
  </div>
);

const CardWidget = (props: { widget: PulseDashboardCardWidget; context: DashboardRenderContext }) => (
  <article class="paper h-full p-4">
    <div class="mb-3">
      <p class="text-sm font-semibold text-primary">{props.widget.title}</p>
      <Show when={props.widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
    </div>
    <div class="space-y-3">
      <For each={props.widget.rows}>{(row) => <DashboardRow row={row} context={props.context} />}</For>
    </div>
  </article>
);

const EventsWidget = (props: { widget: PulseDashboardEventsWidget; context: DashboardRenderContext }) => (
  <article class="paper h-full p-4">
    <div class="mb-3">
      <p class="text-sm font-semibold text-primary">{props.widget.title}</p>
      <Show when={props.widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
    </div>
    <DataTable
      rows={props.context.dashboardEvents()[props.widget.id] ?? []}
      columns={[
        { id: "time", header: "Time", value: (event) => compactDateWithDelta(event.ts, props.context.dateContext()) },
        { id: "event", header: "Event", value: (event) => event.kind },
        { id: "subject", header: "Subject", value: (event) => signalSubject(event) },
        { id: "value", header: "Value", value: (event) => formatSignalValue(event.value) },
      ]}
      getRowId={(event) => event.id}
      density="compact"
      class="max-h-80 overflow-auto"
      empty="No events matched this query."
    />
  </article>
);

const StatesWidget = (props: { widget: PulseDashboardStatesWidget; context: DashboardRenderContext }) => {
  const rows = () => props.context.dashboardStates()[props.widget.id] ?? [];
  const firstRow = createMemo(() => rows()[0]);
  return (
    <article class="paper h-full p-4">
      <div class="mb-3">
        <p class="text-sm font-semibold text-primary">{props.widget.title}</p>
        <Show when={props.widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
      </div>
      <Show
        when={props.widget.visual === "stat"}
        fallback={
          <DataTable
            rows={rows()}
            columns={[
              { id: "state", header: "State", value: (state) => state.key },
              { id: "value", header: "Value", value: (state) => formatSignalValue(state.value) },
              { id: "entity", header: "Entity", value: (state) => state.entityId },
              { id: "updated", header: "Updated", value: (state) => compactDateWithDelta(state.updatedAt, props.context.dateContext()) },
            ]}
            getRowId={(state) => stateRowId(state)}
            density="compact"
            class="max-h-80 overflow-auto"
            empty="No states matched this query."
          />
        }
      >
        <Chart
          kind="stat"
          class="h-40 text-primary"
          label={firstRow()?.key ?? props.widget.title}
          value={firstRow() ? formatSignalValue(firstRow()!.value) : "n/a"}
          sparkline={[]}
        />
      </Show>
    </article>
  );
};

const DashboardSection = (props: { section: PulseDashboardSection; context: DashboardRenderContext }) => (
  <section class="space-y-3">
    <div>
      <h2 class="text-sm font-semibold text-primary">{props.section.title}</h2>
      <Show when={props.section.description}>
        {(description) => <p class="mt-1 max-w-3xl text-xs leading-relaxed text-dimmed">{description()}</p>}
      </Show>
    </div>
    <For each={props.section.rows}>{(row) => <DashboardRow row={row} context={props.context} />}</For>
    <For each={props.section.sections}>
      {(child) => (
        <div class="border-l border-border/70 pl-4">
          <DashboardSection section={child} context={props.context} />
        </div>
      )}
    </For>
  </section>
);

const DashboardControls = (props: {
  dashboard: PulseDashboard;
  config: PulseDashboardConfig;
  context: DashboardRenderContext;
}) => (
  <Show when={props.config.layout?.controls}>
    {(controls) => (
      <div class="flex flex-wrap items-end justify-end gap-2">
        <For each={controls()}>
          {(control) => {
            const options = dashboardControlOptions(control, props.context);
            return (
              <label class="min-w-40 text-xs font-semibold text-secondary">
                <span class="mb-1 block">{control.label}</span>
                <Show
                  when={options.length}
                  fallback={
                    <TextInput
                      icon={control.kind === "entity" ? "ti ti-cube" : control.kind === "text" ? "ti ti-search" : "ti ti-filter"}
                      value={() => dashboardControlValue(props.dashboard, control, props.context)}
                      onInput={(value) => props.context.onControlChange(props.dashboard, control, value, props.config)}
                      placeholder={control.variable}
                    />
                  }
                >
                  <SelectInput
                    icon={
                      control.kind === "range"
                        ? "ti ti-clock"
                        : control.kind === "source"
                          ? "ti ti-database-share"
                          : control.kind === "entity"
                            ? "ti ti-cube"
                            : "ti ti-filter"
                    }
                    value={() => dashboardControlValue(props.dashboard, control, props.context)}
                    onChange={(value) => props.context.onControlChange(props.dashboard, control, value, props.config)}
                    options={options}
                  />
                </Show>
              </label>
            );
          }}
        </For>
      </div>
    )}
  </Show>
);

const DashboardHeader = (props: { dashboard: PulseDashboard; config: PulseDashboardConfig; context: DashboardRenderContext }) => (
  <header class="mb-3 flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <h1 class="truncate text-xl font-semibold text-primary">{props.dashboard.name}</h1>
      <Show when={props.config.layout?.description}>
        {(description) => <p class="mt-1 max-w-3xl text-sm leading-relaxed text-dimmed">{description()}</p>}
      </Show>
    </div>
    <div class="flex flex-wrap items-end justify-end gap-2">
      <Show when={props.dashboard.publicEnabled}>
        <button type="button" class="btn-input btn-input-sm" onClick={() => props.context.onOpenPublicDisplay(props.dashboard)}>
          <i class="ti ti-device-tv" />
          Public display
        </button>
      </Show>
      <DashboardControls dashboard={props.dashboard} config={props.config} context={props.context} />
    </div>
  </header>
);

export const DashboardContent = (props: {
  config: Accessor<PulseDashboardConfig | null>;
  context: DashboardRenderContext;
  empty?: string;
}) => {
  const currentConfig = createMemo(() => {
    const value = props.config();
    return value && dashboardLayoutWidgets(value).length ? value : null;
  });

  return (
    <Show
      when={currentConfig()}
      fallback={
        <div class="paper flex flex-1 items-center justify-center p-8 text-center text-sm text-dimmed">
          {props.empty ?? "Open the dashboard editor to add the first widget."}
        </div>
      }
    >
      {(config) => (
        <div class="space-y-4">
          <Show when={config().layout}>
            {(layout) => (
              <>
                <For each={layout().sections}>{(section) => <DashboardSection section={section} context={props.context} />}</For>
              </>
            )}
          </Show>
        </div>
      )}
    </Show>
  );
};

export default function DashboardView(props: { dashboard: Accessor<PulseDashboard | null>; context: DashboardRenderContext }) {
  return (
    <section class="flex min-h-0 flex-1 flex-col">
      <Show when={props.dashboard()}>{(dashboard) => <DashboardHeader dashboard={dashboard()} config={dashboard().config} context={props.context} />}</Show>
      <DashboardContent config={() => props.dashboard()?.config ?? null} context={props.context} />
    </section>
  );
}
