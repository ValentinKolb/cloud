import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { adminPages as adminPageRoutes } from "./frontend";
import { spacesService } from "./service";
import { migrate } from "./migrate";
import { spacesCapabilities } from "./capabilities";

export default await app.start({
  capabilities: spacesCapabilities,
  routes: {
    api: new Hono().route("/app/spaces", apiRoutes),
    pages: new Hono().route("/app/spaces", pageRoutes).route("/admin/spaces", adminPageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { spacesService as service };
export type { ApiType } from "./api";
