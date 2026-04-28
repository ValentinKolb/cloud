import { defineApp } from "@valentinkolb/cloud";
import { CORE_SETTINGS } from "./_settings";

export const app = defineApp({
  id: "core",
  name: "Core",
  icon: "ti ti-cloud",
  description: "Auth, search, admin, and platform services.",
  baseUrl: "http://app-core:3000",
  settings: CORE_SETTINGS,
});

export const { ssr, plugin } = app;
