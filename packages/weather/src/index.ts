import { app } from "./config";
import { Hono } from "hono";
import type { AppContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import { weatherSettingsRouter } from "./api/settings";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { weatherCapabilities } from "./capabilities";

/** Per-app Hono context: AuthContext + typed snapshot with weather.* + core.* settings. */
export type WeatherAppContext = AppContext<typeof app>;

// weather business logic + DB migrations live in cloud-lib (see
// `packages/cloud/src/services/weather/`) so other apps (e.g. spaces) can
// consume the same service in-process. core-app runs the migration at boot;
// this app is now just routes + UI + admin.
export default await app.start({
  capabilities: weatherCapabilities,
  routes: {
    api: new Hono()
      .route("/app/weather", apiRoutes)
      .route("/admin/weather/settings", weatherSettingsRouter),
    pages: new Hono().route("/app/weather", pageRoutes).route("/admin/weather", adminPageRoutes),
  },
});
export type { ApiType } from "./api";
