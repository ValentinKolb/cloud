import { defineApp } from "@valentinkolb/cloud";

export const app = defineApp({
  id: "settings",
  name: "Settings",
  icon: "ti ti-settings",
  description: "Runtime configuration for application behavior and defaults.",
  basePath: "/admin/settings",
  baseUrl: "http://app-settings:3000",
  adminHref: "/admin/settings",
  // Settings owns the three legal pages — content lives in `legal.*` settings,
  // pages mounted at /impressum + /legal/{terms,privacy} by ./index.ts.
  legalLinks: [
    { label: "Imprint", href: "/impressum", icon: "ti ti-info-circle" },
    { label: "Privacy", href: "/legal/privacy", icon: "ti ti-shield-lock" },
    { label: "Terms", href: "/legal/terms", icon: "ti ti-file-text" },
  ],
});

export const { ssr, plugin } = app;
