import { type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { mailCapabilities } from "./capabilities";
import { app } from "./config";
import pageRoutes from "./frontend";
import { migrate } from "./migrate";
import { commandRuntime, mailRuntime } from "./service";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/mail", apiRoutes)
  .route("/app/mail", pageRoutes);

export default await app.start({
  capabilities: mailCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: migrate,
    start: async () => {
      await mailRuntime.start();
      await commandRuntime.start();
    },
    stop: async () => {
      await commandRuntime.stop();
      await mailRuntime.stop();
    },
  },
});

export type { ApiType } from "./api";
export * from "./contracts";
export { mailService as service } from "./service";
