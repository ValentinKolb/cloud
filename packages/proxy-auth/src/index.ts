import { app } from "./config";
import { Hono } from "hono";
import { middleware, type AuthContext } from "@valentinkolb/cloud/server";
import apiRoutes from "./api";
import verifyRoutes from "./verify";
import adminPageRoutes from "./frontend";
import { proxyAuthService } from "./service";
import { migrate } from "./migrate";

// Verify lives at the top-level `/proxy-auth/verify/:clientId` because
// Traefik forward-auth expects a configurable URL on the public origin.
const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/proxy-auth", apiRoutes)
  .route("/admin/proxy-auth", adminPageRoutes)
  .route("/proxy-auth", verifyRoutes);

export default await app.start({
  fetch: router.fetch,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { proxyAuthService as service };
export type { ApiType } from "./api";
export type { ProxyAuthService } from "./service";
