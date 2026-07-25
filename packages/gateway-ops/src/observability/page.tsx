/**
 * Observability overview — the entry point the console did not have.
 *
 * The incident help document describes a diagnosis path (apps → routes →
 * telemetry → logs → storage → notifications), but the navigation offered
 * eight flat links and no starting point, so an operator had to guess which
 * page held the answer. This page answers one question — "is anything wrong
 * right now" — and links straight to the page that explains each signal.
 *
 * Every tile is a link, and every number is scoped to the same window so the
 * figure shown can be reproduced by the page it leads to.
 */
import type { AuthContext } from "@valentinkolb/cloud/server";
import { logging, trace } from "@valentinkolb/cloud/services";
import { AdminLayout } from "@valentinkolb/cloud/ssr";
import { Placeholder, StatCell, StatGrid } from "@valentinkolb/cloud/ui";
import { ssr } from "../config";
import GatewayOpsLayoutHelp from "../frontend/GatewayOpsLayoutHelp.island";
import { buildGatewayHealth } from "../health";
import { gatewayOpsHelp } from "../help";
import { DEFAULT_TELEMETRY_RANGE, isTelemetryRange, TELEMETRY_RANGES, type TelemetryRange } from "./telemetry/contracts";
import { getTelemetryOverview, listTelemetryRoutes } from "./telemetry/service";

const RANGE_KEYS = Object.keys(TELEMETRY_RANGES) as TelemetryRange[];

const fmt = (value: number) => value.toLocaleString();

/** Reports a section that could not be read instead of rendering it as zero. */
const settled = async <T,>(load: () => Promise<T>, fallback: T): Promise<{ value: T; error: string | null }> => {
  try {
    return { value: await load(), error: null };
  } catch (error) {
    return { value: fallback, error: error instanceof Error ? error.message : String(error) };
  }
};

export default ssr<AuthContext>(async (c) => {
  const url = new URL(c.req.url);
  const rangeParam = url.searchParams.get("range");
  const range = isTelemetryRange(rangeParam) ? rangeParam : DEFAULT_TELEMETRY_RANGE;

  const [health, telemetry, failingRoutes, logSummary, jobStats] = await Promise.all([
    settled(() => buildGatewayHealth(), null),
    settled(() => getTelemetryOverview({ range }), null),
    settled(() => listTelemetryRoutes({ range }, "errorRate", { errorsOnly: true, slowOnly: false }), []),
    settled(() => logging.summary(), null),
    settled(() => trace.stats({ filter: { window: range === "1h" || range === "6h" ? "1h" : "24h", excludeDefinitions: true } }), null),
  ]);

  const offlineApps = health.value?.apps.filter((app) => app.status !== "ok") ?? [];
  const worstRoutes = failingRoutes.value.slice(0, 5);
  const rangeUrl = (option: TelemetryRange) =>
    option === DEFAULT_TELEMETRY_RANGE ? "/admin/observability" : `/admin/observability?range=${option}`;

  return () => (
    <AdminLayout c={c} title="Observability">
      <GatewayOpsLayoutHelp documents={gatewayOpsHelp.manifest} />
      <div class="app-rows">
        <div class="min-w-0">
          <h1 class="text-base font-semibold text-primary">Observability</h1>
          <p class="mt-1 text-xs text-dimmed">What is wrong right now, and where to look next.</p>
        </div>

        <nav class="flex flex-wrap items-center gap-1" aria-label="Window">
          <span class="mr-1 text-[10px] text-dimmed">Window</span>
          {RANGE_KEYS.map((option) => (
            <a
              href={rangeUrl(option)}
              class={`btn-input btn-input-sm ${option === range ? "btn-input-active" : ""}`}
              aria-current={option === range ? "true" : undefined}
            >
              {option}
            </a>
          ))}
        </nav>

        <StatGrid columns={5}>
          <StatCell
            label="Apps"
            value={health.value ? `${health.value.apps.length - offlineApps.length}/${health.value.apps.length}` : "—"}
            sub={health.error ? "unavailable" : offlineApps.length === 0 ? "all online" : offlineApps.map((app) => app.id).join(", ")}
            valueClass={offlineApps.length > 0 ? "text-red-500" : "text-primary"}
            href="/admin/gateway/apps"
            accent={offlineApps.length > 0 ? { tone: "red", icon: "ti ti-plug-connected-x" } : { tone: "emerald", icon: "ti ti-check" }}
          />
          <StatCell
            label="Server errors"
            value={telemetry.value ? fmt(telemetry.value.serverErrors) : "—"}
            sub={telemetry.error ? "unavailable" : `5xx · ${range}`}
            valueClass={(telemetry.value?.serverErrors ?? 0) > 0 ? "text-red-500" : "text-primary"}
            href={`/admin/observability/telemetry?range=${range}&errors=1`}
            accent={(telemetry.value?.serverErrors ?? 0) > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
          <StatCell
            label="Rate limited"
            value={telemetry.value ? fmt(telemetry.value.rateLimited) : "—"}
            sub={telemetry.error ? "unavailable" : `429 · ${range}`}
            href={`/admin/observability/telemetry?range=${range}`}
            accent={(telemetry.value?.rateLimited ?? 0) > 0 ? { tone: "amber", icon: "ti ti-hand-stop" } : undefined}
          />
          <StatCell
            label="Stuck jobs"
            value={jobStats.value ? fmt(jobStats.value.stuck) : "—"}
            sub={jobStats.error ? "unavailable" : "open, abandoned"}
            valueClass={(jobStats.value?.stuck ?? 0) > 0 ? "text-red-500" : "text-primary"}
            href="/admin/observability/jobs?health=stuck"
            accent={(jobStats.value?.stuck ?? 0) > 0 ? { tone: "red", icon: "ti ti-plug-connected-x" } : undefined}
          />
          <StatCell
            label="Log errors"
            value={logSummary.value ? fmt(logSummary.value.errors24h) : "—"}
            sub={logSummary.error ? "unavailable" : "last 24h"}
            valueClass={(logSummary.value?.errors24h ?? 0) > 0 ? "text-red-500" : "text-primary"}
            href="/admin/observability/logs?level=error"
            accent={(logSummary.value?.errors24h ?? 0) > 0 ? { tone: "red", icon: "ti ti-alert-circle" } : undefined}
          />
        </StatGrid>

        <section class="paper p-3">
          <h2 class="text-xs font-semibold text-primary">Failing routes</h2>
          <p class="text-[10px] text-dimmed">Highest error rate in the selected window. Follow one to its requests.</p>
          {failingRoutes.error ? (
            <Placeholder state="error" variant="compact" description={failingRoutes.error} />
          ) : worstRoutes.length === 0 ? (
            <Placeholder variant="compact" description="No route produced an error in this window." />
          ) : (
            <ul class="mt-2 flex flex-col gap-1">
              {worstRoutes.map((row) => (
                <li>
                  <a
                    href={`/admin/observability/telemetry?range=${range}&app=${encodeURIComponent(row.appId)}&route=${encodeURIComponent(row.route)}`}
                    class="flex items-baseline justify-between gap-3 hover:text-primary"
                  >
                    <code class="truncate text-[11px] text-primary">{row.route}</code>
                    <span class="shrink-0 text-[10px] tabular-nums text-red-500">
                      {fmt(row.errors)}/{fmt(row.requests)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AdminLayout>
  );
});
