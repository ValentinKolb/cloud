import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { app } from "./config";
import helpPage from "./frontend/help/page";
import dashboardPage from "./frontend/page";
import { dashboardHelp } from "./help";
import { migrate } from "./migrate";

const pageRoutes = new Hono<AuthContext>()
  .get("/help", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/help/:topic", auth.requireRole("authenticated", auth.redirectToLogin), ...helpPage)
  .get("/", auth.requireRole("authenticated", auth.redirectToLogin), ...dashboardPage);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/dashboard/help", new Hono<AuthContext>().use(auth.requireRole("authenticated")).route("/", dashboardHelp.router))
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
export type { DashboardSettingsResult } from "./service";
export { dashboardService as service, dashboardSettingsService, getUserSettings, saveUserSettings } from "./service";
