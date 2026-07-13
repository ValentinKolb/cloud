import { defineApp } from "@valentinkolb/cloud";

const port = parseInt(process.env.PORT ?? "3000", 10);

export const app = defineApp({
  id: "gateway-ops",
  name: "Gateway",
  icon: "ti ti-route-scan",
  description: "Admin console for gateway operations, observability, and notifications.",
  appearance: { accent: "#b91c1c", background: { from: "#ef4444", to: "#f97316", angle: 135 } },
  basePath: "/admin/gateway",
  baseUrl: `http://app-gateway-ops:${port}`,
  adminHref: "/admin/gateway",
  adminNav: [
    {
      label: "Gateway",
      links: [
        { href: "/admin/gateway/apps", icon: "ti-apps", label: "Apps" },
        { href: "/admin/gateway/routes", icon: "ti-route", label: "Routes" },
      ],
    },
    {
      label: "Observability",
      links: [
        { href: "/admin/observability/logs", icon: "ti-list-details", label: "Logs" },
        { href: "/admin/observability/jobs", icon: "ti-activity", label: "Jobs" },
        { href: "/admin/observability/telemetry", icon: "ti-chart-line", label: "Telemetry" },
        { href: "/admin/observability/metrics", icon: "ti-plug", label: "Metrics" },
        { href: "/admin/observability/postgres", icon: "ti-database", label: "Postgres" },
        { href: "/admin/observability/redis", icon: "ti-database", label: "Redis" },
        { href: "/admin/observability/alerts", icon: "ti-webhook", label: "Webhooks" },
        { href: "/admin/observability/notifications", icon: "ti-bell", label: "Notifications" },
      ],
    },
  ],
  nav: { href: "", section: "hidden", requiresRoles: ["admin"] },
  settings: {
    "gateway.health_check_schedule": {
      kind: "cron",
      label: "Health Check Schedule",
      default: "*/5 * * * *",
      description: "Cron schedule for evaluating global gateway health and health webhooks. Uses app.timezone.",
    },
  },
  widgets: [
    { id: "health", path: "/api/gateway/widget/health" },
    { id: "errors", path: "/api/logging/widget/errors" },
  ],
  routes: [
    "/metrics",
    "/api/gateway",
    "/api/logging",
    "/api/notifications",
    "/admin/gateway",
    "/admin/observability",
    "/public/gateway-ops",
  ],
});

export const { ssr, plugin } = app;
