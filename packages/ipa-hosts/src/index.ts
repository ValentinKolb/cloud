import { type AuthContext, auth, middleware } from "@valentinkolb/cloud/server";
import { Hono } from "hono";
import apiRoutes from "./api";
import { ipaHosts } from "./backend";
import { app } from "./config";
import adminPageRoutes from "./frontend";
import { ipaHostsHelp } from "./help";
import { migrate } from "./migrate";
import { ipaHostsService } from "./service";

const helpRoutes = new Hono<AuthContext>().use(auth.requireRole("admin")).route("/", ipaHostsHelp.router);

const router = new Hono<AuthContext>()
  .use("*", middleware.runtime())
  .use("*", middleware.settings())
  .route("/api/ipa-hosts/help", helpRoutes)
  .route("/api/ipa-hosts", apiRoutes)
  .route("/admin/ipa-hosts", adminPageRoutes);

export default await app.start({
  fetch: router.fetch,
  openapi: apiRoutes,
  lifecycle: {
    setup: async () => {
      await migrate();
    },
    start: async () => {
      await ipaHosts.sync.start();
    },
    stop: async () => {
      await ipaHosts.sync.stop();
    },
  },
});
export type { ApiType } from "./api";
export type { IpaHostsService } from "./service";
export { ipaHostsService as service };
