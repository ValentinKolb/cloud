import type { AuthContext } from "@valentinkolb/cloud/server";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { Chart, DataTable, type DataTableColumn, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";
import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import { getRedisDiagnostics, type RedisPrefixDiagnostic } from "../data/service";
import RedisDataFilters from "./_components/RedisDataFilters.island";

const numberFormat = new Intl.NumberFormat("de-DE");
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

const warningClasses =
  "rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/25 dark:text-amber-100";
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
  const keyspaceKeys = diagnostics.keyspace.reduce((sum, row) => sum + row.keys, 0);
  const expirySub = keyspaceKeys > 0 ? `${Math.round((expiringKeys / keyspaceKeys) * 100)}% expiring` : "no keyspace";

  const prefixColumns: DataTableColumn<RedisPrefixDiagnostic>[] = [
    { id: "prefix", header: "Prefix", value: (prefix) => prefix.prefix, cellClass: "font-mono text-[11px] min-w-[220px]" },
    { id: "depth", header: "Depth", value: (prefix) => prefix.depth, headerClass: "text-right", cellClass: "text-right" },
    { id: "count", header: "Sample count", value: (prefix) => prefix.count, headerClass: "text-right", cellClass: "text-right" },
    { id: "share", header: "Sample share", value: (prefix) => prefix.share, headerClass: "text-right", cellClass: "text-right" },
  ];

  return () => (
    <AdminLayout c={c} title="Redis" stretch>
      <GatewayOpsLayoutHelp />
      <div class="flex-1 min-h-0 overflow-y-auto">
        <div class="flex flex-col gap-2">
          <div class="min-w-0" style="view-transition-name: admin-redis-title">
            <h1 class="text-base font-semibold text-primary">Redis</h1>
            <p class="mt-1 text-xs text-dimmed">Keyspace health and bounded prefix sampling. Raw keys are not listed.</p>
          </div>

          <StatGrid columns={4}>
            <StatCell
              label="Keys"
              value={formatNumber(diagnostics.dbSize)}
              sub={diagnostics.scanComplete ? "full scan" : `${formatNumber(diagnostics.sampledKeys)} sampled`}
              accent={{ tone: diagnostics.available ? "emerald" : "red", icon: "ti ti-database" }}
            />
            <StatCell label="Expiring" value={formatNumber(expiringKeys)} sub={expirySub} />
            <StatCell
              label="Avg TTL"
              value={formatTtl(diagnostics.keyspace[0]?.avgTtlMs ?? 0)}
              sub={diagnostics.keyspace[0]?.database ?? "db0"}
            />
            <StatCell
              label="Warnings"
              value={formatNumber(diagnostics.warnings.length)}
              sub={diagnostics.warnings.length ? "needs review" : "none"}
              valueClass={diagnostics.warnings.length ? "text-amber-600 dark:text-amber-400" : "text-primary"}
              accent={
                diagnostics.warnings.length ? { tone: "amber", icon: "ti ti-alert-triangle" } : { tone: "emerald", icon: "ti ti-check" }
              }
            />
          </StatGrid>

          {diagnostics.warnings.length ? (
            <section class={warningGridClass(diagnostics.warnings.length)}>
              {diagnostics.warnings.map((warning) => (
                <article class={warningClasses}>
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
            <Chart kind="donut" class="mt-2 h-72 text-dimmed" data={prefixChartData} legend />
          </section>

          <section class="paper overflow-hidden">
            <div class="flex flex-col gap-2 border-b border-zinc-100 px-3 py-2 dark:border-zinc-800/60">
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
      </div>
    </AdminLayout>
  );
});
