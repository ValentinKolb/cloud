import { Hono } from "hono";
import type { AppFacade } from "@valentinkolb/cloud/contracts/app";
import apiRoutes from "./api";
import verifyRoutes from "./verify";
import adminPageRoutes from "./pages";
import { proxyAuthService } from "./service";
import { migrate } from "./migrate";

const app = {
  meta: {
    id: "proxy-auth",
    name: "Proxy Auth",
    icon: "ti ti-load-balancer",
    description: "Configure forward-auth clients and verify callback access flows.",
    color: "blue",
    adminHref: "/admin/proxy-auth",
  },
  service: proxyAuthService,
  routes: {
    api: new Hono().route("/admin/proxy-auth", apiRoutes).route("/proxy-auth", verifyRoutes),
    pages: new Hono().route("/admin/proxy-auth", adminPageRoutes),
  },
  lifecycle: {
    setup: async () => {
      await migrate();
    },
  },
} satisfies AppFacade<typeof proxyAuthService>;

export default app;
export { proxyAuthService as service };
export type { ApiType } from "./api";
export type { ProxyAuthService } from "./service";
