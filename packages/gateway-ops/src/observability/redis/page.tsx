import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataTable, type DataTableColumn, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import ObservabilityChart from "../../frontend/ObservabilityChart.island";
import { gatewayOpsHelp } from "../../help";
import { getRedisDiagnostics, type RedisPrefixDiagnostic } from "../data/service";
import RedisDataFilters from "./_components/RedisDataFilters.island";

const numberFormat = new Intl.NumberFormat("de-DE");
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const exponent = Math.min(BYTE_UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const scaled = bytes / 1024 ** exponent;
  return `${scaled >= 10 || exponent === 0 ? Math.round(scaled) : scaled.toFixed(1)} ${BYTE_UNITS[exponent]}`;
};

const formatNumber = (value: number): string => numberFormat.format(Math.round(value));
const normalize = (value: string): string => value.toLowerCase();

const formatTtl = (ms: number): string => {
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 72) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
};

/**
 * The service marks fatal problems (diagnostics unreachable) red and routine
 * advisories amber. This page ignored the tone and painted everything amber,
 * so "Redis is down" looked like "some keys have no expiry".
 */
const warningClasses = (tone: string): string =>
  tone === "red"
    ? "rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-500/30 dark:bg-red-950/25 dark:text-red-100"
    : "rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100";
const warningGridClass = (count: number): string => {
  if (count <= 1) return "grid gap-2";
  if (count === 2) return "grid gap-2 md:grid-cols-2";
  return "grid gap-2 md:grid-cols-2 xl:grid-cols-3";
};

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const search = url.searchParams.get("search")?.trim() ?? "";
  const selectedDepth = Math.min(3, Math.max(1, Number(url.searchParams.get("depth") ?? "3")));
  const diagnostics = await getRedisDiagnostics();
  const searchNeedle = normalize(search);

  const searchActionParams = new URLSearchParams(url.searchParams);
  searchActionParams.delete("search");
  const searchAction = searchActionParams.toString()
    ? `/admin/observability/redis?${searchActionParams.toString()}`
    : "/admin/observability/redis";

  const filteredPrefixes = diagnostics.prefixes.filter((prefix) => {
    if (prefix.depth !== selectedDepth) return false;
    if (!searchNeedle) return true;
    return normalize(prefix.prefix).includes(searchNeedle);
  });

  const prefixChartData = diagnostics.prefixes
    .filter((prefix) => prefix.depth === selectedDepth)
    .slice(0, 10)
    .map((prefix) => ({ label: prefix.prefix, value: prefix.count }));

  const expiringKeys = diagnostics.keyspace.reduce((sum, row) => sum + row.expires, 0);
  const runtime = diagnostics.runtime;
  const memoryPressure =
    runtime.usedMemoryBytes !== null && runtime.maxMemoryBytes !== null && runtime.maxMemoryBytes > 0
      ? runtime.usedMemoryBytes / runtime.maxMemoryBytes > 0.85
      : false;
  const memorySub =
    runtime.maxMemoryBytes && runtime.maxMemoryBytes > 0
      ? `of ${formatBytes(runtime.maxMemoryBytes)}`
      : runtime.usedMemoryBytes === null
        ? "unavailable"
        : "no maxmemory set";
  const keyspaceKeys = diagnostics.keyspace.reduce((sum, row) => sum + row.keys, 0);
  const expirySub = keyspaceKeys > 0 ? `${Math.round((expiringKeys / keyspaceKeys) * 100)}% expiring` : "no keyspace";

  const prefixColumns: DataTableColumn<RedisPrefixDiagnostic>[] = [
    { id: "prefix", header: "Prefix", value: (prefix) => prefix.prefix, cellClass: "font-mono text-[11px] min-w-[220px]" },
    { id: "depth", header: "Depth", value: (prefix) => prefix.depth, headerClass: "text-right", cellClass: "text-right" },
    { id: "count", header: "Sample count", value: (prefix) => prefix.count, headerClass: "text-right", cellClass: "text-right" },
    { id: "share", header: "Sample share", value: (prefix) => prefix.share, headerClass: "text-right", cellClass: "text-right" },
  ];

  return () => (
    <AdminLayout c={c} title="Redis">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-redis-title">
          <h1 class="text-base font-semibold text-primary">Redis</h1>
          <p class="mt-1 text-xs text-dimmed">Keyspace health and bounded prefix sampling. Raw keys are not listed.</p>
        </div>

        <StatGrid columns={5}>
          <StatCell label="Keys" value={formatNumber(diagnostics.dbSize)} sub={`${formatNumber(expiringKeys)} expiring`} />
          <StatCell
            label="Memory"
            value={runtime.usedMemoryBytes === null ? "—" : formatBytes(runtime.usedMemoryBytes)}
            sub={memorySub}
            valueClass={memoryPressure ? "text-amber-600 dark:text-amber-400" : "text-primary"}
            accent={memoryPressure ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
          />
          <StatCell
            label="Evicted"
            value={runtime.evictedKeys === null ? "—" : formatNumber(runtime.evictedKeys)}
            sub={runtime.maxMemoryPolicy ?? "policy unknown"}
            valueClass={(runtime.evictedKeys ?? 0) > 0 ? "text-red-500" : "text-primary"}
            accent={(runtime.evictedKeys ?? 0) > 0 ? { tone: "red", icon: "ti ti-trash-x" } : undefined}
          />
          <StatCell
            label="Hit rate"
            value={runtime.hitRate === null ? "—" : `${(runtime.hitRate * 100).toFixed(1)}%`}
            sub={runtime.connectedClients === null ? "clients unknown" : `${formatNumber(runtime.connectedClients)} clients`}
            valueClass={runtime.hitRate !== null && runtime.hitRate < 0.8 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
          />
          <StatCell
            label="Warnings"
            value={formatNumber(diagnostics.warnings.length)}
            sub={diagnostics.warnings.length === 0 ? "none" : "see below"}
            valueClass={diagnostics.warnings.length > 0 ? "text-amber-600 dark:text-amber-400" : "text-primary"}
            accent={diagnostics.warnings.length > 0 ? { tone: "amber", icon: "ti ti-alert-triangle" } : undefined}
          />
        </StatGrid>

        {diagnostics.warnings.length ? (
          <section class={warningGridClass(diagnostics.warnings.length)}>
            {diagnostics.warnings.map((warning) => (
              <article class={warningClasses(warning.tone)}>
                <div class="flex items-start gap-2">
                  <i class="ti ti-alert-triangle mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
                  <div class="min-w-0">
                    <h2 class="text-xs font-semibold">{warning.title}</h2>
                    <p class="mt-1 text-[11px] opacity-80">{warning.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <section class="paper p-3">
          <h2 class="text-xs font-semibold text-primary">Prefix distribution</h2>
          <p class="text-[10px] text-dimmed">
            {diagnostics.scanComplete
              ? `${formatNumber(diagnostics.sampledKeys)} keys scanned.`
              : `${formatNumber(diagnostics.sampledKeys)} of ${formatNumber(diagnostics.dbSize)} keys sampled.`}
          </p>
          <ObservabilityChart kind="donut" class="mt-2 h-72 text-dimmed" data={prefixChartData} legend />
        </section>

        <section class="paper overflow-hidden">
          <div class="flex flex-col gap-2 px-3 py-2">
            <div>
              <h2 class="text-xs font-semibold text-primary">Prefixes</h2>
              <p class="text-[10px] text-dimmed">
                {formatNumber(filteredPrefixes.length)} prefixes at depth {selectedDepth}. Prefix counts come from a bounded SCAN sample.
              </p>
            </div>
            <SearchBar action={searchAction} value={search} placeholder="Search Redis prefixes..." ariaLabel="Search Redis prefixes" />
            <RedisDataFilters search={search} depth={selectedDepth} />
          </div>
          <DataTable
            rows={filteredPrefixes}
            columns={prefixColumns}
            getRowId={(prefix) => `${prefix.depth}:${prefix.prefix}`}
            density="compact"
            hoverRows
            class="max-h-[34rem] overflow-auto"
            empty="No matching Redis prefixes."
            renderCell={({ col, value, render }) => {
              if (col.id === "count") return <span class="tabular-nums">{formatNumber(Number(value ?? 0))}</span>;
              if (col.id === "share") return <span class="tabular-nums">{((Number(value ?? 0) || 0) * 100).toFixed(1)}%</span>;
              return render(value);
            }}
          />
        </section>
      </div>
    </AdminLayout>
  );
});
