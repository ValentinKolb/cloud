import { Layout } from "@valentinkolb/cloud/ssr/islands";
import { DocConceptGrid, DocLead, DocNote, DocPage, DocRows, DocSection } from "@valentinkolb/cloud/ui";

export default function GatewayOpsLayoutHelp() {
  return (
    <>
      <Layout.Help
        id="gateway-ops-start"
        title="Start"
        icon="ti ti-route-scan"
        description="Gateway apps, routes, health, logs, telemetry, metrics, data diagnostics, notifications, and webhooks."
        order={100}
      >
        <DocPage>
          <DocLead>
            Gateway Ops is the admin console for the Cloud gateway. Use it to see which apps are registered, which route prefixes are
            served, how requests behave, and where platform-level health signals need attention.
          </DocLead>

          <DocSection title="Overview" eyebrow="Start here">
            <DocConceptGrid
              items={[
                {
                  title: "App registry",
                  icon: "ti-apps",
                  text: "Apps register with the gateway and expose metadata such as name, route prefix, navigation support, admin pages, search support, and health state.",
                },
                {
                  title: "Routes",
                  icon: "ti-route",
                  text: "Route prefixes show which app currently owns a path, how often the route was hit, and how many gateway errors were recorded.",
                },
                {
                  title: "Health",
                  icon: "ti-heartbeat",
                  text: "Gateway health combines live app registration, stale app status, offline apps, route stats, unmatched requests, and gateway instances.",
                },
                {
                  title: "Observability",
                  icon: "ti-activity",
                  text: "Logs, telemetry, Prometheus metrics, Redis diagnostics, Postgres diagnostics, notifications, and alert webhooks are grouped under Observability.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Common paths">
            <DocRows
              items={[
                {
                  title: "Check the platform state",
                  icon: "ti-checkup-list",
                  text: "Start with Apps for online, degraded, and offline services. Remove an offline registration only when the app is no longer expected to return.",
                },
                {
                  title: "Trace routing behavior",
                  icon: "ti-route-2",
                  text: "Open Routes to inspect route prefixes, total hits, and recorded errors for each prefix served by the gateway.",
                },
                {
                  title: "Investigate a request problem",
                  icon: "ti-search",
                  text: "Use Telemetry for request events, slow requests, status codes, route prefixes, methods, and error kinds. Use Logs when the application emitted structured log entries.",
                },
                {
                  title: "Check platform storage",
                  icon: "ti-database",
                  text: "Use Postgres and Redis diagnostics to inspect table growth, dead rows, installed extensions, key counts, prefix distribution, TTL coverage, and warnings.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Access" variant="info">
            Gateway Ops is an admin surface. API routes require admin access, and destructive actions such as removing offline apps or
            deleting webhooks are handled through the same admin API as the UI.
          </DocNote>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="gateway-ops-operations"
        title="Operations"
        icon="ti ti-tool"
        description="How the operational pages fit together during normal diagnosis and maintenance."
        order={110}
      >
        <DocPage>
          <DocLead>
            The pages are server-rendered admin views with URL-backed filters, search, pagination, and compact status summaries.
          </DocLead>

          <DocSection title="Gateway pages">
            <DocRows
              items={[
                {
                  title: "Apps",
                  icon: "ti-apps",
                  text: "Shows registered apps, online status, base URL, heartbeat, uptime, request count, latency, error count, and supported platform features.",
                },
                {
                  title: "Routes",
                  icon: "ti-router",
                  text: "Shows route prefix ownership and route counters from the current gateway router snapshot.",
                },
                {
                  title: "Health webhooks",
                  icon: "ti-webhook",
                  text: "Deliver gateway health to HTTP endpoints. Webhooks can be scoped to all apps, included apps, or excluded apps, and can send GET pings or POST JSON payloads.",
                },
                {
                  title: "Settings",
                  icon: "ti-settings",
                  text: "The gateway health check schedule is stored as a setting and controls when scheduled webhook evaluations run.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Observability pages">
            <DocRows
              items={[
                {
                  title: "Logs",
                  icon: "ti-list-details",
                  text: "Filter structured log entries by source, level, search text, and page. Retention is shown from the log retention setting.",
                },
                {
                  title: "Telemetry",
                  icon: "ti-wave-sine",
                  text: "Inspect gateway request events by app, route, method, status, duration, slow requests, and errors.",
                },
                {
                  title: "Metrics",
                  icon: "ti-chart-line",
                  text: "Expose a Prometheus-compatible metrics endpoint and manage bearer tokens for Pulse or external scrapers.",
                },
                {
                  title: "Notifications",
                  icon: "ti-bell-ringing",
                  text: "Search notification delivery records and filter by sent, pending, or error status.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Data diagnostics">
            <DocConceptGrid
              items={[
                {
                  title: "Postgres",
                  icon: "ti-database",
                  text: "Shows schema size, table size, planner row estimates, dead rows, analyze timestamps, installed extensions, and table warnings.",
                },
                {
                  title: "Redis",
                  icon: "ti-database-export",
                  text: "Shows keyspace size, expiry coverage, average TTL, prefix distribution, bounded SCAN samples, and warnings.",
                },
              ]}
            />
          </DocSection>
        </DocPage>
      </Layout.Help>

      <Layout.Help
        id="gateway-ops-reference"
        title="Reference"
        icon="ti ti-book"
        description="Field meanings, webhook behavior, and what the diagnostics are allowed to show."
        order={120}
      >
        <DocPage>
          <DocLead>
            Gateway Ops summarizes platform signals. It avoids listing raw Redis keys and relies on existing service APIs for logs,
            telemetry, settings, metrics, and health webhooks.
          </DocLead>

          <DocSection title="Health states">
            <DocRows
              items={[
                {
                  title: "OK",
                  icon: "ti-check",
                  text: "The scoped apps are online and their status is fresh enough for the gateway health check.",
                },
                {
                  title: "Warning",
                  icon: "ti-alert-triangle",
                  text: "An app can be reached but reports stale health information or another degraded state.",
                },
                {
                  title: "Error",
                  icon: "ti-alert-circle",
                  text: "At least one scoped app is offline or otherwise unhealthy enough to make the scoped health status fail.",
                },
              ]}
            />
          </DocSection>

          <DocSection title="Webhook delivery">
            <DocRows
              items={[
                {
                  title: "Triggers",
                  icon: "ti-bell",
                  text: "Webhooks can send on OK, warning, error, recovery, or every scheduled check. If no trigger is selected, error and recovery are used.",
                },
                {
                  title: "Repeat interval",
                  icon: "ti-repeat",
                  text: "Unresolved warning or error states repeat only after the configured interval. The interval is clamped between one minute and thirty days.",
                },
                {
                  title: "Timeout",
                  icon: "ti-clock",
                  text: "Delivery timeout is clamped between one and thirty seconds. Failed deliveries update the webhook's last error and failure count.",
                },
                {
                  title: "Payload",
                  icon: "ti-json",
                  text: "GET delivery sends a ping request. POST delivery sends JSON containing the mode and scoped gateway health report.",
                },
              ]}
            />
          </DocSection>

          <DocNote title="Diagnostics limits" variant="info">
            Redis prefixes come from a bounded sample, not a full raw key browser. Postgres row counts are planner estimates, not exact
            counts from full table scans.
          </DocNote>
        </DocPage>
      </Layout.Help>
    </>
  );
}
