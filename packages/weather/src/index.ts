import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AppContext, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { weatherCapabilities } from "./capabilities";

/** Per-app Hono context: AuthContext + typed snapshot with weather.* + core.* settings. */
export type WeatherAppContext = AppContext<typeof app>;

// weather business logic + DB migrations live in cloud-lib (see
// `packages/cloud/src/services/weather/`) so other apps (e.g. spaces) can
// consume the same service in-process. core-app runs the migration at boot;
// this app is now just routes + UI + admin.
const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/weather", apiRoutes)
  .route("/app/weather", pageRoutes)
  .route("/admin/weather", adminPageRoutes);

export default await app.start({
  capabilities: weatherCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
});
export type { ApiType } from "./api";
