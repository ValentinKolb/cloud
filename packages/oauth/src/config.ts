import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "oauth",
  name: "OAuth",
  icon: "ti ti-key",
  description: "Manage OAuth/OIDC clients, redirects, scopes, and secrets.",
  basePath: "/oauth",
  baseUrl: "http://app-oauth:3000",
  adminHref: "/admin/oauth",
});

export const { ssr, plugin } = app;
