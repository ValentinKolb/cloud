import { app } from "./config";
import { Hono } from "hono";
import { auth, middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import pageRoutes from "./frontend";
import { oauthService } from "./service";
import { migrate } from "./migrate";
import { oauthHelp } from "./help";

const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("admin")).route("/", oauthHelp.router);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/oauth/help", helpRoutes)
  .route("/api/oauth/admin/clients", apiRoutes)
  .route("/", pageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { oauthService as service };
export type { ApiType } from "./api";
export type { OauthService } from "./service";
