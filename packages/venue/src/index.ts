import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/venue", apiRoutes)
  .route("/app/venue", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});

export type { ApiType } from "./api";
