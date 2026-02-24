import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { loggingService } from "./service";

const app = {
  meta: {
    id: "logging",
    name: "Logs",
    icon: "ti ti-list-details",
    description: "View, filter, and clean up application logs.",
    color: "emerald",
    adminHref: "/admin/logs",
  },
  service: loggingService,
  routes: {
    api: new Hono().route("/admin/logs", apiRoutes),
    pages: new Hono().route("/admin/logs", adminPageRoutes),
  },
} satisfies AppFacade<typeof loggingService>;

export default app;
export { loggingService as service };
export type { ApiType } from "./api";
export type { LoggingService } from "./service";
