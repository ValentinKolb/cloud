import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { spacesService } from "./service";
import { migrate } from "./migrate";
import { spacesCapabilities } from "./capabilities";

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/spaces", apiRoutes)
  .route("/app/spaces", pageRoutes)
  .route("/admin/spaces", adminPageRoutes);

export default await app.start({
  capabilities: spacesCapabilities,
  fetch: router.fetch,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { spacesService as service };
export type { ApiType } from "./api";
