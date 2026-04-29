import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "ipa-hosts",
  name: "Hosts",
  icon: "ti ti-server",
  description: "Manage FreeIPA hosts, hostgroups, and mirrored host membership data.",
  basePath: "/admin/ipa-hosts",
  baseUrl: "http://app-ipa-hosts:3000",
  adminHref: "/admin/ipa-hosts",
  widgets: [{ id: "sync", path: "/api/ipa-hosts/widget/sync" }],
  routes: ["/api/ipa-hosts", "/admin/ipa-hosts", "/public/ipa-hosts"],
});

export const { ssr, plugin } = app;
