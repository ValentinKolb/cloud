import { Chart, DataTable, MarkdownView, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { markdown } from "@valentinkolb/cloud/shared";
import type { DateContext } from "@valentinkolb/stdlib";
import { createEffect, createSignal, For, onCleanup, Show, type JSX } from "solid-js";
import type {
  MetricQueryPoint,
  PulseDashboardCardWidget,
  PulseDashboardCondition,
  PulseDashboardEventsWidget,
  PulseDashboardMarkdownWidget,
  PulseDashboardMetricWidget,
  PulseDashboardRow,
  PulseDashboardSection,
  PulseDashboardStatesWidget,
  PulseDashboardWidget,
  PulseDashboardSnapshot,
} from "../contracts";
import { compactDate, compactDateWithDelta, compactDay, defaultPulseDateContext, formatSignalValue, stateRowId } from "./workspace/helpers";
import { signalSubject } from "./workspace/helpers";

type Props = {
  token: string;
  initialSnapshot: PulseDashboardSnapshot;
  initialDateConfig?: DateContext;
};

const formatValue = (value: number | null | undefined): string => {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  if (Math.abs(value) >= 1_000_000) return value.toExponential(2);
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
};

const gaugeMax = (value: number): number => {
  if (value <= 100) return 100;
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(value)));
  return Math.ceil(value / magnitude) * magnitude;
};

const pointsToBars = (points: MetricQueryPoint[], dateContext: DateContext) =>
  points.slice(-48).map((point) => ({
    label: compactDate(point.bucket, dateContext),
    value: point.value ?? 0,
  }));

