import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "proxy-auth",
  name: "Proxy Auth",
  icon: "ti ti-load-balancer",
  description: "Configure forward-auth clients and verify callback access flows.",
  basePath: "/admin/proxy-auth",
  baseUrl: "http://app-proxy-auth:3000",
  adminHref: "/admin/proxy-auth",
  openapi: "/api/proxy-auth/openapi.json",
  // Top-level `/proxy-auth` for the Traefik forward-auth verify endpoint
  // — the URL must be configurable on the public origin without /api prefix.
  routes: ["/proxy-auth", "/api/proxy-auth", "/admin/proxy-auth", "/public/proxy-auth"],
});

export const { ssr, plugin } = app;
