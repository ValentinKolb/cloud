import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "proxy-auth",
  name: "Proxy Auth",
  icon: "ti ti-load-balancer",
  description: "Configure forward-auth clients and verify callback access flows.",
  basePath: "/admin/proxy-auth",
  baseUrl: "http://app-proxy-auth:3000",
  adminHref: "/admin/proxy-auth",
});

export const { ssr, plugin } = app;
