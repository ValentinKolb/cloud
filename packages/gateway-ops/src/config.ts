import { defineApp } from "@valentinkolb/cloud";

const port = parseInt(process.env.PORT ?? "3000", 10);

export const app = defineApp({
  id: "gateway-ops",
  name: "Gateway",
  icon: "ti ti-route-scan",
  description: "Admin console for gateway operations, observability, settings, and notifications.",
  basePath: "/admin/gateway",
  baseUrl: `http://app-gateway-ops:${port}`,
  adminHref: "/admin/gateway",
  nav: { href: "", section: "hidden", requiresRoles: ["admin"] },
  settings: {
    "gateway.health_check_schedule": {
      kind: "cron",
      label: "Health Check Schedule",
      default: "*/5 * * * *",
      description: "Cron schedule for evaluating global gateway health and health webhooks. Uses app.timezone.",
    },
  },
  legalLinks: [
    { label: "Imprint", href: "/impressum", icon: "ti ti-info-circle" },
    { label: "Privacy", href: "/legal/privacy", icon: "ti ti-shield-lock" },
    { label: "Terms", href: "/legal/terms", icon: "ti ti-file-text" },
  ],
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
    "/admin/settings",
    "/public/gateway-ops",
    "/legal/privacy",
    "/legal/terms",
    "/impressum",
  ],
});

export const { ssr, plugin } = app;
