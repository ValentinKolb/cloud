import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "tools",
  name: "Tools",
  icon: "ti ti-tools",
  description: "Utility tools for day-to-day work tasks.",
  basePath: "/tools",
  baseUrl: "http://app-tools:3000",
  nav: {
    href: "/tools",
    match: "/tools",
    section: "more",
  },
  // Top-level `/tools` (no `/app/tools` for the legacy short URL).
  routes: ["/tools", "/public/tools"],
});

export const { ssr, plugin } = app;
