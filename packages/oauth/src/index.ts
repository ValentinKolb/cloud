import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { oauthService } from "./service";
import { migrate } from "./migrate";

export default await app.start({
  router: new Hono()
    .route("/api/oauth/admin/clients", apiRoutes)
    .route("/", pageRoutes),
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { oauthService as service };
export type { ApiType } from "./api";
export type { OauthService } from "./service";
