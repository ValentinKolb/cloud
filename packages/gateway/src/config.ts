import { defineApp } from "@valentinkolb/cloud";

const port = parseInt(process.env.PORT ?? "3000", 10);

export const app = defineApp({
  id: "gateway",
  name: "Gateway",
  icon: "ti ti-route-scan",
  description: "HTTP reverse proxy with dynamic route discovery.",
  basePath: "/admin/gateway",
  baseUrl: `http://gateway:${port}`,
  adminHref: "/admin/gateway",
  nav: { href: "", section: "hidden" },
  settings: {
    "gateway.health_check_schedule": {
      kind: "cron",
      label: "Health Check Schedule",
      default: "*/5 * * * *",
      description: "Cron schedule for evaluating global gateway health and health webhooks. Uses app.timezone.",
    },
  },
  widgets: [{ id: "health", path: "/api/gateway/widget/health" }],
  // Gateway is the dispatcher itself — it doesn't appear in its own route
  // table (filtered out in `buildAppRoutes`). The list here is for shape
  // completeness and any tooling that iterates registry entries.
  routes: ["/health", "/api/gateway", "/admin/gateway"],
});

export const { ssr, plugin, config } = app;
