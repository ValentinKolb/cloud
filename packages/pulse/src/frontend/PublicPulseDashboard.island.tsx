import { Chart, DataTable, type DataTableColumn } from "@valentinkolb/cloud/ui";
import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import type { PulseDashboardSnapshot, PulsePublicDashboardPanel, MetricQueryPoint } from "../contracts";

type Props = {
  token: string;
  initialSnapshot: PulseDashboardSnapshot;
};

const compactDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const compactDay = (value: string) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
  }).format(new Date(value));

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

const pointsToBars = (points: MetricQueryPoint[]) =>
  points.slice(-48).map((point) => ({
    label: compactDate(point.bucket),
    value: point.value ?? 0,
  }));

const pointsToHistogram = (points: MetricQueryPoint[]) =>
  points.map((point) => point.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));

const pointsToHeatmap = (points: MetricQueryPoint[]) =>
  points.slice(-240).map((point) => {
    const date = new Date(point.bucket);
    return {
      x: new Intl.DateTimeFormat(undefined, { hour: "2-digit" }).format(date),
      y: compactDay(point.bucket),
      value: point.value ?? 0,
    };
  });

const queryPointColumns: DataTableColumn<MetricQueryPoint>[] = [
  { id: "bucket", header: "Bucket", value: (point) => compactDate(point.bucket), cellClass: "w-32 whitespace-nowrap" },
  { id: "value", header: "Value", value: (point) => formatValue(point.value), cellClass: "w-32 whitespace-nowrap" },
];

export default function PublicPulseDashboard(props: Props) {
  const [snapshot, setSnapshot] = createSignal(props.initialSnapshot);

  const reload = async () => {
    const response = await fetch(`/api/pulse/public-dashboard/${props.token}`);
    if (!response.ok) return;
    setSnapshot((await response.json()) as PulseDashboardSnapshot);
  };

  const pointsFor = (panel: PulsePublicDashboardPanel): MetricQueryPoint[] => snapshot().points[panel.id] ?? [];

  const renderPanel = (panel: PulsePublicDashboardPanel) => {
    const data = pointsFor(panel);
    const last = data.at(-1)?.value ?? null;
    if (panel.visual === "stat") {
      return (
        <Chart
          kind="stat"
          class="h-40 text-primary"
          label={panel.title}
          value={formatValue(last)}
          sparkline={data.map((point) => point.value ?? 0)}
        />
      );
    }
    if (panel.visual === "gauge") {
      const value = last ?? 0;
      return <Chart kind="gauge" class="h-48 text-primary" value={value} min={0} max={gaugeMax(value)} label={panel.title} />;
    }
    if (panel.visual === "barGauge") {
      const value = last ?? 0;
      return (
        <Chart
          kind="barGauge"
          class="h-40 text-primary"
          data={[{ label: panel.title, value, min: 0, max: gaugeMax(value) }]}
          min={0}
          max={gaugeMax(value)}
        />
      );
    }
    if (panel.visual === "bar") {
      return <Chart kind="bar" class="h-56 text-dimmed" data={pointsToBars(data)} showValues={data.length <= 16} />;
    }
    if (panel.visual === "histogram") {
      return <Chart kind="histogram" class="h-56 text-dimmed" data={pointsToHistogram(data)} bins={12} yAxis={{ label: "Count" }} />;
    }
    if (panel.visual === "heatmap") {
      return (
        <Chart
          kind="heatmap"
          class="h-56 text-dimmed"
          data={pointsToHeatmap(data)}
          format={(value) => formatValue(value)}
          showValues={data.length <= 48}
        />
      );
    }
    if (panel.visual === "table") {
      return (
        <DataTable
          rows={data}
          columns={queryPointColumns}
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
        series={[{ label: panel.title, data: data.map((point) => ({ x: Date.parse(point.bucket), y: point.value ?? 0 })) }]}
        xAxis={{ format: (value) => compactDate(new Date(value).toISOString()) }}
        yAxis={{ format: (value) => formatValue(value) }}
        smooth
        area
      />
    );
  };

  onMount(() => {
    const events = new EventSource(`/api/pulse/public-dashboard/${props.token}/events`);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void reload(), 150);
    };
    events.addEventListener("refresh", scheduleRefresh);
    events.addEventListener("metric.ingested", scheduleRefresh);
    events.addEventListener("source.changed", scheduleRefresh);
    events.addEventListener("base.changed", scheduleRefresh);
    onCleanup(() => {
      events.close();
      if (refreshTimer) clearTimeout(refreshTimer);
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
          <p class="text-sm text-zinc-500 dark:text-zinc-400">Live</p>
        </header>

        <Show
          when={snapshot().dashboard.config.panels.length}
          fallback={<p class="paper p-8 text-center text-sm text-dimmed">This dashboard has no panels.</p>}
        >
          <section class="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            <For each={snapshot().dashboard.config.panels}>
              {(panel) => (
                <article class="paper p-4">
                  <div class="mb-3 min-w-0">
                    <p class="truncate text-sm font-semibold text-primary">{panel.title}</p>
                    <p class="mt-1 truncate text-xs text-dimmed">
                      {panel.metric} · {panel.aggregation} / {panel.bucket}
                    </p>
                  </div>
                  {renderPanel(panel)}
                </article>
              )}
            </For>
          </section>
        </Show>
      </div>
    </main>
  );
}
