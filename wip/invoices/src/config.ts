import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "invoices",
  name: "Invoices",
  icon: "ti ti-file-invoice",
  description: "Create structured invoices and e-invoice artifacts.",
  basePath: "/app/invoices",
  baseUrl: "http://app-invoices:3000",
  nav: {
    href: "/app/invoices",
    match: "/app/invoices",
    section: "more",
    requiresAuth: true,
  },
  openapi: "/api/invoices/openapi.json",
  routes: ["/api/invoices", "/app/invoices", "/public/invoices"],
});

export const { ssr, plugin } = app;
