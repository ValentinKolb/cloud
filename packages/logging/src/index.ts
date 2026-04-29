import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { loggingService } from "./service";

export default await app.start({
  router: new Hono()
    .route("/api/logging", apiRoutes)
    .route("/admin/logging", adminPageRoutes),
});
export { loggingService as service };
export type { ApiType } from "./api";
export type { LoggingService } from "./service";
