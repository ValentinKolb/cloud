/**
 * Core app — thin shell that mounts the platform API (defined in cloud-lib),
 * builds runtime pages, and runs core setup hooks. The API itself lives in
 * `@valentinkolb/cloud/api` so other apps can import its typed client without
 * cross-app imports.
 */
import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AppContext, type AuthContext } from "@valentinkolb/cloud/server";
import { createCoreApiRouter } from "@valentinkolb/cloud/api";
import { createPagesRouter } from "./pages/create";
import { runCoreSetup, startCoreServices, stopCoreServices } from "./runtime-helpers";

/** Per-app Hono context: AuthContext + typed core settings snapshot. */
export type CoreAppContext = AppContext<typeof app>;

const { api } = createCoreApiRouter();
const pages = createPagesRouter();

const coreApi = new Hono().route("/", api);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api", coreApi)
  .route("/", pages);

export default await app.start({
  fetch: router.fetch,
  openapi: coreApi,
  lifecycle: {
    setup: async () => {
      await runCoreSetup();
    },
    start: async () => {
      await startCoreServices();
    },
    stop: async () => {
      await stopCoreServices();
    },
  },
});
