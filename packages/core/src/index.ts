/**
 * Core app — thin shell that mounts the platform API (defined in cloud-lib),
 * builds runtime pages, and runs core setup hooks. The API itself lives in
 * `@valentinkolb/cloud/api` so other apps can import its typed client without
 * cross-app imports.
 */

import { createCoreApiRouter, createMcpProtectedResourceRoutes } from "@valentinkolb/cloud/api";
import { type AppContext, type AuthContext, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import { websocket } from "hono/bun";
import { app } from "./config";
import { coreHelp } from "./help";
import { createCoreNotificationSender } from "./notifications";
import notificationWebSocketRoutes from "./notifications-ws";
import { createPagesRouter } from "./pages/create";
import { runCoreSetup, startCoreServices, stopCoreServices } from "./runtime-helpers";

/** Per-app Hono context: AuthContext + typed core settings snapshot. */
export type CoreAppContext = AppContext<typeof app>;

const notificationSender = createCoreNotificationSender(app.notifications);
const { api } = createCoreApiRouter({ notifications: notificationSender });
const pages = createPagesRouter();
const mcpProtectedResource = createMcpProtectedResourceRoutes();

const coreApi = new Hono().route("/", api);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/", mcpProtectedResource)
  .route("/api/me/notifications/ws", notificationWebSocketRoutes)
  .route("/api", coreApi)
  .route("/", pages);

const result = await app.start({
  fetch: router.fetch,
  help: coreHelp,
  openapi: coreApi,
  lifecycle: {
    setup: async () => {
      await runCoreSetup();
    },
    start: async () => {
      await startCoreServices(notificationSender);
    },
    stop: async () => {
      await stopCoreServices();
    },
  },
});

export default { ...result, websocket };
