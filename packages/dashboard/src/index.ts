import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import dashboardPage from "./frontend/page";
import { migrate } from "./migrate";

const pageRoutes = new Hono<AuthContext>().get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...dashboardPage);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/dashboard", apiRoutes)
  .route("/app/dashboard", pageRoutes);

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
