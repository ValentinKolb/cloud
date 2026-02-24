import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { syncService } from "./service";

const app = {
  meta: {
    id: "sync",
    name: "Sync",
    icon: "ti ti-refresh",
    description: "Trigger and monitor synchronization with FreeIPA.",
    color: "amber",
    adminHref: "/admin/sync",
  },
  service: syncService,
  routes: {
    api: new Hono().route("/ipa/sync", apiRoutes),
    pages: new Hono().route("/admin/sync", adminPageRoutes),
  },
} satisfies AppFacade<typeof syncService>;

export default app;
export { syncService as service };
export type { ApiType } from "./api";
export type { SyncService } from "./service";
