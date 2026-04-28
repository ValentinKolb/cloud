import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "contacts",
  name: "Contacts",
  icon: "ti ti-address-book",
  description: "Business contact books with structured emails, phones, postal addresses, and IPA system directory projection.",
  basePath: "/app/contacts",
  baseUrl: "http://app-contacts:3000",
  nav: {
    href: "/app/contacts",
    match: "/app/contacts",
    section: "primary",
    requiresAuth: true,
    requiresRoles: ["user"],
  },
});

export const { ssr, plugin } = app;
