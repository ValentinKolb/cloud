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
  widgets: [{ id: "health", path: "/api/gateway/widgets/health" }],
});

export const { ssr, plugin, config } = app;
