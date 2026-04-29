import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AppContext, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { filesService } from "./service";
import { filesCapabilities } from "./capabilities";

/** Per-app Hono context: AuthContext + typed snapshot with files.* + core.* settings. */
export type FilesAppContext = AppContext<typeof app>;

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/files", apiRoutes)
  .route("/app/files", pageRoutes)
  .route("/admin/files", adminPageRoutes);

export default await app.start({
  capabilities: filesCapabilities,
  fetch: router.fetch,
  openapi: apiRoutes,
});
export { filesService as service };
export type { ApiType } from "./api";
