import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "spaces",
  name: "Spaces",
  icon: "ti ti-layout-kanban",
  description: "Plan, track, and collaborate on boards, tasks, and events.",
  basePath: "/app/spaces",
  baseUrl: "http://app-spaces:3000",
  adminHref: "/admin/spaces",
  nav: {
    href: "/app/spaces?recent=true",
    match: "/app/spaces",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  widgets: [{ id: "today", path: "/api/spaces/widget/today" }],
  openapi: "/api/spaces/openapi.json",
  routes: ["/api/spaces", "/app/spaces", "/admin/spaces", "/public/spaces"],
});

export const { ssr, plugin } = app;
