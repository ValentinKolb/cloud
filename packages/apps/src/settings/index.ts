import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { settingsService } from "./service";

const app = {
  meta: {
    id: "settings",
    name: "Settings",
    icon: "ti ti-settings",
    description: "Runtime configuration for application behavior and defaults.",
    color: "zinc",
    adminHref: "/admin/settings",
  },
  service: settingsService,
  routes: {
    api: new Hono().route("/admin/settings", apiRoutes),
    pages: new Hono().route("/admin/settings", adminPageRoutes),
  },
} satisfies AppFacade<typeof settingsService>;

export default app;
export { settingsService as service };
export type { ApiType } from "./api";
export type { SettingsService } from "./service";
