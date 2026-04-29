import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { notificationsService } from "./service";

export default await app.start({
  router: new Hono()
    .route("/api/notifications", apiRoutes)
    .route("/admin/notifications", adminPageRoutes),
});
export { notificationsService as service };
export type { ApiType } from "./api";
export type { NotificationsService } from "./service";
