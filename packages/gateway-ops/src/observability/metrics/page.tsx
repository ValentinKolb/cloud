import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import MetricsCatalogue, { type MetricsCatalogueRow } from "./_components/MetricsCatalogue.island";
import MetricsTokens from "./_components/MetricsTokens.island";
import { getMetricsSnapshot, listMetricsTokens, METRICS_ENDPOINT, type MetricsSnapshot } from "./service";

const numberFormat = new Intl.NumberFormat("de-DE");
const formatNumber = (value: number): string => numberFormat.format(Math.round(value));

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const parseMetricMetadata = (text: string): Map<string, { description: string; type: string; series: number }> => {
  const metrics = new Map<string, { description: string; type: string; series: number }>();
  for (const line of text.split("\n")) {
    if (line.startsWith("# HELP ")) {
      const [, name, description] = line.match(/^# HELP\s+(\S+)\s+(.+)$/) ?? [];
      if (name) metrics.set(name, { description: description ?? "", type: "unknown", series: 0 });
      continue;
    }
    if (line.startsWith("# TYPE ")) {
      const [, name, type] = line.match(/^# TYPE\s+(\S+)\s+(\S+)$/) ?? [];
      if (name) {
        const current = metrics.get(name) ?? { description: "", type: "unknown", series: 0 };
        metrics.set(name, { ...current, type: type ?? "unknown" });
      }
      continue;
    }
    if (line.startsWith("#") || !line.trim()) continue;
    const name = line.match(/^([^{\s]+)/)?.[1];
    if (!name) continue;
    const current = metrics.get(name) ?? { description: "", type: "unknown", series: 0 };
    metrics.set(name, { ...current, series: current.series + 1 });
  }
  return metrics;
};

const buildMetricRows = (snapshot: MetricsSnapshot): MetricsCatalogueRow[] => {
  const metadata = parseMetricMetadata(snapshot.text);
  const sourceByMetric = new Map<string, (typeof snapshot.collectors)[number]>();
  for (const collector of snapshot.collectors) {
    for (const metric of collector.metricNames) sourceByMetric.set(metric, collector);
  }

  return [...metadata.entries()]
    .map(([name, metric]) => {
      const collector = sourceByMetric.get(name);
      return {
        name,
        sourceId: collector?.id ?? "metrics",
        source: collector?.name ?? "Metrics",
        description: metric.description,
        type: metric.type,
        series: metric.series,
        status: collector?.status ?? "ok",
        error: collector?.error ?? null,
      } satisfies MetricsCatalogueRow;
    })
    .sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
};

export default ssr<AuthContext>(async (c) => {
  const [snapshot, tokens] = await Promise.all([getMetricsSnapshot(), listMetricsTokens()]);
  const okCollectors = snapshot.collectors.filter((collector) => collector.status === "ok").length;
  const metrics = buildMetricRows(snapshot);
  const sources = [...new Map(metrics.map((metric) => [metric.sourceId, { id: metric.sourceId, label: metric.source }])).values()].sort(
    (a, b) => a.label.localeCompare(b.label),
  );

  return () => (
    <AdminLayout c={c} title="Metrics" stretch>
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-metrics-title">
            <h1 class="text-base font-semibold text-primary">Metrics</h1>
            <p class="mt-1 text-xs text-dimmed">Prometheus-compatible Cloud metrics for Pulse or external scrapers.</p>
          </div>

          <StatGrid columns={4}>
            <StatCell label="Endpoint" value={METRICS_ENDPOINT} sub="bearer token required" accent={{ tone: "blue", icon: "ti ti-plug" }} />
            <StatCell
              label="Collectors"
              value={`${okCollectors}/${snapshot.collectors.length}`}
              sub="healthy"
              accent={
                okCollectors === snapshot.collectors.length
                  ? { tone: "emerald", icon: "ti ti-check" }
                  : { tone: "amber", icon: "ti ti-alert-triangle" }
              }
            />
            <StatCell label="Series" value={formatNumber(snapshot.series)} sub="last payload" />
            <StatCell label="Tokens" value={formatNumber(tokens.length)} sub="active" accent={{ tone: "zinc", icon: "ti ti-key" }} />
          </StatGrid>

          <p class="text-[10px] text-dimmed">Last generated {formatDate(snapshot.generatedAt)}. Collection is cached for short scrapes.</p>

          <MetricsTokens tokens={tokens} />

          <MetricsCatalogue rows={metrics} sources={sources} />
        </div>
      </div>
    </AdminLayout>
  );
});
