import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import adminPageRoutes from "./pages";
import { notificationsService } from "./service";

const app = {
  meta: {
    id: "notifications",
    name: "Notifications",
    icon: "ti ti-bell",
    description: "Inspect sent notifications and resend or edit pending deliveries.",
    color: "blue",
    adminHref: "/admin/notifications",
  },
  service: notificationsService,
  routes: {
    api: new Hono().route("/admin/notifications", apiRoutes),
    pages: new Hono().route("/admin/notifications", adminPageRoutes),
  },
} satisfies AppFacade<typeof notificationsService>;

export default app;
export { notificationsService as service };
export type { ApiType } from "./api";
export type { NotificationsService } from "./service";
