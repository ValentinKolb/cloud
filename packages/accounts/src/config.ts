import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "accounts",
  name: "Accounts",
  icon: "ti ti-users-group",
  description: "Manage account access, groups, and account requests.",
  basePath: "/app/accounts",
  baseUrl: "http://app-accounts:3000",
  nav: {
    href: "/app/accounts",
    match: "/app/accounts",
    section: "more",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
  widgets: [{ id: "admin-queue", path: "/api/accounts/widget/admin-queue" }],
  routes: ["/api/accounts", "/app/accounts", "/public/accounts"],
});

export const { ssr, plugin } = app;
