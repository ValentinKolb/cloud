import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { routes } from "@valentinkolb/ssr/hono";
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { apiRoutes } from "./api";
import { app } from "./config";
import gatewayPage from "./frontend/page";
import { gatewayOpsLifecycle } from "./lifecycle";
import alertsPage from "./observability/alerts/page";
import loggingApiRoutes from "./observability/logs/api";
import logsPage from "./observability/logs/page";
import loggingWidgetRoutes from "./observability/logs/widgets";
import notificationsApiRoutes from "./observability/notifications/api";
import notificationsPage from "./observability/notifications/page";
import telemetryPage from "./observability/telemetry/page";
import settingsPage from "./settings/page";
import { makeLegalPage } from "./settings/legal/page-handler";
import { widgetRoutes } from "./widgets";

const termsPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("terms"));
const privacyPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("privacy"));
const imprintPublicPages = new Hono<AuthContext>().get("/", auth.requireRole("*"), ...makeLegalPage("imprint"));

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/admin/gateway/_ssr", routes(app.config))
  .use(
    "/public/*",
    serveStatic({
      root: "./",
      onFound: (_path, c) => {
        c.header("Cache-Control", "public, max-age=31536000, immutable");
      },
    }),
  )
  .get("/admin/gateway", (c) => c.redirect("/admin/gateway/apps"))
  .get("/admin/gateway/apps", auth.requireRole("admin", auth.redirectToLogin), ...gatewayPage)
  .get("/admin/gateway/routes", auth.requireRole("admin", auth.redirectToLogin), ...gatewayPage)
  .get("/admin/observability/logs", auth.requireRole("admin", auth.redirectToLogin), ...logsPage)
  .get("/admin/observability/telemetry", auth.requireRole("admin", auth.redirectToLogin), ...telemetryPage)
  .get("/admin/observability/alerts", auth.requireRole("admin", auth.redirectToLogin), ...alertsPage)
  .get("/admin/observability/notifications", auth.requireRole("admin", auth.redirectToLogin), ...notificationsPage)
  .get("/admin/settings", auth.requireRole("admin", auth.redirectToLogin), ...settingsPage)
  .route("/legal/terms", termsPublicPages)
  .route("/legal/privacy", privacyPublicPages)
  .route("/impressum", imprintPublicPages)
  .route("/api/gateway/widget", widgetRoutes)
  .route("/api/logging/widget", loggingWidgetRoutes)
  .route("/api/logging", loggingApiRoutes)
  .route("/api/notifications", notificationsApiRoutes)
  .route("/api/gateway", apiRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: gatewayOpsLifecycle,
});

export type { ApiType } from "./api";
