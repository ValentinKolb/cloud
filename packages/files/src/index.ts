import { app } from "./config";
import { Hono } from "hono";
import type { AppContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { filesService } from "./service";
import { filesCapabilities } from "./capabilities";

/** Per-app Hono context: AuthContext + typed snapshot with files.* + core.* settings. */
export type FilesAppContext = AppContext<typeof app>;

export default await app.start({
  capabilities: filesCapabilities,
  router: new Hono()
    .route("/api/files", apiRoutes)
    .route("/app/files", pageRoutes)
    .route("/admin/files", adminPageRoutes),
});
export { filesService as service };
export type { ApiType } from "./api";
