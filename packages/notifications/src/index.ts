import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { notificationsService } from "./service";

export default await app.start({
  routes: {
    api: new Hono().route("/notifications", apiRoutes),
    pages: new Hono().route("/admin/notifications", adminPageRoutes),
  },
});
export { notificationsService as service };
export type { ApiType } from "./api";
export type { NotificationsService } from "./service";
