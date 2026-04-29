import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import verifyRoutes from "./verify";
import adminPageRoutes from "./frontend";
import { proxyAuthService } from "./service";
import { migrate } from "./migrate";

export default await app.start({
  // Verify lives at the top-level `/proxy-auth/verify/:clientId` because
  // Traefik forward-auth expects a configurable URL on the public origin.
  router: new Hono()
    .route("/api/proxy-auth", apiRoutes)
    .route("/admin/proxy-auth", adminPageRoutes)
    .route("/proxy-auth", verifyRoutes),
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { proxyAuthService as service };
export type { ApiType } from "./api";
export type { ProxyAuthService } from "./service";