const pointsToHistogram = (points: MetricQueryPoint[]) =>
  points.map((point) => point.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const pointsToHeatmap = (points: MetricQueryPoint[], dateContext: DateContext) =>
  points.slice(-240).map((point) => {
    const date = new Date(point.bucket);
    return {
      x: compactDate(date.toISOString(), dateContext).slice(0, 2),
      y: compactDay(point.bucket, dateContext),
      value: point.value ?? 0,
    };
  });

const queryPointColumns = (dateContext: DateContext): DataTableColumn<MetricQueryPoint>[] => [
  { id: "bucket", header: "Bucket", value: (point) => compactDate(point.bucket, dateContext), cellClass: "w-32 whitespace-nowrap" },
  { id: "value", header: "Value", value: (point) => formatValue(point.value), cellClass: "w-32 whitespace-nowrap" },
];

export default function PublicPulseDashboard(props: Props) {
  const [snapshot, setSnapshot] = createSignal(props.initialSnapshot);
  const dateContext = () => ({ ...defaultPulseDateContext, ...(props.initialDateConfig ?? {}) });

  const reload = async (signal?: AbortSignal) => {
    const response = await fetch(`/api/pulse/public-dashboard/${props.token}`, { signal });
    if (!response.ok) throw new Error("Could not refresh dashboard");
    setSnapshot((await response.json()) as PulseDashboardSnapshot);
  };

  const pointsFor = (widget: PulseDashboardMetricWidget): MetricQueryPoint[] => snapshot().points[widget.id] ?? [];

  const renderMetricWidget = (widget: PulseDashboardMetricWidget) => {
    const data = pointsFor(widget);
    const last = data.at(-1)?.value ?? null;
    if (widget.visual === "stat") {
      return (
        <Chart
          kind="stat"
          class="h-40 text-primary"
          label={widget.title}
          value={formatValue(last)}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (widget.visual === "gauge") {
      const value = last ?? 0;
      return <Chart kind="gauge" class="h-48 text-primary" value={value} min={0} max={gaugeMax(value)} label={widget.title} />;
    }
    if (widget.visual === "barGauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="barGauge"
          class="h-40 text-primary"
          data={[{ label: widget.title, value, min: 0, max: gaugeMax(value) }]}
          min={0}
          max={gaugeMax(value)}
        />
      );
    }
    if (widget.visual === "bar") {
      return <Chart kind="bar" class="h-56 text-dimmed" data={pointsToBars(data, dateContext())} showValues={data.length <= 16} />;
    }
    if (widget.visual === "histogram") {
      return <Chart kind="histogram" class="h-56 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    }
    if (widget.visual === "heatmap") {
      return (
        <Chart
          kind="heatmap"
          class="h-56 text-dimmed"
          data={pointsToHeatmap(data, dateContext())}
          format={(value) => formatValue(value)}
          showValues={data.length <= 48}
        />
      );
    }
    if (widget.visual === "table") {
      return (
        <DataTable
          rows={data}
          columns={queryPointColumns(dateContext())}
          getRowId={(point) => point.bucket}
          density="compact"
          class="max-h-72 overflow-auto"
          empty="No points yet."
        />
      );
    }
    return (
      <Chart
        kind="line"
        class="h-56 text-dimmed"
        series={[{ label: widget.title, data: data.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString(), dateContext()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  const renderWidgetFrame = (widget: { title?: string | null; description?: string | null }, content: JSX.Element) => (
    <article class="paper p-4">
      <Show when={widget.title || widget.description}>
        <div class="mb-3 min-w-0">
          <Show when={widget.title}>{(title) => <p class="truncate text-sm font-semibold text-primary">{title()}</p>}</Show>
          <Show when={widget.description}>{(description) => <p class="mt-1 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
      </Show>
      {content}
    </article>
  );

  const matchedMetricCondition = (widget: PulseDashboardMetricWidget): PulseDashboardCondition | null => {
    const value = pointsFor(widget).at(-1)?.value ?? null;
    if (value === null) return null;
    let match: PulseDashboardCondition | null = null;
    for (const condition of widget.conditions ?? []) {
      const target = typeof condition.value === "number" ? condition.value : Number(condition.value);
      if (!Number.isFinite(target)) continue;
      const matched =
        condition.operator === ">"
          ? value > target
          : condition.operator === ">="
            ? value >= target
            : condition.operator === "<"
              ? value < target
              : condition.operator === "<="
                ? value <= target
                : condition.operator === "="
                ? value === target
                : value !== target;
      if (matched) {
        match = condition;
        if (condition.level === "critical") break;
      }
    }
    return match;
  };

  const conditionText = (condition: PulseDashboardCondition): string =>
    condition.message?.trim() || `${condition.level === "critical" ? "Critical" : "Warning"} when value ${condition.operator} ${String(condition.value)}`;

  const renderMetricWidgetFrame = (widget: PulseDashboardMetricWidget) => {
    const condition = matchedMetricCondition(widget);
    const level = condition?.level ?? null;
    return (
      <article
        class="paper p-4"
        classList={{
          "border-yellow-300 bg-yellow-50/70 dark:border-yellow-800 dark:bg-yellow-950/30": level === "warn",
          "border-red-300 bg-red-50/70 dark:border-red-800 dark:bg-red-950/30": level === "critical",
        }}
      >
        <div class="mb-3 min-w-0">
          <p class="truncate text-sm font-semibold text-primary">{widget.title}</p>
          <p class="mt-1 truncate text-xs text-dimmed">
            {widget.metric} · {widget.aggregation} / {widget.bucket}
          </p>
          <Show when={condition}>
            {(matched) => (
              <p
                class={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  matched().level === "critical"
                    ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200"
                    : "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-200"
                }`}
              >
                <i class={`ti ${matched().level === "critical" ? "ti-alert-triangle" : "ti-alert-circle"}`} />
                <span>{conditionText(matched())}</span>
              </p>
            )}
          </Show>
          <Show when={widget.description}>{(description) => <p class="mt-2 text-xs leading-relaxed text-dimmed">{description()}</p>}</Show>
        </div>
        {renderMetricWidget(widget)}
      </article>
    );
  };

  const renderMarkdownWidget = (widget: PulseDashboardMarkdownWidget) =>
    renderWidgetFrame(widget, <MarkdownView html={markdown.render(widget.markdown)} smallHeadings class="text-sm" />);

  const renderEventsWidget = (widget: PulseDashboardEventsWidget) =>
    renderWidgetFrame(
      widget,
      <DataTable
        rows={snapshot().events[widget.id] ?? []}
        columns={[
          { id: "time", header: "Time", value: (event) => compactDateWithDelta(event.ts, dateContext()) },
          { id: "event", header: "Event", value: (event) => event.kind },
          { id: "subject", header: "Subject", value: (event) => signalSubject(event) },
          { id: "value", header: "Value", value: (event) => formatSignalValue(event.value) },
        ]}
        getRowId={(event) => event.id}
        density="compact"
        class="max-h-80 overflow-auto"
        empty="No events matched this query."
      />,
    );

  const renderStatesWidget = (widget: PulseDashboardStatesWidget) =>
    renderWidgetFrame(
      widget,
      <DataTable
        rows={snapshot().states[widget.id] ?? []}
        columns={[
          { id: "state", header: "State", value: (state) => state.key },
          { id: "value", header: "Value", value: (state) => formatSignalValue(state.value) },
          { id: "entity", header: "Entity", value: (state) => state.entityId },
          { id: "updated", header: "Updated", value: (state) => compactDateWithDelta(state.updatedAt, dateContext()) },
        ]}
        getRowId={(state) => stateRowId(state)}
        density="compact"
        class="max-h-80 overflow-auto"
        empty="No states matched this query."
      />,
    );

  const renderCardWidget = (widget: PulseDashboardCardWidget) =>
    renderWidgetFrame(
      widget,
      <div class="space-y-3">
        <For each={widget.rows}>{(row) => renderDashboardRow(row)}</For>
      </div>,
    );

  const renderDashboardWidget = (widget: PulseDashboardWidget) => {
    const span = Math.min(12, Math.max(1, widget.span ?? 12));
    return (
      <div style={{ "grid-column": `span ${span} / span ${span}` }}>
        {widget.kind === "metric"
          ? renderMetricWidgetFrame(widget)
          : widget.kind === "markdown"
            ? renderMarkdownWidget(widget)
            : widget.kind === "events"
              ? renderEventsWidget(widget)
              : widget.kind === "states"
                ? renderStatesWidget(widget)
                : renderCardWidget(widget)}
      </div>
    );
  };

  const renderDashboardRow = (row: PulseDashboardRow) => (
    <div class="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <For each={row.cells}>{(widget) => renderDashboardWidget(widget)}</For>
    </div>
  );

  const renderDashboardSection = (section: PulseDashboardSection) => (
    <section class="space-y-4">
      <div>
        <h2 class="text-base font-semibold text-primary">{section.title}</h2>
        <Show when={section.description}>
          {(description) => <p class="mt-1 max-w-3xl text-sm leading-relaxed text-dimmed">{description()}</p>}
        </Show>
      </div>
      <For each={section.rows}>{(row) => renderDashboardRow(row)}</For>
      <For each={section.sections}>{(child) => <div class="border-l border-border/70 pl-4">{renderDashboardSection(child)}</div>}</For>
    </section>
  );

  createEffect(() => {
    const configuredInterval = snapshot().dashboard.config.refreshIntervalSeconds;
    const intervalSeconds = configuredInterval === null ? null : (configuredInterval ?? 5);
    if (intervalSeconds === null) return;

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let currentRefresh: AbortController | undefined;
    let failures = 0;

    const schedule = (delayMs: number) => {
      if (disposed) return;
      timer = setTimeout(run, delayMs + Math.floor(Math.random() * 350));
    };

    const nextDelay = () => Math.min(60_000, intervalSeconds * 1000 * Math.max(1, 2 ** failures));

    const run = () => {
      if (disposed) return;
      if (document.hidden) {
        schedule(intervalSeconds * 1000);
        return;
      }

      currentRefresh?.abort();
      const refresh = new AbortController();
      currentRefresh = refresh;
      reload(refresh.signal)
        .then(() => {
          failures = 0;
        })
        .catch((error) => {
          if (refresh.signal.aborted) return;
          failures += 1;
          console.warn("Pulse public dashboard refresh failed", error);
        })
        .finally(() => {
          if (currentRefresh === refresh) currentRefresh = undefined;
          schedule(nextDelay());
        });
    };

    schedule(intervalSeconds * 1000);
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      currentRefresh?.abort();
    });
  });

  return (
    <main class="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50 sm:px-6 lg:px-8">
      <div class="mx-auto flex max-w-7xl flex-col gap-5">
        <header class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-300">Pulse public dashboard</p>
            <h1 class="mt-1 text-3xl font-semibold tracking-normal">{snapshot().dashboard.name}</h1>
          </div>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {snapshot().dashboard.config.refreshIntervalSeconds === null
              ? "Manual"
              : `Refreshes every ${snapshot().dashboard.config.refreshIntervalSeconds ?? 5}s`}
          </p>
        </header>

        <Show when={snapshot().dashboard.config.layout?.sections.length} fallback={<p class="paper p-8 text-center text-sm text-dimmed">This dashboard has no widgets.</p>}>
          <section class="space-y-6">
            <For each={snapshot().dashboard.config.layout?.sections ?? []}>{(section) => renderDashboardSection(section)}</For>
          </section>
        </Show>
      </div>
    </main>
  );
}
