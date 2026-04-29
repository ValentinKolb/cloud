import { app } from "./config";
import { Hono } from "hono";
import apiRoutes from "./api";
import verifyRoutes from "./verify";
import adminPageRoutes from "./frontend";
import { proxyAuthService } from "./service";
import { migrate } from "./migrate";

export default await app.start({
  routes: {
    api: new Hono().route("/proxy-auth", apiRoutes),
    // Verify lives at the top-level `/proxy-auth/verify/:clientId` because
    // Traefik forward-auth expects a configurable URL on the public origin.
    pages: new Hono().route("/admin/proxy-auth", adminPageRoutes).route("/proxy-auth", verifyRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
});
export { proxyAuthService as service };
export type { ApiType } from "./api";
export type { ProxyAuthService } from "./service";
