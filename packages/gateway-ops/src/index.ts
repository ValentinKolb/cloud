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
import { metricsEndpoint } from "./observability/metrics/endpoint";
import metricsPage from "./observability/metrics/page";
import notificationsApiRoutes from "./observability/notifications/api";
import notificationsPage from "./observability/notifications/page";
import postgresPage from "./observability/postgres/page";
import redisPage from "./observability/redis/page";
import telemetryPage from "./observability/telemetry/page";
import { widgetRoutes } from "./widgets";

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
  .get("/admin/observability/metrics", auth.requireRole("admin", auth.redirectToLogin), ...metricsPage)
  .get("/admin/observability/data", auth.requireRole("admin", auth.redirectToLogin), (c) => c.redirect("/admin/observability/postgres"))
  .get("/admin/observability/postgres", auth.requireRole("admin", auth.redirectToLogin), ...postgresPage)
  .get("/admin/observability/redis", auth.requireRole("admin", auth.redirectToLogin), ...redisPage)
  .get("/admin/observability/alerts", auth.requireRole("admin", auth.redirectToLogin), ...alertsPage)
  .get("/admin/observability/notifications", auth.requireRole("admin", auth.redirectToLogin), ...notificationsPage)
  .get("/metrics", auth.requireRole("*"), metricsEndpoint)
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
