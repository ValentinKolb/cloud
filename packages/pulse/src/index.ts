import { Hono } from "hono";
import { app } from "./config";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";
import { pulseService } from "./service";
import { pulseRuntime } from "./service/runtime";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/pulse", apiRoutes)
  .route("/app/pulse", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await pulseRuntime.start();
    },
    stop: async () => {
      await pulseRuntime.stop();
    },
  },
});

export { pulseService as service };
export type { ApiType } from "./api";
