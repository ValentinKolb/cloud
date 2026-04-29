import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { oauthService } from "./service";
import { migrate } from "./migrate";

export default await app.start({
  routes: {
    api: new Hono().route("/oauth/admin/clients", apiRoutes),
    pages: new Hono().route("/", pageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { oauthService as service };
export type { ApiType } from "./api";
export type { OauthService } from "./service";
