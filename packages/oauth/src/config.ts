import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "oauth",
  name: "OAuth",
  icon: "ti ti-key",
  description: "Manage OAuth/OIDC clients, redirects, scopes, and secrets.",
  basePath: "/oauth",
  baseUrl: "http://app-oauth:3000",
  adminHref: "/admin/oauth",
  openapi: "/api/oauth/openapi.json",
  // OAuth needs RFC-mandated top-level paths (/oauth/authorize, /oauth/token,
  // /.well-known/openid-configuration, /.well-known/jwks.json) plus the
  // platform-standard admin UI + admin API.
  routes: ["/oauth", "/.well-known/openid-configuration", "/.well-known/jwks.json", "/api/oauth", "/admin/oauth", "/public/oauth"],
});

export const { ssr, plugin } = app;
