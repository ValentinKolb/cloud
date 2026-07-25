import type { AuthContext } from "@valentinkolb/cloud/server";
import { formatBytes, formatDateTime as formatDate, formatNumber } from "@valentinkolb/cloud/shared";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { SearchBar } from "@valentinkolb/cloud/ssr/islands";
import { DataPanel, DataTable, type DataTableColumn, StatCell, StatGrid, StatusBadge } from "@valentinkolb/cloud/ui";
import { ssr } from "../../config";

/** Seconds to a compact age; sessions report ages, not durations. */
const formatSeconds = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${Math.round(seconds / 3600)}h`;
};

import GatewayOpsLayoutHelp from "../../frontend/GatewayOpsLayoutHelp.island";
import ObservabilityChart from "../../frontend/ObservabilityChart.island";
import { gatewayOpsHelp } from "../../help";
import {
  getPostgresDiagnostics,
  listPostgresIndexes,
  listPostgresSessions,
  type PostgresExtensionDiagnostic,
  type PostgresIndexDiagnostic,
  type PostgresSession,
  type PostgresTableDiagnostic,
} from "../data/service";
import PostgresDataFilters from "./_components/PostgresDataFilters.island";

const numberFormat = new Intl.NumberFormat("de-DE");

const normalize = (value: string): string => value.toLowerCase();

const sortTables = (rows: PostgresTableDiagnostic[], sort: string): PostgresTableDiagnostic[] => {
  const sorted = [...rows];
  switch (sort) {
    case "rows-desc":
      return sorted.sort((a, b) => b.estimatedRows - a.estimatedRows || a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
    case "dead-desc":
      return sorted.sort((a, b) => b.deadRows - a.deadRows || b.totalBytes - a.totalBytes);
    case "schema-asc":
      return sorted.sort((a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
    case "name-asc":
      return sorted.sort((a, b) => a.name.localeCompare(b.name) || a.schema.localeCompare(b.schema));
    case "size-desc":
    default:
      return sorted.sort((a, b) => b.totalBytes - a.totalBytes || a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name));
  }
};

const warningClasses = (tone: "amber" | "red"): string =>
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
  const selectedSchema = url.searchParams.get("schema")?.trim() || "all";
  const selectedSort = url.searchParams.get("sort")?.trim() || "size-desc";
  const [diagnostics, sessions, indexes] = await Promise.all([getPostgresDiagnostics(), listPostgresSessions(), listPostgresIndexes()]);
  const blockedSessions = sessions.filter((session) => session.blockedBy.length > 0);
  const unnamedSessions = sessions.filter((session) => !session.application).length;
  // Cumulative since the last statistics reset, so this is "not used since
  // then" rather than a claim that the index is unnecessary.
  const unusedIndexBytes = indexes
    .filter((index) => index.scans === 0 && !index.isPrimary)
    .reduce((sum, index) => sum + index.sizeBytes, 0);

  const sessionColumns: DataTableColumn<PostgresSession>[] = [
    { id: "pid", header: "PID", cellClass: "tabular-nums" },
    { id: "state", header: "State" },
    { id: "application", header: "Application" },
    { id: "wait", header: "Waiting on" },
    { id: "txAge", header: "Transaction", subtitle: "age", align: "right" },
    { id: "queryAge", header: "Query", subtitle: "age", align: "right" },
    { id: "query", header: "Statement", cellClass: "max-w-[320px]" },
  ];

  const indexColumns: DataTableColumn<PostgresIndexDiagnostic>[] = [
    { id: "index", header: "Index", cellClass: "min-w-[240px]" },
    { id: "kind", header: "Kind" },
    { id: "size", header: "Size", align: "right" },
    { id: "scans", header: "Scans", subtitle: "since reset", align: "right" },
  ];
  const hasCriticalWarning = diagnostics.warnings.some((warning) => warning.tone === "red");
  const searchNeedle = normalize(search);
  const schemas = diagnostics.schemaRows.map((row) => row.schema).sort((a, b) => a.localeCompare(b));

  const searchActionParams = new URLSearchParams(url.searchParams);
  searchActionParams.delete("search");
  const searchAction = searchActionParams.toString()
    ? `/admin/observability/postgres?${searchActionParams.toString()}`
    : "/admin/observability/postgres";

  const filteredTables = sortTables(
    diagnostics.tableRows.filter((table) => {
      if (selectedSchema !== "all" && table.schema !== selectedSchema) return false;
      if (!searchNeedle) return true;
      return (
        normalize(`${table.schema}.${table.name}`).includes(searchNeedle) ||
        table.warnings.some((warning) => warning.includes(searchNeedle))
      );
    }),
    selectedSort,
  );

  const filteredExtensions = diagnostics.extensionRows.filter((extension) => {
    if (!searchNeedle) return true;
    return normalize(
      `${extension.name} ${extension.defaultVersion ?? ""} ${extension.installedVersion ?? ""} ${extension.comment ?? ""}`,
    ).includes(searchNeedle);
  });

  const schemaChartData = diagnostics.schemaRows.slice(0, 10).map((schema) => ({ label: schema.schema, value: schema.totalBytes }));
  const schemaRowsChartData = diagnostics.schemaRows.slice(0, 10).map((schema) => ({ label: schema.schema, value: schema.estimatedRows }));
  const tableChartData = diagnostics.tableRows
    .slice()
    .sort((a, b) => b.totalBytes - a.totalBytes)
    .slice(0, 10)
    .map((table) => ({ label: `${table.schema}.${table.name}`, value: table.totalBytes }));

  const tableColumns: DataTableColumn<PostgresTableDiagnostic>[] = [
    { id: "table", header: "Table", value: (table) => `${table.schema}.${table.name}`, cellClass: "min-w-[220px]" },
    {
      id: "rows",
      header: "Rows",
      subtitle: "estimated",
      value: (table) => table.estimatedRows,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "total",
      header: "Total",
      subtitle: "relation",
      value: (table) => table.totalBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    {
      id: "tableBytes",
      header: "Table",
      subtitle: "heap",
      value: (table) => table.tableBytes,
      headerClass: "text-right",
      cellClass: "text-right",
    },
    { id: "indexBytes", header: "Indexes", value: (table) => table.indexBytes, headerClass: "text-right", cellClass: "text-right" },
    { id: "dead", header: "Dead rows", value: (table) => table.deadRows, headerClass: "text-right", cellClass: "text-right" },
    { id: "analyze", header: "Analyze", value: (table) => table.lastAutoanalyze ?? table.lastAnalyze, cellClass: "whitespace-nowrap" },
    { id: "warnings", header: "Signals", value: (table) => table.warnings.join(", ") },
  ];

  const extensionColumns: DataTableColumn<PostgresExtensionDiagnostic>[] = [
    { id: "name", header: "Extension", value: (extension) => extension.name, cellClass: "font-mono text-[11px]" },
    { id: "status", header: "Status", value: (extension) => extension.installed },
    { id: "installed", header: "Installed", value: (extension) => extension.installedVersion },
    { id: "default", header: "Default", value: (extension) => extension.defaultVersion },
    { id: "comment", header: "Description", value: (extension) => extension.comment, cellClass: "max-w-[34rem]" },
  ];

  return () => (
    <AdminLayout c={c} title="Postgres">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0" style="view-transition-name: admin-postgres-title">
          <h1 class="text-base font-semibold text-primary">Postgres</h1>
          <p class="mt-1 text-xs text-dimmed">Runtime pressure, storage, table statistics, and installed extensions.</p>
        </div>

        <StatGrid columns={5}>
          <StatCell
            label="Storage"
            value={formatBytes(diagnostics.totalBytes)}
            sub={`${formatNumber(diagnostics.tables)} tables`}
            accent={{ tone: diagnostics.available ? "blue" : "red", icon: "ti ti-database" }}
          />
          <StatCell
            label="Connections"
            value={`${formatNumber(diagnostics.runtime.connections)}/${formatNumber(diagnostics.runtime.maxConnections)}`}
            sub={`${formatNumber(diagnostics.runtime.activeConnections)} active`}
            accent={
              diagnostics.runtime.maxConnections > 0 && diagnostics.runtime.connections / diagnostics.runtime.maxConnections >= 0.8
                ? { tone: "amber", icon: "ti ti-plug-connected" }
                : undefined
            }
          />
          <StatCell
            label="Lock waits"
            value={formatNumber(diagnostics.runtime.waitingLocks)}
            sub={diagnostics.runtime.waitingLocks ? `${Math.round(diagnostics.runtime.oldestWaitingQuerySeconds)}s oldest query` : "none"}
            accent={diagnostics.runtime.waitingLocks ? { tone: "amber", icon: "ti ti-lock" } : undefined}
          />
          <StatCell
            label="Extensions"
            value={`${formatNumber(diagnostics.installedExtensions)}/${formatNumber(diagnostics.availableExtensions)}`}
            sub="installed / available"
            accent={{ tone: "zinc", icon: "ti ti-plug" }}
          />
          <StatCell
            label="Warnings"
            value={formatNumber(diagnostics.warnings.length)}
            sub={diagnostics.warnings.length ? "needs review" : "none"}
            valueClass={
              hasCriticalWarning
                ? "text-red-600 dark:text-red-400"
                : diagnostics.warnings.length
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-primary"
            }
            accent={
              hasCriticalWarning
                ? { tone: "red", icon: "ti ti-alert-circle" }
                : diagnostics.warnings.length
                  ? { tone: "amber", icon: "ti ti-alert-triangle" }
                  : { tone: "emerald", icon: "ti ti-check" }
            }
          />
        </StatGrid>

        {diagnostics.warnings.length ? (
          <section class={warningGridClass(diagnostics.warnings.length)}>
            {diagnostics.warnings.map((warning) => (
              <article class={warningClasses(warning.tone)}>
                <div class="flex items-start gap-2">
                  <i
                    class={`ti mt-0.5 shrink-0 ${
                      warning.tone === "red"
                        ? "ti-alert-circle text-red-600 dark:text-red-300"
                        : "ti-alert-triangle text-amber-600 dark:text-amber-300"
                    }`}
                  />
                  <div class="min-w-0">
                    <h2 class="text-xs font-semibold">{warning.title}</h2>
                    <p class="mt-1 text-[11px] opacity-80">{warning.detail}</p>
                  </div>
                </div>
              </article>
            ))}
          </section>
        ) : null}

        <DataPanel
          title="Sessions"
          subtitle={
            sessions.length === 0
              ? "No client backends reported"
              : `${sessions.length} client backends · ${blockedSessions.length} blocked · ${unnamedSessions} unnamed`
          }
          isEmpty={sessions.length === 0}
          empty="No client backends are connected."
        >
          <DataTable
            rows={sessions}
            columns={sessionColumns}
            getRowId={(session) => String(session.pid)}
            density="compact"
            class="max-h-[26rem] overflow-auto"
            renderCell={({ row, col, value, render }) => {
              if (col.id === "state")
                return (
                  <StatusBadge
                    tone={row.blockedBy.length > 0 ? "error" : row.state === "active" ? "running" : "neutral"}
                    label={row.blockedBy.length > 0 ? `blocked by ${row.blockedBy.join(", ")}` : (row.state ?? "unknown")}
                    variant="dot"
                  />
                );
              if (col.id === "application")
                return row.application ? (
                  <span class="text-[10px] text-dimmed">{row.application}</span>
                ) : (
                  // Cloud does not set application_name yet, so an unattributable
                  // connection is the finding rather than a rendering gap.
                  <span class="text-[10px] text-amber-600 dark:text-amber-400" title="Connection does not report an application_name">
                    unnamed
                  </span>
                );
              if (col.id === "txAge")
                return <span class="text-[10px] tabular-nums text-dimmed">{formatSeconds(row.transactionAgeSeconds)}</span>;
              if (col.id === "queryAge")
                return <span class="text-[10px] tabular-nums text-dimmed">{formatSeconds(row.queryAgeSeconds)}</span>;
              if (col.id === "wait")
                return <span class="text-[10px] text-dimmed">{row.waitEvent ? `${row.waitEventType}: ${row.waitEvent}` : "—"}</span>;
              if (col.id === "query")
                return (
                  <code class="block truncate text-[10px] text-dimmed" title={row.query ?? undefined}>
                    {row.query ?? "—"}
                  </code>
                );
              return render(value);
            }}
          />
        </DataPanel>

        <DataPanel
          title="Indexes"
          subtitle={`Largest ${indexes.length} by size · ${formatBytes(unusedIndexBytes)} in indexes not scanned since the last statistics reset`}
          isEmpty={indexes.length === 0}
          empty="No user indexes reported."
        >
          <DataTable
            rows={indexes}
            columns={indexColumns}
            getRowId={(index) => `${index.schema}.${index.name}`}
            density="compact"
            class="max-h-[26rem] overflow-auto"
            renderCell={({ row, col, value, render }) => {
              if (col.id === "index")
                return (
                  <div class="min-w-0">
                    <code class="block truncate text-[10px] text-primary">{row.name}</code>
                    <span class="text-[9px] text-dimmed">
                      {row.schema}.{row.table}
                    </span>
                  </div>
                );
              if (col.id === "size") return <span class="text-[10px] tabular-nums text-dimmed">{formatBytes(row.sizeBytes)}</span>;
              if (col.id === "scans")
                return (
                  <span
                    class={`text-[10px] tabular-nums ${row.scans === 0 && !row.isPrimary ? "text-amber-600 dark:text-amber-400" : "text-dimmed"}`}
                  >
                    {formatNumber(row.scans)}
                  </span>
                );
              if (col.id === "kind")
                return <span class="text-[10px] text-dimmed">{row.isPrimary ? "primary" : row.isUnique ? "unique" : "index"}</span>;
              return render(value);
            }}
          />
        </DataPanel>

        <section class="paper overflow-hidden">
          <div class="flex flex-col gap-2 px-3 py-2">
            <div>
              <h2 class="text-xs font-semibold text-primary">Tables</h2>
              <p class="text-[10px] text-dimmed">
                {formatNumber(filteredTables.length)} of {formatNumber(diagnostics.tableRows.length)} tables. Row counts are planner
                estimates.
              </p>
            </div>
            <SearchBar
              action={searchAction}
              value={search}
              placeholder="Search tables or table signals..."
              ariaLabel="Search Postgres tables"
            />
            <PostgresDataFilters search={search} schema={selectedSchema} sort={selectedSort} schemas={schemas} />
          </div>
          <DataTable
            rows={filteredTables}
            columns={tableColumns}
            getRowId={(table) => `${table.schema}.${table.name}`}
            density="compact"
            hoverRows
            class="max-h-[34rem] overflow-auto"
            rowClass={(table) => (table.warnings.length > 0 ? "bg-amber-500/[0.04]" : "")}
            empty="No matching tables."
            renderCell={({ row: table, col, value, render }) => {
              if (col.id === "table") {
                return (
                  <span title={`${table.schema}.${table.name}`}>
                    <span class="text-dimmed">{table.schema}</span>
                    <span class="text-dimmed">.</span>
                    <span class="font-medium text-primary">{table.name}</span>
                  </span>
                );
              }
              if (col.id === "rows" || col.id === "dead") return <span class="tabular-nums">{formatNumber(Number(value ?? 0))}</span>;
              if (col.id === "total" || col.id === "tableBytes" || col.id === "indexBytes")
                return <span class="tabular-nums">{formatBytes(Number(value ?? 0))}</span>;
              if (col.id === "analyze") return <span class="text-dimmed">{formatDate(value as string | null)}</span>;
              if (col.id === "warnings") {
                return table.warnings.length ? (
                  <div class="flex flex-wrap gap-1">
                    {table.warnings.map((warning) => (
                      <span class="tag bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">{warning}</span>
                    ))}
                  </div>
                ) : (
                  <span class="text-dimmed">-</span>
                );
              }
              return render(value);
            }}
          />
        </section>

        <section class="paper overflow-hidden">
          <div class="px-3 py-2">
            <h2 class="text-xs font-semibold text-primary">Extensions</h2>
            <p class="text-[10px] text-dimmed">
              {formatNumber(diagnostics.installedExtensions)} installed, {formatNumber(diagnostics.availableExtensions)} available.
            </p>
          </div>
          <DataTable
            rows={filteredExtensions}
            columns={extensionColumns}
            getRowId={(extension) => extension.name}
            density="compact"
            hoverRows
            class="max-h-80 overflow-auto"
            empty="No matching extensions."
            renderCell={({ row: extension, col, value, render }) => {
              if (col.id === "status") {
                return extension.installed ? (
                  <span class="tag bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                    <i class="ti ti-check text-[9px]" />
                    installed
                  </span>
                ) : (
                  <span class="tag bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">available</span>
                );
              }
              if (col.id === "comment") return <span title={extension.comment ?? undefined}>{extension.comment ?? "-"}</span>;
              return render(value);
            }}
          />
        </section>
        <section class="grid gap-2 xl:grid-cols-3">
          <article class="paper p-3">
            <h2 class="text-xs font-semibold text-primary">Size by schema</h2>
            <p class="text-[10px] text-dimmed">Top schemas by total relation size.</p>
            <ObservabilityChart kind="bar" class="mt-2 h-56 text-dimmed" data={schemaChartData} yFormat="bytes" />
          </article>
          <article class="paper p-3">
            <h2 class="text-xs font-semibold text-primary">Largest tables</h2>
            <p class="text-[10px] text-dimmed">Top 10 by relation size.</p>
            <ObservabilityChart kind="donut" class="mt-2 h-64 text-dimmed" data={tableChartData} legend />
          </article>
          <article class="paper p-3">
            <h2 class="text-xs font-semibold text-primary">Rows by schema</h2>
            <p class="text-[10px] text-dimmed">Planner row estimates by schema.</p>
            <ObservabilityChart kind="bar" class="mt-2 h-56 text-dimmed" data={schemaRowsChartData} yFormat="number" />
          </article>
        </section>
      </div>
    </AdminLayout>
  );
});
