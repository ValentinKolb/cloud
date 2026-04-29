import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import adminPageRoutes from "./frontend";
import { loggingService } from "./service";

export default await app.start({
  routes: {
    api: new Hono().route("/logging", apiRoutes),
    pages: new Hono().route("/admin/logging", adminPageRoutes),
  },
});
export { loggingService as service };
export type { ApiType } from "./api";
export type { LoggingService } from "./service";
