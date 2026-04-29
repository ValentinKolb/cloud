import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "ui-lab",
  name: "UI Lab",
  icon: "ti ti-palette",
  description: "Static showcase of shared UI components and styles.",
  basePath: "/app/ui-lab",
  baseUrl: "http://app-ui-lab:3000",
  // ui-lab is a public component showcase. In production, simply don't
  // start the container if the showcase shouldn't be visible.
  nav: {
    href: "/app/ui-lab",
    match: "/app/ui-lab",
    section: "more",
  },
  routes: ["/app/ui-lab", "/public/ui-lab"],
});

export const { ssr, plugin } = app;
